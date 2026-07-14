#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIRECTORY = ".";
const DEFAULT_BUILD_DIRECTORIES = [
  "dist",
  "build",
  "www",
  "wwwroot",
  ".next",
  ".output",
  "out",
  "public",
  "storybook-static",
  "coverage/lcov-report",
  "dist/browser",
  "dist/client",
  "build/client",
  ".vercel/output",
];
const EXCLUDED_ROOT_ENTRIES = new Set([
  ".DS_Store",
  ".cache",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".git",
  ".github",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "logs",
  "node_modules",
  "npm-debug.log",
]);
const EXCLUDED_ROOT_SUFFIXES = [".log", ".tgz"];

export async function manifestHash(root: string) {
  const hash = createHash("sha256");
  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory)).sort();
    for (const entry of entries) {
      const path = join(directory, entry);
      const relativePath = relative(root, path);
      if (shouldExclude(root, relativePath, entry)) {
        continue;
      }
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new Error(`Refusing to attest symlink: ${relativePath}`);
      }
      if (info.isDirectory()) await visit(path);
      else {
        hashManifestFile(hash, relativePath, await readFile(path));
      }
    }
  }
  await visit(root);
  return `sha256:${hash.digest("hex")}`;
}

function hashManifestFile(
  hash: ReturnType<typeof createHash>,
  path: string,
  content: Uint8Array,
) {
  const pathBytes = Buffer.from(path);
  const pathLength = Buffer.allocUnsafe(8);
  const contentLength = Buffer.allocUnsafe(8);
  pathLength.writeBigUInt64BE(BigInt(pathBytes.byteLength));
  contentLength.writeBigUInt64BE(BigInt(content.byteLength));

  hash.update("file:v1");
  hash.update(pathLength);
  hash.update(pathBytes);
  hash.update(contentLength);
  hash.update(content);
}

export async function main() {
  const apiUrl = required("LIZFLOW_API_URL").replace(/\/$/, "");
  const deploymentId = required("LIZFLOW_DEPLOYMENT_ID");
  const secret = required("LIZFLOW_DEPLOYMENT_SECRET");
  const args = process.argv.slice(2);
  const requestedBuildDirectory = args[0] === "attest" ? args[1] : args[0];
  const buildDirectory = await resolveBuildDirectory(requestedBuildDirectory);
  const response = await fetch(`${apiUrl}/runtime-entitlements/attestations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lizflow-deployment-secret": secret,
    },
    body: JSON.stringify({
      deploymentId,
      commitSha: process.env.GITHUB_SHA || required("LIZFLOW_COMMIT_SHA"),
      workflowRunId:
        process.env.GITHUB_RUN_ID || required("LIZFLOW_WORKFLOW_RUN_ID"),
      repository: process.env.GITHUB_REPOSITORY,
      environment: process.env.ENVIRONMENT,
      manifestHash: await manifestHash(buildDirectory),
    }),
  });
  if (!response.ok)
    throw new Error(`LizFlow attestation failed (${response.status})`);
  process.stdout.write(`${JSON.stringify(await response.json())}\n`);
}

export async function resolveBuildDirectory(requested?: string) {
  if (requested) {
    await assertDirectory(requested);
    return requested;
  }

  for (const directory of DEFAULT_BUILD_DIRECTORIES) {
    if (await isDirectory(directory)) {
      return directory;
    }
  }

  return ROOT_DIRECTORY;
}

async function assertDirectory(path: string) {
  if (!(await isDirectory(path))) {
    throw new Error(`Build output directory not found: ${path}`);
  }
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function shouldExclude(root: string, relativePath: string, entry: string) {
  if (root !== ROOT_DIRECTORY) {
    return false;
  }
  const topLevelEntry = relativePath.split(/[\\/]/)[0] || entry;
  return (
    EXCLUDED_ROOT_ENTRIES.has(topLevelEntry) ||
    EXCLUDED_ROOT_SUFFIXES.some((suffix) => entry.endsWith(suffix))
  );
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
