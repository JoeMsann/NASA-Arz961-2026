"use client";
import { Atmos, Env, fmt } from "@/lib/api";

export default function EnvPanel({ env, atmos, edited, nav, onEdit, onReset, onEarth }: {
  env: Env; atmos: Atmos; edited: boolean; nav: any; onEdit: (p: Partial<Atmos>) => void; onReset: () => void; onEarth: () => void;
}) {
  const ppO2 = (atmos.o2_pct / 100) * atmos.pressure_psia;
  return (
    <aside className="card envp">
      <div className="note">Selected environment</div>
      <h2>{env.name}</h2>
      <p>{env.blurb}</p>
      <div className="stats">
        <div><b>{fmt(atmos.o2_pct)}%</b><span>oxygen</span></div>
        <div><b>{fmt(atmos.pressure_psia)}</b><span>psi</span></div>
        <div><b>{fmt(atmos.gravity_g, 2)} g</b><span>gravity</span></div>
        <div><b>{fmt(ppO2)}</b><span>psi O₂</span></div>
      </div>
      <label>Oxygen <b>{fmt(atmos.o2_pct)}%</b></label>
      <input type="range" min={10} max={100} step={0.5} value={atmos.o2_pct} onChange={(e) => onEdit({ o2_pct: +e.target.value })} />
      <label>Cabin pressure <b>{fmt(atmos.pressure_psia)} psi</b></label>
      <input type="range" min={3} max={20} step={0.1} value={atmos.pressure_psia} onChange={(e) => onEdit({ pressure_psia: +e.target.value })} />
      <div className="note" style={{ marginTop: 8 }}>
        {edited ? <>Edited values. <button className="link" onClick={onReset}>Reset to preset</button></> : <>Preset: {env.basis}</>}
      </div>
      {nav && (
        <div className={`verdict ${nav.covered ? "ok" : "no"}`}>
          {nav.covered ? <>Tested: {nav.near_count} flight tests near these conditions</> : <>No data here: closest flight test is {fmt(nav.nearest_distance)} steps away</>}
        </div>
      )}
      {env.id === "earth" && <button className="ghost" style={{ marginTop: 10 }} onClick={onEarth}>See what this research gave Earth</button>}
    </aside>
  );
}
