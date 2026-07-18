# Changelog

## Unreleased

- Publish each workflow release to GitHub Packages as `@nebur242/lizflow-license` in addition to npm.

## 0.2.10

- Normalize wrapped attestation API responses so the CLI always emits a stable
  top-level `accepted` result for CI consumers.

## 0.1.0

- Added signed LizFlow runtime lease verification.
- Added Next.js, Vercel, Netlify, Node, and browser adapters.
- Added browser public-status mode for static frontend apps.
- Added workflow attestation CLI with build output auto-detection and root fallback.
- Added manual release workflow and npm publishing scripts.
