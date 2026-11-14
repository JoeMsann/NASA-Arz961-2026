export interface Env { id: string; name: string; o2_pct: number; pressure_psia: number; gravity_g: number; basis: string; blurb: string }
export interface Atmos { o2_pct: number; pressure_psia: number; gravity_g: number }

export async function api<T = any>(svc: "ml" | "agent", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/svc/${svc}/${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ detail: "Bad response" }));
  if (!r.ok) throw Object.assign(new Error(typeof j.detail === "string" ? j.detail : "Request failed"), { status: r.status });
  return j as T;
}

export const OUTCOME: Record<string, string> = {
  self_extinguished: "Went out by itself", burned_to_completion: "Burned all the fuel", droplet_disrupted: "Droplet broke up",
  burned: "Burned", no_spread: "Did not spread", burns_at_or_above_this_o2: "Burns at or above this O₂ (1 g)",
};
export const fmt = (v: number | null | undefined, d = 1) => (v == null ? "—" : Number(v).toFixed(d).replace(/\.0+$/, ""));
