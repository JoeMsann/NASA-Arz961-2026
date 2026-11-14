# Flame in Freefall

NASA Space Apps 2026. Pick a crewed environment in a 3D scene (Earth, ISS, spacesuit, Moon base, rover, Mars habitat) and see what NASA's microgravity combustion data covers there, what it does not, and what the models and the evidence say.

## Run

```bash
cp .env.example .env          # add your free Groq key: https://console.groq.com/keys
docker compose up --build     # http://localhost:3000
```

Without Docker (three terminals):

```bash
pip install -r services/ml/requirements.txt -r services/agent/requirements.txt
cd services/ml    && uvicorn app:app --port 8001
cd services/agent && GROQ_API_KEY=... uvicorn app:app --port 8002
cd web && npm install && npm run dev
```

Rebuild the table and retrain: `docker compose run --rm pipeline` (or `python pipeline/build.py`).

## Containers

| Container | Port | Does |
| --- | --- | --- |
| `web` | 3000 | Next.js 15 + three.js interface. Proxies `/api/svc/ml/*` and `/api/svc/agent/*` to the services |
| `ml` | 8001 | Unified table API, habitat navigator (coverage + ranking), flame predictor |
| `agent` | 8002 | Ask PSI: LangGraph agent on Groq with two tools, plus a no-LLM evidence search |
| `pipeline` | – | One-off job: builds `data/build/` from `data/raw/` and trains the models |

## Features

| Idea | Where | Status |
| --- | --- | --- |
| 1. Habitat Risk Navigator | 3D scene + first tab | Working. Coverage map, "No data here", ranking by closeness then fire-safety class |
| 2. Unified test table | `pipeline/build.py`, table tab, CSV download | Working. 992 rows from 12 source files |
| 3. Ask PSI chat with citations | `services/agent` | Graph and tools tested offline. Live Groq call not tested (no key in the build environment) |
| 4. Compare two investigations | Compare tab, `GET /compare` on `ml` | Working. Side-by-side table, shared and differing points, both on one oxygen-pressure map. See `docs/compare-and-ask-psi.md` |
| 5. Flammability predictor | Predictor tab | FLEX self-extinction and burn-rate models. No CFI-G ignition classifier: that data was not available |
| 7. Earth benefits | Last tab | Three sourced cards |

## Unified table

`tests` columns: test_id, investigation, psi_id, kind, gravity, date, fuel, phase, o2_pct, pressure_psia, flow_cm_s, diluent, diluent_pct, outcome, metric_name, metric_value, metric_unit, assumed, notes, source_file, provenance.

| Investigation | Rows | Kind | Provenance |
| --- | --- | --- | --- |
| FLEX (PSI-69) | 274 | flown test | NASA table |
| FLEX-2 (PSI-68) | 160 | planned matrix points, no results | NASA table |
| SAME / SAME-R (PSI-101) | 154 | flown test | third-party extract |
| BASS-II (PSI-25) | 129 | flown test | NASA table |
| BASS (PSI-26) | 122 | flown test, with crew notes | third-party extract |
| SPICE (PSI-107) | 90 | flown test | third-party extract |
| WSTF 1-g thresholds (NTRS 20110008636) | 52 | ground threshold | third-party transcription |
| Saffire I, II, III (PSI-98/99/100) | 11 | flown test | NASA table |

Values added during cleaning are named in the `assumed` column (cabin pressure for BASS-II and Saffire, air co-flow O2 for SPICE, flow units for BASS).

Adding a new CSV: `python pipeline/llm_map.py data/raw/File.csv` drafts a column mapping with Groq into `data/mappings/`. Review it, set `"approved": true`, rebuild. The model proposes column names and unit scales only; it never writes values. This script has not been run against Groq yet.

## Navigator rule

Distance = sqrt((ΔO2 / 5 points)² + (Δpressure / 2 psi)²). A flown test within distance 1 covers the environment. Planned points and 1-g thresholds are drawn on the map but never count as coverage. Investigations are ranked by closest test, then fire-safety class.

## Models (FLEX, 5-fold CV grouped by test date)

| Target | Shipped | Score | Gradient boosting | No-skill |
| --- | --- | --- | --- | --- |
| Droplet flame self-extinguishes | Logistic regression | AUC 0.82, Brier 0.089 (206 tests) | AUC 0.78, Brier 0.100 | Brier 0.114 |
| Burning-rate constant | Ridge | R² 0.68, MAE 0.050 (257 tests) | R² 0.62, MAE 0.058 | MAE 0.108 |

40-member bootstrap ensembles give the ranges shown. Inputs outside the tested envelope trigger a warning and the numbers are struck through. Scope: heptane and methanol droplets in microgravity only.

## Before submitting

- Raw files came from public GitHub mirrors of PSI tables. Download each from psi.nasa.gov and diff.
- PSI ids and DOIs in `data/catalog.json` came from the same mirrors. Confirm each.
- Rover and Mars presets use 8.2 psi / 34% O2 from memory of NASA's exploration atmosphere. Moon base and spacesuit values are the team's. All are editable in the UI; verify before citing.
- The Docker images were written but not built here (no Docker daemon). The three services were run and tested directly with the same commands the images use.
- BASS outcomes are blank: the source has free-text crew notes only. Classifying them is a good LLM task, with review.
- Declare AI assistance (Claude for code, Groq models in the app) in the Space Apps submission.
