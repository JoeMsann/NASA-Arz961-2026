"""Draft a column mapping for a new raw CSV with Groq, for human review.

  GROQ_API_KEY=... python pipeline/llm_map.py data/raw/NewFile.csv

Writes data/mappings/<name>.json with "approved": false.
Check every field against the file, set "approved": true, then run pipeline/build.py.
The model only proposes column names and unit scales. It never writes data values.
"""
import csv, json, os, pathlib, sys
import httpx

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA = """Unified fields (use only these keys):
investigation (short name), psi_id, kind (test|planned|threshold_1g), gravity (0g|1g), date, fuel,
phase (liquid droplet|solid|gas jet|overheated solid (smoke)), o2_pct (percent, 0-100), pressure_psia,
flow_cm_s, diluent, diluent_pct, outcome, metric_name, metric_value, metric_unit, notes."""
PROMPT = """You map one NASA experiment CSV onto a unified schema. {schema}

Return JSON only:
{{"prefix": "<short id prefix>", "constants": {{field: value for facts true of every row}},
  "columns": {{field: "<exact column name>" or {{"col": "<exact column name>", "numeric": true, "scale": <multiply by>}}}},
  "unsure": ["anything you guessed"]}}
Rules: column names must match the header exactly. Use scale to convert units (mole fraction to percent = 100,
atm to psia = 14.696, mmHg to psia = 0.019337). Leave a field out if the file has no such column. Never invent values.

File: {name}
Header: {header}
First rows:
{rows}"""


def main(path):
    p = pathlib.Path(path)
    rows = list(csv.reader(open(p, encoding="latin-1")))
    body = {"model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"), "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": PROMPT.format(schema=SCHEMA, name=p.name, header=rows[0],
                                                                    rows="\n".join(map(str, rows[1:6])))}]}
    r = httpx.post("https://api.groq.com/openai/v1/chat/completions", json=body, timeout=60,
                   headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"})
    r.raise_for_status()
    m = json.loads(r.json()["choices"][0]["message"]["content"])
    bad = [c if isinstance(c, str) else c.get("col") for c in m.get("columns", {}).values()]
    bad = [c for c in bad if c not in rows[0]]
    m.update(file=p.name, approved=False, provenance_note="LLM-drafted mapping; reviewed by: <name>",
             columns_not_in_header=bad)
    out = ROOT / "data" / "mappings" / f"{p.stem}.json"
    out.write_text(json.dumps(m, indent=1))
    print(f"wrote {out}\nunsure: {m.get('unsure')}\ncolumns not found in header: {bad}")


if __name__ == "__main__":
    main(sys.argv[1])
