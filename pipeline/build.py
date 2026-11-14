"""Flame in Freefall - build the unified test table and train the models.

  python pipeline/build.py

Reads   data/raw/*.csv, data/catalog.json, data/mappings/*.json
Writes  data/build/unified.db      SQLite: tables `tests`, `investigations`
        data/build/tests.json      same rows as JSON
        data/build/models.json     bootstrap ensembles (linear), tested envelope
        data/build/report.json     cross-validation scores + row counts

One mapper per source file. A new CSV can also be added without code:
run pipeline/llm_map.py to draft data/mappings/<name>.json with Groq, review it, rebuild.
"""
import csv, json, pathlib, re, sqlite3
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score, brier_score_loss, r2_score, mean_absolute_error

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW, OUT = ROOT / "data" / "raw", ROOT / "data" / "build"
OUT.mkdir(parents=True, exist_ok=True)
PSI_PER_ATM = 14.696
RNG, N_BOOT = 7, 40

COLS = ["test_id", "investigation", "psi_id", "kind", "gravity", "date", "fuel", "phase",
        "o2_pct", "pressure_psia", "flow_cm_s", "diluent", "diluent_pct", "outcome",
        "metric_name", "metric_value", "metric_unit", "assumed", "notes", "source_file", "provenance"]
# kind:       test | planned | threshold_1g
# provenance: nasa_table | third_party_extract | third_party_transcription


def num(x):
    """First number in a messy cell ('~ 21.5', '21.5 - 21.7', '20 cm/s'), else None."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    if isinstance(x, (int, float, np.integer, np.floating)):
        return float(x)
    m = re.search(r"-?\d+(?:\.\d+)?", str(x))
    return float(m.group()) if m else None


def row(**kw):
    r = dict.fromkeys(COLS)
    r.update(kw)
    return r


# ------------------------------------------------------------------ mappers
def flex():
    f = "PSI-69_Experimental_table_FLEX.csv"
    d = pd.read_csv(RAW / f, encoding="latin-1")
    d.columns = ["test", "id", "date", "gmt", "fuel", "p_mmHg", "o2", "n2", "co2", "he", "d0", "d_ext", "k", "t_burn", "end"]
    end = {"Extinction": "self_extinguished", "Completion": "burned_to_completion", "Disruption": "droplet_disrupted"}
    out = []
    for _, r in d.iterrows():
        co2, he = r.co2 or 0, r.he or 0
        dil = "CO2+He" if co2 > .005 and he > .005 else "CO2" if co2 > .005 else "He" if he > .005 else "N2"
        p = r.p_mmHg / 760 * PSI_PER_ATM if r.p_mmHg > 0 else None
        out.append(row(test_id=f"FLEX-{r.id}", investigation="FLEX", psi_id="PSI-69", kind="test", gravity="0g",
                       date=r.date, fuel=r.fuel, phase="liquid droplet", o2_pct=r.o2 * 100, pressure_psia=p,
                       diluent=dil, diluent_pct=100 * (co2 + he) if dil != "N2" else 100 * r.n2,
                       outcome=end.get(str(r.end).strip()), metric_name="burning_rate_constant", metric_value=num(r.k),
                       metric_unit="mm2/s", notes=f"initial droplet diameter {r.d0} mm", source_file=f, provenance="nasa_table"))
    return out


def bass2():
    f = "PSI-25_Experimental_table_BASS-II.csv"
    b = pd.read_csv(RAW / f, encoding="utf-8-sig")
    b.columns = ["pi", "test", "date", "gmt", "sample", "material", "restrictor", "fan", "air", "gain", "frames",
                 "o2_i", "o2_f", "co2_i", "co2_f", "co_i", "co_f"]
    out = []
    for i, r in b.iterrows():
        o2i, o2f = num(r.o2_i), num(r.o2_f)
        out.append(row(test_id=f"BASS2-{i+1:03d}", investigation="BASS-II", psi_id="PSI-25", kind="test", gravity="0g",
                       date=r.date, fuel=str(r.material).strip(), phase="solid", o2_pct=o2i, pressure_psia=14.7, diluent="N2",
                       metric_name="o2_consumed", metric_value=(o2i - o2f) if o2i and o2f else None, metric_unit="vol-% points",
                       assumed="pressure (ISS cabin, not in table)",
                       notes=f"PI {r.pi}; test {r.test}; air setting '{r.air}'; CO final {r.co_f} ppm", source_file=f, provenance="nasa_table"))
    return out


def bass():
    f = "PSI-26_AsRunTestMatrix_extract_raw.csv"
    o2 = {r["xlsx_row"]: float(r["o2_vol_frac"]) for r in csv.DictReader(open(RAW / "PSI-26_AsRunTestMatrix_O2_extract.csv")) if r["o2_vol_frac"].strip()}
    out = []
    rows = list(csv.reader(open(RAW / f, encoding="latin-1")))[1:]
    for r in rows:  # header in the extract is shifted by one; read by position
        x, material, air, p_atm, obs = r[0], r[6], r[11], num(r[17]), r[19]
        out.append(row(test_id=f"BASS-{int(x):03d}", investigation="BASS", psi_id="PSI-26", kind="test", gravity="0g",
                       fuel=material, phase="solid", o2_pct=o2[x] * 100 if x in o2 else None,
                       pressure_psia=p_atm * PSI_PER_ATM if p_atm else None, flow_cm_s=num(air), diluent="N2",
                       assumed="flow (first air setting, read as cm/s)" if num(air) is not None else None,
                       notes=obs.strip()[:900], source_file=f, provenance="third_party_extract"))
    return out


def saffire():
    out = []
    for name, psi, f in [("SAFFIRE-I", "PSI-98", "PSI-98_Experimental_table_SAFFIRE-1.csv"),
                         ("SAFFIRE-II", "PSI-99", "PSI-99_Experimental_table_SAFFIRE-2.csv"),
                         ("SAFFIRE-III", "PSI-100", "PSI-100_Experimental_table_SAFFIRE-3.csv")]:
        d = pd.read_csv(RAW / f, encoding="latin-1", dtype=str).fillna("")
        for _, r in d.iterrows():
            g = lambda *ks: next((r[k].strip() for k in d.columns if any(x in k.lower() for x in ks)), "")
            if not g("material") or "flow vis" in g("material").lower():
                continue
            ug, g1 = g("g burn length"), g("1-g burn length")
            out.append(row(test_id=f"{name}-{r.iloc[0].strip()}", investigation=name, psi_id=psi, kind="test", gravity="0g",
                           fuel=g("material"), phase="solid", o2_pct=num(g("percent o2")), pressure_psia=14.7,
                           flow_cm_s=num(g("air flow")), diluent="N2",
                           outcome=("no_spread" if ug.replace("~", "").strip() == "0" else "burned") if ug else None,
                           metric_name="microgravity_burn_length", metric_value=num(ug) if ug else None, metric_unit="cm",
                           assumed="pressure (Cygnus cabin, not in table)",
                           notes=f"thickness {g('thick')}; {g('direction')} flow; burn time {g('burn time') or 'n/a'}; "
                                 f"0-g burn length {ug or 'n/a'}; 1-g burn length {g1 or 'n/a'}",
                           source_file=f, provenance="nasa_table"))
    return out


def same():
    f = "PSI-101_SAME_SAME-R_Results_ReducedDataSheet_extract.csv"
    d = pd.read_csv(RAW / f)
    out = []
    for _, r in d.iterrows():
        dia = num(r.count_mean_diameter_um)
        out.append(row(test_id=f"SAME-F{r.flight}-{r.xlsx_row}", investigation="SAME", psi_id="PSI-101", kind="test", gravity="0g",
                       fuel=r.material, phase="overheated solid (smoke)", flow_cm_s=num(r.inlet_velocity_cm_s),
                       metric_name="smoke_count_mean_diameter", metric_value=dia if dia else None, metric_unit="um",
                       notes=f"flight {r.flight}; run {r.same_run}; {r.description}; sample temp {r.sample_temp_c} C",
                       source_file=f, provenance="third_party_extract"))
    return out


def spice():
    f = "PSI-107_SmokePointReview-0g-3_SmokePointDatasheet_extract.csv"
    d = pd.read_csv(RAW / f)
    d["L"] = pd.to_numeric(d.smoke_point_length_mm, errors="coerce")
    d = d.dropna(subset=["L", "u_air_cm_s", "nozzle_mm"])
    d["P"] = pd.to_numeric(d.pressure_pa, errors="coerce")
    out = []
    for _, r in d.iterrows():
        fuel = re.sub(r"\s+", " ", str(r.fuel)).replace("% ", "%").strip()
        out.append(row(test_id=f"SPICE-{r.tp_id}-{r.xlsx_row}", investigation="SPICE", psi_id="PSI-107", kind="test", gravity="0g",
                       fuel=fuel, phase="gas jet", o2_pct=21.0, pressure_psia=r.P / 101325 * PSI_PER_ATM if r.P == r.P else None,
                       flow_cm_s=num(r.u_air_cm_s), diluent="N2", metric_name="smoke_point_flame_length", metric_value=r.L,
                       metric_unit="mm", assumed="O2 (air co-flow)", notes=f"nozzle {r.nozzle_mm} mm; fuel velocity {r.u_fuel_cm_s} cm/s",
                       source_file=f, provenance="third_party_extract"))
    return out


def flex2():
    """PSI-68 lists a matrix of planned conditions, not individual burns. Expanded and tagged kind='planned'."""
    f = "PSI-68_Experimental_table_Flex2.csv"
    d = pd.read_csv(RAW / f, encoding="latin-1")
    out, n = [], 0
    for _, r in d.iterrows():
        o2s = [float(x) for x in re.findall(r"\d\.\d+", str(r.iloc[3]))]
        ps = [float(x) for x in re.findall(r"\d\.\d+", str(r.iloc[4]))]
        for o in o2s:
            for p in ps:
                n += 1
                out.append(row(test_id=f"FLEX2-P{n:03d}", investigation="FLEX-2", psi_id="PSI-68", kind="planned", gravity="0g",
                               fuel=r.iloc[0].strip(), phase="liquid droplet", o2_pct=o * 100, pressure_psia=p * PSI_PER_ATM,
                               diluent="N2 or He", notes="planned matrix point; no result in the PSI table",
                               source_file=f, provenance="nasa_table"))
    return out


def wstf():
    f = "NTRS-20110008636_Hirsch2011_Tables2-9_transcribed.csv"
    out = []
    for r in csv.DictReader(open(RAW / f)):
        out.append(row(test_id=r["record_id"], investigation="WSTF-1G", psi_id="NTRS-20110008636", kind="threshold_1g", gravity="1g",
                       fuel=r["material_as_printed"], phase="solid", o2_pct=num(r["ULOI_pct_O2"]), pressure_psia=num(r["test_pressure_psia"]),
                       diluent="N2", outcome="burns_at_or_above_this_o2", metric_name="max_o2_no_burn_MOC", metric_value=num(r["MOC_pct_O2"]),
                       metric_unit="% O2", notes=f"{r['table']}, {r['column']}; o2_pct column holds the upward limiting oxygen index (ULOI)",
                       source_file=f, provenance="third_party_transcription"))
    return out


def from_mappings():
    """Generic path for CSVs described by a reviewed mapping file (see pipeline/llm_map.py)."""
    out = []
    for mp in sorted((ROOT / "data" / "mappings").glob("*.json")):
        m = json.loads(mp.read_text())
        if not m.get("approved"):
            continue
        d = pd.read_csv(RAW / m["file"], encoding=m.get("encoding", "latin-1"), dtype=str).fillna("")
        for i, r in d.iterrows():
            kw = dict(m.get("constants", {}))
            for field, spec in m["columns"].items():
                spec = spec if isinstance(spec, dict) else {"col": spec}
                v = r.get(spec["col"], "")
                if spec.get("numeric"):
                    v = num(v)
                    v = v * spec.get("scale", 1) if v is not None else None
                kw[field] = v if v != "" else None
            kw.setdefault("test_id", f"{m['prefix']}-{i+1:03d}")
            out.append(row(source_file=m["file"], **kw))
    return out


# ------------------------------------------------------------------ models (FLEX)
FEATS = ["heptane", "o2", "p_atm", "co2", "he", "d0"]


def flex_frame():
    d = pd.read_csv(RAW / "PSI-69_Experimental_table_FLEX.csv", encoding="latin-1")
    d.columns = ["test", "id", "date", "gmt", "fuel", "p_mmHg", "o2", "n2", "co2", "he", "d0", "d_ext", "k", "t_burn", "end"]
    for c in ["d0", "d_ext", "t_burn"]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d.loc[d.p_mmHg <= 0, "p_mmHg"] = np.nan
    d["p_atm"] = d.p_mmHg / 760
    d["heptane"] = (d.fuel == "Heptane").astype(int)
    d["end"] = d.end.str.strip()
    return d


def gb(kind):
    kw = dict(n_estimators=120, max_depth=2, learning_rate=0.06, subsample=0.8, random_state=RNG)
    return GradientBoostingClassifier(**kw) if kind == "clf" else GradientBoostingRegressor(**kw)


def cv(X, y, groups, kind):
    pred, base, naive = np.zeros(len(y)), np.zeros(len(y)), np.zeros(len(y))
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        m = gb(kind).fit(X[tr], y[tr])
        naive[te] = y[tr].mean()
        if kind == "clf":
            pred[te] = m.predict_proba(X[te])[:, 1]
            base[te] = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        else:
            pred[te] = m.predict(X[te])
            base[te] = make_pipeline(StandardScaler(), Ridge()).fit(X[tr], y[tr]).predict(X[te])
    if kind == "clf":
        return {"n": len(y), "positives": int(y.sum()), "shipped_auc": roc_auc_score(y, base), "shipped_brier": brier_score_loss(y, base),
                "gbm_auc": roc_auc_score(y, pred), "gbm_brier": brier_score_loss(y, pred), "naive_brier": brier_score_loss(y, naive)}
    return {"n": len(y), "shipped_r2": r2_score(y, base), "shipped_mae": mean_absolute_error(y, base),
            "gbm_r2": r2_score(y, pred), "gbm_mae": mean_absolute_error(y, pred), "naive_mae": mean_absolute_error(y, naive)}


def boot(X, y, kind):
    rs, members = np.random.RandomState(RNG), []
    while len(members) < N_BOOT:
        idx = rs.randint(0, len(y), len(y))
        if kind == "clf" and len(set(y[idx])) < 2:
            continue
        sc = StandardScaler().fit(X[idx])
        est = (LogisticRegression(max_iter=1000) if kind == "clf" else Ridge()).fit(sc.transform(X[idx]), y[idx])
        members.append({"mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(), "coef": np.ravel(est.coef_).tolist(),
                        "b": float(np.ravel(est.intercept_)[0])})
    return members


def train():
    d = flex_frame().dropna(subset=FEATS)
    c = d[d.end.isin(["Extinction", "Completion"])]          # droplet break-up says nothing about flammability
    r = d.dropna(subset=["k"])
    Xc, yc = c[FEATS].to_numpy(float), (c.end == "Extinction").to_numpy(int)
    Xr, yr = r[FEATS].to_numpy(float), r.k.to_numpy(float)
    models = {"features": FEATS, "extinction": boot(Xc, yc, "clf"), "burn_rate": boot(Xr, yr, "reg"),
              "domain": {fuel: {f: [float(g[f].min()), float(g[f].max())] for f in FEATS[1:]} for fuel, g in d.groupby("fuel")},
              "scale": {f: float(d[f].std()) for f in FEATS[1:]},
              "train_rows": d[["id", "fuel", "o2", "p_atm", "co2", "he", "d0", "k", "end"]].replace({np.nan: None}).to_dict("records")}
    report = {"extinction": cv(Xc, yc, c.date.to_numpy(), "clf"), "burn_rate": cv(Xr, yr, r.date.to_numpy(), "reg"),
              "excluded_disruption_runs": int((d.end == "Disruption").sum()),
              "validation": "5-fold GroupKFold grouped by test date, so same-day repeats never straddle train and test",
              "shipped": "Logistic regression and ridge regression. Gradient boosting was tested and scored lower out-of-fold."}
    return models, report


# ------------------------------------------------------------------ run
def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else round(float(o), 5)
    if isinstance(o, np.integer):
        return int(o)
    return o


if __name__ == "__main__":
    rows = clean(flex() + bass2() + bass() + saffire() + same() + spice() + flex2() + wstf() + from_mappings())
    seen = {}
    for r in rows:                      # a few source ids repeat (reruns); keep both, suffix the repeat
        k = r["test_id"]; seen[k] = seen.get(k, 0) + 1
        if seen[k] > 1:
            r["test_id"] = f"{k}#{seen[k]}"
    df = pd.DataFrame(rows, columns=COLS)

    cat = json.loads((ROOT / "data" / "catalog.json").read_text())
    counts = df[df.kind != "planned"].groupby("investigation").size().to_dict()
    for c in cat:
        c["rows"] = int(counts.get(c["id"], 0))
        c["doi_url"] = f"https://doi.org/{c['doi']}" if c["doi"] else (
            f"https://ntrs.nasa.gov/citations/{c['psi'].split('-')[1]}" if c["psi"].startswith("NTRS") else None)

    db = OUT / "unified.db"
    db.unlink(missing_ok=True)
    con = sqlite3.connect(db)
    df.to_sql("tests", con, index=False)
    pd.DataFrame(cat).to_sql("investigations", con, index=False)
    con.execute("CREATE INDEX i_inv ON tests(investigation)")
    con.commit(); con.close()

    models, report = train()
    report["rows"] = {"total": len(df), "by_investigation": df.groupby("investigation").size().to_dict(),
                      "by_kind": df.groupby("kind").size().to_dict(), "by_provenance": df.groupby("provenance").size().to_dict()}
    (OUT / "tests.json").write_text(json.dumps(rows, separators=(",", ":")))
    (OUT / "catalog.json").write_text(json.dumps(cat, indent=1))
    (OUT / "models.json").write_text(json.dumps(clean(models), separators=(",", ":")))
    (OUT / "report.json").write_text(json.dumps(clean(report), indent=1))
    print(json.dumps(clean(report), indent=1))
