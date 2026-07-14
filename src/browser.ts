import { LizFlowPublicLicenseStatus } from "./index.js";

export type LizFlowBrowserClientOptions = {
  apiUrl: string;
  deploymentId: string;
  hostname: string;
  fetch?: typeof fetch;
};

export class LizFlowBrowserClient {
  private readonly apiUrl: string;
  private readonly deploymentId: string;
  private readonly hostname: string;
  private readonly fetcher: typeof fetch;

  constructor(options: LizFlowBrowserClientOptions) {
    if (!options.apiUrl) {
      throw new Error("LizFlow browser status requires apiUrl");
    }
    if (!options.deploymentId) {
      throw new Error("LizFlow browser status requires deploymentId");
    }
    if (!options.hostname) {
      throw new Error("LizFlow browser status requires hostname");
    }

    this.apiUrl = options.apiUrl;
    this.deploymentId = options.deploymentId;
    this.hostname = options.hostname;
    this.fetcher = options.fetch || globalThis.fetch;
  }

  async getStatus(): Promise<LizFlowPublicLicenseStatus> {
    const response = await this.fetcher(this.statusUrl(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "default",
    });
    const status = (await response.json()) as LizFlowPublicLicenseStatus;

    if (!isLizFlowPublicStatus(status)) {
      throw new Error("Invalid LizFlow public status response");
    }

    return status;
  }

  statusUrl() {
    const url = new URL(
      `${this.apiUrl.replace(/\/$/, "")}/runtime-entitlements/public-status`,
    );
    url.searchParams.set("deploymentId", this.deploymentId);
    url.searchParams.set("hostname", this.hostname);
    return url.toString();
  }
}

export function createLizFlowBrowserClient(options: LizFlowBrowserClientOptions) {
  return new LizFlowBrowserClient(options);
}

function isLizFlowPublicStatus(
  value: unknown,
): value is LizFlowPublicLicenseStatus {
  if (!value || typeof value !== "object" || !("allowed" in value)) {
    return false;
  }

  const status = value as {
    allowed?: unknown;
    code?: unknown;
    message?: unknown;
  };

  return (
    status.allowed === true ||
    (status.allowed === false &&
      typeof status.code === "string" &&
      typeof status.message === "string")
  );
}
