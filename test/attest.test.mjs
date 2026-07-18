import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  isDirectExecution,
  manifestHash,
  normalizeAttestationResponse,
  resolveBuildDirectory,
} from "../dist/cli/attest.js";

const execFileAsync = promisify(execFile);

test("attest CLI defaults to dist when no build directory is passed", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "dist"));

    assert.equal(await resolveBuildDirectory(), "dist");
  });
});

test("attest CLI falls back to build when dist is missing", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "build"));

    assert.equal(await resolveBuildDirectory(), "build");
  });
});

test("attest CLI checks additional common build output directories", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "www"));

    assert.equal(await resolveBuildDirectory(), "www");
  });
});

test("attest CLI honors an explicit build directory", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "custom-output"));

    assert.equal(await resolveBuildDirectory("custom-output"), "custom-output");
  });
});

test("attest CLI falls back to the project root when no build output exists", async () => {
  await withTempDir(async () => {
    assert.equal(await resolveBuildDirectory(), ".");
  });
});

test("root attestation ignores noisy and sensitive files", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "app.js"), "console.log('app');");

    const firstHash = await manifestHash(".");

    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "dep.js"), "changed");
    await writeFile(join(dir, ".env"), "SECRET=changed");
    await writeFile(join(dir, "debug.log"), "changed");
    await writeFile(join(dir, "package.tgz"), "changed");

    assert.equal(await manifestHash("."), firstHash);
  });
});

test("manifest hash frames paths and content unambiguously", async () => {
  const first = await hashTempFiles([
    ["ab", "c"],
  ]);
  const second = await hashTempFiles([
    ["a", "bc"],
  ]);

  assert.notEqual(first, second);
});

test("attestation hashes symlink metadata without following the target", async () => {
  await withTempDir(async (dir) => {
    const routeDirectory = join(dir, "functions", "[locale]", "admin", "categories", "[id]");
    const link = join(routeDirectory, "edit.rsc.func");
    await mkdir(routeDirectory, { recursive: true });
    await symlink("../../../../shared/route-a.func", link);
    const firstHash = await manifestHash(".");

    await unlink(link);
    await symlink("../../../../shared/route-b.func", link);

    assert.notEqual(await manifestHash("."), firstHash);
  });
});

test("attestation response normalization supports API envelopes", () => {
  assert.deepEqual(
    normalizeAttestationResponse({
      success: true,
      statusCode: 202,
      data: {
        accepted: true,
        attestationId: "attestation-1",
        deploymentId: "deployment-1",
      },
    }),
    {
      accepted: true,
      attestationId: "attestation-1",
      deploymentId: "deployment-1",
    },
  );
});

test("attestation response normalization keeps direct responses compatible", () => {
  assert.deepEqual(normalizeAttestationResponse({ accepted: true }), {
    accepted: true,
  });
  assert.throws(
    () => normalizeAttestationResponse({ data: { status: "ok" } }),
    /invalid response/,
  );
});

test("attest CLI executes through an npm-style bin symlink", async () => {
  await withTempDir(async (dir) => {
    const buildDirectory = join(dir, "build-output");
    const binPath = join(dir, "lizflow-license");
    const cliPath = fileURLToPath(new URL("../dist/cli/attest.js", import.meta.url));
    await mkdir(buildDirectory);
    await writeFile(join(buildDirectory, "app.js"), "console.log('built');");
    await symlink(cliPath, binPath);

    assert.equal(isDirectExecution(binPath), true);

    let received;
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        received = {
          authorization: request.headers["x-lizflow-deployment-secret"],
          body: JSON.parse(body),
        };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: true,
            statusCode: 202,
            data: { accepted: true },
          }),
        );
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      assert(address && typeof address === "object");
      const result = await execFileAsync(process.execPath, [binPath, "attest", buildDirectory], {
        env: {
          ...process.env,
          LIZFLOW_API_URL: `http://127.0.0.1:${address.port}`,
          LIZFLOW_DEPLOYMENT_ID: "deployment-test",
          LIZFLOW_DEPLOYMENT_SECRET: "deployment-secret",
          GITHUB_SHA: "commit-sha",
          GITHUB_RUN_ID: "workflow-run",
          GITHUB_REPOSITORY: "lizflow/example",
          ENVIRONMENT: "production",
        },
      });

      assert.deepEqual(JSON.parse(result.stdout), { accepted: true });
      assert.equal(received.authorization, "deployment-secret");
      assert.equal(received.body.deploymentId, "deployment-test");
      assert.equal(received.body.commitSha, "commit-sha");
      assert.equal(received.body.workflowRunId, "workflow-run");
      assert.equal(received.body.repository, "lizflow/example");
      assert.equal(received.body.environment, "production");
      assert.match(received.body.manifestHash, /^sha256:[a-f0-9]{64}$/);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

async function withTempDir(run) {
  const cwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "lizflow-attest-"));
  try {
    process.chdir(dir);
    await run(dir);
  } finally {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  }
}

async function hashTempFiles(files) {
  let digest;
  await withTempDir(async (dir) => {
    for (const [path, content] of files) {
      await writeFile(join(dir, path), content);
    }
    digest = await manifestHash(".");
  });
  return digest;
}
