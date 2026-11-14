"use client";
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { Atmos, Env, OUTCOME, fmt } from "@/lib/api";

const axis = { stroke: "#93a1b8", fontSize: 12 };

export default function Navigator({ env, atmos, nav, onAsk }: { env: Env; atmos: Atmos; nav: any; onAsk: (q: string) => void }) {
  if (!nav) return <div className="card">Loading coverage…</div>;
  const pts = nav.points as any[];
  const series = [
    { name: "Flown microgravity test", data: pts.filter((p) => p.kind === "test"), fill: "#5aa9ff", shape: "circle" as const, size: 40 },
    { name: "Planned, no result", data: pts.filter((p) => p.kind === "planned"), fill: "#7d8aa0", shape: "diamond" as const, size: 28 },
    { name: "1-g ground threshold", data: pts.filter((p) => p.kind === "threshold_1g"), fill: "#c9a227", shape: "triangle" as const, size: 34 },
  ];
  const here = [{ o2: atmos.o2_pct, p: atmos.pressure_psia, id: env.name, inv: "Selected environment", fuel: "", kind: "env" }];
  const phases = Object.entries(nav.near_by_phase as Record<string, number>);
  const missing = phases.filter(([, n]) => n === 0).map(([p]) => p);
  const th = nav.thresholds_1g;

  return (
    <div className="grid">
      <div className={`card banner ${nav.covered ? "ok" : "no"}`}>
        <h3>{nav.covered ? `Tested near ${env.name} conditions` : `No data here: ${env.name} conditions were never flown`}</h3>
        <div>{nav.covered
          ? <>{nav.near_count} flight tests lie within range. {missing.length > 0 && <b>None of them cover: {missing.join(", ")}.</b>}</>
          : <>The closest flight test is {fmt(nav.nearest_distance)} steps away (1 step = 5 O₂ points or 2 psi). Anything said about this environment is extrapolation.</>}</div>
        <div className="note gap-top">{nav.rule} {nav.gravity_note}</div>
        <div className="row gap-top">
          {phases.map(([p, n]) => <span key={p} className={`tag ${n ? "" : "tno"}`}>{p}: {n}</span>)}
          <button className="ghost" onClick={() => onAsk(`For an atmosphere of ${fmt(atmos.o2_pct)}% O2 at ${fmt(atmos.pressure_psia)} psi, which tests are closest and what happened in them? What is missing?`)}>Ask PSI about this environment</button>
        </div>
      </div>

      <div className="card">
        <h3>Coverage map</h3>
        <p className="note">Every record that lists oxygen and pressure. The ring marks {env.name}. Empty space around it means no evidence.</p>
        <div className="chart">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 12, bottom: 28, left: 0 }}>
              <CartesianGrid stroke="#1e2838" />
              <XAxis type="number" dataKey="o2" domain={[10, 100]} ticks={[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]} {...axis} label={{ value: "Oxygen (%)", position: "bottom", fill: "#93a1b8", fontSize: 12 }} />
              <YAxis type="number" dataKey="p" domain={[0, 46]} width={46} {...axis} label={{ value: "Pressure (psi)", angle: -90, position: "insideLeft", fill: "#93a1b8", fontSize: 12 }} />
              <ZAxis range={[40, 40]} />
              <Tooltip cursor={{ stroke: "#3a4a63" }} content={({ payload }) => {
                const r = payload?.[0]?.payload; if (!r) return null;
                return <div className="card tip"><b>{r.id}</b> · {r.inv}<br />{r.fuel}<br />O₂ {fmt(r.o2)}% · {fmt(r.p)} psi{r.outcome ? <><br />{OUTCOME[r.outcome] ?? r.outcome}</> : null}</div>;
              }} />
              <Legend verticalAlign="top" wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} />
              {series.map((s) => <Scatter key={s.name} name={s.name} data={s.data} fill={s.fill} shape={s.shape} fillOpacity={0.7} isAnimationActive={false} />)}
              <Scatter name={env.name} data={here} isAnimationActive={false} fill={nav.covered ? "#4cd28a" : "#ff6b6b"}
                shape={(p: any) => <g><circle cx={p.cx} cy={p.cy} r={13} fill="none" stroke={p.fill} strokeWidth={3} /><circle cx={p.cx} cy={p.cy} r={3.5} fill={p.fill} /></g>} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3>Investigations ranked for {env.name}</h3>
        <p className="note">Order: closest test conditions first, then fire-safety class. Distance 0 means a test ran at these exact conditions.</p>
        <div className="scroll scroll-md">
          <table>
            <thead><tr><th>#</th><th>Investigation</th><th>Class</th><th>Distance</th><th>Tests in range</th><th>Closest test</th><th>Why it matters</th></tr></thead>
            <tbody>
              {nav.ranking.map((r: any, k: number) => (
                <tr key={r.investigation}>
                  <td>{k + 1}</td>
                  <td><b>{r.investigation}</b><div className="note">{r.doi_url ? <a href={r.doi_url} target="_blank" rel="noreferrer">{r.psi}</a> : r.psi}</div></td>
                  <td><span className={`tag t${r.tier}`}>{r.tier_label}</span></td>
                  <td className={r.min_distance <= 1 ? "good" : "far"}>{fmt(r.min_distance, 2)}</td>
                  <td>{r.near} of {r.tests}</td>
                  <td>{r.closest.fuel}<div className="note">O₂ {fmt(r.closest.o2_pct)}% · {fmt(r.closest.pressure_psia)} psi{r.closest.outcome ? ` · ${OUTCOME[r.closest.outcome] ?? r.closest.outcome}` : ""}{r.closest.assumed ? ` · assumed: ${r.closest.assumed}` : ""}</div></td>
                  <td>{r.safety}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {nav.not_placed.length > 0 && <p className="note">Not ranked, because their tables list no oxygen or pressure: {nav.not_placed.join(", ")}.</p>}
      </div>

      <div className="card">
        <h3>Ground-test check at {fmt(atmos.o2_pct)}% oxygen</h3>
        <p><b>{th.burn_count} of {th.total}</b> 1-g material records keep burning upward at or below this oxygen level.</p>
        <p className="note">{th.note}</p>
        <div className="grid">
          <div><h4>Burn at this oxygen level</h4>
            {th.burns.length ? <ul className="plain">{th.burns.map((t: any) => <li key={t.test_id}>{t.fuel} <span className="note">burns from {fmt(t.o2_pct)}% · {fmt(t.pressure_psia)} psi</span></li>)}</ul> : <p className="note">None in this dataset.</p>}
          </div>
          <div><h4>Next to become flammable</h4>
            {th.resists.length ? <ul className="plain">{th.resists.map((t: any) => <li key={t.test_id}>{t.fuel} <span className="note">burns from {fmt(t.o2_pct)}% · {fmt(t.pressure_psia)} psi</span></li>)}</ul> : <p className="note">Every tested material burns at this level.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
