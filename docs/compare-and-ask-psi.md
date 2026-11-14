# Compare two investigations, and Ask PSI changes

Covers idea 4 (Compare 2 Investigations) and the follow-up work on idea 3 (Ask PSI chat with citations).

## What was added

| Area | Change | Files |
| --- | --- | --- |
| Catalog | Every investigation now has `objective`, `platform`, `hardware`, `sensors`, `flown` and `details_basis`. Two investigations the challenge names were added as description-only entries: `ACME-CFI-G` and `ACME-E-FIELD` | `data/catalog.json`, `data/build/catalog.json`, `data/build/unified.db` |
| Compare API | `GET /compare?a=<id>&b=<id>` on the `ml` service | `services/ml/app.py` |
| Compare tab | Second tab in the web app | `web/components/Compare.tsx`, `web/app/page.tsx`, `web/app/globals.css` |
| Ask PSI search | Hardware, platform, sensors and objective are searchable. Rare words now outweigh common ones | `services/agent/tools.py` |
| Ask PSI citations | If the model answers without citing, the records its tool calls returned are listed and the answer carries a warning | `services/agent/app.py`, `web/components/AskPsi.tsx` |
| Ask PSI prompt | The schema lists the new `investigations` columns; the prompt says how to cite a record with no DOI | `services/agent/graph.py`, `services/agent/tools.py` |

## Compare: how it works

Pick any two of the 17 catalog entries. The response has three parts.

1. **Catalog text**, shown as written: objective, platform, hardware, sensors, fuels, what it measures, fire-safety relevance, when it flew.
2. **Statistics computed from the unified table** for each side: record counts by kind, fuel phase, gravity, the eight most common fuels, oxygen / pressure / flow ranges, diluents, outcome counts, measured quantities, and which variables changed between its tests and which stayed fixed.
3. **Shared and differing points** between the two, written as sentences. Every sentence is produced by a rule in `_between()`; none comes from a language model.

Rules worth knowing:

- A numeric condition counts as *varied* only when its spread is more than 1 oxygen point, 1 psi or 1 cm/s. Smaller spreads are sensor drift and are reported as *held fixed*.
- For the White Sands 1-g thresholds, the `o2_pct` column holds the limiting oxygen level each test found, not a condition it ran at. The comparison says so and does not compare it with a flight test's oxygen.
- Shared materials are found by matching material names (SIBAL, PMMA, Nomex, heptane and so on) inside the free-text fuel descriptions. The list is `FAMILIES` in `services/ml/app.py`; add to it when a new source brings a new material.
- An investigation with no loaded records is still selectable. Only its catalog text is compared, and the page says so.
- "Ask PSI to explain the difference" sends a ready-made question about the two investigations to the Ask PSI tab.

## Where the hardware and sensor text comes from

The PSI tables do not carry hardware or sensor descriptions, so these were written by hand. Each catalog entry's `details_basis` states its source, and the Compare tab shows it in the last row.

| Basis | Investigations | Trust |
| --- | --- | --- |
| Hardware from the challenge text, sensors from the source table's columns | BASS, BASS-II, SPICE | Good |
| Hardware from the challenge text, sensors from NASA summaries | FLEX, FLEX-2, CFI, the four ACME entries, CFI-G, E-FIELD | Verify the sensor lists |
| Platform and sensors from NASA summaries | Saffire I to III, SAME | Verify |
| Transcribed report tables | WSTF-1G | Verify against NTRS 20110008636 |

`ACME-CFI-G` and `ACME-E-FIELD` have no PSI id or DOI in the catalog because neither was confirmed. Look them up on psi.nasa.gov and fill them in.

## Checks that were run

- `python pipeline/build.py` rebuilds without error with the two new catalog entries.
- `cd services/agent && python test_graph.py` passes, including three new checks: fallback citations, hardware search, and the new `investigations` columns in SQL.
- `/compare` returns 200 for all 289 ordered pairs of catalog ids and 404 for an unknown id.
- In the browser: the Compare tab renders BASS against BASS-II, and its Ask PSI button hands the question over and returns evidence.
- `npx tsc --noEmit` in `web/` is clean.

## Not checked, and known limits

- **No live Groq call was made.** No API key was available, so the written-answer path of Ask PSI is tested only with a scripted stand-in for the model.
- **Docker images were not rebuilt.** The services were run directly with uvicorn and `npm run dev`.
- **BASS-II "O2 consumed" shows -19.7 to 20.6 points** in the Compare tab. That range comes from bad cells in the source table (for example test B2 lists a final oxygen of 1.6%). It is a data fix for `pipeline/build.py`, not a Compare bug.
- **Outcomes are blank for BASS and BASS-II**, so the Outcomes row reads "Not coded in the source".
- **Model scores depend on the installed scikit-learn version.** Rebuilding here with scikit-learn 1.7.2 changed the cross-validation scores in `report.json` (extinction AUC 0.82 to 0.79) with no change to the model code. That file was left as committed. Pin the versions in `pipeline/requirements.txt` to make the numbers reproducible.
