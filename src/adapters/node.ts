import { LizFlowLicenseOptions, createLizFlowChecker } from "../index.js";

type NodeRequest = { headers: { host?: string | string[] } };
type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};
type Next = (error?: unknown) => void;

export function lizFlowLicenseMiddleware(options: LizFlowLicenseOptions = {}) {
  const check = createLizFlowChecker(options);
  return async function lizFlowNode(
    req: NodeRequest,
    res: NodeResponse,
    next: Next,
  ) {
    const decision = await check(req);
    if (decision.allowed) return next();
    res.statusCode = decision.status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "private, no-store");
    res.end(
      JSON.stringify({ error: decision.code, message: decision.message }),
    );
  };
}
