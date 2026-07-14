import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import { withLizFlowLicense as withNextLizFlowLicense } from "../dist/adapters/next.js";
import { withLizFlowLicense as withNetlifyLizFlowLicense } from "../dist/adapters/netlify.js";
import { lizFlowLicenseMiddleware } from "../dist/adapters/node.js";

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

function optionsFor(fixture, fetch = leaseFetch(fixture)) {
  return {
    apiUrl: "https://api.lizflow.test",
    deploymentId: "deployment-test",
    deploymentSecret: "deployment-secret",
    licenseId: "license-test",
    publicKey: fixture.publicKey,
    fetch,
  };
}

function leaseFetch(fixture) {
  return async () =>
    Response.json({
      lease: fixture.token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "active",
      publicKey: "ignored-response-key",
    });
}

test("next adapter allows valid leases and returns no blocking response", async () => {
  const fixture = signedLease();
  const middleware = withNextLizFlowLicense(optionsFor(fixture));

  const response = await middleware(new Request("https://example.com/dashboard"));

  assert.equal(response, undefined);
});

test("next adapter returns a denial response for invalid leases", async () => {
  const fixture = signedLease({ hostname: "other.example.com" });
  const middleware = withNextLizFlowLicense(optionsFor(fixture));

  const response = await middleware(new Request("https://example.com/dashboard"));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "LIZFLOW_LICENSE_UNAVAILABLE",
    message: "Lease belongs to another hostname",
  });
});

test("netlify adapter calls context.next only after a valid lease", async () => {
  const fixture = signedLease();
  const middleware = withNetlifyLizFlowLicense(optionsFor(fixture));
  let calledNext = false;

  const response = await middleware(new Request("https://example.com/"), {
    next: async () => {
      calledNext = true;
      return new Response("ok");
    },
  });

  assert.equal(calledNext, true);
  assert.equal(await response.text(), "ok");
});

test("node adapter parses host headers with ports", async () => {
  const fixture = signedLease({ hostname: "example.com" });
  const middleware = lizFlowLicenseMiddleware(optionsFor(fixture));
  let calledNext = false;

  await middleware(
    { headers: { host: "example.com:3000" } },
    nodeResponse(),
    () => {
      calledNext = true;
    },
  );

  assert.equal(calledNext, true);
});

test("node adapter preserves IPv6 hostnames", async () => {
  const fixture = signedLease({ hostname: "::1" });
  const middleware = lizFlowLicenseMiddleware(optionsFor(fixture));
  let calledNext = false;

  await middleware(
    { headers: { host: "[::1]:3000" } },
    nodeResponse(),
    () => {
      calledNext = true;
    },
  );

  assert.equal(calledNext, true);
});

function nodeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body = "") {
      this.body = body;
    },
  };
}
