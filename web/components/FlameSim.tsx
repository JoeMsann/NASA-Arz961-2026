"use client";
import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/api";
import { BLUE, FlameScene, SHELL, createFlameScene } from "@/components/scene/flame3d";

// One droplet burn drawn from the Predictor's result. The ml service computes every number (flame() in services/ml/app.py);
// this component only interpolates its time samples and draws them. docs/flame-simulation.md explains the physics.
type Run = { id: string; d0_mm: number; d_ext_mm: number; ratio: number };
type Burn = {
  p: number; d_end: number; mode: "radiative" | "diffusive" | "burnout"; retreat_s: number; t_end: number;
  t: number[]; d: number[]; df: number[]; fsr: number[]; lum: number[]; soot: number[]; ratio?: number; from_runs?: Run[];
};
type Source = { cite: string; url: string };
export type Flame = {
  fuel: "Heptane" | "Methanol"; k: number; d0: number; default: Ending; out: Burn | null; burnout: Burn;
  fsr_o2_held: boolean; fsr_o2_range: [number, number]; fsr_steady: number | null; fsr_o2_factor: number | null;
  d2_check: { n: number; median: number; p10: number; p90: number } | null; runs: number; disrupted: number;
  sources: { flex: Source; cool_flame: Source };
};
type Ending = "out" | "burnout";
type View = "3d" | "2d";

const SPEEDS = [1, 2, 5, 10];
const BG = "#020306";
const pct = (v: number) => `${Math.round(v * 100)}%`;
const still = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Brightness across a thin glowing spherical shell (outer radius 1) seen from afar: the path length through the shell. */
const PROFILE = (() => {
  const ri = 1 - SHELL, peak = 2 * Math.sqrt(1 - ri * ri), out: number[] = [];
  for (let s = 0; s <= 48; s++) {
    const r = s / 48;
    out.push((2 * (Math.sqrt(Math.max(1 - r * r, 0)) - Math.sqrt(Math.max(ri * ri - r * r, 0)))) / peak);
  }
  return out;
})();

/** The burn at time t, interpolated between the service's evenly spaced samples. */
function sample(b: Burn, t: number) {
  const n = b.t.length - 1, end = b.t[n];
  const x = Math.min(Math.max(t / end, 0), 1) * n, i = Math.min(Math.floor(x), n - 1), f = x - i;
  const at = (a: number[]) => a[i] + (a[i + 1] - a[i]) * f;
  return { d: at(b.d), df: at(b.df), fsr: at(b.fsr), lum: at(b.lum), soot: at(b.soot) };
}

function draw(cv: HTMLCanvasElement, fuel: Flame["fuel"], b: Burn, t: number, fov: number) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const dpr = cv.width / Math.max(cv.clientWidth, 1), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
  const pxmm = Math.min(W, H) / fov, end = b.t[b.t.length - 1], s = sample(b, t);
  const alive = t < end && s.df > 0;
  const [r, g, bl] = BLUE[fuel];
  ctx.clearRect(0, 0, W, H);

  if (alive) {
    const R = (s.df / 2) * pxmm;
    ctx.globalCompositeOperation = "lighter";
    // camera glow just outside the flame
    const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.35);
    halo.addColorStop(0, `rgba(${r},${g},${bl},${(0.14 * s.lum).toFixed(3)})`);
    halo.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(cx - R * 1.4, cy - R * 1.4, R * 2.8, R * 2.8);
    // the reaction zone is a thin shell, so it shows as a ring brighter at its edge
    const shell = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    PROFILE.forEach((v, k) => shell.addColorStop(k / (PROFILE.length - 1), `rgba(${r},${g},${bl},${(0.92 * v * s.lum).toFixed(3)})`));
    ctx.fillStyle = shell;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fill();
    // heptane soot glows yellow just after ignition, inside the reaction zone, far brighter than the blue: paint over it
    if (s.soot > 0.01) {
      ctx.globalCompositeOperation = "source-over";
      const soot = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.9);
      soot.addColorStop(0, `rgba(255,236,170,${(0.97 * s.soot).toFixed(3)})`);
      soot.addColorStop(0.5, `rgba(255,170,60,${(0.85 * s.soot).toFixed(3)})`);
      soot.addColorStop(1, "rgba(240,100,20,0)");
      ctx.fillStyle = soot;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, 0, 2 * Math.PI); ctx.fill();
    }
    // radiative extinction: the flame dies on one side first and the dark region sweeps across
    if (b.retreat_s > 0 && t > end - b.retreat_s) {
      const p = (t - (end - b.retreat_s)) / b.retreat_s, edge = cx + R * (1.4 - 2.8 * p);
      const sweep = ctx.createLinearGradient(edge - R * 0.3, 0, edge, 0);
      sweep.addColorStop(0, "rgba(0,0,0,0)");
      sweep.addColorStop(1, "rgba(0,0,0,1)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = sweep;
      ctx.fillRect(edge - R * 0.3, 0, W, H);
    }
  }
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";

  // the droplet, to the same scale (at least a dot, so it stays visible)
  const d = t >= end ? b.d_end : s.d;
  if (d > 0) {
    const rd = Math.max((d / 2) * pxmm, 1.25 * dpr);
    const fill = ctx.createRadialGradient(cx - rd * 0.35, cy - rd * 0.35, rd * 0.1, cx, cy, rd);
    fill.addColorStop(0, "#4a5263");
    fill.addColorStop(1, "#11151d");
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(cx, cy, rd, 0, 2 * Math.PI); ctx.fill();
    ctx.lineWidth = dpr;
    ctx.strokeStyle = alive ? `rgba(${r},${g},${bl},${(0.25 + 0.4 * s.lum).toFixed(3)})` : "rgba(147,161,184,.45)";
    ctx.stroke();
  }

  // scale bar bottom left, clock bottom right
  const fits = [1, 2, 5, 10, 20, 50, 100].filter((mm) => mm * pxmm <= W * 0.3);
  const mm = fits.length ? fits[fits.length - 1] : 1, len = mm * pxmm, x0 = 14 * dpr, y0 = H - 14 * dpr;
  ctx.strokeStyle = ctx.fillStyle = "#93a1b8";
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - 4 * dpr); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 4 * dpr);
  ctx.stroke();
  ctx.font = `${12 * dpr}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText(`${mm} mm`, x0, y0 - 6 * dpr);
  ctx.textAlign = "right";
  ctx.fillText(`${t.toFixed(1)} s`, W - 14 * dpr, y0);
}

/** What the 3D scene draws at time t: the same interpolated numbers as the flat drawing. */
function frame3(flame: Flame, b: Burn, t: number, cut: boolean) {
  const end = b.t[b.t.length - 1], s = sample(b, t), alive = t < end && s.df > 0, into = t - (end - b.retreat_s);
  return {
    fuel: flame.fuel, d: t >= end ? b.d_end : s.d, df: alive ? s.df : 0, lum: s.lum, soot: s.soot,
    retreat: alive && b.retreat_s > 0 && into > 0 ? into / b.retreat_s : null, dfMax: Math.max(...b.df), cut,
  };
}

/** Scale bar for the 3D view. Exact at the droplet's depth; the narrow perspective changes it little elsewhere. */
function ScaleBar({ pxmm }: { pxmm: number }) {
  if (!pxmm) return null;
  const fits = [0.5, 1, 2, 5, 10, 20, 50, 100].filter((mm) => mm * pxmm <= 120);
  const mm = fits.length ? fits[fits.length - 1] : 0.5;
  return <span className="sim-scale" style={{ width: mm * pxmm }}><i>{mm} mm</i></span>;
}

export default function FlameSim({ flame, gravity, extrapolating }: { flame: Flame; gravity: number; extrapolating: boolean }) {
  const [ending, setEnding] = useState<Ending>(flame.default);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [size, setSize] = useState(0);        // bumped whenever the flat canvas is resized, which clears it
  const [view, setView] = useState<View>("3d");
  const [gl, setGl] = useState(true);         // false once WebGL failed: then the flat drawing is all there is
  const [cut, setCut] = useState(false);
  const [pxmm, setPxmm] = useState(0);        // 3D view: CSS pixels per millimetre at the droplet, for the scale bar
  const scene3 = useRef<FlameScene | null>(null);
  const glHost = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  const cv = useRef<HTMLCanvasElement>(null);
  const b = (ending === "out" && flame.out) || flame.burnout;
  const end = b.t[b.t.length - 1];
  // one scale for both endings, so switching between them does not resize the picture
  const fov = Math.max(5, 1.15 * Math.max(...flame.burnout.df, ...(flame.out?.df ?? [])));
  const seek = (v: number) => { tRef.current = v; setT(v); };

  // A new prediction is a new burn: play its likelier ending from ignition. With reduced motion, start paused mid-burn.
  useEffect(() => {
    const next: Ending = flame.out && flame.default === "out" ? "out" : "burnout";
    const nb = (next === "out" && flame.out) || flame.burnout;
    setEnding(next);
    seek(still() ? nb.t[nb.t.length - 1] / 2 : 0);
    setPlaying(!still());
  }, [flame]);

  // Flat drawing: keep the canvas at device resolution. The 3D scene sizes its own canvas.
  useEffect(() => {
    const el = cv.current;
    if (view !== "2d" || !el) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; setSize((n) => n + 1); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  // 3D scene: built on the canvas when the 3D view is shown, torn down when it is left
  useEffect(() => {
    const el = glHost.current;
    if (view !== "3d" || !el) return;
    const sc = createFlameScene(el, { still: still() });
    if (!sc) { setGl(false); setView("2d"); return; }
    scene3.current = sc;
    sc.onView(() => setPxmm(sc.pxPerMm()));
    return () => { sc.dispose(); scene3.current = null; setPxmm(0); };
  }, [view]);
  useEffect(() => { scene3.current?.fit(fov); }, [fov, view]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const next = Math.min(tRef.current + ((now - last) / 1000) * speed, end);
      last = now;
      seek(next);
      if (next >= end) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, end]);

  useEffect(() => {
    if (view === "3d") scene3.current?.frame(frame3(flame, b, t, cut));
    else if (cv.current && size) draw(cv.current, flame.fuel, b, t, fov);
  }, [view, flame, b, t, fov, size, cut]);

  const pick = (e: Ending) => { setEnding(e); seek(0); setPlaying(!still()); };
  const play = () => { if (tRef.current >= end) { seek(0); setPlaying(true); } else setPlaying(!playing); };

  const heptane = flame.fuel === "Heptane", fuel = flame.fuel.toLowerCase();
  const s = sample(b, t), done = t >= end, alive = !done && s.df > 0;
  const status = done
    ? b.mode === "burnout" ? "All the fuel burned. The flame shrank with the droplet until nothing was left."
      : `Out. A droplet ${fmt(b.d_end, 2)} mm across is left.${heptane ? " In FLEX, large heptane droplets often kept burning at this point with an invisible cool flame (not drawn)." : ""}`
    : b.retreat_s > 0 && t > end - b.retreat_s ? "Going out: the flame dies on one side first and the dark region sweeps across."
      : s.soot > 0.3 ? "Igniting: soot glows yellow for a moment, then the flame turns blue."
        : "Burning: a steady blue ball around the droplet.";
  const label = `Simulated ${fuel} droplet flame in microgravity: a round blue flame up to ${fmt(Math.max(...b.df), 0)} mm across around a `
    + `${fmt(flame.d0, 2)} mm droplet. ${b.mode === "burnout" ? `It burns all the fuel in ${fmt(end, 1)} s.`
      : `It goes out after ${fmt(end, 1)} s, leaving a ${fmt(b.d_end, 2)} mm droplet.`}`;
  const pOut = 1 - flame.burnout.p, ck = flame.d2_check, near = flame.out?.from_runs ?? [];

  return (
    <div className="card">
      <h3>Flame simulation</h3>
      {gravity > 0.01 && (
        <p className="warnline gap-top">
          Drawn for microgravity, like every FLEX burn. At {fmt(gravity, 2)} g buoyancy would carry hot gas upward and stretch the flame into
          a teardrop, as a candle does on Earth. Neither the model nor this drawing covers that.
        </p>
      )}
      {extrapolating && <p className="warnline gap-top">Some inputs are outside the tested range, so this burn is drawn from extrapolated numbers.</p>}

      <div className="seg" role="group" aria-label="Ending to show">
        <button className="ghost" aria-pressed={ending === "out"} disabled={!flame.out} onClick={() => pick("out")}>
          Goes out by itself <b className={extrapolating ? "dim" : ""}>{pct(pOut)}</b>
        </button>
        <button className="ghost" aria-pressed={ending === "burnout"} onClick={() => pick("burnout")}>
          Burns all the fuel <b className={extrapolating ? "dim" : ""}>{pct(flame.burnout.p)}</b>
        </button>
      </div>

      <div className="row sim-opts" role="group" aria-label="View">
        <button className="ghost" aria-pressed={view === "3d"} disabled={!gl} onClick={() => setView("3d")}
          title={gl ? undefined : "WebGL is not available in this browser"}>3D</button>
        <button className="ghost" aria-pressed={view === "2d"} onClick={() => setView("2d")}>Camera view</button>
        {view === "3d" && <button className="ghost" aria-pressed={cut} onClick={() => setCut(!cut)}>Cut flame in half</button>}
      </div>

      <div className="sim-view">
        {view === "2d" ? <canvas ref={cv} role="img" aria-label={label} /> : <>
          <div ref={glHost} className="sim-gl" role="img" aria-label={`${label} Shown in 3D: drag to turn, scroll to zoom.`} />
          <ScaleBar pxmm={pxmm} />
          <span className="sim-clock">{t.toFixed(1)} s</span>
          <span className="sim-hint">Drag to turn · scroll to zoom</span>
        </>}
      </div>

      <div className="row sim-controls">
        <button className="ghost" onClick={play}>{playing ? "Pause" : done ? "Replay" : "Play"}</button>
        <input type="range" min={0} max={end} step={end / 400} value={Math.min(t, end)} aria-label="Time since ignition, seconds"
          onChange={(e) => { setPlaying(false); seek(+e.target.value); }} />
        <select value={speed} aria-label="Playback speed" onChange={(e) => setSpeed(+e.target.value)}>
          {SPEEDS.map((v) => <option key={v} value={v}>{v === 1 ? "Real time" : `${v}× faster`}</option>)}
        </select>
      </div>

      <dl className="sim-read">
        <div><dt>Since ignition</dt><dd>{fmt(t, 1)} s <span className="note">of {fmt(end, 1)}</span></dd></div>
        <div><dt>Droplet</dt><dd>{fmt(done ? b.d_end : s.d, 2)} mm</dd></div>
        <div><dt>Flame</dt><dd>{alive ? <>{fmt(s.df, 1)} mm <span className="note">{fmt(s.fsr, 1)}× droplet</span></> : "none"}</dd></div>
      </dl>
      <p className="sim-status">{status}</p>
      <p className="note">
        A {fuel} droplet burning in microgravity, drawn to scale and in real time from the two predictions below. With no buoyancy there is
        no rising hot gas, so instead of a candle&apos;s flickering teardrop the flame is a steady ball around the droplet. The model gives
        a chance, not a certainty, so either ending can be shown; the likelier one comes first.
      </p>

      <details>
        <summary>How this burn is computed</summary>
        <ul className="plain">
          <li>
            <b>Droplet size.</b> The d² law, d² = d₀² − K·t, with d₀ = {fmt(flame.d0, 2)} mm and K = {fmt(flame.k, 3)} mm²/s from the
            burning-rate model below.
            {ck && <> Checked against FLEX: across the {ck.n} {fuel} runs that went out, the recorded burn time was typically{" "}
              {fmt(ck.median, 2)} times what this law gives with each run&apos;s own K (10th to 90th percentile: {fmt(ck.p10, 2)} to{" "}
              {fmt(ck.p90, 2)} times). Real burns usually ran a little longer than drawn.</>}
          </li>
          <li>
            <b>Ending.</b> The extinction model gives a {pct(pOut)} chance that the flame goes out before the fuel is gone.
            {flame.out && near.length > 0 && <> If it does, it goes out when the droplet is {fmt(flame.out.d_end, 2)} mm across,
              {" "}{fmt(flame.out.ratio ?? 0, 2)} of its starting size. That is the median of the {near.length} FLEX {fuel} runs that went out
              under the most similar conditions ({near.map((r) => `${r.id}: ${fmt(r.ratio, 2)}`).join(", ")}).</>}
          </li>
          <li>
            <b>Flame size.</b> Flame diameter = standoff ratio × droplet diameter, with ratios measured in FLEX and published by Dietrich et al. (2014).
            {heptane
              ? <> Heptane flames kept growing relative to the droplet, from about 7 times its diameter to 11 to 15 times before going out
                (their Figs. 3 and 4: runs 301F001, C01H601 and C01H701). The drawing uses one straight line through those three runs,
                ratio = 6.8 + 5.4·t/d₀², capped at 15, which matches each run to within about 12%. Those runs burned at 18 to 20% O₂. Here the
                ratio is multiplied by {fmt(flame.fsr_o2_factor, 2)} for the oxygen level, following the trend FLEX measured for methanol.
                That is an assumption: simple flame theory gives both fuels nearly the same relative trend.</>
              : <> Methanol flames held a nearly steady ratio once lit, {fmt(flame.fsr_steady, 1)} at this oxygen level. It comes from the trend
                line through the FLEX methanol results against oxygen (their Fig. 7, whose points scatter about ±1 around it). The ratio starts at
                about three quarters of that and settles within a few seconds (their Fig. 6).</>}
            {flame.fsr_o2_held && <> FLEX measured standoff ratios only between {flame.fsr_o2_range[0]} and {flame.fsr_o2_range[1]}% O₂,
              so the value at the nearer end of that range is used.</>}
            {" "}Pressure, CO₂ and helium do not change the ratio in this drawing, only how fast the droplet burns: FLEX methanol flames kept a
            ratio near 5 in air and with 30% CO₂ or helium.
          </li>
          <li>
            <b>3D view.</b> The same numbers as the camera view, drawn as glowing gas you can turn. Each pixel adds up the light along
            its line of sight through the flame, as a camera does, so the thin reaction zone shows as a bright rim around a fainter
            middle from every angle. Soot glows and also hides what is behind it. Bright areas bleed a little, as in a real lens.
            &ldquo;Cut flame in half&rdquo; removes the near half so the gap between droplet and flame (the standoff distance) shows
            from the side. The faint rings mark the largest size the flame reaches in this burn. Drawing choices, not data: how thick
            the glowing zone is, the slightly greener inner edge, the soot&apos;s position and churning texture, the lens glow, and the
            droplet&apos;s shading (it uses the liquid&apos;s real refractive index, but no test recorded how the droplet looked).
            The flame stays a sphere because FLEX droplets burned in still gas with no buoyancy. Drift, airflow or gravity would
            stretch it, and neither the model nor the data here covers that.
          </li>
          <li>
            <b>Shape.</b> A sphere centred on the droplet, steady, with no flicker. A candle&apos;s flicker and teardrop shape both come from
            buoyancy, and the FLEX chamber typically stayed below one hundred-thousandth of Earth&apos;s gravity.
          </li>
          <li>
            <b>Colour and brightness.</b> The flame is a thin glowing shell, so it shows as a ring brighter at its edge.
            {heptane ? " Heptane glows yellow from soot just after ignition and then burns blue. The paper says the yellow “quickly” gave way to blue without timing it; the drawing fades it over about a second."
              : " Methanol makes no soot at these pressures, so it shows only a faint blue."}
            {" "}Brightness is relative: bright early and dim near the end, as FLEX observed. The camera gain was set per test, so the images give
            no brightness to compare between conditions.
          </li>
          <li>
            <b>How it goes out.</b> {heptane
              ? "Heptane flames usually went out radiatively: as the flame grows it loses more heat by radiation, then dies on one side and retreats across within 5 to 10 video frames, a fraction of a second."
              : "Methanol flames went out diffusively: visible in one video frame and gone in the next."}
          </li>
          <li>
            <b>Not drawn.</b> The pulsing at about once a second that some flames showed just before going out radiatively.
            {heptane && <> The invisible cool flame on which large heptane droplets kept burning after the visible flame went out
              (<a href={flame.sources.cool_flame.url} target="_blank" rel="noreferrer">Nayagam et al. 2012</a>).</>}
            {" "}Droplet break-up, which ended {flame.disrupted} of the {flame.runs} FLEX {fuel} runs used here and is left out of the extinction
            model. Droplet drift, the igniter and the deployment needles.
          </li>
        </ul>
        <p className="note gap-top">
          Source for the flame behaviour: <a href={flame.sources.flex.url} target="_blank" rel="noreferrer">{flame.sources.flex.cite}</a>.
          The ratios were read off its figures; docs/flame-simulation.md in the repository shows how.
        </p>
      </details>
    </div>
  );
}
