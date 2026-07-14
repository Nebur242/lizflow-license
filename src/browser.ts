import { LizFlowLicenseStatus, LizFlowPublicLicenseStatus } from "./index.js";

export type LizFlowBrowserStatus =
  | LizFlowLicenseStatus
  | LizFlowPublicLicenseStatus;

export type LizFlowBrowserClientOptions = {
  apiUrl?: string;
  deploymentId?: string;
  hostname?: string;
  statusUrl?: string;
  fetch?: typeof fetch;
};

export type LizFlowStatusListener = (status: LizFlowBrowserStatus) => void;
export type LizFlowStatusErrorListener = (error: unknown) => void;

export class LizFlowBrowserClient {
  private readonly apiUrl?: string;
  private readonly deploymentId?: string;
  private readonly hostname?: string;
  private readonly statusUrl?: string;
  private readonly fetcher: typeof fetch;

  constructor(options: LizFlowBrowserClientOptions = {}) {
    this.apiUrl = options.apiUrl;
    this.deploymentId = options.deploymentId;
    this.hostname = options.hostname;
    this.statusUrl = options.statusUrl;
    this.fetcher = options.fetch || globalThis.fetch;
  }

  async getStatus(): Promise<LizFlowBrowserStatus> {
    const response = await this.fetcher(this.getStatusUrl(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: this.deploymentId ? "default" : "no-store",
    });
    const status = (await response.json()) as LizFlowBrowserStatus;

    if (!isLizFlowBrowserStatus(status)) {
      throw new Error("Invalid LizFlow license status response");
    }

    return status;
  }

  watch(
    listener: LizFlowStatusListener,
    options: {
      intervalMs?: number;
      onError?: LizFlowStatusErrorListener;
      immediate?: boolean;
    } = {},
  ) {
    const intervalMs = options.intervalMs || 60_000;
    let stopped = false;

    const refresh = async () => {
      try {
        listener(await this.getStatus());
      } catch (error) {
        options.onError?.(error);
      }
    };

    if (options.immediate !== false) {
      void refresh();
    }

    const timer = globalThis.setInterval(() => {
      if (!stopped) {
        void refresh();
      }
    }, intervalMs);

    return () => {
      stopped = true;
      globalThis.clearInterval(timer);
    };
  }

  private getStatusUrl() {
    if (!this.deploymentId) {
      return this.statusUrl || "/api/lizflow/license-status";
    }

    const statusUrl =
      this.statusUrl ||
      `${trimSlash(this.apiUrl || "https://api.lizflow.com/api/v1")}/runtime-entitlements/public-status`;
    const url = new URL(statusUrl, globalThis.location?.href);
    url.searchParams.set("deploymentId", this.deploymentId);
    const hostname = this.hostname || globalThis.location?.hostname;
    if (!hostname) {
      throw new Error("LizFlow public status mode requires a hostname");
    }
    url.searchParams.set("hostname", hostname);
    return url.toString();
  }
}

export function createLizFlowBrowserClient(options: LizFlowBrowserClientOptions = {}) {
  return new LizFlowBrowserClient(options);
}

function isLizFlowBrowserStatus(value: unknown): value is LizFlowBrowserStatus {
  if (!value || typeof value !== "object" || !("allowed" in value)) {
    return false;
  }

  const status = value as {
    allowed?: unknown;
    code?: unknown;
    message?: unknown;
    nextCheckAt?: unknown;
  };
  if (status.allowed === true) {
    return true;
  }

  return (
    status.allowed === false &&
    typeof status.code === "string" &&
    typeof status.message === "string"
  );
}

function trimSlash(value: string) {
  return value.replace(/\/$/, "");
}
