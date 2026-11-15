# Flame in Freefall

**SI-powered fire-safety insights from NASA's microgravity combustion data.**
NASA Space Apps Challenge 2026 · Team **Arz 961** · Beirut, Lebanon

Flame in Freefall is a web dashboard that turns NASA's scattered ISS fire experiments into clear, cited fire-safety answers for crews heading to the Moon and Mars. We cleaned 12 messy tables from NASA's Physical Sciences Informatics (PSI) database, plus one NASA 1-g reference, into one table of 992 records. Pick a habitat and the dashboard shows which NASA fire tests matter there, where NASA has no data at all, and what the models and the evidence say.

- **Space Apps project page:** https://www.spaceappschallenge.org/2026/find-a-team/arz961/?tab=project
- **Presentation:** [`docs/presentation/Flame-in-Freefall-Arz961.pptx`](docs/presentation/Flame-in-Freefall-Arz961.pptx)
- **Challenge:** [Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data](docs/challenge.md)

> Research aid only. Nothing here is flight-safety guidance or material approval.

## Why it matters

Fire has threatened spaceflight again and again: Apollo 1 (1967), Apollo 13 (1970), Mir (1997) and the Artemis II smoke alarm (2026). In freefall there is no buoyancy, so a flame becomes a dim blue sphere fed only by slow diffusion and cabin fans, and Earth fire tests alone cannot predict what will burn.

The planned Moon base and pressurized rovers will run at about **30% oxygen and 10.2 psi** to shorten spacewalk preparation. Astronauts breathe about the same amount of oxygen as on Earth (about 3.1 psi of O2), but the oxygen fraction is more than 40% higher, so materials burn much more easily. Engineers need quick, trustworthy answers from the data NASA already has.

## What it does

| Feature | What you get |
| --- | --- |
| **3D Explore view** | Real NASA imagery of Earth, Moon and Mars. Click a habitat to open its fire-risk panel |
| **Habitat Risk Navigator** | Presets for the ISS (21% O2, 14.7 psi), Moon base (30% O2, 10.2 psi), pressurized rover, Mars habitat and spacesuit (100% O2, 4.3 psi). Ranks investigations by closeness of oxygen, pressure, airflow and fuel, plus fire-safety pillar (prevention, detection, suppression). The weights are shown, so the ranking is explainable. A coverage map marks "No data here" where NASA never tested |
| **Compare investigations** | Hardware, fuels, conditions, sensors and results side by side, with what is shared and what differs. Every sentence comes from a rule, not from a language model |
| **Flame predictor** | Chance that a heptane or methanol droplet flame goes out by itself, and its burning-rate constant, with an uncertainty range. Warns when inputs are outside the tested range and draws the flame to scale |
| **Ask PSI** | An AI agent that answers plain-English questions using only two tools: read-only SQL over the test table, and a search over investigation descriptions, crew notes and live NASA Technical Reports Server results. Every answer cites the PSI id and DOI, or the NTRS id. Made-up links are detected and removed |
| **Unified test table** | Filter, search and download as CSV. Each row keeps its raw source file and a provenance flag |
| **Earth benefits** | Water-mist extinguishers, smoke detectors that tell smoke from dust, firefighter breathing gear |
| **MCP server** | 10 read-only tools (test table, SQL, navigator, compare, predictor, NASA reports), so Claude, Cursor or any MCP client can use our data with the same numbers and citations |

## What we found in the data

- **More oxygen, faster burning.** In FLEX, the average burning-rate constant rises from about 0.36 mm²/s at 12% O2 to about 0.71 mm²/s at 34% O2. A Moon base at 30% O2 sits at the high end.
- **Diluting the air helps put flames out.** In FLEX, 57% of flames went out by themselves with no added diluent, 72% with added CO2 and 80% with added helium.
- **The honest gap: partial gravity.** NASA has fire data at 0 g and at 1 g, but none yet at Moon or Mars gravity. The dashboard says so instead of guessing, and uses 0 g and 1 g as bounds.

These are trends across tests where fuel and oxygen also vary, not controlled experiments. The dashboard lets you filter to compare like with like.

## How it works

```
NASA PSI tables ─► pipeline (clean + unify) ─► SQLite, 992 records ─► ml service ──┐
                                                                    └► agent (Ask PSI) ┼─► web (Next.js + three.js)
                                                                                       └─► MCP server (any AI assistant)
```

- **Data pipeline** (Python, pandas, `pipeline/build.py`): reads the PSI tables and fixes units typed inside cells, ranges, estimates such as "~21.5", notes mixed into data rows and broken column names, then maps everything to one schema (fuel, phase, O2, pressure, flow, diluent, outcome, metric). Every row keeps its provenance, and any value added during cleaning is named in an `assumed` column. A language model only drafts column mappings for new files, reviewed before use. It never writes data values.
- **Models** (scikit-learn, trained on NASA FLEX, validated with 5-fold cross-validation grouped by test date):

  | Target | Model | Score |
  | --- | --- | --- |
  | Droplet flame goes out by itself | Logistic regression with interaction terms, 40-member bootstrap ensemble | AUC 0.88, Brier 0.079 (206 runs) |
  | Burning-rate constant | Ridge regression, 40-member bootstrap ensemble | R² 0.68, MAE 0.050 mm²/s (257 runs) |

  Both beat 14 alternatives we tested (random forest, boosting, SVM, kNN, neural nets). Scope: heptane and methanol droplets in microgravity only.
- **Services:** FastAPI services for the models (`services/ml`) and the Ask PSI agent (`services/agent`, LangGraph on Groq), plus the MCP server (`services/mcp`).
- **Web app:** Next.js 15, React 19, three.js for the 3D scene, Recharts for charts.

| Container | Port | Does |
| --- | --- | --- |
| `web` | 3000 | Interface. Proxies `/api/svc/ml/*` and `/api/svc/agent/*` to the services |
| `ml` | 8001 | Unified table API, habitat navigator, compare, flame predictor |
| `agent` | 8002 | Ask PSI agent and a no-LLM evidence search |
| `mcp` | 8003 | MCP server at `/mcp`, forwards to `ml` and `agent` |
| `tunnel` | – | Optional (`--profile tunnel`): temporary public address for `mcp` |
| `pipeline` | – | One-off job: rebuilds `data/build/` and retrains the models |

## Run it

```bash
cp .env.example .env          # add your free Groq key: https://console.groq.com/keys
docker compose up --build     # open http://localhost:3000
```

Without Docker, see [`setup.md`](setup.md). Rebuild the table and retrain with `docker compose run --rm pipeline` (or `python pipeline/build.py`).

**Connect an AI assistant (MCP):**

```bash
claude mcp add --transport http flame-in-freefall http://localhost:8003/mcp
```

For hosted chatbots such as claude.ai, start the tunnel (`docker compose --profile tunnel up --build`) and add the printed `https://…trycloudflare.com/mcp` address as a custom connector. Details in [`docs/mcp-server.md`](docs/mcp-server.md).

## NASA data

| Investigation | PSI id | Records | Kind |
| --- | --- | --- | --- |
| FLEX | PSI-69 (DOI 10.60555/mbq8-0451) | 274 | flown test |
| FLEX-2 | PSI-68 (DOI 10.60555/byp8-h018) | 160 | planned test points, no results |
| SAME / SAME-R | PSI-101 | 154 | flown test |
| BASS-II | PSI-25 (DOI 10.60555/4qc4-de67) | 129 | flown test |
| BASS | PSI-26 | 122 | flown test, with crew notes |
| SPICE | PSI-107 (DOI 10.60555/9kbh-e962) | 90 | flown test |
| WSTF 1-g thresholds | Hirsch (2011), NTRS 20110008636 | 52 | ground threshold test |
| Saffire-I, II, III | PSI-98, 99, 100 | 11 | flown test |

Total: 992 records (780 flown tests, 160 planned FLEX-2 points, 52 ground 1-g thresholds). Planned points and ground thresholds are never mixed with flown tests in a chart, count or model.

Also described in the catalog: Cool Flames Investigation (PSI-39), ACME Burning Rate Emulator (PSI-20), Coflow Laminar Diffusion Flame (PSI-21), s-Flame (PSI-23), Flame Design (PSI-10), CFI-G and E-FIELD Flames. Other sources: the NASA Technical Reports Server API, *A Researcher's Guide to ISS Combustion Science* (2015), NASA Spinoff, and NASA imagery (Blue Marble, CGI Moon Kit, Solar System Treks; full list in `web/public/textures/CREDITS.md`).

## Known limits

- PSI has no partial-gravity combustion data yet (LUCI and FM2 will add it). Moon and Mars are bounded by 0 g and 1 g results.
- The flame predictor covers heptane and methanol droplets in microgravity only. Outside the tested range its numbers are struck through and flagged as extrapolated.
- BASS and BASS-II results are recorded as free-text crew notes, so their outcomes are not coded yet.
- Rover and Mars atmospheres (8.2 psi, 34% O2) are assumptions. They can be edited in the interface.

## Team Arz 961

We are Arz 961, ranked 3rd in the 2025 NASA Space Apps Challenge for *Hunting for Exoplanets with AI*. We are interested in software engineering and AI, which is why we chose Flame in Freefall for 2026.

- Joe Al Msann (team owner)
- Anthony Abi Said
- Chadi Awar
- Fares Al Maady

Local event: Beirut, Lebanon.

## Tools and languages

Python, TypeScript, Next.js, React, three.js, Recharts, FastAPI, Pydantic, Uvicorn, HTTPX, LangGraph, LangChain, MCP Python SDK, pandas, NumPy, scikit-learn, PyTorch (model comparison only), SQLite, JupyterLab, matplotlib, ImageMagick, Docker Compose. Groq hosts the open-weight Qwen language model used by Ask PSI.

AI assistance (Claude for code, a Groq-hosted model inside the app) is declared in our Space Apps submission. Independent NASA Space Apps 2026 project, not a NASA product.
