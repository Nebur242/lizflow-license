# @lizflow/license

LizFlow's runtime enforcement package obtains short-lived, signed leases from the LizFlow API. It is framework-agnostic by default: developers decide where the check runs, how environment values are named, and what should happen when a license is denied.

Use it from any JavaScript server, edge function, middleware, proxy, custom framework, or build workflow. The package exports general-purpose primitives, not framework-specific adapters.

The package is intentionally explicit. It does not hide the integration or silently modify your workflow. LizFlow verifies that the app is wired correctly by checking runtime lease requests, hostnames, license status, and build attestations.

## Runtime trust model

The package does not identify a LizFlow app by package name. It identifies the running app by verifying a signed LizFlow lease.

Recommended server/runtime values:

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

You can use different secret names in your host if you prefer. In that case, pass values explicitly:

```ts
import { LizFlowLicenseClient } from "@lizflow/license";

const lizflow = new LizFlowLicenseClient({
  apiUrl: process.env.MY_LIZFLOW_API_URL,
  deploymentId: process.env.MY_LIZFLOW_DEPLOYMENT_ID,
  deploymentSecret: process.env.MY_LIZFLOW_DEPLOYMENT_SECRET,
  publicKey: process.env.MY_LIZFLOW_PUBLIC_KEY,
  licenseId: process.env.MY_LIZFLOW_LICENSE_ID,
});
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
4. Add an explicit license check where your app receives requests.
5. Add the attestation command to your build workflow when you want build provenance warnings to clear.
6. Check the LizFlow dashboard for setup health: last lease request, attestation status, hostname match, and license status.

LizFlow should reject invalid runtime identity rather than hiding it. For example, leases are denied when the hostname does not match the dashboard deployment URL. Missing build attestation should appear as a dashboard/package warning, not as a hard runtime block.

## What LizFlow checks

The dashboard/API should make setup problems visible:

- Runtime package connected: has the deployment requested a lease?
- Build attestation: has the workflow submitted a build fingerprint? If not, show a warning.
- Hostname: does the request hostname match the deployment URL in the dashboard?
- License: is the linked license active or in grace period?
- Browser status: is the public status helper calling from the expected hostname?

## Which integration should you use?

Most LizFlow apps are front-only apps. Start with browser status when your app is a static React, Vue, Angular, Vite, Svelte, or similar frontend. Use server/edge enforcement only when your app has a trusted runtime before the browser receives the app.

## Front-only apps: React, Vue, Angular, Vite

Front-only apps do not have a trusted server runtime, so they cannot perform hard license enforcement. They can still call LizFlow's public status endpoint for low-cost, display-only status.

Use this for static React, Vue, Angular, Vite, Svelte, or any other browser-only app when you want to show a warning, banner, modal, disabled state, support link, or payment prompt.

This mode needs only public deployment metadata:

```env
VITE_LIZFLOW_DEPLOYMENT_ID=...
VITE_LIZFLOW_API_URL=https://api.lizflow.com/api/v1
```

Use the public env prefix required by your framework:

- Vite, React, Vue, SvelteKit: `VITE_LIZFLOW_*`
- Next.js browser code: `NEXT_PUBLIC_LIZFLOW_*`
- Angular: use your build-time environment file or generated runtime config

Example for a Vite-style front-only app:

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

The browser client does not enforce access. It only builds the public status request from the values you pass:

```ts
lizflow.statusUrl();
```

## Generic server/edge usage

The integration is intentionally explicit:

1. Create `LizFlowLicenseClient` with the values you chose to expose in your runtime.
2. Read the hostname from your request or trusted runtime config.
3. Call `lizflow.check(hostname)`.
4. Inspect the decision.
5. Return, redirect, render, or continue however your app wants.

```ts
import { LizFlowLicenseClient } from "@lizflow/license";

const lizflow = new LizFlowLicenseClient({
  apiUrl: process.env.MY_LIZFLOW_API_URL,
  deploymentId: process.env.MY_LIZFLOW_DEPLOYMENT_ID,
  deploymentSecret: process.env.MY_LIZFLOW_DEPLOYMENT_SECRET,
  publicKey: process.env.MY_LIZFLOW_PUBLIC_KEY,
  licenseId: process.env.MY_LIZFLOW_LICENSE_ID,
});

export async function handleRequest(request: Request) {
  const hostname = new URL(request.url).hostname;
  const decision = await lizflow.check(hostname);

  if (!decision.allowed) {
    return new Response(
      JSON.stringify({
        error: decision.code,
        message: decision.message,
      }),
      {
        status: decision.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, no-store",
        },
      },
    );
  }

  return new Response("Your app response");
}
```

LizFlow compares the hostname you pass to the deployment URL configured in the dashboard. The package does not decide which hostname is trustworthy for your infrastructure. If your app is behind a proxy, load balancer, or custom domain layer, choose the hostname from the source your runtime trusts.

## Use the same API in different frameworks

Every framework uses the same package import:

```ts
import { LizFlowLicenseClient } from "@lizflow/license";
```

Only the request object and continuation behavior change.

### Next.js 16+

```ts
// proxy.ts
import { LizFlowLicenseClient } from "@lizflow/license";

const lizflow = new LizFlowLicenseClient({
  apiUrl: process.env.MY_LIZFLOW_API_URL,
  deploymentId: process.env.MY_LIZFLOW_DEPLOYMENT_ID,
  deploymentSecret: process.env.MY_LIZFLOW_DEPLOYMENT_SECRET,
  publicKey: process.env.MY_LIZFLOW_PUBLIC_KEY,
  licenseId: process.env.MY_LIZFLOW_LICENSE_ID,
});

export default async function proxy(request: Request) {
  const hostname = new URL(request.url).hostname;
  const decision = await lizflow.check(hostname);

  if (!decision.allowed) {
    return new Response(decision.message, { status: decision.status });
  }

  // Returning undefined lets Next.js continue to the requested route.
  return undefined;
}
```

For Next.js 15 and earlier, export the same handler from `middleware.ts`.

### Node / Express

```ts
import { LizFlowLicenseClient } from "@lizflow/license";

const lizflow = new LizFlowLicenseClient({
  apiUrl: process.env.MY_LIZFLOW_API_URL,
  deploymentId: process.env.MY_LIZFLOW_DEPLOYMENT_ID,
  deploymentSecret: process.env.MY_LIZFLOW_DEPLOYMENT_SECRET,
  publicKey: process.env.MY_LIZFLOW_PUBLIC_KEY,
  licenseId: process.env.MY_LIZFLOW_LICENSE_ID,
});

app.use(async (req, res, next) => {
  const hostname = req.hostname;
  const decision = await lizflow.check(hostname);

  if (decision.allowed) {
    return next();
  }

  res.status(decision.status).json({
    error: decision.code,
    message: decision.message,
  });
});
```

### Netlify Edge

```ts
import { LizFlowLicenseClient } from "@lizflow/license";

const lizflow = new LizFlowLicenseClient({
  apiUrl: process.env.MY_LIZFLOW_API_URL,
  deploymentId: process.env.MY_LIZFLOW_DEPLOYMENT_ID,
  deploymentSecret: process.env.MY_LIZFLOW_DEPLOYMENT_SECRET,
  publicKey: process.env.MY_LIZFLOW_PUBLIC_KEY,
  licenseId: process.env.MY_LIZFLOW_LICENSE_ID,
});

export default async function lizflowEdge(request: Request, context: any) {
  const hostname = new URL(request.url).hostname;
  const decision = await lizflow.check(hostname);

  if (!decision.allowed) {
    return new Response(decision.message, { status: decision.status });
  }

  return context.next();
}

export const config = { path: "/*" };
```

### Vercel middleware

```ts
import { LizFlowLicenseClient } from "@lizflow/license";

const lizflow = new LizFlowLicenseClient({
  apiUrl: process.env.MY_LIZFLOW_API_URL,
  deploymentId: process.env.MY_LIZFLOW_DEPLOYMENT_ID,
  deploymentSecret: process.env.MY_LIZFLOW_DEPLOYMENT_SECRET,
  publicKey: process.env.MY_LIZFLOW_PUBLIC_KEY,
  licenseId: process.env.MY_LIZFLOW_LICENSE_ID,
});

export default async function middleware(request: Request) {
  const hostname = new URL(request.url).hostname;
  const decision = await lizflow.check(hostname);

  if (!decision.allowed) {
    return new Response(decision.message, { status: decision.status });
  }

  return undefined;
}
```

## HTTP API for non-JavaScript runtimes

Projects that do not use JavaScript can implement the same flow directly against the LizFlow HTTP API. The package is not required.

Current API version: `v1`. The base URL should include `/api/v1`.

Use these server-side values:

```env
LIZFLOW_API_URL=https://api.lizflow.com/api/v1
LIZFLOW_DEPLOYMENT_ID=...
LIZFLOW_DEPLOYMENT_SECRET=...
LIZFLOW_LICENSE_PUBLIC_KEY=...
LIZFLOW_LICENSE_ID=... # optional
```

### Runtime lease check

Request a lease from your server, edge runtime, middleware, or proxy:

```http
POST /runtime-entitlements/leases
content-type: application/json
x-lizflow-deployment-secret: <deployment secret>

{
  "deploymentId": "<deployment id>",
  "hostname": "app.example.com"
}
```

Example response:

```json
{
  "lease": "<signed JWT>",
  "expiresAt": "2026-07-14T12:00:00.000Z",
  "status": "active",
  "publicKey": "-----BEGIN PUBLIC KEY-----..."
}
```

Do not trust the `publicKey` returned in the response for verification. Verify the lease with the public key copied from the LizFlow dashboard, stored in your runtime as `LIZFLOW_LICENSE_PUBLIC_KEY` or your own env name.

The lease is an Ed25519 JWT:

- header `alg` must be `EdDSA`
- `iss` must be `lizflow`
- `aud` must be `lizflow-runtime`
- `exp` must be in the future
- `sub` must match your deployment ID
- `userLicenseId` must match your configured license ID, when you use one
- `hostname` must match the hostname you requested, when you pass one

If any of those checks fail, deny or degrade access according to your app policy.

### Python example

This is intentionally direct: the app passes the hostname, asks LizFlow for a lease, verifies it locally, then decides what to do.

```py
import os
import requests
import jwt

api_url = os.environ["MY_LIZFLOW_API_URL"].rstrip("/")
deployment_id = os.environ["MY_LIZFLOW_DEPLOYMENT_ID"]
deployment_secret = os.environ["MY_LIZFLOW_DEPLOYMENT_SECRET"]
public_key = os.environ["MY_LIZFLOW_PUBLIC_KEY"]
license_id = os.environ.get("MY_LIZFLOW_LICENSE_ID")

def check_lizflow(hostname: str):
    response = requests.post(
        f"{api_url}/runtime-entitlements/leases",
        headers={
            "content-type": "application/json",
            "x-lizflow-deployment-secret": deployment_secret,
        },
        json={
            "deploymentId": deployment_id,
            "hostname": hostname,
        },
        timeout=5,
    )

    if not response.ok:
        return {
            "allowed": False,
            "status": response.status_code,
            "message": response.text,
        }

    lease = response.json()["lease"]
    claims = jwt.decode(
        lease,
        public_key,
        algorithms=["EdDSA"],
        audience="lizflow-runtime",
        issuer="lizflow",
    )

    if claims["sub"] != deployment_id:
        raise Exception("Lease belongs to another deployment")

    if license_id and claims.get("userLicenseId") != license_id:
        raise Exception("Lease belongs to another license")

    if claims.get("hostname") != hostname:
        raise Exception("Lease belongs to another hostname")

    return {
        "allowed": True,
        "claims": claims,
    }
```

Use the equivalent Ed25519/JWT verification library in Ruby, Go, PHP, Java, Rust, or any other runtime. The important part is local signature verification with the pinned public key from the dashboard.

### Public browser/status check

For display-only browser status, call the public endpoint with public values:

```http
GET /runtime-entitlements/public-status?deploymentId=<deployment id>&hostname=app.example.com
```

Example response:

```json
{
  "allowed": true,
  "status": "active",
  "hostname": "app.example.com",
  "attested": true,
  "warnings": [],
  "nextCheckAt": "2026-07-14T12:05:00.000Z"
}
```

This endpoint never returns secrets, signed leases, license IDs, entitlement IDs, project IDs, or deployment secrets. It is for display only, not hard enforcement.

### Build attestation API

If you are not using the package CLI, submit build attestations from your own workflow:

```http
POST /runtime-entitlements/attestations
content-type: application/json
x-lizflow-deployment-secret: <deployment secret>

{
  "deploymentId": "<deployment id>",
  "commitSha": "<git commit sha>",
  "manifestHash": "sha256:<build artifact hash>",
  "workflowRunId": "<ci workflow run id>",
  "repository": "owner/repository",
  "environment": "production"
}
```

Example response:

```json
{
  "accepted": true,
  "attestationId": "<attestation id>",
  "deploymentId": "<deployment id>"
}
```

Attestation is currently a setup/provenance signal. Missing attestation should show as a warning, not block runtime leases by itself.

## Server enforcement vs browser display

Real license enforcement must run before the browser receives the app. Use a server, middleware, edge function, or proxy when you need to prevent unlicensed access to the official deployed app.

Good enforcement locations:

- Next.js proxy or middleware
- Vercel middleware
- Netlify Edge Functions
- Express or another Node server
- an edge/proxy wrapper you configure with LizFlow-provided values

Browser-only code is not a security boundary. React, Vue, Angular, and other static frontend bundles are public once shipped. A browser check can show a warning, hide UI, or create casual friction, but a determined user can patch or bypass it.

For static React, Vue, Angular, or Vite apps, browser status is only for display. Do not claim hard enforcement unless the app is served behind a server, edge function, middleware, or proxy check.

Never expose these values to browser code:

```env
LIZFLOW_DEPLOYMENT_SECRET
LIZFLOW_LICENSE_PUBLIC_KEY
```

`LIZFLOW_LICENSE_PUBLIC_KEY` is not secret, but it belongs in the trusted runtime path with the verifier. Browser status checks do not need it.

## Server-backed frontend status

Do not expose `LIZFLOW_DEPLOYMENT_SECRET` in browser code. Create a small server route that returns
the public license status, then render that status however your app wants.

This setup has two explicit parts:

- the server route reads the LizFlow values from server-side environment variables
- the browser calls that server route and renders the JSON it returns

```ts
// app/api/lizflow/license-status/route.ts
import { LizFlowLicenseClient } from "@lizflow/license";

const lizflow = new LizFlowLicenseClient({
  apiUrl: process.env.MY_LIZFLOW_API_URL,
  deploymentId: process.env.MY_LIZFLOW_DEPLOYMENT_ID,
  deploymentSecret: process.env.MY_LIZFLOW_DEPLOYMENT_SECRET,
  publicKey: process.env.MY_LIZFLOW_PUBLIC_KEY,
  licenseId: process.env.MY_LIZFLOW_LICENSE_ID,
});

export async function GET(request: Request) {
  const hostname = new URL(request.url).hostname;
  const decision = await lizflow.check(hostname);

  if (!decision.allowed) {
    return Response.json(
      {
        allowed: false,
        status: decision.status,
        code: decision.code,
        message: decision.message,
      },
      { status: decision.status },
    );
  }

  return Response.json({
    allowed: true,
    status: decision.claims.status,
    hostname: decision.claims.hostname,
    attested: decision.claims.attested,
    expiresAt: new Date(decision.claims.exp * 1000).toISOString(),
  });
}
```

```ts
// Any browser UI
const response = await fetch("/api/lizflow/license-status", {
  method: "GET",
  headers: { accept: "application/json" },
});

const status = await response.json();

if (!status.allowed) {
  // Display anything you like: banner, modal, paywall, support link, etc.
  console.log(status.message);
}
```

For live UI updates, use your own polling interval:

```ts
const timer = window.setInterval(async () => {
  const response = await fetch("/api/lizflow/license-status", {
    headers: { accept: "application/json" },
  });
  const status = await response.json();

  if (status.allowed && status.status === "grace_period") {
    showBillingWarning(status.expiresAt);
  }
}, 60_000);

// Later, when the component unmounts:
window.clearInterval(timer);
```

## GitHub Actions attestation

Run after the production build and before/after provider deployment.

The CLI reads these env keys at runtime:

- `LIZFLOW_API_URL`
- `LIZFLOW_DEPLOYMENT_ID`
- `LIZFLOW_DEPLOYMENT_SECRET`

Where the values come from is up to the workflow. If LizFlow generates or runs the workflow, map the values from the LizFlow-provided deployment payload:

```yaml
- name: Attest LizFlow build
  run: npx @lizflow/license attest
  env:
    LIZFLOW_API_URL: ${{ fromJSON(inputs.DATA).variables.LIZFLOW_API_URL }}
    LIZFLOW_DEPLOYMENT_ID: ${{ fromJSON(inputs.DATA).variables.LIZFLOW_DEPLOYMENT_ID }}
    LIZFLOW_DEPLOYMENT_SECRET: ${{ fromJSON(inputs.DATA).variables.LIZFLOW_DEPLOYMENT_SECRET }}
```

If the developer owns the workflow outside LizFlow, they can store the LizFlow-provided values under any GitHub secret names and map them into the env keys the CLI reads:

```yaml
- name: Attest LizFlow build
  run: npx @lizflow/license attest
  env:
    LIZFLOW_API_URL: ${{ secrets.MY_LIZFLOW_API_URL }}
    LIZFLOW_DEPLOYMENT_ID: ${{ secrets.MY_PRODUCT_DEPLOYMENT_ID }}
    LIZFLOW_DEPLOYMENT_SECRET: ${{ secrets.MY_PRODUCT_DEPLOYMENT_SECRET }}
```

If no build directory is passed, the CLI looks for common output folders such as `dist`, `build`, `.next`, `.output`, `out`, `public`, `www`, and `.vercel/output`. If none are found, it hashes the project root while skipping noisy or sensitive entries such as `.git`, `.env*`, `node_modules`, logs, caches, generated build folders, and package tarballs. Pass a directory explicitly when you know the exact output path:

```bash
npx @lizflow/license attest build
```

Manifest hashing uses framed path/content records and rejects symlinks by default, so attestation cannot accidentally follow links outside the project.

The default runtime policy is fail-closed. Use `failMode: 'open'` only for deliberate availability-over-enforcement scenarios.
