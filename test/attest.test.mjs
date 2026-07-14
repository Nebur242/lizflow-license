import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { manifestHash, resolveBuildDirectory } from "../dist/cli/attest.js";

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
