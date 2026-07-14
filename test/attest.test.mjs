import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, symlink, writeFile } from "node:fs/promises";
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

test("manifest hash frames paths and content unambiguously", async () => {
  const first = await hashTempFiles([
    ["ab", "c"],
  ]);
  const second = await hashTempFiles([
    ["a", "bc"],
  ]);

  assert.notEqual(first, second);
});

test("attestation rejects symlinks", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "target.js"), "console.log('target');");
    await symlink(join(dir, "target.js"), join(dir, "linked.js"));

    await assert.rejects(() => manifestHash("."), /Refusing to attest symlink/);
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
