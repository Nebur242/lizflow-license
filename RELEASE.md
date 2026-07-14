# Release management

`@lizflow/license` is released manually. There is no automatic release on push or merge.

## One-time setup

Add this repository secret in GitHub:

```text
NPM_TOKEN
```

The token needs permission to publish `@lizflow/license` to npm.

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
- create the matching `vX.Y.Z` git tag
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
- create an annotated `vX.Y.Z` git tag
- push the commit and tag
- publish to npm with provenance
- create a GitHub release with generated notes

## Raw manual fallback

If you do not want to use the helper scripts:

```bash
npm version patch
npm test
npm audit --omit=dev
npm publish
git push origin HEAD --follow-tags
```

Use `minor` or `major` instead of `patch` when needed.
