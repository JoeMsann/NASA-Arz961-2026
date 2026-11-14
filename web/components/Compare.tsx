"use client";
import { ReactNode, useEffect, useState } from "react";
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { api, OUTCOME, fmt } from "@/lib/api";

const axis = { stroke: "#93a1b8", fontSize: 12 };
const KIND: Record<string, string> = { test: "flown", planned: "planned", threshold_1g: "1-g threshold" };
const STATUS: Record<string, string> = { varied: "varied", fixed: "held fixed", "not recorded": "not recorded" };
const g = (v: number) => Number(v.toPrecision(3)).toString();

function range(s: any): ReactNode {
  if (!s.n) return <span className="note">Not recorded</span>;
  const span = s.min === s.max ? `${g(s.min)} ${s.unit}` : `${g(s.min)} to ${g(s.max)} ${s.unit}`;
  return <>{span}<div className="note">{STATUS[s.status]}{s.status === "varied" ? `, ${s.levels} levels` : ""} · {s.n} records{s.assumed ? " · assumed, not in the source table" : ""}</div></>;
}

export default function Compare({ onAsk }: { onAsk: (q: string) => void }) {
  const [cat, setCat] = useState<any[]>([]);
  const [a, setA] = useState("BASS");
  const [b, setB] = useState("BASS-II");
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => { api("ml", "catalog").then(setCat).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    api("ml", `compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`).then((r) => { setD(r); setErr(""); }).catch((e) => setErr(e.message));
  }, [a, b]);

  const pick = (value: string, set: (v: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
      {cat.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}{c.rows ? "" : " (no records loaded)"}</option>)}
    </select>
  );
  if (err) return <div className="card bad">{err}</div>;
  if (!d) return <div className="card">Loading comparison…</div>;

  const A = d.a, B = d.b;
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : <span className="note">—</span>);
  const fuels = (p: any) => p.fuels.length
    ? <>{p.fuels.map((f: any) => <div key={f.fuel}>{f.fuel} <span className="note">×{f.n}</span></div>)}{p.fuel_kinds > p.fuels.length && <div className="note">and {p.fuel_kinds - p.fuels.length} more</div>}</>
    : <span className="note">—</span>;
  const outcomes = (p: any) => p.outcomes.length ? p.outcomes.map((o: any) => <div key={o.outcome}>{OUTCOME[o.outcome] ?? o.outcome} <span className="note">×{o.n}</span></div>) : <span className="note">Not coded in the source</span>;
  const metrics = (p: any) => p.metrics.length ? p.metrics.map((m: any) => <div key={m.name}>{m.name.replace(/_/g, " ")}<div className="note">{g(m.min)} to {g(m.max)} {m.unit} · {m.n} values</div></div>) : <span className="note">—</span>;
  const kinds = (p: any) => p.records ? <>{p.records}<div className="note">{Object.entries(p.kinds).map(([k, n]) => `${n} ${KIND[k] ?? k}`).join(", ")}</div></> : <span className="note">No records loaded</span>;

  // one row per attribute: label, cell for A, cell for B, and whether the two differ
  const rows: [string, ReactNode, ReactNode, boolean][] = [
    ...d.static_fields.map((f: any): [string, ReactNode, ReactNode, boolean] =>
      [f.label, A.static[f.key] ?? <span className="note">—</span>, B.static[f.key] ?? <span className="note">—</span>, A.static[f.key] !== B.static[f.key]]),
    ["Records in the table", kinds(A), kinds(B), false],
    ["Fuel phase", list(A.phases), list(B.phases), A.phases.join() !== B.phases.join()],
    ["Gravity", list(A.gravity), list(B.gravity), A.gravity.join() !== B.gravity.join()],
    ["Fuels tested", fuels(A), fuels(B), false],
    ...["o2_pct", "pressure_psia", "flow_cm_s"].map((k): [string, ReactNode, ReactNode, boolean] => {
      const x = A.numeric[k], y = B.numeric[k];
      return [x.label === y.label ? x.label : `${x.label} / ${y.label}`, range(x), range(y), x.status !== y.status || x.min !== y.min || x.max !== y.max];
    }),
    ["Diluents", list(A.diluents), list(B.diluents), A.diluents.join() !== B.diluents.join()],
    ["Outcomes", outcomes(A), outcomes(B), false],
    ["Measured result", metrics(A), metrics(B), A.metrics.map((m: any) => m.name).join() !== B.metrics.map((m: any) => m.name).join()],
    ["What changed between its tests", list(A.varied), list(B.varied), false],
    ["What stayed the same", list(A.fixed), list(B.fixed), false],
  ];
  const head = (p: any) => (
    <th style={{ width: "41%" }}>
      <b style={{ color: "var(--text)", fontSize: 15 }}>{p.id}</b> <span className={`tag t${p.tier}`}>{p.tier_label}</span>
      <div>{p.name}</div>
      <div>{p.doi_url ? <a href={p.doi_url} target="_blank" rel="noreferrer">{p.psi}</a> : p.psi ?? "PSI id not confirmed"}</div>
    </th>
  );

  return (
    <div className="grid">
      <div className="card">
        <h2>Compare two investigations</h2>
        <p className="note">{d.note}</p>
        <div className="grid g2" style={{ marginTop: 8 }}>{pick(a, setA, "First investigation")}{pick(b, setB, "Second investigation")}</div>
        {a === b && <div className="warnline" style={{ marginTop: 8 }}>Both sides show the same investigation.</div>}
      </div>

      <div className="grid g2">
        <div className="card"><h3>What they share</h3>
          {d.similarities.length ? <ul className="plain">{d.similarities.map((s: string) => <li key={s}>{s}</li>)}</ul> : <p className="note">Nothing in common was found in the loaded data.</p>}
        </div>
        <div className="card"><h3>Where they differ</h3>
          {d.differences.length ? <ul className="plain">{d.differences.map((s: string) => <li key={s}>{s}</li>)}</ul> : <p className="note">No difference was found in the loaded data.</p>}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Side by side</h2>
          <button className="ghost" onClick={() => onAsk(`Compare ${A.id} (${A.name}) with ${B.id} (${B.name}): what did each one find, and why do their results differ?`)}>Ask PSI to explain the difference</button>
        </div>
        <p className="note">Rows marked with an orange bar differ between the two.</p>
        <div className="scroll">
          <table className="cmp">
            <thead><tr><th />{head(A)}{head(B)}</tr></thead>
            <tbody>
              {rows.map(([label, x, y, differs]) => <tr key={label} className={differs ? "differs" : ""}><th scope="row">{label}</th><td>{x}</td><td>{y}</td></tr>)}
              <tr><th scope="row">Where this description comes from</th><td className="note">{A.details_basis ?? "—"}</td><td className="note">{B.details_basis ?? "—"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Test conditions on one map</h2>
        {A.points.length + B.points.length === 0 ? <p className="note">Neither investigation lists both oxygen and pressure, so there is nothing to plot.</p> : <>
          <p className="note">Each mark is a distinct oxygen and pressure combination that was tested.
            {A.points.length === 0 && ` ${A.id} lists no oxygen and pressure pairs.`}{B.points.length === 0 && ` ${B.id} lists no oxygen and pressure pairs.`}</p>
          <div style={{ height: 360 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 24, bottom: 34, left: 8 }}>
                <CartesianGrid stroke="#1e2838" />
                <XAxis type="number" dataKey="o2" domain={["auto", "auto"]} {...axis} label={{ value: "Oxygen (%)", position: "bottom", fill: "#93a1b8", fontSize: 12 }} />
                <YAxis type="number" dataKey="p" domain={["auto", "auto"]} {...axis} label={{ value: "Pressure (psi)", angle: -90, position: "insideLeft", fill: "#93a1b8", fontSize: 12 }} />
                <ZAxis range={[60, 60]} />
                <Tooltip cursor={{ stroke: "#3a4a63" }} content={({ payload }) => {
                  const r = payload?.[0]?.payload; if (!r) return null;
                  return <div className="card tip">O₂ {fmt(r.o2)}% · {fmt(r.p)} psi</div>;
                }} />
                <Legend verticalAlign="top" wrapperStyle={{ fontSize: 13 }} />
                <Scatter name={A.id} data={A.points} fill="#5aa9ff" shape="circle" fillOpacity={0.75} isAnimationActive={false} />
                {a !== b && <Scatter name={B.id} data={B.points} fill="#ff9d4d" shape="diamond" fillOpacity={0.75} isAnimationActive={false} />}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </>}
      </div>
    </div>
  );
}
