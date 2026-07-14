#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

async function manifestHash(root: string) {
  const hash = createHash("sha256");
  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory)).sort();
    for (const entry of entries) {
      const path = join(directory, entry);
      const info = await stat(path);
      if (info.isDirectory()) await visit(path);
      else {
        hash.update(relative(root, path));
        hash.update(await readFile(path));
      }
    }
  }
  await visit(root);
  return `sha256:${hash.digest("hex")}`;
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

  throw new Error(
    `No build output directory found. Tried: ${DEFAULT_BUILD_DIRECTORIES.join(
      ", ",
    )}. Pass one explicitly, for example: lizflow-license attest build`,
  );
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
