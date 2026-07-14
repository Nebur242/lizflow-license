import { LizFlowLicenseOptions, createLizFlowGuard } from "../index.js";

export function withLizFlowLicense(options: LizFlowLicenseOptions = {}) {
  const guard = createLizFlowGuard(options);
  return async function lizFlowProxy(
    request: Request,
  ): Promise<Response | undefined> {
    return guard(request);
  };
}
