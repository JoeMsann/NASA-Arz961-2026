// Runtime proxy from the browser to the backend containers. URLs come from the environment, so the same
// image works in Docker Compose and in local development.
const TARGETS: Record<string, string | undefined> = {
  ml: process.env.ML_URL || "http://localhost:8001",
  agent: process.env.AGENT_URL || "http://localhost:8002",
};
export const dynamic = "force-dynamic";

async function forward(req: Request, ctx: { params: Promise<{ svc: string; path: string[] }> }) {
  const { svc, path } = await ctx.params;
  const base = TARGETS[svc];
  if (!base) return Response.json({ detail: "Unknown service" }, { status: 404 });
  const url = `${base}/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;
  try {
    const r = await fetch(url, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "GET" ? undefined : await req.text(),
      signal: AbortSignal.timeout(90000),
      cache: "no-store",
    });
    const headers = new Headers({ "content-type": r.headers.get("content-type") ?? "application/json" });
    const cd = r.headers.get("content-disposition");
    if (cd) headers.set("content-disposition", cd);
    return new Response(r.body, { status: r.status, headers });
  } catch {
    return Response.json({ detail: `The ${svc} service is not reachable.` }, { status: 502 });
  }
}
export { forward as GET, forward as POST };
