"use client";
import { useEffect, useState } from "react";
import { api, Atmos, Env, fmt } from "@/lib/api";

const pct = (v: number) => `${Math.round(v * 100)}%`;
function Range({ lo, hi, mean, max }: { lo: number; hi: number; mean: number; max: number }) {
  const p = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return <div className="bar"><i style={{ left: p(lo), width: `calc(${p(hi)} - ${p(lo)})` }} /><u style={{ left: p(mean) }} /></div>;
}

export default function Predictor({ env, atmos }: { env: Env; atmos: Atmos }) {
  const [x, setX] = useState({ fuel: "Heptane", co2_pct: 0, he_pct: 0, d0_mm: 3 });
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState("");
  const body = { ...x, o2_pct: Math.min(100, Math.max(5, atmos.o2_pct)), pressure_psia: atmos.pressure_psia };
  const key = JSON.stringify(body);
  useEffect(() => {
    const t = setTimeout(() => api("ml", "predict", JSON.parse(key)).then((o) => { setOut(o); setErr(""); }).catch((e) => setErr(e.message)), 150);
    return () => clearTimeout(t);
  }, [key]);
  const slider = (k: "co2_pct" | "he_pct" | "d0_mm", label: string, min: number, max: number, step: number, unit: string) => (
    <><label>{label}<b>{fmt(x[k], 2)}{unit}</b></label>
      <input type="range" min={min} max={max} step={step} value={x[k]} onChange={(e) => setX({ ...x, [k]: +e.target.value })} /></>
  );
  const s = out?.scores;

  return (
    <div className="grid">
      <div className="grid">
        <div className="card">
          <h3>Small liquid-fuel fire in {env.name}</h3>
          <p className="note">Uses the oxygen and pressure set for the selected place ({fmt(atmos.o2_pct)}% O₂, {fmt(atmos.pressure_psia)} psi). {out?.scope}</p>
          <label>Fuel</label>
          <select value={x.fuel} onChange={(e) => setX({ ...x, fuel: e.target.value })}><option>Heptane</option><option>Methanol</option></select>
          {slider("co2_pct", "CO₂ added (suppressant)", 0, 70, 1, "%")}
          {slider("he_pct", "Helium added (diluent)", 0, 45, 1, "%")}
          {slider("d0_mm", "Droplet diameter", 1, 5, 0.05, " mm")}
        </div>
        {s && (
          <div className="card">
            <h3>How far to trust this</h3>
            <table><tbody>
              <tr><td>Self-extinction model</td><td>AUC {fmt(s.extinction.shipped_auc, 2)} on {s.extinction.n} tests</td></tr>
              <tr><td>Burning-rate model</td><td>R² {fmt(s.burn_rate.shipped_r2, 2)}, typical error {fmt(s.burn_rate.shipped_mae, 3)} mm²/s on {s.burn_rate.n} tests</td></tr>
            </tbody></table>
            <p className="note">{s.validation}. {s.shipped} {s.excluded_disruption_runs} droplet break-up runs left out of the extinction model.</p>
          </div>
        )}
      </div>

      <div className="grid">
        {err && <div className="card bad">{err}</div>}
        {out?.outside.length > 0 && (
          <div className="card warn"><b>Outside the tested range. Treat every number below as extrapolation.</b>
            {out.outside.map((o: any) => <div key={o.feature}>{o.feature}: {o.value} {o.unit} (tested {o.min} to {o.max} {o.unit})</div>)}
          </div>
        )}
        {out && <>
          <div className="card">
            <h3>Chance the flame goes out before the fuel is gone</h3>
            <div className={`big ${out.extrapolating ? "dim" : ""}`}>{pct(out.extinction.mean)}</div>
            {out.extrapolating && <div className="warnline">Extrapolated. The narrow range below reflects the model, not evidence.</div>}
            <Range {...out.extinction} max={1} />
            <div className="note">90% bootstrap range {pct(out.extinction.lo)} to {pct(out.extinction.hi)}. Higher is safer.</div>
          </div>
          <div className="card">
            <h3>Burning-rate constant</h3>
            <div className={`big ${out.extrapolating ? "dim" : ""}`}>{fmt(out.burn_rate.mean, 2)} <span className="unit">mm²/s</span></div>
            <Range {...out.burn_rate} max={1.2} />
            <div className="note">90% bootstrap range {fmt(out.burn_rate.lo, 2)} to {fmt(out.burn_rate.hi, 2)}. Higher means fuel is consumed faster.</div>
          </div>
          <div className="card">
            <h3>Closest real tests</h3>
            <div className="scroll"><table>
              <thead><tr><th>Test</th><th>O₂</th><th>psi</th><th>CO₂</th><th>He</th><th>d₀ mm</th><th>K</th><th>Ended</th></tr></thead>
              <tbody>{out.nearest.map((r: any) => <tr key={r.id}><td>{r.id}</td><td>{r.o2_pct}%</td><td>{r.pressure_psia}</td><td>{r.co2_pct}%</td><td>{r.he_pct}%</td><td>{r.d0_mm}</td><td>{r.k ?? "—"}</td><td>{r.end}</td></tr>)}</tbody>
            </table></div>
          </div>
          <div className="card">
            <h3>Gravity: what 0 g and 1 g each showed</h3>
            <p className="note">{atmos.gravity_g > 0.01 && atmos.gravity_g < 0.99
              ? `No test in the dataset ran at ${fmt(atmos.gravity_g, 2)} g. These Saffire-II samples were burned both in orbit and on the ground. They bracket the question; they do not answer it.`
              : "Saffire-II burned the same samples in orbit and on the ground."}</p>
            <ul className="plain">{out.gravity_pairs.map((g: any) => <li key={g.test_id}><b>{g.fuel}</b> <span className="note">{g.notes}</span></li>)}</ul>
          </div>
        </>}
      </div>
    </div>
  );
}
