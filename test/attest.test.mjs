import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveBuildDirectory } from "../dist/cli/attest.js";

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

test("attest CLI fails clearly when no build output exists", async () => {
  await withTempDir(async () => {
    await assert.rejects(
      () => resolveBuildDirectory(),
      /No build output directory found/,
    );
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
