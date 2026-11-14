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


@app.post("/predict")
def predict(i: PredictIn):
    if i.fuel not in MODELS["domain"]:
        raise HTTPException(400, f"fuel must be one of {list(MODELS['domain'])}")
    f = {"o2": i.o2_pct / 100, "p_atm": i.pressure_psia / PSI_PER_ATM, "co2": i.co2_pct / 100, "he": i.he_pct / 100, "d0": i.d0_mm}
    x = [1.0 if i.fuel == "Heptane" else 0.0] + [f[k] for k in MODELS["features"][1:]]
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
    return {
        "extinction": _ensemble(MODELS["extinction"], x, True), "burn_rate": _ensemble(MODELS["burn_rate"], x, False),
        "outside": outside, "extrapolating": bool(outside),
        "nearest": [{"id": r["id"], "o2_pct": round(r["o2"] * 100, 1), "pressure_psia": round(r["p_atm"] * PSI_PER_ATM, 1),
                     "co2_pct": round(r["co2"] * 100), "he_pct": round(r["he"] * 100), "d0_mm": r["d0"], "k": r["k"], "end": r["end"]} for r in near],
        "gravity_pairs": [{"test_id": t["test_id"], "fuel": t["fuel"], "o2_pct": t["o2_pct"], "notes": t["notes"]} for t in pairs],
        "scores": REPORT,
        "scope": "Trained on FLEX droplet flames in microgravity (PSI-69): heptane and methanol only. Not a solid-material model.",
    }
