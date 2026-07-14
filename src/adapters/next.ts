import {
  LizFlowLicenseOptions,
  createLizFlowChecker,
  licenseDeniedResponse,
} from "../index.js";

export function withLizFlowLicense(options: LizFlowLicenseOptions = {}) {
  const check = createLizFlowChecker(options);
  return async function lizFlowProxy(
    request: Request,
  ): Promise<Response | undefined> {
    const decision = await check(request);
    return decision.allowed ? undefined : licenseDeniedResponse(decision);
  };
}
