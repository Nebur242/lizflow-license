import {
  LizFlowLicenseClient,
  LizFlowLicenseOptions,
  licenseDeniedResponse,
} from "../index.js";

export type NetlifyContextLike = { next(): Promise<Response> };

export function withLizFlowLicense(options: LizFlowLicenseOptions = {}) {
  const client = new LizFlowLicenseClient(options);
  return async function lizFlowNetlifyEdge(
    request: Request,
    context: NetlifyContextLike,
  ) {
    const decision = await client.check(new URL(request.url).hostname);
    return decision.allowed ? context.next() : licenseDeniedResponse(decision);
  };
}
