# @lizflow/license

LizFlow's runtime enforcement package obtains short-lived, signed leases from the LizFlow API. LizFlow provides the deployment values in the dashboard; developers add those values to their hosting provider or CI environment and choose the adapter that matches their app.

The package is intentionally explicit. It does not hide the integration or silently modify your workflow. LizFlow verifies that the app is wired correctly by checking runtime lease requests, hostnames, license status, and build attestations.

## Runtime trust model

The package does not identify a LizFlow app by package name. It identifies the running app by verifying a signed LizFlow lease.

Required server/runtime values:

```env
LIZFLOW_API_URL=...
LIZFLOW_DEPLOYMENT_ID=...
LIZFLOW_DEPLOYMENT_SECRET=...
LIZFLOW_LICENSE_PUBLIC_KEY=...
```

Optional runtime value:

```env
LIZFLOW_LICENSE_ID=...
LIZFLOW_FETCH_TIMEOUT_MS=5000
```

On each check, the package sends the deployment ID and deployment secret to LizFlow. LizFlow returns a short-lived Ed25519-signed lease. The package verifies that lease with the pinned `LIZFLOW_LICENSE_PUBLIC_KEY`; it does not trust a public key returned by the lease response.

A lease is accepted only when:

- the signature was created by LizFlow's pinned public key
- the lease is not expired
- the signed deployment ID matches `LIZFLOW_DEPLOYMENT_ID`
- the signed license ID matches `LIZFLOW_LICENSE_ID`, when configured
- the signed hostname matches the current request hostname, when provided

This means the app is allowed to run only when LizFlow has signed a current lease for this exact deployment, optional license, and host.

The package is published with zero deployment-specific values baked in. Add the values from the LizFlow dashboard to the environment where the package runs. Runtime lease requests fail closed and use a 5 second timeout by default.

## Developer setup contract

1. Create or open a deployment in LizFlow.
2. Copy the LizFlow-provided environment values into your hosting provider or CI secrets.
3. Install this package.
4. Add the server/edge adapter for hard enforcement, or the browser helper for display-only status.
5. Add the attestation command to your build workflow when using hard runtime enforcement.
6. Check the LizFlow dashboard for setup health: last lease request, attestation status, hostname match, and license status.

LizFlow should reject invalid or incomplete setup rather than hiding it. For example, leases are denied when the hostname does not match the dashboard deployment URL or when build attestation is required but missing.

## What LizFlow checks

The dashboard/API should make setup problems visible:

- Runtime package connected: has the deployment requested a lease?
- Build attestation: has the workflow submitted a build fingerprint?
- Hostname: does the request hostname match the deployment URL in the dashboard?
- License: is the linked license active or in grace period?
- Browser status: is the public status helper calling from the expected hostname?

## Next.js 16+

```ts
// proxy.ts
export { default } from "./src/lizflow-proxy";

// src/lizflow-proxy.ts
import { withLizFlowLicense } from "@lizflow/license/next";
export default withLizFlowLicense();
```

For Next.js 15 and earlier, export the same handler from `middleware.ts`.

## Node / Express

```ts
import { lizFlowLicenseMiddleware } from "@lizflow/license/node";
app.use(lizFlowLicenseMiddleware());
```

## Netlify Edge

```ts
import { withLizFlowLicense } from "@lizflow/license/netlify";
export default withLizFlowLicense();
export const config = { path: "/*" };
```

## Vercel middleware

```ts
import { lizFlowMiddleware } from "@lizflow/license/vercel";
export default lizFlowMiddleware();
```

## Server enforcement vs browser display

Real license enforcement must run before the browser receives the app. Use a server, middleware, edge function, or proxy when you need to prevent unlicensed access to the official deployed app.

Good enforcement locations:

- Next.js proxy or middleware
- Vercel middleware
- Netlify Edge Functions
- Express or another Node server
- an edge/proxy wrapper you configure with LizFlow-provided values

Browser-only code is not a security boundary. React, Vue, Angular, and other static frontend bundles are public once shipped. A browser check can show a warning, hide UI, or create casual friction, but a determined user can patch or bypass it.

For static React, Vue, Angular, or Vite apps, use the browser helper only for display. Do not claim hard enforcement unless the app is served behind a server, edge function, middleware, or proxy guard.

Never expose these values to browser code:

```env
LIZFLOW_DEPLOYMENT_SECRET
LIZFLOW_LICENSE_PUBLIC_KEY
```

`LIZFLOW_LICENSE_PUBLIC_KEY` is not secret, but it belongs in the trusted runtime path with the verifier. The browser helper does not need it.

## Browser status mode

Static frontend apps can use the browser helper for low-cost, display-only status. This mode needs only public deployment metadata:

```env
VITE_LIZFLOW_DEPLOYMENT_ID=...
VITE_LIZFLOW_API_URL=https://api.lizflow.com/api/v1
```

Use the public env prefix required by your framework:

- Vite, React, Vue, SvelteKit: `VITE_LIZFLOW_*`
- Next.js browser code: `NEXT_PUBLIC_LIZFLOW_*`
- Angular: use your build-time environment file or generated runtime config

```ts
import { createLizFlowBrowserClient } from "@lizflow/license/browser";

const lizflow = createLizFlowBrowserClient({
  apiUrl: import.meta.env.VITE_LIZFLOW_API_URL,
  deploymentId: import.meta.env.VITE_LIZFLOW_DEPLOYMENT_ID,
  hostname: window.location.hostname,
});

const status = await lizflow.getStatus();

if (!status.allowed) {
  // Show a warning, modal, disabled state, or support link.
  console.log(status.message);
}
```

This calls LizFlow's public status endpoint:

```text
GET /runtime-entitlements/public-status?deploymentId=...&hostname=...
```

The `hostname` must match the deployment URL stored in the user's LizFlow dashboard. If the browser is running on a different host, LizFlow returns `allowed: false`.

The response contains only public state and is cacheable. It does not return secrets, signed leases, license IDs, entitlement IDs, project IDs, or deployment secrets.

## Server-backed frontend status

Do not expose `LIZFLOW_DEPLOYMENT_SECRET` in browser code. Create a small server route that returns
the public license status, then render that status however your app wants.

```ts
// app/api/lizflow/license-status/route.ts
import { lizFlowLicenseStatusResponse } from "@lizflow/license";

export async function GET(request: Request) {
  return lizFlowLicenseStatusResponse({}, new URL(request.url).hostname);
}
```

```ts
// Any browser UI
import { createLizFlowBrowserClient } from "@lizflow/license/browser";

const lizflow = createLizFlowBrowserClient({
  statusUrl: "/api/lizflow/license-status",
});

const status = await lizflow.getStatus();

if (!status.allowed) {
  // Display anything you like: banner, modal, paywall, support link, etc.
  console.log(status.message);
}
```

For live UI updates:

```ts
const stop = lizflow.watch((status) => {
  if (status.allowed && status.status === "grace_period") {
    showBillingWarning(status.expiresAt);
  }
});
```

## GitHub Actions attestation

Run after the production build and before/after provider deployment. Add these values as GitHub Actions secrets from the LizFlow dashboard:

```yaml
- name: Attest LizFlow build
  run: npx @lizflow/license attest
  env:
    LIZFLOW_API_URL: ${{ secrets.LIZFLOW_API_URL }}
    LIZFLOW_DEPLOYMENT_ID: ${{ secrets.LIZFLOW_DEPLOYMENT_ID }}
    LIZFLOW_DEPLOYMENT_SECRET: ${{ secrets.LIZFLOW_DEPLOYMENT_SECRET }}
```

If no build directory is passed, the CLI looks for common output folders such as `dist`, `build`, `.next`, `.output`, `out`, `public`, `www`, and `.vercel/output`. If none are found, it hashes the project root while skipping noisy or sensitive entries such as `.git`, `.env*`, `node_modules`, logs, caches, generated build folders, and package tarballs. Pass a directory explicitly when you know the exact output path:

```bash
npx @lizflow/license attest build
```

Manifest hashing uses framed path/content records and rejects symlinks by default, so attestation cannot accidentally follow links outside the project.

The default runtime policy is fail-closed. Use `failMode: 'open'` only for deliberate availability-over-enforcement scenarios.
