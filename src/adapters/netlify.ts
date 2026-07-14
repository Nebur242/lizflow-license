import { LizFlowLicenseOptions, createLizFlowGuard } from "../index.js";

export type NetlifyContextLike = { next(): Promise<Response> };

export function withLizFlowLicense(options: LizFlowLicenseOptions = {}) {
  const guard = createLizFlowGuard(options);
  return async function lizFlowNetlifyEdge(
    request: Request,
    context: NetlifyContextLike,
  ) {
    return (await guard(request)) || context.next();
  };
}
