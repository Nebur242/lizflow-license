import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  LizFlowLicenseClient,
  verifyLease,
} from "../dist/index.js";

function signedLease(overrides = {}, keyPair = generateKeyPairSync("ed25519")) {
  const { privateKey, publicKey } = keyPair;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "EdDSA", typ: "JWT" });
  const payload = encode({
    iss: "lizflow",
    aud: "lizflow-runtime",
    sub: "deployment-test",
    entitlementId: "entitlement-test",
    projectId: "project-test",
    userLicenseId: "license-test",
    status: "active",
    hostname: "example.com",
    attested: true,
    exp: now + 60,
    iat: now,
    ...overrides,
  });
  const input = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(input), privateKey).toString("base64url");
  return {
    token: `${input}.${signature}`,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function clientFor(fixture, overrides = {}) {
  return new LizFlowLicenseClient({
    apiUrl: "https://api.lizflow.test",
    deploymentId: "deployment-test",
    deploymentSecret: "deployment-secret",
    licenseId: "license-test",
    publicKey: fixture.publicKey,
    fetch: async () =>
      Response.json({
        lease: fixture.token,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "active",
        publicKey: overrides.responsePublicKey || fixture.publicKey,
      }),
    ...overrides,
  });
}

test("verifies an Ed25519 LizFlow lease", async () => {
  const fixture = signedLease();
  const claims = await verifyLease(fixture.token, fixture.publicKey);
  assert.equal(claims.sub, "deployment-test");
});

test("rejects a tampered LizFlow lease", async () => {
  const fixture = signedLease();
  const parts = fixture.token.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({
      iss: "lizflow",
      aud: "lizflow-runtime",
      sub: "another-deployment",
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString("base64url");
  await assert.rejects(() => verifyLease(parts.join("."), fixture.publicKey));
});

test("client verifies leases with the pinned LizFlow public key", async () => {
  const fixture = signedLease();
  const attacker = generateKeyPairSync("ed25519");
  const client = clientFor(fixture, {
    responsePublicKey: attacker.publicKey.export({ type: "spki", format: "pem" }).toString(),
  });

  const decision = await client.check("example.com");

  assert.equal(decision.allowed, true);
});

test("client rejects leases without a pinned LizFlow public key", async () => {
  const fixture = signedLease();
  const client = new LizFlowLicenseClient({
    apiUrl: "https://api.lizflow.test",
    deploymentId: "deployment-test",
    deploymentSecret: "deployment-secret",
    fetch: async () =>
      Response.json({
        lease: fixture.token,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "active",
        publicKey: fixture.publicKey,
      }),
  });

  const decision = await client.check("example.com");

  assert.equal(decision.allowed, false);
  assert.match(decision.message, /Missing LizFlow runtime environment variables/);
});

test("client rejects leases for another license", async () => {
  const fixture = signedLease({ userLicenseId: "license-other" });
  const client = clientFor(fixture);

  const decision = await client.check("example.com");

  assert.equal(decision.allowed, false);
  assert.match(decision.message, /another license/);
});

test("client rejects leases for another hostname", async () => {
  const fixture = signedLease({ hostname: "other.example.com" });
  const client = clientFor(fixture);

  const decision = await client.check("example.com");

  assert.equal(decision.allowed, false);
  assert.match(decision.message, /another hostname/);
});

test("client does not reuse a cached lease for another hostname", async () => {
  let calls = 0;
  const keyPair = generateKeyPairSync("ed25519");
  const first = signedLease({ hostname: "one.example.com" }, keyPair);
  const second = signedLease({ hostname: "two.example.com" }, keyPair);
  const client = clientFor(first, {
    fetch: async () => {
      calls += 1;
      const fixture = calls === 1 ? first : second;
      return Response.json({
        lease: fixture.token,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "active",
        publicKey: fixture.publicKey,
      });
    },
  });

  const firstDecision = await client.check("one.example.com");
  const secondDecision = await client.check("two.example.com");

  assert.equal(firstDecision.allowed, true);
  assert.equal(secondDecision.allowed, true);
  assert.equal(calls, 2);
});

test("client fails closed when the lease request times out", async () => {
  const fixture = signedLease();
  const client = clientFor(fixture, {
    fetchTimeoutMs: 10,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });

  const decision = await client.check("example.com");

  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 503);
  assert.match(decision.message, /aborted/);
});

test("client lets developers pass an explicit request hostname", async () => {
  const fixture = signedLease({ hostname: "app.example.com" });
  const client = clientFor(fixture);
  const request = new Request("https://app.example.com/dashboard");

  const decision = await client.check(new URL(request.url).hostname);

  assert.equal(decision.allowed, true);
});

test("client normalizes explicit hostnames with ports", async () => {
  const fixture = signedLease({ hostname: "example.com" });
  const client = clientFor(fixture);

  const decision = await client.check("example.com:3000");

  assert.equal(decision.allowed, true);
});

test("client lets developers handle denied decisions explicitly", async () => {
  const fixture = signedLease({ hostname: "licensed.example.com" });
  const client = clientFor(fixture);

  const decision = await client.check("other.example.com");

  assert.equal(decision.allowed, false);
  assert.equal(decision.status, 503);
  assert.equal(decision.code, "LIZFLOW_LICENSE_UNAVAILABLE");
  assert.equal(decision.message, "Lease belongs to another hostname");
});
