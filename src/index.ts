export type LizFlowLicenseOptions = {
  apiUrl?: string;
  deploymentId?: string;
  deploymentSecret?: string;
  licenseId?: string;
  publicKey?: string;
  hostname?: string;
  leaseRefreshSeconds?: number;
  fetchTimeoutMs?: number;
  failMode?: "closed" | "open";
  fetch?: typeof fetch;
};

export type LizFlowLeaseClaims = {
  iss: "lizflow";
  aud: "lizflow-runtime";
  sub: string;
  entitlementId: string;
  projectId: string;
  userLicenseId: string | null;
  status: "active" | "grace_period";
  hostname: string | null;
  attested: boolean;
  warnings?: LizFlowLicenseWarning[];
  iat: number;
  exp: number;
};

export type LizFlowLicenseWarning = {
  code: string;
  message: string;
};

type LeaseResponse = {
  lease: string;
  expiresAt: string;
  status: LizFlowLeaseClaims["status"];
  publicKey: string;
};

export type LicenseDecision =
  | { allowed: true; claims: LizFlowLeaseClaims }
  | { allowed: false; status: number; code: string; message: string };

export type LizFlowLicenseStatus =
  | {
      allowed: true;
      status: LizFlowLeaseClaims["status"];
      deploymentId: string;
      entitlementId: string;
      projectId: string;
      userLicenseId: string | null;
      hostname: string | null;
      attested: boolean;
      expiresAt: string;
    }
  | {
      allowed: false;
      status: number;
      code: string;
      message: string;
    };

export type LizFlowPublicLicenseStatus =
  | {
      allowed: true;
      status: LizFlowLeaseClaims["status"];
      hostname: string | null;
      attested?: boolean;
      warnings?: LizFlowLicenseWarning[];
      nextCheckAt: string;
    }
  | {
      allowed: false;
      status?: LizFlowLeaseClaims["status"] | "suspended" | "cancelled";
      code: string;
      message: string;
      hostname: string | null;
      attested?: boolean;
      warnings?: LizFlowLicenseWarning[];
      nextCheckAt: string;
    };

export class LizFlowLicenseClient {
  private cached?: {
    claims: LizFlowLeaseClaims;
    hostname: string | null;
    refreshAt: number;
  };
  private readonly options: Required<
    Pick<
      LizFlowLicenseOptions,
      "apiUrl" | "deploymentId" | "deploymentSecret" | "publicKey" | "failMode"
    >
  > &
    LizFlowLicenseOptions;

  constructor(options: LizFlowLicenseOptions = {}) {
    this.options = {
      ...options,
      apiUrl: options.apiUrl || readEnv("LIZFLOW_API_URL"),
      deploymentId: options.deploymentId || readEnv("LIZFLOW_DEPLOYMENT_ID"),
      deploymentSecret:
        options.deploymentSecret || readEnv("LIZFLOW_DEPLOYMENT_SECRET"),
      licenseId:
        options.licenseId ||
        readEnv("LIZFLOW_LICENSE_ID") ||
        readEnv("LIZFLOW_USER_LICENSE_ID"),
      publicKey: options.publicKey || readEnv("LIZFLOW_LICENSE_PUBLIC_KEY"),
      failMode: options.failMode || "closed",
      fetchTimeoutMs: options.fetchTimeoutMs ?? readNumberEnv("LIZFLOW_FETCH_TIMEOUT_MS"),
    };
  }

  async check(hostname?: string): Promise<LicenseDecision> {
    const now = Math.floor(Date.now() / 1000);
    const requestedHostname = normalizeHostname(hostname || this.options.hostname);
    if (
      this.cached &&
      this.cached.hostname === requestedHostname &&
      this.cached.refreshAt > now &&
      this.cached.claims.exp > now
    ) {
      return { allowed: true, claims: this.cached.claims };
    }

    try {
      this.assertConfiguration();
      const fetcher = this.options.fetch || globalThis.fetch;
      const abortController = new AbortController();
      const timeout = globalThis.setTimeout(
        () => abortController.abort(),
        this.options.fetchTimeoutMs || 5_000,
      );
      let response: Response;
      try {
        response = await fetcher(
          `${trimSlash(this.options.apiUrl)}/runtime-entitlements/leases`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-lizflow-deployment-secret": this.options.deploymentSecret,
            },
            body: JSON.stringify({
              deploymentId: this.options.deploymentId,
              hostname: requestedHostname || undefined,
            }),
            signal: abortController.signal,
          },
        );
      } finally {
        globalThis.clearTimeout(timeout);
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
          errors?: { code?: string; message?: string };
        };
        return {
          allowed: false,
          status: response.status,
          code:
            payload.code || payload.errors?.code || "LIZFLOW_LICENSE_DENIED",
          message:
            payload.errors?.message ||
            payload.message ||
            "LizFlow license check failed",
        };
      }

      const rawLease = (await response.json()) as
        LeaseResponse | { data: LeaseResponse };
      const lease = "data" in rawLease ? rawLease.data : rawLease;
      const claims = await verifyLease(lease.lease, this.options.publicKey);
      this.assertLeaseClaims(claims, requestedHostname);
      const refreshBefore = this.options.leaseRefreshSeconds || 30;
      this.cached = {
        claims,
        hostname: requestedHostname,
        refreshAt: Math.max(now, claims.exp - refreshBefore),
      };
      return { allowed: true, claims };
    } catch (error) {
      if (this.options.failMode === "open") {
        return {
          allowed: true,
          claims: {
            iss: "lizflow",
            aud: "lizflow-runtime",
            sub: this.options.deploymentId,
            entitlementId: "offline",
            projectId: "offline",
            userLicenseId: null,
            status: "grace_period",
            hostname: requestedHostname,
            attested: false,
            iat: now,
            exp: now + 60,
          },
        };
      }
      return {
        allowed: false,
        status: 503,
        code: "LIZFLOW_LICENSE_UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "LizFlow license service unavailable",
      };
    }
  }

  clearCache() {
    this.cached = undefined;
  }

  private assertConfiguration() {
    if (
      !this.options.apiUrl ||
      !this.options.deploymentId ||
      !this.options.deploymentSecret ||
      !this.options.publicKey
    ) {
      throw new Error("Missing LizFlow runtime environment variables");
    }
  }

  private assertLeaseClaims(
    claims: LizFlowLeaseClaims,
    requestedHostname: string | null,
  ) {
    if (claims.sub !== this.options.deploymentId) {
      throw new Error("Lease belongs to another deployment");
    }
    if (
      this.options.licenseId &&
      claims.userLicenseId !== this.options.licenseId
    ) {
      throw new Error("Lease belongs to another license");
    }
    if (
      requestedHostname &&
      normalizeHostname(claims.hostname || undefined) !== requestedHostname
    ) {
      throw new Error("Lease belongs to another hostname");
    }
  }
}

export function licenseStatusFromDecision(
  decision: LicenseDecision,
): LizFlowLicenseStatus {
  if (!decision.allowed) {
    return {
      allowed: false,
      status: decision.status,
      code: decision.code,
      message: decision.message,
    };
  }

  return {
    allowed: true,
    status: decision.claims.status,
    deploymentId: decision.claims.sub,
    entitlementId: decision.claims.entitlementId,
    projectId: decision.claims.projectId,
    userLicenseId: decision.claims.userLicenseId,
    hostname: decision.claims.hostname,
    attested: decision.claims.attested,
    expiresAt: new Date(decision.claims.exp * 1000).toISOString(),
  };
}

export async function checkLizFlowLicenseStatus(
  options: LizFlowLicenseOptions = {},
  hostname?: string,
): Promise<LizFlowLicenseStatus> {
  const client = new LizFlowLicenseClient(options);
  return licenseStatusFromDecision(await client.check(hostname));
}

export async function lizFlowLicenseStatusResponse(
  options: LizFlowLicenseOptions = {},
  hostname?: string,
) {
  const status = await checkLizFlowLicenseStatus(options, hostname);
  return new Response(JSON.stringify(status), {
    status: status.allowed ? 200 : status.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

export async function verifyLease(token: string, publicKeyPem: string) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature)
    throw new Error("Malformed LizFlow lease");
  const parsedHeader = JSON.parse(decodeText(header)) as { alg?: string };
  if (parsedHeader.alg !== "EdDSA")
    throw new Error("Unexpected LizFlow lease algorithm");
  const key = await crypto.subtle.importKey(
    "spki",
    pemToBytes(publicKeyPem),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    decodeBytes(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!valid) throw new Error("Invalid LizFlow lease signature");
  const claims = JSON.parse(decodeText(payload)) as LizFlowLeaseClaims;
  if (claims.iss !== "lizflow" || claims.aud !== "lizflow-runtime") {
    throw new Error("Invalid LizFlow lease issuer or audience");
  }
  if (claims.exp <= Math.floor(Date.now() / 1000))
    throw new Error("LizFlow lease expired");
  return claims;
}

function readEnv(name: string): string {
  return typeof process !== "undefined" ? process.env?.[name] || "" : "";
}

function readNumberEnv(name: string) {
  const value = readEnv(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function trimSlash(value: string) {
  return value.replace(/\/$/, "");
}

function normalizeHostname(value?: string | URL) {
  if (!value) return null;
  if (value instanceof URL) return normalizeHostname(value.hostname);

  const stripIpv6Brackets = (hostname: string) =>
    hostname.replace(/^\[/, "").replace(/\]$/, "");
  const rawValue = value.trim();
  try {
    const parsed = new URL(rawValue);
    if (!parsed.hostname) throw new Error("Missing hostname");
    return stripIpv6Brackets(
      parsed.hostname.toLowerCase().replace(/\.$/, ""),
    );
  } catch {
    try {
      return stripIpv6Brackets(
        new URL(`http://${rawValue}`).hostname.toLowerCase().replace(/\.$/, ""),
      );
    } catch {
      return stripIpv6Brackets(rawValue.toLowerCase().replace(/\.$/, ""));
    }
  }
}

function pemToBytes(pem: string) {
  const encoded = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  return decodeBytes(encoded);
}

function decodeText(value: string) {
  return new TextDecoder().decode(decodeBytes(value));
}

function decodeBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined")
    return Uint8Array.from(Buffer.from(padded, "base64"));
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
