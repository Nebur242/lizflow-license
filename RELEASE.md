# Release management

`@lizflow/license` is released manually. There is no automatic release on push or merge. The GitHub release workflow publishes the same version and built artifacts to both npm and GitHub Packages:

- npm: `@lizflow/license`
- GitHub Packages: `@nebur242/lizflow-license`

## One-time setup

Add this repository secret in GitHub:

```text
NPM_TOKEN
```

The token needs permission to publish `@lizflow/license` to npm.

GitHub Packages uses the workflow's built-in `GITHUB_TOKEN`; no additional repository secret is needed. The workflow publishes under the `@nebur242` scope because GitHub Packages requires the package scope to match the GitHub account or organization that owns it.

## Local preflight

Run this before starting a release:

```bash
npm run release:dry-run
```

This builds the package, runs tests, audits production dependencies, and performs an npm publish dry run.

## Release from your terminal

Choose the release type yourself:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Each command will:

- bump the package version with `npm version`
- create the matching `vX.Y.Z` git tag using your local git/npm configuration
- run tests
- audit production dependencies
- publish to npm
- push the commit and tag

## Release from GitHub manually

Open the `Release` workflow and run it manually.

Inputs:

- `version`: choose `patch`, `minor`, or `major`
- `npm_tag`: choose `latest`, `next`, or `beta`

The workflow will:

- install dependencies with `npm ci`
- run tests before changing the version
- audit production dependencies
- verify package contents
- bump `package.json` and `package-lock.json`
- verify the new version is not already published
- commit the version bump
- push the version commit
- publish to npm with provenance
- publish the same version to GitHub Packages
- create the `vX.Y.Z` tag and GitHub release with generated notes through GitHub

After the first GitHub Packages publish, set the package visibility and access policy you want on its GitHub package settings page. Consumers need a token with `read:packages` even when the package is public.

## Raw manual fallback

If you do not want to use the helper scripts, the following publishes only to npm:

```bash
npm version patch
npm test
npm audit --omit=dev
npm publish
git push origin HEAD --follow-tags
```

Use `minor` or `major` instead of `patch` when needed.
