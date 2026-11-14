"""The two tools the Ask PSI agent can call: read-only SQL and evidence search."""
import json, os, pathlib, re, sqlite3
import httpx
from langchain_core.tools import tool

DATA = pathlib.Path(os.environ.get("DATA_DIR") or pathlib.Path(__file__).resolve().parents[2] / "data" / "build")
DB = DATA / "unified.db"
MAX_ROWS = 40

SCHEMA = """SQLite tables.
tests(test_id, investigation, psi_id, kind, gravity, date, fuel, phase, o2_pct, pressure_psia, flow_cm_s,
      diluent, diluent_pct, outcome, metric_name, metric_value, metric_unit, assumed, notes, source_file, provenance)
  kind: 'test' = flown microgravity test | 'planned' = planned matrix point, no result | 'threshold_1g' = 1-g ground
        flammability threshold (o2_pct holds the upward limiting oxygen index)
  phase: 'liquid droplet' | 'solid' | 'gas jet' | 'overheated solid (smoke)'
  outcome: self_extinguished | burned_to_completion | droplet_disrupted | burned | no_spread | burns_at_or_above_this_o2 | NULL
  o2_pct is percent (0-100). pressure_psia is psi absolute. `assumed` names fields that were not in the NASA table.
investigations(id, name, psi, doi, doi_url, tier, tier_label, fuel, measures, safety, rows)
  join: tests.investigation = investigations.id"""

_FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum)\b", re.I)


def run_sql(query: str) -> dict:
    q = query.strip().rstrip(";")
    if not re.match(r"(?is)^\s*(select|with)\b", q) or ";" in q or _FORBIDDEN.search(q):
        return {"error": "Only a single SELECT statement is allowed."}
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        cur = con.execute(q)
        cols = [c[0] for c in cur.description]
        rows = cur.fetchmany(MAX_ROWS + 1)
    except sqlite3.Error as e:
        return {"error": f"SQL error: {e}"}
    finally:
        con.close()
    return {"columns": cols, "rows": [list(r) for r in rows[:MAX_ROWS]], "truncated": len(rows) > MAX_ROWS}


_STOP = set("the a an of in on for to and or is are was were does do did how what which when why with by from at as it its be can above below than ran happened".split())


def _words(s):
    return [w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 1 and w not in _STOP]


def search_local(query: str, k: int = 6) -> list[dict]:
    """Keyword search over investigation descriptions and free-text test notes."""
    qs = set(_words(query))
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    docs = []
    for r in con.execute("select * from investigations"):
        docs.append({"ref": f"{r['psi']} ({r['id']})", "url": r["doi_url"], "kind": "investigation",
                     "text": f"{r['name']}. Fuel: {r['fuel']}. Measures: {r['measures']}. Fire-safety relevance: {r['safety']}. Records loaded: {r['rows']}."})
    for r in con.execute("select t.test_id, t.fuel, t.o2_pct, t.notes, i.psi, i.doi_url from tests t join investigations i on i.id=t.investigation "
                         "where t.investigation in ('BASS','SAFFIRE-I','SAFFIRE-II','SAFFIRE-III') and t.notes is not null"):
        docs.append({"ref": f"{r['psi']} test {r['test_id']}", "url": r["doi_url"], "kind": "test note",
                     "text": f"{r['fuel']}, O2 {r['o2_pct']}%. {r['notes']}"})
    con.close()
    scored = [(len(qs & set(_words(d["text"] + " " + d["ref"]))), d) for d in docs]
    return [d for s, d in sorted(scored, key=lambda x: -x[0]) if s > 0][:k]


def search_ntrs(query: str, k: int = 4) -> list[dict]:
    """Live search of the NASA Technical Reports Server."""
    q = " ".join(_words(query)[:8]) + " microgravity combustion"
    r = httpx.get("https://ntrs.nasa.gov/api/citations/search", params={"q": q, "page.size": k}, timeout=12)
    r.raise_for_status()
    out = []
    for x in r.json().get("results", []):
        year = str((x.get("publications") or [{}])[0].get("publicationDate") or x.get("distributionDate") or "")[:4]
        out.append({"ref": f"NTRS {x.get('id')} ({year})", "url": f"https://ntrs.nasa.gov/citations/{x.get('id')}", "kind": "NTRS report",
                    "text": f"{x.get('title')}. {re.sub(r'\\s+', ' ', str(x.get('abstract') or ''))[:600]}"})
    return out


def search_all(query: str) -> dict:
    res, note = search_local(query), None
    try:
        res += search_ntrs(query)
    except Exception as e:  # network or API failure must not break the answer
        note = f"NTRS search unavailable ({type(e).__name__}); local evidence only."
    return {"results": res, "note": note}


@tool
def sql_query(query: str) -> str:
    """Run one read-only SQLite SELECT over the unified NASA combustion test table. Use for counts, filters,
    ranges and comparisons of test conditions and outcomes. Always select test_id, investigation and psi_id
    so results can be cited. Returns JSON with columns and rows (max 40)."""
    return json.dumps(run_sql(query))


@tool
def search_reports(query: str) -> str:
    """Search investigation descriptions, crew test notes and the NASA Technical Reports Server for what
    happened and why. Use for explanations, mechanisms and background. Returns JSON results, each with a
    `ref` (PSI id or NTRS id) and `url` to cite."""
    return json.dumps(search_all(query))


TOOLS = [sql_query, search_reports]
