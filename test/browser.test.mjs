import assert from "node:assert/strict";
import test from "node:test";

import { createLizFlowBrowserClient } from "../dist/adapters/browser.js";

test("browser client lets apps fetch and render custom license status", async () => {
  const client = createLizFlowBrowserClient({
    statusUrl: "/license-status",
    fetch: async (url, init) => {
      assert.equal(url, "/license-status");
      assert.equal(init.method, "GET");
      return Response.json({
        allowed: true,
        status: "active",
        deploymentId: "dep_123",
        entitlementId: "ent_123",
        projectId: "proj_123",
        userLicenseId: "lic_123",
        hostname: "example.com",
        attested: true,
        expiresAt: "2026-07-14T00:00:00.000Z",
      });
    },
  });

  const status = await client.getStatus();
  assert.equal(status.allowed, true);
  assert.equal(status.status, "active");
});

test("browser client can fetch public deployment status without secrets", async () => {
  const client = createLizFlowBrowserClient({
    apiUrl: "https://api.lizflow.test/api/v1",
    deploymentId: "dep_123",
    hostname: "example.com",
    fetch: async (url, init) => {
      const parsed = new URL(url);
      assert.equal(
        `${parsed.origin}${parsed.pathname}`,
        "https://api.lizflow.test/api/v1/runtime-entitlements/public-status",
      );
      assert.equal(parsed.searchParams.get("deploymentId"), "dep_123");
      assert.equal(parsed.searchParams.get("hostname"), "example.com");
      assert.equal(init.method, "GET");
      assert.equal(init.cache, "default");
      return Response.json({
        allowed: true,
        status: "active",
        hostname: "example.com",
        nextCheckAt: "2026-07-14T00:05:00.000Z",
      });
    },
  });

  const status = await client.getStatus();
  assert.equal(status.allowed, true);
  assert.equal(status.hostname, "example.com");
});

test("browser client passes window hostname in public status mode", async () => {
  const originalLocation = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { href: "https://app.example.com/dashboard", hostname: "app.example.com" },
  });

  try {
    const client = createLizFlowBrowserClient({
      apiUrl: "https://api.lizflow.test/api/v1",
      deploymentId: "dep_123",
      fetch: async (url) => {
        const parsed = new URL(url);
        assert.equal(parsed.searchParams.get("hostname"), "app.example.com");
        return Response.json({
          allowed: true,
          status: "active",
          hostname: "app.example.com",
          nextCheckAt: "2026-07-14T00:05:00.000Z",
        });
      },
    });

    const status = await client.getStatus();
    assert.equal(status.allowed, true);
  } finally {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: originalLocation,
    });
  }
});

test("browser client requires a hostname in public status mode", async () => {
  const client = createLizFlowBrowserClient({
    apiUrl: "https://api.lizflow.test/api/v1",
    deploymentId: "dep_123",
    fetch: async () => {
      throw new Error("fetch should not be called");
    },
  });

  await assert.rejects(() => client.getStatus(), /requires a hostname/);
});
