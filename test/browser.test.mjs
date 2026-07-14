import assert from "node:assert/strict";
import test from "node:test";

import { createLizFlowBrowserClient } from "../dist/browser.js";

test("browser client fetches public deployment status with explicit values", async () => {
  const client = createLizFlowBrowserClient({
    apiUrl: "https://api.lizflow.test/api/v1",
    deploymentId: "dep_123",
    hostname: "app.example.com",
    fetch: async (url, init) => {
      const parsed = new URL(url);
      assert.equal(
        `${parsed.origin}${parsed.pathname}`,
        "https://api.lizflow.test/api/v1/runtime-entitlements/public-status",
      );
      assert.equal(parsed.searchParams.get("deploymentId"), "dep_123");
      assert.equal(parsed.searchParams.get("hostname"), "app.example.com");
      assert.equal(init.method, "GET");
      assert.equal(init.cache, "default");
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
  assert.equal(status.hostname, "app.example.com");
});

test("browser client exposes the public status URL", () => {
  const client = createLizFlowBrowserClient({
    apiUrl: "https://api.lizflow.test/api/v1/",
    deploymentId: "dep_123",
    hostname: "app.example.com",
  });

  const url = new URL(client.statusUrl());

  assert.equal(
    `${url.origin}${url.pathname}`,
    "https://api.lizflow.test/api/v1/runtime-entitlements/public-status",
  );
  assert.equal(url.searchParams.get("deploymentId"), "dep_123");
  assert.equal(url.searchParams.get("hostname"), "app.example.com");
});

test("browser client requires explicit public values", () => {
  assert.throws(
    () =>
      createLizFlowBrowserClient({
        apiUrl: "",
        deploymentId: "dep_123",
        hostname: "app.example.com",
      }),
    /requires apiUrl/,
  );
  assert.throws(
    () =>
      createLizFlowBrowserClient({
        apiUrl: "https://api.lizflow.test/api/v1",
        deploymentId: "",
        hostname: "app.example.com",
      }),
    /requires deploymentId/,
  );
  assert.throws(
    () =>
      createLizFlowBrowserClient({
        apiUrl: "https://api.lizflow.test/api/v1",
        deploymentId: "dep_123",
        hostname: "",
      }),
    /requires hostname/,
  );
});
