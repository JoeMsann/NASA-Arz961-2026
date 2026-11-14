# Flame simulation (Predictor tab)

The Predictor tab draws one burn from the prediction: a heptane or methanol droplet burning in microgravity, to scale and in real time. The drawing shows the burn the model predicts, so it is a fuel droplet, not a wax candle. The model covers droplets only, and FLEX burned droplets. In microgravity a candle flame and a droplet flame are the same kind of flame: a round, steady ball, with no rising hot gas to pull it into a teardrop.

## Files

| File | Change |
| --- | --- |
| `pipeline/build.py` | `models.json` `train_rows` also carry each FLEX run's `d_ext` (droplet diameter when the visible flame went out) and `t_burn`. The models are unchanged: a rebuild gives identical coefficients |
| `data/build/models.json` | Rebuilt. Only `train_rows` changed |
| `services/ml/app.py` | `flame()`; `/predict` returns it as `flame` (both endings sampled in time, plus the sources) |
| `web/components/FlameSim.tsx` | Canvas drawing, playback, the explanation |
| `web/components/Predictor.tsx` | Shows `FlameSim` after the two prediction cards |
| `web/app/globals.css` | `.seg`, `.sim-*` |

`report.json` and `unified.db` were not committed: a rebuild only shifts them with the local scikit-learn version (see CLAUDE.md).

## What is computed, and from what

| Quantity | How | Basis |
| --- | --- | --- |
| Droplet diameter | d² = d₀² − K·t, K = burning-rate model mean | The d² law. Check against the PSI-69 table, runs that went out: recorded burn time / d²-law time has median 1.05 (methanol, 101 runs, 10th to 90th percentile 1.00 to 1.11) and 1.06 (heptane, 55 runs, 0.99 to 1.48). The service computes this at startup |
| Which ending | Extinction model mean. The likelier ending plays first; the user can switch | The model |
| Where it goes out | d₀ × median(d_ext/d₀) of the 5 closest FLEX runs of the same fuel that went out. Closeness is the same scaled distance as "Closest real tests" | PSI-69 table |
| When it goes out | (d₀² − d_ext²)/K | d² law |
| Flame diameter | standoff ratio (FSR) × droplet diameter | Dietrich et al. 2014, below |
| Shape | Sphere, steady, no flicker | No buoyancy; FLEX g-levels typically below 10⁻⁵ g |
| How it goes out | Heptane: radiative, the flame dies on one side and retreats in 0.25 s. Methanol: diffusive, gone in one frame | Paper: retreat over 5 to 10 frames at 30 fps; methanol "visible ... in one frame and then gone in the next" |
| Colour | Blue reaction zone drawn as a thin glowing shell (brighter at its edge, as seen in projection). Heptane: soot yellow at ignition, fading over ~1 s | Paper: heptane "initially luminous yellow ... quickly became a relatively bright blue"; methanol makes no soot at FLEX pressures. The fade time is a drawing choice |
| Brightness | Falls linearly to 35% by the end | Qualitative only. Paper: "brighter early in the burn and very dim near flame extinction"; camera gain varied per test, so there is no brightness to compare between conditions |

## Flame standoff ratio: read off the paper's figures

Source: D. L. Dietrich et al., "Droplet Combustion Experiments Aboard the International Space Station", *Microgravity Sci. Technol.* 26:65–76 (2014), [doi:10.1007/s12217-014-9372-2](https://doi.org/10.1007/s12217-014-9372-2). Its figures are runs from our PSI-69 table: Fig. 3 is 301F001 (K 0.39, 4.8 s), Fig. 4 is C01H601 and C01H701 (K 0.49 and 0.53), and Fig. 6 includes C10M201 and H12M201 (K 0.45 and 0.70).

The figures were rendered from the PDF at 260 to 300 dpi and read by pixel position against the axis ticks. Expect about ±0.1 in FSR from the reading.

**Methanol.** Fig. 7 plots the average FSR against O₂ mole fraction, with a dashed trend line from (0.126, 5.94) to (0.343, 4.11), which gives 5.23 at 21% O₂. The paper says the ratio is "about 5" in air, with 30% CO₂ and with 30% helium (Fig. 6). The points scatter about ±1 around the line. Outside 12.6 to 34.3% O₂ the value is held at the nearer end and the interface says so. Fig. 6 also shows the ratio starting at about 0.76 of its average (0.74, 0.81 and 0.74 in the three runs) and settling with a time constant near 1.5 s; the drawing uses FSR × (1 − 0.24·e^(−t/1.5 s)). Not drawn: the slight drop just before extinction.

**Heptane.** FSR grows nearly linearly through the burn. Against t/D₀² the three published traces have similar slopes (4.95, 6.5 and 4.9 s⁻¹·mm²), so one line describes them: FSR = 6.8 + 5.4·t/D₀², capped at 15, the largest value measured. The line against the points read off the figures:

| Run | t (s) | Read | Line | Difference |
| --- | --- | --- | --- | --- |
| 301F001 (Fig. 3, 18% O₂) | 0.74 | 6.82 | 7.25 | +6% |
| 301F001 | 4.22 | 8.30 | 8.87 | +7% |
| C01H601 (Fig. 4, 20% O₂, 5% CO₂) | 0 | 6.39 | 6.69 | +5% |
| C01H601 | 3.09 | 8.80 | 8.47 | −4% |
| C01H601 | 6.30 | 10.84 | 10.32 | −5% |
| C01H701 (Fig. 4) | 0 | 7.59 | 6.69 | −12% |
| C01H701 | 6.96 | 15.2 | 14.77 | −3% |

These runs burned at 18 to 20% O₂. At other oxygen levels the line is multiplied by FSR_methanol(O₂) / FSR_methanol(19%). **This is an assumption.** It rests on Burke-Schumann theory, FSR = ln(1+B) / ln(1+Y_O₂/ν), whose relative change with oxygen, −1 / ((ν+Y) ln(1+Y/ν)), is −4.0 for methanol (ν = 1.5) and −4.2 for heptane (ν = 3.52) in air. The measured methanol trend is weaker than the theory, and the same weakening is assumed for heptane.

## Not drawn

- Oscillations at about 1 Hz before radiative extinction (some runs only).
- The cool flame that kept large heptane droplets burning after the visible flame went out (Nayagam et al. 2012, [doi:10.1016/j.combustflame.2012.07.012](https://doi.org/10.1016/j.combustflame.2012.07.012)). The status line mentions it.
- Droplet break-up (32 of 108 heptane runs and 23 of 153 methanol runs), drift, the igniters and the needles.
- Partial or full gravity. Above 0.01 g the card says the drawing is for microgravity and that buoyancy would make a teardrop.

## Data notes found on the way

- The PSI-69 table lists `193F001` twice (tests 70 and 73), with the same date and time but different values. The unified table already names the second `#2`, and the simulation does too. Check this against psi.nasa.gov.
- Some runs the table marks "Completion" also record an extinction diameter well above zero. Examples are C10M303 (2.10 of 3.37 mm) and C10M401 (2.35 of 3.99 mm), and their burn times match a flame that went out at that size. The model and the interface read "Completion" as "burned all the fuel"; that reading may not hold for every run.

## How to check

```bash
python pipeline/build.py                       # models.json: only train_rows gain d_ext and t_burn
cd services/ml && uvicorn app:app --port 8001
curl -s localhost:8001/predict -H 'content-type: application/json' \
  -d '{"fuel":"Heptane","o2_pct":20,"pressure_psia":14.7,"co2_pct":5,"he_pct":0,"d0_mm":3.04}' | python -m json.tool | head -40
```

Those inputs are run C01H601's conditions. The burn should go out near 2.3 mm after about 7.6 s (the table says 2.33 mm and 8.1 s), with the flame growing from about 20 to 26 mm (Fig. 4: 19.6 to 27 mm).

In the interface: open Flame predictor, let the heptane burn play (yellow at ignition, then a blue ring that grows, then dies from one side). Switch to "Burns all the fuel", switch to methanol (paler, smaller ring that vanishes at once), then pick Mars habitat (gravity and extrapolation warnings).

## Checks that were run

- Rebuilt with `python pipeline/build.py`; every `models.json` key except `train_rows` is identical to the committed file.
- `/predict` on eight input sets, including the paper's runs, 100% O₂ (flame size held at the 34.3% value) and a 5 mm droplet outside the tested range.
- `npx tsc --noEmit` clean. `python services/agent/test_graph.py` passes.
- Headless Chrome at 1440×900 against `next dev` and the modified ml service: both fuels, both endings, scrubbing, real-time playback (1.0 s on the clock after 1 s), ignition, retreat and end frames, the Mars warnings, no console errors.

## Not checked

- Browsers other than Chrome, phones, and reduced-motion mode (it starts paused mid-burn by design; not exercised).
- The Docker images were not rebuilt.
