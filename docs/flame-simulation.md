# Flame simulation (Predictor tab)

The Predictor tab draws one burn from the prediction: a heptane or methanol droplet burning in microgravity, to scale and in real time. The drawing shows the burn the model predicts, so it is a fuel droplet, not a wax candle. The model covers droplets only, and FLEX burned droplets. In microgravity a candle flame and a droplet flame are the same kind of flame: a round, steady ball, with no rising hot gas to pull it into a teardrop.

## Files

| File | Change |
| --- | --- |
| `pipeline/build.py` | `models.json` `train_rows` also carry each FLEX run's `d_ext` (droplet diameter when the visible flame went out) and `t_burn`. The models are unchanged: a rebuild gives identical coefficients |
| `data/build/models.json` | Rebuilt. Only `train_rows` changed |
| `services/ml/app.py` | `flame()`; `/predict` returns it as `flame` (both endings sampled in time, plus the sources). `physics()`: the estimates that set brightness, soot and shape (see "Physics estimates"). `/predict` accepts `gravity_g`, used by those estimates only |
| `web/components/FlameSim.tsx` | Canvas drawing, playback, the explanation, the 3D / camera view switch |
| `web/components/scene/flame3d.ts` | The 3D view (see "3D view" below) |
| `web/components/Predictor.tsx` | Shows `FlameSim` after the two prediction cards; sends the selected place's gravity |
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
| Shape | Sphere, steady, no flicker, when gravity is zero. With gravity: see "Physics estimates" | No buoyancy; FLEX g-levels typically below 10⁻⁵ g |
| How it goes out | Heptane: radiative, the flame dies on one side and retreats in 0.25 s. Methanol: diffusive, gone in one frame | Paper: retreat over 5 to 10 frames at 30 fps; methanol "visible ... in one frame and then gone in the next" |
| Colour | Blue reaction zone. Heptane: soot yellow at ignition, then blue. Strength, duration and colour of the yellow: see "Physics estimates" | Paper: heptane "initially luminous yellow ... quickly became a relatively bright blue"; methanol makes no soot at FLEX pressures |
| Brightness | From heat release per flame area: see "Physics estimates". A flame that goes out is also dimmed to 35% over its last quarter | Estimate. The dimming is from the paper: "very dim near flame extinction". Camera gain varied per test, so no measured brightness exists to compare between conditions |

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

- The cool flame that kept large heptane droplets burning after the visible flame went out (Nayagam et al. 2012, [doi:10.1016/j.combustflame.2012.07.012](https://doi.org/10.1016/j.combustflame.2012.07.012)). The status line mentions it.
- Droplet break-up (32 of 108 heptane runs and 23 of 153 methanol runs), drift and the igniters.
- How gravity changes burn rate and extinction: the two models are zero-gravity only.

## Physics estimates

The two models predict whether the flame goes out and how fast the droplet burns. The PSI-69 table records nothing about brightness, soot or shape, so no model could be trained for them. For the picture to respond to the inputs, `physics()` in `services/ml/app.py` computes four estimates from the same inputs. They give the right direction of each effect. They are not PSI data and not model predictions, and the interface tags each one "estimate". `/predict` returns them as `flame.physics`.

| Estimate | Formula | Leaves out |
| --- | --- | --- |
| Flame temperature | Energy balance for one mole of fuel burned with just enough atmosphere: T = 298 K + LHV / Σ nᵢ·cpᵢ over the products and the inert gas drawn in. cp at 1200 K: CO₂ 56.21, H₂O 43.87, N₂ 33.71, He 20.79 J/(mol·K) (the constant-cp shortcut in Turns, *An Introduction to Combustion*, ch. 2). LHV of the liquid: heptane 4465, methanol 638 kJ/mol | Radiative loss, so it is an upper bound. Dissociation: above 2500 K the value is replaced by "above 2,500 K". Gives 2385 K for heptane in air and 2207 K for methanol in air; the shortcut is known to run on the order of 100 K high for fuel-air flames |
| Heat release per flame area | Total heat output (shown in W) = (π/4)·ρ·K·d·LHV. Per area of a round flame: q = ρ·K·d·LHV / (4·d_f²): the d² law burns (π/4)·ρ·K·d of fuel per second, all of it at the flame, a sphere of diameter d_f. Brightness = (q / 25 kW/m²)^0.6, limited to 0.05 to 2.5 | Finite-rate chemistry: a real flame weakens before it goes out, so the "goes out" ending is also dimmed (previous table). 25 kW/m² and the 0.6 display curve are choices |
| Soot index | Heptane only: clamp((T − 1600 K)/(2300 K − 1600 K), 0, 1.6) × pressure in atm × (d₀/3 mm)², limited to 1.6. The yellow is index × e^(−t/τ), τ = 0.4 s × index (0.25 to 3). Glow colour: Planck radiance at 0.61, 0.55 and 0.465 µm for 0.85 × flame temperature | A rule of thumb. Basis for each factor: soot forms in diffusion flames above roughly 1600 K (Glassman); soot rises with pressure; soot needs residence time, which scales with flame size squared. The exponents, the 0.85 and the reference point (index 1 = what FLEX saw at 1 atm, 3 mm, 18 to 20% O₂) are choices. Methanol: none, as observed |
| Flicker | Rate: f = 0.48·√(g/width), from the measured rule f = 1.5/√D Hz at 1 g for buoyant flames D metres wide (Cetegen and Ahmed 1993). Strength: Pe²/(Pe² + 30²) | The rate rule was measured on burners and pool fires centimetres wide and larger; a droplet flame is smaller and burns almost steadily, like a candle, hence the low strength (14% for a 3 mm heptane droplet on Earth, 52% for 5 mm, 0 to 3% on the Moon and Mars). The strength, and how the flicker moves the outline (a bulge and neck travelling up, the tip bobbing, a lean, wrinkles), are illustration |
| Pre-extinction pulsing | Heptane, "goes out" ending, zero gravity: brightness ±24% and size ±4% at 1 Hz, growing over the last 3 s (at most 40% of the burn) | The paper reports pulsing at about 1 Hz before radiative extinction in some runs only. Here every such burn shows it; the amplitude is a choice |
| Shape under gravity | The flame surface of a fuel source in a rising stream. Rise speed U = √(g·d_f·(1 − T_room/T_flame)). Steady diffusion from a small source in a uniform stream gives c = Q/(4πDr)·exp(−U(r − y)/(2D)), y upward; the flame is a surface of constant c: **r·exp(Pe·(r − y)/L) = L**, Pe = U·L/(2D). In polar form r/L = W(a)/a with a = Pe·(1 − cos θ) and W Lambert's function. Pe = 0 is a sphere. L, the tip height, is the zero-gravity flame radius × boost. Boost = 1 + 0.3·Re^½·Pr^⅓ (Ranz–Marshall, Re on droplet diameter and U): convection raises the burn rate, and the drawn burn uses K × boost. D = 0.2 cm²/s × (T_mean/300 K)^1.75 ÷ p, ν = 0.16 cm²/s × (T_mean/300 K)^1.7 ÷ p, Pr = 0.7 | The droplet is treated as a point (for a large droplet the formula puts the bottom of the flame inside it, where the droplet hides it). The stream is taken as uniform, while real buoyant gas accelerates upward, which makes real tips more pointed. Helium's higher diffusivity is ignored. The extinction model and its "goes out" ending are zero-gravity only. No partial-gravity test exists in PSI to check any of it |

What the sliders do through these: more oxygen means a hotter flame, more soot and a smaller, brighter flame; CO₂ cools it and removes the soot; pressure and droplet size add soot; a larger droplet has a dimmer flame; gravity presses the flame close under the droplet and draws it out above; lower pressure makes it rounder again.

Checked values (`physics()` called directly, 3 mm heptane unless noted): in air 2385 K, soot index 1.12; with 70% CO₂ 1804 K, index 0.29; a 1 mm droplet index 0.12, a 5 mm droplet 1.6. Shape: ISS Pe 0, height ÷ width 1.00; Moon base Pe 2.0, boost 1.32, 1.32; rover 1.4, 1.28, 1.23; Mars habitat 2.2, 1.35, 1.35; Earth 12.2, 1.65, 2.34; Earth with a 5 mm droplet 31, 1.96, 3.48; Earth with methanol 6.2, 1.61, 1.83. Mars is much rounder than Earth for two reasons: 0.38 g, and 8.2 psi, which lets gas diffuse faster.

Under gravity the burn is drawn with K × boost. The chance of going out, the size at which it goes out and the K shown on the cards are still the zero-gravity models' numbers, and the card says so.

The heat capacities, heating values and densities are textbook values and the literature pointers (Turns, Glassman, Cetegen and Ahmed, Ranz and Marshall) and the gas properties were written from memory. Check them before citing.

## 3D view

The simulation opens in a 3D view (three.js, `web/components/scene/flame3d.ts`); "Camera view" switches to the flat drawing above, which is also the fallback when WebGL is not available. Both views draw the same interpolated numbers from `/predict`: nothing is computed in the browser, and one scene unit is one millimetre. The camera view always shows the zero-gravity sphere and has no headroom for brightness above 1.

The flame is rendered as glowing gas, not as a painted surface. A fragment shader marches each pixel's line of sight through the flame (96 steps, out to 1.2 flame radii) and adds up the light it passes, in high dynamic range. Bloom, tone mapping and grain then turn that into the picture, as a lens and sensor would. The look is modelled on photographs of microgravity flames in NASA's *Researcher's Guide to Combustion Science* (Figs. 1 and 5, cover).

| Element | How it is drawn | Data or drawing choice |
| --- | --- | --- |
| Flame | Emission peaks at 0.9 flame radii, falls off outward with a Gaussian width of 0.075 and inward more slowly (width 0.11), so the edge is soft and the rim brighter than the middle. Colour runs from teal inside through cyan to violet at the edge; methanol is a paler, more even blue. A fixed ±8% mottling. Brightness scales with `lum` | Diameter: model and paper. Brightness: estimate. Profile, colours and mottling: drawing choices (hydrocarbon flames glow blue-green from C₂ on the fuel side and blue from CH) |
| Soot | Emitting and absorbing cloud inside the flame, density = `soot` × a slow noise field. Thick lines of sight burn out to white-yellow, thin ones stay orange | Strength, duration and colour: estimate. Position and texture: decoration (FLEX images do not resolve soot structure) |
| Buoyant shape | The shader evaluates s = r·exp(Pe·(r − y)) at every sample (units of the tip height): the flame is where s is near 1, exactly as r is for the round flame, so one emission profile serves both. Brightness is scaled locally by the gradient of s (how fast fuel and oxygen meet) on the same 0.6 display curve, up to 1.6 times: brightest under the droplet, dimmer at the tip. Flicker, when its strength is above zero, is laid over this (see "Physics estimates"). Everything that moves is a function of the time since ignition, so a paused frame is still | The surface: estimate from the formula. Flicker motion: illustration |
| Droplet | Sphere of diameter `d`, at least 1.5 px across. Fresnel reflection from the liquid's refractive index (heptane 1.39, methanol 1.33), lit by the flame and soot, plus a faint fill light so the leftover droplet is visible after the flame is out | Diameter: data. Refractive indices: handbook values. Everything else: drawing choice |
| Needles | Two opposed steel needles, 0.4 mm thick, tips at 1.15 times the largest flame radius, lit by the flame | FLEX deployed droplets from two opposed needles and retracted them before ignition. Thickness and distance: drawing choices; the table records neither |
| Cutaway | "Cut flame in half" skips gas with x > 0, so the gap between droplet and flame (standoff) can be seen from the side. Guide rings at the largest flame size show with it | Drawing aid |
| Going out | Heptane: the same sweep as the flat view (dark side moving across in 0.25 s), applied in 3D along one axis. Methanol: gone in one frame | As in the flat view |
| Lens and sensor | Bloom (strength 0.2), Khronos neutral tone mapping, a little grain | Drawing choice |
| Scale bar | CSS pixels per mm at the droplet's depth, updated as the view is turned or zoomed. Field of view is 30°, so perspective changes sizes little | Exact at the droplet |

Reduced motion: the simulation starts paused, and nothing moves while it is paused.

Checks run for the 3D view and the estimates: `npx tsc --noEmit` clean. In the Browser pane against `next dev` and the ml service: heptane on the ISS preset (ignition, mid-burn, cutaway, radiative retreat), Earth and Moon base (teardrop), 60% CO₂ (no visible soot), a 5 mm droplet (heavy soot), needles on, methanol mid-burn, switching to the camera view and back; ISS (sphere), Mars habitat with heptane and methanol (rounded egg), Earth with heptane and methanol (slender flame); two ISS frames half a second apart near extinction (pulsing). The flicker was checked on the earlier hand-made shape, not re-checked on this one. Not checked: phones and touch, browsers other than Chromium, reduced-motion mode, frame rate on low-end GPUs, the Docker images, `services/agent/test_graph.py` (the agent was not touched).

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
