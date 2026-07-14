import {
  LizFlowLicenseOptions,
  createLizFlowChecker,
  licenseDeniedResponse,
} from "../index.js";

export type NetlifyContextLike = { next(): Promise<Response> };

export function withLizFlowLicense(options: LizFlowLicenseOptions = {}) {
  const check = createLizFlowChecker(options);
  return async function lizFlowNetlifyEdge(
    request: Request,
    context: NetlifyContextLike,
  ) {
    const decision = await check(request);
    return decision.allowed ? context.next() : licenseDeniedResponse(decision);
  };
}
