"use client";
import { useEffect, useState } from "react";
import { api, OUTCOME, fmt } from "@/lib/api";

const KIND: Record<string, string> = { test: "Flown test", planned: "Planned", threshold_1g: "1-g threshold" };
const PROV: Record<string, string> = { nasa_table: "NASA table", third_party_extract: "Third-party extract", third_party_transcription: "Third-party transcription" };
const PAGE = 50;

export default function TestTable() {
  const [f, setF] = useState({ investigation: "", phase: "", kind: "", q: "" });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    const p = new URLSearchParams({ offset: String(page * PAGE), limit: String(PAGE) });
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    const t = setTimeout(() => api("ml", `tests?${p}`).then(setData).catch(() => setData(null)), 200);
    return () => clearTimeout(t);
  }, [f, page]);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(0); };
  const pick = (k: "investigation" | "phase" | "kind", label: string, names?: Record<string, string>) => (
    <select aria-label={label} value={f[k]} onChange={(e) => set(k, e.target.value)}>
      <option value="">{label}: all</option>
      {(data?.facets[k] ?? []).map((v: string) => <option key={v} value={v}>{names?.[v] ?? v}</option>)}
    </select>
  );

  return (
    <div className="card">
      <h2>Unified test table</h2>
      <p className="note">One row per test from every loaded source, in one schema. Blank means the source did not record it. “Assumed” names a value added during cleaning.</p>
      <div className="row filters">
        {pick("investigation", "Investigation")}{pick("kind", "Type", KIND)}{pick("phase", "Fuel phase")}
        <input type="text" placeholder="Search fuel, notes, id…" aria-label="Search" value={f.q} onChange={(e) => set("q", e.target.value)} />
        <a className="ghost" href="/api/svc/ml/tests.csv">Download CSV</a>
      </div>
      {!data ? <p className="note">Loading…</p> : <>
        <div className="scroll">
          <table>
            <thead><tr><th>Test</th><th>Investigation</th><th>Type</th><th>Fuel</th><th>Phase</th><th>O₂ %</th><th>psi</th><th>Flow cm/s</th><th>Diluent</th><th>Outcome</th><th>Measured</th><th>Assumed</th><th>Source</th></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.test_id} title={r.notes ?? ""}>
                  <td>{r.test_id}</td><td>{r.investigation}<div className="note">{r.psi_id}</div></td><td>{KIND[r.kind]}</td><td>{r.fuel}</td><td>{r.phase}</td>
                  <td>{fmt(r.o2_pct)}</td><td>{fmt(r.pressure_psia)}</td><td>{fmt(r.flow_cm_s)}</td><td>{r.diluent ?? "—"}</td>
                  <td>{r.outcome ? OUTCOME[r.outcome] ?? r.outcome : "—"}</td>
                  <td>{r.metric_value != null ? <>{fmt(r.metric_value, 2)} {r.metric_unit}<div className="note">{r.metric_name.replace(/_/g, " ")}</div></> : "—"}</td>
                  <td className="note">{r.assumed ?? ""}</td><td className="note">{PROV[r.provenance]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="note">{data.total ? `${page * PAGE + 1}–${Math.min(data.total, (page + 1) * PAGE)} of ${data.total}` : "No rows match"}</span>
          <button className="ghost" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </>}
    </div>
  );
}
