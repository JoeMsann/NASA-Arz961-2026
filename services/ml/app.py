"""ML service: unified table, habitat navigator, flame predictor.

Loads artifacts written by pipeline/build.py (DATA_DIR, default ./data/build).
"""
import csv, io, json, math, os, pathlib, re, sqlite3
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

DATA = pathlib.Path(os.environ.get("DATA_DIR") or pathlib.Path(__file__).resolve().parents[2] / "data" / "build")
ENV_FILE = pathlib.Path(os.environ.get("ENV_FILE", DATA.parent / "environments.json"))
TESTS = json.loads((DATA / "tests.json").read_text())
CATALOG = json.loads((DATA / "catalog.json").read_text())
MODELS = json.loads((DATA / "models.json").read_text())
REPORT = json.loads((DATA / "report.json").read_text())
ENVS = json.loads(ENV_FILE.read_text())
CAT = {c["id"]: c for c in CATALOG}
PSI_PER_ATM = 14.696

# Closeness: 1 unit = 5 O2 percentage points or 2 psi. A test within 1 unit counts as "covering" the environment.
O2_UNIT, P_UNIT, NEAR = 5.0, 2.0, 1.0

app = FastAPI(title="Flame in Freefall - ML service")


class Env(BaseModel):
    o2_pct: float = Field(ge=5, le=100)
    pressure_psia: float = Field(ge=1, le=50)
    gravity_g: float = Field(default=0, ge=0, le=1)


class PredictIn(BaseModel):
    fuel: str = "Heptane"
    o2_pct: float = Field(ge=5, le=100)
    pressure_psia: float = Field(ge=1, le=50)
    co2_pct: float = Field(default=0, ge=0, le=80)
    he_pct: float = Field(default=0, ge=0, le=80)
    d0_mm: float = Field(default=3, ge=0.5, le=6)
    gravity_g: float = Field(default=0, ge=0, le=1)   # used only by the physics estimates for the drawing, never by the models


def dist(t, e: Env):
    return math.hypot((t["o2_pct"] - e.o2_pct) / O2_UNIT, (t["pressure_psia"] - e.pressure_psia) / P_UNIT)


def brief(t, d=None):
    keep = ["test_id", "investigation", "fuel", "phase", "o2_pct", "pressure_psia", "flow_cm_s", "diluent", "outcome",
            "metric_name", "metric_value", "metric_unit", "assumed", "kind"]
    out = {k: t[k] for k in keep}
    if d is not None:
        out["distance"] = round(d, 2)
    return out


@app.get("/health")
def health():
    return {"ok": True, "tests": len(TESTS)}


@app.get("/catalog")
def catalog():
    return CATALOG


@app.get("/environments")
def environments():
    return ENVS


@app.get("/report")
def report():
    return REPORT


def _filter(investigation, phase, kind, q):
    rows = TESTS
    if investigation: rows = [r for r in rows if r["investigation"] == investigation]
    if phase: rows = [r for r in rows if r["phase"] == phase]
    if kind: rows = [r for r in rows if r["kind"] == kind]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in " ".join(str(r[k] or "") for k in ("test_id", "fuel", "notes", "outcome", "diluent")).lower()]
    return rows


@app.get("/tests")
def tests(investigation: str | None = None, phase: str | None = None, kind: str | None = None, q: str | None = None,
          offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
    rows = _filter(investigation, phase, kind, q)
    return {"total": len(rows), "rows": rows[offset:offset + limit],
            "facets": {"investigation": sorted({r["investigation"] for r in TESTS}),
                       "phase": sorted({r["phase"] for r in TESTS}), "kind": sorted({r["kind"] for r in TESTS})}}


@app.get("/tests.csv", response_class=PlainTextResponse)
def tests_csv():
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(TESTS[0].keys()))
    w.writeheader(); w.writerows(TESTS)
    return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                             headers={"content-disposition": "attachment; filename=unified_tests.csv"})


@app.post("/navigator")
def navigator(e: Env):
    plot = [t for t in TESTS if t["o2_pct"] is not None and t["pressure_psia"] is not None]
    real = [t for t in plot if t["kind"] == "test"]
    scored = sorted(((dist(t, e), t) for t in real), key=lambda x: x[0])
    nearest_d = scored[0][0]

    ranking = []
    for inv in sorted({t["investigation"] for t in real}):
        mine = [(d, t) for d, t in scored if t["investigation"] == inv]
        c = CAT[inv]
        ranking.append({"investigation": inv, "name": c["name"], "psi": c["psi"], "doi_url": c["doi_url"], "tier": c["tier"],
                        "tier_label": c["tier_label"], "safety": c["safety"], "tests": len(mine),
                        "near": sum(d <= NEAR for d, _ in mine), "min_distance": round(mine[0][0], 2),
                        "closest": brief(mine[0][1], mine[0][0])})
    # closest test conditions first; fire-safety class breaks ties
    ranking.sort(key=lambda r: (round(r["min_distance"], 1), r["tier"], -r["near"]))
    no_xy = sorted({t["investigation"] for t in TESTS if t["kind"] == "test"} - {r["investigation"] for r in ranking})

    # 1-g ground thresholds: which materials sustain upward burning at or below this oxygen level?
    thr = [t for t in TESTS if t["kind"] == "threshold_1g"]
    burns = sorted((t for t in thr if t["o2_pct"] <= e.o2_pct), key=lambda t: t["o2_pct"])
    resists = sorted((t for t in thr if t["o2_pct"] > e.o2_pct), key=lambda t: t["o2_pct"])

    if e.gravity_g < 0.01:
        gnote = "Microgravity: same regime as the flight experiments."
    elif e.gravity_g > 0.99:
        gnote = "Earth gravity: flight data does not apply directly. The 1-g ground thresholds do."
    else:
        gnote = (f"{e.gravity_g:.2f} g sits between the two regimes with data. The table holds no partial-gravity test, "
                 "so 0-g and 1-g results are shown side by side. Behaviour in between is not guaranteed to lie between them.")

    return {
        "covered": nearest_d <= NEAR, "nearest_distance": round(nearest_d, 2), "near_count": sum(d <= NEAR for d, _ in scored),
        "rule": f"A test covers the environment when it lies within {O2_UNIT:g} O2 percentage points and {P_UNIT:g} psi (combined distance <= 1).",
        "near_by_phase": {ph: sum(1 for d, t in scored if d <= NEAR and t["phase"] == ph) for ph in sorted({t["phase"] for t in real})},
        "nearest": [brief(t, d) for d, t in scored[:8]],
        "ranking": ranking, "not_placed": no_xy,
        "points": [{"o2": t["o2_pct"], "p": round(t["pressure_psia"], 2), "kind": t["kind"], "inv": t["investigation"],
                    "fuel": t["fuel"], "outcome": t["outcome"], "id": t["test_id"]} for t in plot],
        "gravity_note": gnote,
        "thresholds_1g": {"total": len(thr), "burn_count": len(burns),
                          "burns": [brief(t) for t in burns[-12:]][::-1], "resists": [brief(t) for t in resists[:12]],
                          "note": "Upward limiting oxygen index from White Sands 1-g tests at 10.2 or 14.7 psia, not at the selected pressure or gravity. "
                                  "Transcribed from the report tables by a third party: check against NTRS 20110008636."},
    }


# ------------------------------------------------------------------ compare two investigations
# A numeric condition counts as "varied" only when its spread exceeds this tolerance (sensor drift is not a test variable).
TOL = {"o2_pct": 1.0, "pressure_psia": 1.0, "flow_cm_s": 1.0}
NUM = [("o2_pct", "Oxygen", "%"), ("pressure_psia", "Pressure", "psi"), ("flow_cm_s", "Flow speed", "cm/s")]
WORD = {"o2_pct": "o2", "pressure_psia": "pressure", "flow_cm_s": "flow"}
FAMILIES = ["SIBAL", "PMMA", "Nomex", "silicone", "Kapton", "Teflon", "wax", "lamp wick", "Pyrell", "DBP", "heptane", "methanol",
            "octane", "decane", "ethanol", "propanol", "ethylene", "propane", "propylene", "PET", "PEI", "PEEK", "PVC", "nylon", "polyimide"]
ALIAS = {"lampwick": "lamp wick", "dibutyl phthalate": "dbp", "cotton-fiberglass": "sibal"}
STATIC = [("objective", "Objective"), ("platform", "Platform"), ("hardware", "Hardware"), ("sensors", "Sensors and measurements"),
          ("fuel", "Fuels and samples"), ("measures", "What it measures"), ("safety", "Fire-safety relevance"), ("flown", "Flown")]


def _families(text):
    s = (text or "").lower()
    for a, f in ALIAS.items():
        s = s.replace(a, f)
    words = set(re.findall(r"[a-z]+", s))
    return {f for f in FAMILIES if (f.lower() in s if " " in f else f.lower() in words)}


def _g(v):
    return f"{v:.3g}"


def _profile(inv_id):
    """Everything known about one investigation: catalog text plus statistics computed from its rows."""
    c = CAT[inv_id]
    rows = [t for t in TESTS if t["investigation"] == inv_id]
    flown = [t for t in rows if t["kind"] != "planned"]
    threshold = bool(rows) and all(t["kind"] == "threshold_1g" for t in rows)
    assumed = " ".join(sorted({t["assumed"] for t in rows if t["assumed"]})).lower()
    num = {}
    for k, label, unit in NUM:
        vals = [t[k] for t in rows if t[k] is not None]
        st = {"label": "Limiting oxygen (1-g threshold)" if threshold and k == "o2_pct" else label, "unit": unit, "n": len(vals),
              "assumed": WORD[k] in assumed}
        if vals:
            st.update(min=min(vals), max=max(vals), levels=len({round(v, 1) for v in vals}))
            st["status"] = "varied" if st["max"] - st["min"] > TOL[k] else "fixed"
        else:
            st["status"] = "not recorded"
        num[k] = st
    fuels = {}
    for t in rows:
        if t["fuel"]:
            fuels[t["fuel"]] = fuels.get(t["fuel"], 0) + 1
    outcomes, metrics = {}, {}
    for t in flown:
        if t["outcome"]:
            outcomes[t["outcome"]] = outcomes.get(t["outcome"], 0) + 1
        if t["metric_name"] and t["metric_value"] is not None:
            m = metrics.setdefault(t["metric_name"], {"name": t["metric_name"], "unit": t["metric_unit"], "vals": []})
            m["vals"].append(t["metric_value"])
    diluents = sorted({t["diluent"] for t in rows if t["diluent"]})
    varied = [s["label"].lower() for s in num.values() if s["status"] == "varied"]
    fixed = [f"{s['label'].lower()} near {_g((s['min'] + s['max']) / 2)} {s['unit']}{' (assumed)' if s['assumed'] else ''}"
             for s in num.values() if s["status"] == "fixed"]
    if len(fuels) > 1:
        varied.insert(0, f"fuel or sample ({len(fuels)} kinds)")
    elif len(fuels) == 1:
        fixed.insert(0, f"fuel ({next(iter(fuels))})")
    if len(diluents) > 1:
        varied.append("diluent")
    return {
        "id": inv_id, "name": c["name"], "psi": c["psi"], "doi_url": c["doi_url"], "tier": c["tier"], "tier_label": c["tier_label"],
        "static": {k: c.get(k) for k, _ in STATIC}, "details_basis": c.get("details_basis"),
        "records": len(rows), "kinds": {k: sum(1 for t in rows if t["kind"] == k) for k in sorted({t["kind"] for t in rows})},
        "phases": sorted({t["phase"] for t in rows if t["phase"]}), "gravity": sorted({t["gravity"] for t in rows if t["gravity"]}),
        "fuels": [{"fuel": f, "n": n} for f, n in sorted(fuels.items(), key=lambda x: -x[1])[:8]], "fuel_kinds": len(fuels),
        "families": sorted(_families(" ".join(fuels) + " " + (c.get("fuel") or ""))),
        "numeric": num, "diluents": diluents,
        "outcomes": [{"outcome": o, "n": n} for o, n in sorted(outcomes.items(), key=lambda x: -x[1])],
        "metrics": [{"name": m["name"], "unit": m["unit"], "n": len(m["vals"]), "min": min(m["vals"]), "max": max(m["vals"])} for m in metrics.values()],
        "varied": varied, "fixed": fixed,
        "not_recorded": [s["label"].lower() for s in num.values() if s["status"] == "not recorded"] if rows else [],
        "points": [{"o2": o, "p": p} for o, p in sorted({(round(t["o2_pct"], 1), round(t["pressure_psia"], 1)) for t in rows
                                                        if t["o2_pct"] is not None and t["pressure_psia"] is not None})],
    }


def _between(a, b):
    """Plain-language similarities and differences, each derived from the two profiles."""
    same, diff = [], []
    for k in ("platform", "hardware"):
        x, y = a["static"][k], b["static"][k]
        if x and y and x == y:
            same.append(f"Same {k}: {x}.")
        elif x and y:
            diff.append(f"Different {k}: {a['id']} used {x}; {b['id']} used {y}.")
    if a["phases"] and b["phases"]:
        if set(a["phases"]) == set(b["phases"]):
            same.append(f"Same fuel phase: {', '.join(a['phases'])}.")
        else:
            diff.append(f"Different fuel phase: {a['id']} is {', '.join(a['phases'])}; {b['id']} is {', '.join(b['phases'])}.")
    if a["gravity"] and b["gravity"] and a["gravity"] != b["gravity"]:
        diff.append(f"Different gravity: {a['id']} ran at {', '.join(a['gravity'])}; {b['id']} at {', '.join(b['gravity'])}.")
    shared = sorted(set(a["families"]) & set(b["families"]))
    if shared:
        same.append(f"Shared materials: {', '.join(shared)}.")
    elif a["families"] and b["families"]:
        diff.append("No material in common.")
    for p, q in ((a, b), (b, a)):
        only = sorted(set(p["families"]) - set(q["families"]))
        if only and shared:
            diff.append(f"Only in {p['id']}: {', '.join(only)}.")
        if p["records"] and set(p["kinds"]) == {"planned"} and set(q["kinds"]) != {"planned"}:
            diff.append(f"{p['id']} rows are planned conditions with no results; {q['id']} rows are completed tests.")
    for k, label, unit in NUM:
        x, y = a["numeric"][k], b["numeric"][k]
        if x["n"] and y["n"] and x["label"] != y["label"]:
            # a 1-g threshold's oxygen value is the limit it found, not a condition it was run at
            diff.append(f"Oxygen means different things: a test condition in one, the limiting oxygen level found in the other. Not compared.")
        elif x["n"] and y["n"]:
            lo, hi = max(x["min"], y["min"]), min(x["max"], y["max"])
            if lo <= hi + TOL[k] and abs(hi - lo) <= TOL[k]:
                same.append(f"Both ran at {label.lower()} near {_g((lo + hi) / 2)} {unit}.")
            elif lo <= hi:
                same.append(f"{label} ranges overlap between {_g(lo)} and {_g(hi)} {unit}.")
            else:
                diff.append(f"{label} ranges do not overlap: {a['id']} {_g(x['min'])} to {_g(x['max'])} {unit}; "
                            f"{b['id']} {_g(y['min'])} to {_g(y['max'])} {unit}.")
        elif bool(x["n"]) != bool(y["n"]) and a["records"] and b["records"]:
            have, lack = (a, b) if x["n"] else (b, a)
            diff.append(f"{label} is recorded for {have['id']} but not for {lack['id']}.")
    ma, mb = {m["name"] for m in a["metrics"]}, {m["name"] for m in b["metrics"]}
    if ma and mb:
        if ma & mb:
            same.append(f"Same measured quantity: {', '.join(sorted(ma & mb)).replace('_', ' ')}.")
        else:
            diff.append(f"Different measured quantity: {a['id']} reports {', '.join(sorted(ma)).replace('_', ' ')}; "
                        f"{b['id']} reports {', '.join(sorted(mb)).replace('_', ' ')}.")
    for p in (a, b):
        if not p["records"]:
            diff.append(f"{p['id']} has no test records loaded, so only its catalog description can be compared.")
    return same, diff


@app.get("/compare")
def compare(a: str, b: str):
    for x in (a, b):
        if x not in CAT:
            raise HTTPException(404, f"Unknown investigation '{x}'. Use an id from /catalog.")
    pa, pb = _profile(a), _profile(b)
    same, diff = _between(pa, pb)
    return {"a": pa, "b": pb, "similarities": same, "differences": diff,
            "static_fields": [{"key": k, "label": label} for k, label in STATIC],
            "note": "Ranges and counts are computed from the unified test table. Descriptions come from the catalog; "
                    "the basis line under each column says where its hardware and sensor text came from."}


def _ensemble(members, x, clf):
    v = np.array([sum(c * (a - m) / s for c, a, m, s in zip(e["coef"], x, e["mean"], e["scale"])) + e["b"] for e in members])
    v = 1 / (1 + np.exp(-v)) if clf else np.maximum(v, 0)
    return {"mean": float(v.mean()), "lo": float(np.quantile(v, .05)), "hi": float(np.quantile(v, .95))}


# ------------------------------------------------------------------ flame simulation (Predictor tab)
# One FLEX-style droplet burn drawn from the prediction. Droplet size: the d^2 law with the predicted K. Ending: the
# extinction model's chance, and the droplet size at extinction from the closest FLEX runs that went out. Flame size:
# flame standoff ratio (FSR = flame diameter / droplet diameter) as measured in FLEX and published in FLEX_PAPER.
# The FSR constants below were read off that paper's figures; docs/flame-simulation.md shows how.
FLEX_PAPER = {"cite": "Dietrich et al. (2014), Droplet combustion experiments aboard the International Space Station, "
                      "Microgravity Sci. Technol. 26:65-76", "url": "https://doi.org/10.1007/s12217-014-9372-2"}
COOL_PAPER = {"cite": "Nayagam et al. (2012), Can cool flames support quasi-steady alkane droplet burning?, "
                      "Combust. Flame 159:3583-3588", "url": "https://doi.org/10.1016/j.combustflame.2012.07.012"}
FSR_M_LINE = ((0.126, 5.94), (0.343, 4.11))  # methanol, Fig. 7 trend line: average FSR against O2 mole fraction (ends of the line)
FSR_M_START, FSR_M_TAU = 0.76, 1.5            # methanol, Fig. 6: FSR starts at ~0.76 of its average; time constant ~1.5 s
FSR_H = {"start": 6.8, "slope": 5.4, "max": 15.0, "o2": 0.19}  # heptane, Figs. 3-4: FSR ~ 6.8 + 5.4 t/D0^2 at 18-20% O2
SOOT_TAU = 0.4    # s; heptane's ignition glow is soot-yellow and "quickly" turns blue (paper text); the fade time is a drawing choice
RETREAT_S = 0.25  # s; radiative extinction: the flame retreats from one side over 5-10 video frames at 30 fps
LUM_END = 0.35    # a flame that goes out dims to this fraction just before it does; qualitative ("very dim near extinction")
NEAREST_OUT = 5   # closest FLEX runs that went out, used for the extinction diameter
SAMPLES = 160
_seen = {}
for _r in MODELS["train_rows"]:  # the FLEX table repeats an identifier; name repeats "#2" as the unified table does
    _seen[_r["id"]] = _seen.get(_r["id"], 0) + 1
    _r["run"] = _r["id"] if _seen[_r["id"]] == 1 else f"{_r['id']}#{_seen[_r['id']]}"


def _d2_check(fuel):
    """How well the d^2 law with each run's own K reproduces the recorded burn time of FLEX runs that went out."""
    rows = [r for r in MODELS["train_rows"] if r["fuel"] == fuel and r.get("end") == "Extinction"
            and r.get("d_ext") and r.get("t_burn") and r.get("k") and r["d0"] > r["d_ext"]]
    ratio = np.array([r["t_burn"] / ((r["d0"] ** 2 - r["d_ext"] ** 2) / r["k"]) for r in rows])
    if not len(ratio):
        return None
    return {"n": len(ratio), "median": round(float(np.median(ratio)), 2),
            "p10": round(float(np.quantile(ratio, .1)), 2), "p90": round(float(np.quantile(ratio, .9)), 2)}


FUEL_FACTS = {fuel: {"d2_check": _d2_check(fuel),
                     "runs": sum(r["fuel"] == fuel for r in MODELS["train_rows"]),
                     "disrupted": sum(r["fuel"] == fuel and r.get("end") == "Disruption" for r in MODELS["train_rows"])}
              for fuel in MODELS["domain"]}


def _fsr_methanol(o2):
    (x0, y0), (x1, y1) = FSR_M_LINE
    return y0 + (y1 - y0) / (x1 - x0) * (min(max(o2, x0), x1) - x0)  # held at the line's ends outside its range


def _fsr(fuel, o2, t, d0):
    if fuel == "Methanol":
        return _fsr_methanol(o2) * (1 - (1 - FSR_M_START) * np.exp(-t / FSR_M_TAU))
    # Heptane: measured at 18-20% O2 only. Other oxygen levels are scaled by methanol's measured trend; Burke-Schumann
    # theory gives both fuels nearly the same relative change of FSR with oxygen.
    return np.minimum(FSR_H["start"] + FSR_H["slope"] * t / d0 ** 2, FSR_H["max"]) * _fsr_methanol(o2) / _fsr_methanol(FSR_H["o2"])


# ------------------------------------------------------------------ physics estimates for the drawing
# Neither model output nor PSI data. Textbook energy balances and scaling rules, computed from the same inputs, so that how
# the flame looks (brightness, soot, shape) responds to them. The interface labels every one of them as an estimate.
# docs/flame-simulation.md gives the formulas and what each one leaves out.
T0 = 298.0
# Mean molar heat capacities, J/(mol K), taken at 1200 K: the usual constant-cp shortcut for flame temperature
# (Turns, An Introduction to Combustion, ch. 2). Helium is 5/2 R at any temperature.
CP = {"co2": 56.21, "h2o": 43.87, "n2": 33.71, "he": 20.79}
# Per mole of fuel: O2 needed, CO2 and H2O made, lower heating value of the liquid (kJ/mol), molar mass (g/mol),
# liquid density (kg/m3). `soots`: methanol makes no soot at FLEX pressures (Dietrich et al. 2014).
FUEL = {"Heptane": {"o2": 11.0, "co2": 7, "h2o": 8, "lhv": 4465.0, "molar": 100.2, "rho": 684.0, "soots": 1.0},
        "Methanol": {"o2": 1.5, "co2": 1, "h2o": 2, "lhv": 638.0, "molar": 32.04, "rho": 792.0, "soots": 0.0}}
T_NO_DISSOCIATION = 2500.0   # above about this, real flames lose heat to dissociation and the estimate runs high
T_SOOT_MIN, T_SOOT_REF = 1600.0, 2300.0   # soot starts to form in diffusion flames near 1600 K (Glassman); 2300 K ~ heptane in air
T_SOOT_GLOW = 0.85           # soot glows on the cooler fuel side of the flame: drawn at this fraction of flame temperature (a choice)
Q_REF, LUM_GAMMA = 25.0, 0.6  # kW/m2 shown at brightness 1 (a 3 mm heptane droplet in air at ignition), and the display curve
FADE_PART = 0.25             # a flame that goes out dims over this last part of the burn, down to LUM_END
D_HOT = 3.0e-4               # m2/s: diffusivity of hot flame gas at 1 atm, order of magnitude (air at ~1500 K)
STRETCH_MAX, STRETCH_HALF = 2.5, 3.0   # shape illustration: how far the teardrop stretches, and the ratio at which it is half way
# Buoyant flames flicker: rising hot gas rolls up into a vortex that squeezes the flame, again and again. Measured flicker
# frequencies follow f = 1.5 / sqrt(D) Hz at 1 g for a flame D metres wide (Cetegen and Ahmed 1993), which is
# f = 0.48 sqrt(g / D) for any gravity. About 11 Hz for a 2 cm flame on Earth, as for a candle.
FLICKER_C = 0.48
FLICKER_HALF = 6.0   # illustration: buoyancy ratio at which the flicker is drawn at half strength (small flames burn steadily)
PULSE_HZ = 1.0       # FLEX: some flames pulsed about once a second before going out radiatively (Dietrich et al. 2014)


def _blackbody(T):
    """Planck radiance at red, green and blue wavelengths (0.61, 0.55, 0.465 um), arbitrary units."""
    lam = np.array([0.610, 0.550, 0.465])
    return lam ** -5 / (np.exp(14388.0 / (lam * T)) - 1)


def physics(fuel, f, gravity_g):
    """Estimates that shape the drawing. f: model features (fractions, atm, mm)."""
    p = FUEL[fuel]
    o2, co2, he = f["o2"], f["co2"], f["he"]
    over = o2 + co2 + he > 1 + 1e-9          # the sliders allow more than 100%: shrink the diluents to fit and say so
    if over:
        co2, he = (v * (1 - o2) / (co2 + he) for v in (co2, he))
    n2 = max(1 - o2 - co2 - he, 0.0)
    # Flame temperature: all the heat of burning one mole of fuel with just enough atmosphere goes into the products.
    per = p["o2"] / o2                       # moles of atmosphere drawn in per mole of fuel, per unit O2 fraction
    heat_cap = p["co2"] * CP["co2"] + p["h2o"] * CP["h2o"] + per * (co2 * CP["co2"] + n2 * CP["n2"] + he * CP["he"])
    t_flame = T0 + p["lhv"] * 1e3 / heat_cap

    # Soot: none for methanol. For heptane it scales with how far the flame is above the soot threshold, with pressure,
    # and with residence time in the flame, which grows with the square of the droplet size. 1 = a 3 mm droplet at 1 atm
    # with a 2300 K flame, where FLEX saw a yellow glow at ignition that quickly turned blue.
    soot = p["soots"] * min(max((t_flame - T_SOOT_MIN) / (T_SOOT_REF - T_SOOT_MIN), 0.0), 1.6) * f["p_atm"] * (f["d0"] / 3.0) ** 2
    soot = min(soot, 1.6)
    t_soot = T_SOOT_GLOW * min(t_flame, T_NO_DISSOCIATION + 100)
    glow, ref = _blackbody(t_soot), _blackbody(T_SOOT_GLOW * T_SOOT_REF)

    # Buoyancy: speed of hot gas rising past the flame, sqrt(g * flame diameter), against the speed at which gas diffuses
    # across the flame's radius. Far below 1 the flame stays round; far above 1 it is a teardrop, as on Earth.
    df0 = f["d0"] * float(_fsr(fuel, o2, 0.0, f["d0"])) / 1000.0
    ratio = math.sqrt(gravity_g * 9.81 * df0) * df0 / (2 * D_HOT / f["p_atm"])
    return {
        # above the limit the balance is no longer trustworthy, so the limit is reported with a flag instead of the number
        "t_flame_k": round(min(t_flame, T_NO_DISSOCIATION)), "t_high": t_flame > T_NO_DISSOCIATION, "mix_over": over,
        "n2_pct": round(n2 * 100, 1),
        "soot_index": round(soot, 2), "soot_t_k": round(t_soot),
        "soot_rgb": [round(float(v), 3) for v in glow / glow.max()],
        "soot_gain": round(float(np.clip(math.sqrt(glow[0] / ref[0]), 0.2, 2.0)), 2),
        "gravity_g": gravity_g, "buoyancy_ratio": round(ratio, 2),
        # how far the drawing stretches the flame upward: 1 = round. An illustration: no test here ran in partial gravity
        "stretch": round(1 + STRETCH_MAX * ratio ** 2 / (ratio ** 2 + STRETCH_HALF ** 2), 2),
        "flicker_hz": round(FLICKER_C * math.sqrt(gravity_g * 9.81 / df0), 1),
        "flicker_amp": round(ratio ** 2 / (ratio ** 2 + FLICKER_HALF ** 2), 2),   # 0 = steady, 1 = full flicker
        "pulse_hz": PULSE_HZ, "q_ref": Q_REF,
    }


def _burn(fuel, o2, d0, k, t_end, ph, goes_out):
    t = np.linspace(0, max(t_end, 1e-3), SAMPLES)
    d = np.sqrt(np.maximum(d0 ** 2 - k * t, 0))
    fsr = _fsr(fuel, o2, t, d0)
    df = d * fsr
    # Heat released per unit flame surface, kW/m2. The d^2 law gives the fuel burned per second, (pi/4) rho K d, and all of
    # it burns at the flame, a sphere of diameter df. Flame light follows heat release, so this sets the brightness.
    p = FUEL[fuel]
    q = np.divide(p["rho"] * (k * 1e-6) * (d * 1e-3) * (p["lhv"] / p["molar"] * 1e6), 4 * (df * 1e-3) ** 2,
                  out=np.zeros_like(d), where=df > 0) / 1000.0
    lum = np.clip((q / Q_REF) ** LUM_GAMMA, 0.05, 2.5)
    if goes_out:   # FLEX flames were "very dim near flame extinction": the heat balance alone does not show that
        lum = lum * (1 - (1 - LUM_END) * np.clip((t / t[-1] - (1 - FADE_PART)) / FADE_PART, 0, 1))
    s = ph["soot_index"]
    # the glow at ignition fades; under gravity soot keeps forming in the rising plume, as in a candle
    steady = 0.8 * s * min(ph["buoyancy_ratio"] / STRETCH_HALF, 1.0)
    soot = s * np.exp(-t / (SOOT_TAU * min(max(s, 0.25), 3.0))) + steady if s > 0 else np.zeros_like(t)
    r = lambda a, n=3: [round(float(v), n) for v in a]
    return {"t_end": round(float(t[-1]), 2), "t": r(t), "d": r(d), "df": r(df, 2), "fsr": r(fsr, 2),
            "q": r(q, 1), "lum": r(lum, 2), "soot": r(soot, 2)}


def flame(fuel, f, k, p_out, gravity_g=0.0):
    """Both endings of one burn, sampled in time. f: model features (o2 as a fraction, d0 in mm); k in mm^2/s."""
    if k <= 0:
        return None
    ph = physics(fuel, f, gravity_g)
    sc = MODELS["scale"]
    runs = [r for r in MODELS["train_rows"] if r["fuel"] == fuel and r.get("end") == "Extinction" and r.get("d_ext")]
    near = sorted(runs, key=lambda r: sum(((r[c] - f[c]) / sc[c]) ** 2 for c in sc))[:NEAREST_OUT]
    ratio = float(np.median([min(r["d_ext"] / r["d0"], 1.0) for r in near])) if near else None
    d0, o2 = f["d0"], f["o2"]
    out = None
    if ratio is not None:
        d_end = d0 * ratio
        out = {"p": round(p_out, 3), "d_end": round(d_end, 2), "ratio": round(ratio, 2),
               "mode": "radiative" if fuel == "Heptane" else "diffusive", "retreat_s": RETREAT_S if fuel == "Heptane" else 0,
               "from_runs": [{"id": r["run"], "d0_mm": r["d0"], "d_ext_mm": r["d_ext"], "ratio": round(r["d_ext"] / r["d0"], 2)} for r in near],
               **_burn(fuel, o2, d0, k, (d0 ** 2 - d_end ** 2) / k, ph, True)}
    burnout = {"p": round(1 - p_out, 3), "d_end": 0, "mode": "burnout", "retreat_s": 0, **_burn(fuel, o2, d0, k, d0 ** 2 / k, ph, False)}
    lo, hi = FSR_M_LINE[0][0], FSR_M_LINE[1][0]
    return {"fuel": fuel, "k": round(k, 3), "d0": d0, "default": "out" if out and p_out >= 0.5 else "burnout",
            "out": out, "burnout": burnout, "physics": ph,
            "fsr_o2_held": o2 < lo or o2 > hi, "fsr_o2_range": [round(lo * 100, 1), round(hi * 100, 1)],
            # methanol: the settled ratio at this oxygen level; heptane: the oxygen scaling applied to the measured line
            "fsr_steady": round(_fsr_methanol(o2), 2) if fuel == "Methanol" else None,
            "fsr_o2_factor": round(_fsr_methanol(o2) / _fsr_methanol(FSR_H["o2"]), 2) if fuel == "Heptane" else None,
            **FUEL_FACTS[fuel], "sources": {"flex": FLEX_PAPER, "cool_flame": COOL_PAPER}}


@app.post("/predict")
def predict(i: PredictIn):
    if i.fuel not in MODELS["domain"]:
        raise HTTPException(400, f"fuel must be one of {list(MODELS['domain'])}")
    f = {"o2": i.o2_pct / 100, "p_atm": i.pressure_psia / PSI_PER_ATM, "co2": i.co2_pct / 100, "he": i.he_pct / 100, "d0": i.d0_mm}
    x = [1.0 if i.fuel == "Heptane" else 0.0] + [f[k] for k in MODELS["features"][1:]]
    # extinction model inputs: products of features (pairwise interactions); plain features for older models.json files
    x_ext = [math.prod(x[j] for j in t) for t in MODELS.get("extinction_terms", [[j] for j in range(len(x))])]
    dom = MODELS["domain"][i.fuel]
    label = {"o2": ("oxygen", 100, "%"), "p_atm": ("pressure", PSI_PER_ATM, "psi"), "co2": ("CO2", 100, "%"),
             "he": ("helium", 100, "%"), "d0": ("droplet diameter", 1, "mm")}
    outside = [{"feature": label[k][0], "unit": label[k][2], "value": round(f[k] * label[k][1], 2),
                "min": round(dom[k][0] * label[k][1], 2), "max": round(dom[k][1] * label[k][1], 2)}
               for k in dom if f[k] < dom[k][0] - 0.02 * (dom[k][1] - dom[k][0]) - 1e-9 or f[k] > dom[k][1] + 0.02 * (dom[k][1] - dom[k][0]) + 1e-9]
    sc = MODELS["scale"]
    rows = [r for r in MODELS["train_rows"] if r["fuel"] == i.fuel]
    near = sorted(rows, key=lambda r: sum(((r[k] - f[k]) / sc[k]) ** 2 for k in sc))[:5]
    pairs = [t for t in TESTS if t["investigation"] == "SAFFIRE-II"]
    ext, burn = _ensemble(MODELS["extinction"], x_ext, True), _ensemble(MODELS["burn_rate"], x, False)
    return {
        "extinction": ext, "burn_rate": burn, "flame": flame(i.fuel, f, burn["mean"], ext["mean"], i.gravity_g),
        "outside": outside, "extrapolating": bool(outside),
        "nearest": [{"id": r["id"], "o2_pct": round(r["o2"] * 100, 1), "pressure_psia": round(r["p_atm"] * PSI_PER_ATM, 1),
                     "co2_pct": round(r["co2"] * 100), "he_pct": round(r["he"] * 100), "d0_mm": r["d0"], "k": r["k"], "end": r["end"]} for r in near],
        "gravity_pairs": [{"test_id": t["test_id"], "fuel": t["fuel"], "o2_pct": t["o2_pct"], "notes": t["notes"]} for t in pairs],
        "scores": REPORT,
        "scope": "Trained on FLEX droplet flames in microgravity (PSI-69): heptane and methanol only. Not a solid-material model.",
    }
