"use client";
import { useEffect, useRef, useState } from "react";
import { Atmos, Env, fmt } from "@/lib/api";

const SMALL_SCREEN = "(max-width: 819px)", MID_SCREEN = "(max-width: 1279px)";

function Verdict({ nav }: { nav: any }) {
  if (nav.covered) return <>NASA flew {nav.near_count} fire test{nav.near_count === 1 ? "" : "s"} near these conditions.</>;
  return <>No NASA flight test is this close. The nearest is {fmt(nav.nearest_distance)} steps away (1 step = 5 oxygen points or 2 psi).</>;
}

export default function ConfigWindow({ env, atmos, edited, nav, sidebarOpen, onEdit, onReset, onOpen }: {
  env: Env; atmos: Atmos; edited: boolean; nav: any; sidebarOpen: boolean; onEdit: (p: Partial<Atmos>) => void; onReset: () => void; onOpen: (section: "nav" | "earth") => void;
}) {
  // Expanded on desktop, collapsed to its header on small screens.
  const [expanded, setExpanded] = useState(() => typeof window === "undefined" || !window.matchMedia(SMALL_SCREEN).matches);
  // Mid-size screens cannot fit this window, the scene and the sidebar side by side: fold away while the sidebar is open.
  const folded = useRef(false);
  useEffect(() => {
    if (sidebarOpen && window.matchMedia(MID_SCREEN).matches) setExpanded((e) => { folded.current = e; return false; });
    else if (!sidebarOpen && folded.current) { folded.current = false; setExpanded(true); }
  }, [sidebarOpen]);
  const toggle = () => { folded.current = false; setExpanded(!expanded); };
  const ppO2 = (atmos.o2_pct / 100) * atmos.pressure_psia;
  const status = !nav ? "Checking test coverage" : nav.covered ? "Tested near these conditions" : "No flight test near these conditions";

  return (
    <section className="config" data-expanded={expanded} aria-label="Selected place and its air">
      <button className="config-head" aria-expanded={expanded} aria-controls="config-body" onClick={toggle}>
        <span className={`dot ${nav ? (nav.covered ? "ok" : "no") : ""}`} role="img" aria-label={status} title={status} />
        <span className="config-name">{env.name}</span>
        <svg className="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {expanded && (
        <div id="config-body" className="config-body">
          <div>
            <div className="eyebrow">You are looking at</div>
            <p className="note">Places where astronauts live and work. Click Earth, the ISS, a spacewalker, the Moon base, the rover or the Mars habitat to pick one. Drag to turn the view, scroll to zoom, right-drag to move.</p>
            <h2>{env.name}</h2>
            <p>{env.blurb}</p>
          </div>

          <div>
            <label htmlFor="cfg-o2">Oxygen (%) <b>{fmt(atmos.o2_pct)}%</b></label>
            <input id="cfg-o2" type="range" min={10} max={100} step={0.5} value={atmos.o2_pct} aria-describedby="cfg-o2-help" onChange={(e) => onEdit({ o2_pct: +e.target.value })} />
            <p id="cfg-o2-help" className="help">How much of the air is oxygen. More oxygen usually makes flames easier to start and faster to spread.</p>
          </div>
          <div>
            <label htmlFor="cfg-p">Cabin pressure (psi) <b>{fmt(atmos.pressure_psia)} psi</b></label>
            <input id="cfg-p" type="range" min={3} max={20} step={0.1} value={atmos.pressure_psia} aria-describedby="cfg-p-help" onChange={(e) => onEdit({ pressure_psia: +e.target.value })} />
            <p id="cfg-p-help" className="help">How hard the air presses, in pounds per square inch. More pressure usually helps flames start and spread.</p>
          </div>

          <dl className="facts">
            <div>
              <dt>Gravity</dt>
              <dd><b>{fmt(atmos.gravity_g, 2)} g</b><span className="help">Pull compared with Earth, where it is 1 g.</span></dd>
            </div>
            <div>
              <dt>Oxygen partial pressure</dt>
              <dd><b>{fmt(ppO2)} psi O₂</b><span className="help">Oxygen share × pressure: what a flame feeds on.</span></dd>
            </div>
          </dl>

          {nav && (
            <div className={`verdict ${nav.covered ? "ok" : "no"}`}>
              <Verdict nav={nav} /> <button className="link" onClick={() => onOpen("nav")}>See details</button>
            </div>
          )}

          <div className="note">
            {edited ? <>Edited values. <button className="link" onClick={onReset}>Reset to preset</button></> : <>Preset: {env.basis}</>}
          </div>
          {env.id === "earth" && <button className="ghost" onClick={() => onOpen("earth")}>See what this research gave Earth</button>}
        </div>
      )}
    </section>
  );
}
