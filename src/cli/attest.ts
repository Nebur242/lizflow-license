#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

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

async function main() {
  const apiUrl = required("LIZFLOW_API_URL").replace(/\/$/, "");
  const deploymentId = required("LIZFLOW_DEPLOYMENT_ID");
  const secret = required("LIZFLOW_DEPLOYMENT_SECRET");
  const args = process.argv.slice(2);
  const buildDirectory = (args[0] === "attest" ? args[1] : args[0]) || "dist";
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

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
