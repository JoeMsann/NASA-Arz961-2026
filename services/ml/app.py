"""ML service: unified table, habitat navigator, flame predictor.

Loads artifacts written by pipeline/build.py (DATA_DIR, default ./data/build).
"""
import csv, io, json, math, os, pathlib, sqlite3
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
