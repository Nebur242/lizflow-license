import {
  LizFlowLicenseClient,
  LizFlowLicenseOptions,
  licenseDeniedResponse,
} from "../index.js";

export function withLizFlowLicense(options: LizFlowLicenseOptions = {}) {
  const client = new LizFlowLicenseClient(options);
  return async function lizFlowProxy(
    request: Request,
  ): Promise<Response | undefined> {
    const decision = await client.check(new URL(request.url).hostname);
    return decision.allowed ? undefined : licenseDeniedResponse(decision);
  };
}
