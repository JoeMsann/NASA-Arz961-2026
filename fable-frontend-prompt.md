# Task: Redesign the Flame in Freefall frontend (frontend only)

You are working in the repo `NASA-Arz961-2026`. This is our NASA Space Apps 2026 entry, challenge "Flame in Freefall". The web app lives in `web/` (Next.js App Router, React, raw three.js, Recharts). Do the whole job in one pass, then verify it builds.

## Hard rules

1. **Frontend only.** Do not touch `services/`, `pipeline/`, `docker-compose.yml`, or `web/app/api/svc/[svc]/[...path]/route.ts`. Do not change any request path, request body, or response handling in `web/lib/api.ts`. Every component must keep calling the same endpoints with the same data.
2. **No package upgrades.** Keep `next ^15.1`, `react ^19`, `three ^0.187`, `recharts ^2.15` exactly as pinned. Do not add React Three Fiber, drei, Tailwind, or any UI library. Plain CSS in `web/app/globals.css` (you may reorganize it).
3. **Keep raw three.js** in `web/components/SpaceScene.tsx`. Upgrade it, do not rewrite it in another library.
4. **Keep all existing features and text that matters:** the backend-down alert (`docker compose up` hint), the footer data credit and "research aid only, not flight-safety guidance" disclaimer, the "Ask PSI about this environment" handoff from Navigator to Ask PSI, and the Earth "See what this research gave Earth" button.
5. Clean, small components. No dead code, no commented-out old layout. Keep accessibility (aria roles, focus-visible, reduced-motion, the no-WebGL fallback).

## Current structure (read these first)

- `web/app/page.tsx`: state owner. Loads environments (`api("ml","environments")`), holds `id`, `edit`, `atmos`, `nav` (debounced `api("ml","navigator", atmos)`), `tab`, `question`. Renders header, hero (`SpaceScene` + `EnvPanel`), a tab bar, then the active tab, then footer.
- Tabs: `nav` Habitat risk navigator (`Navigator`), `predict` Flame predictor (`Predictor`), `ask` Ask PSI (`AskPsi`), `table` Unified test table (`TestTable`), `earth` Earth benefits (`EarthBenefits`).
- `web/components/EnvPanel.tsx`: the right-side "configuration box": environment name, blurb, 4 stats (O₂ %, psi, gravity, psi O₂), O₂ and pressure sliders, reset, coverage verdict, Earth button.
- `web/components/SpaceScene.tsx`: Earth + clouds + atmosphere shell, ISS on an orbit ring, spacewalking suit, Moon with base dome and rover, Mars with habitat. Canvas-drawn textures, HTML label pins projected each frame, raycast picking (smallest target wins), selection halo, OrbitControls with limited angles, zoom disabled.

Keep `page.tsx` as the single state owner. Move layout, not logic.

## Requirement 1: Space view is the whole home screen

- `SpaceScene` fills the full viewport (`100vw × 100dvh`, fixed, behind everything). No card border, no fixed 460px height.
- Remove the old header block, hero grid, and bottom tab content area. The page has no vertical scroll at the top level.
- Every section opens in a **right sidebar** that overlays the scene.
  - Starts **closed** on load. The scene is the first thing users see.
  - Opens when a navbar item is clicked. Clicking the active item again, the sidebar's close (X) button, or pressing `Esc` closes it.
  - Width about `min(560px, 92vw)`, full height under the navbar, its own vertical scroll, slide-in from the right (no animation when `prefers-reduced-motion`).
  - Semi-opaque dark panel with backdrop blur so the scene shows through faintly.
  - Header row inside it: section title + one-line description of what the section answers + close button.
  - When the sidebar is open, the scene stays interactive in the visible area. Optionally shift the camera target slightly left so the selected body is not hidden behind the panel.
- Section content must fit the narrower width. Today `.g2` uses `minmax(420px,1fr)` and `.g3` `minmax(300px,1fr)`, and the Navigator chart is 430px tall. Inside the sidebar make these grids single column and make charts fit the width. Check every section at 560px and at 360px wide.
- Backend-down alert: show as a small fixed toast/banner near the top center, under the navbar, not inside the sidebar.
- Footer: becomes a small, low-contrast line fixed at the bottom left or bottom center of the scene. Keep the full text (it can wrap or sit behind a small "About the data" toggle, your call, but the disclaimer must be visible without clicking).

## Requirement 2: More detailed space view (real NASA textures)

Upgrade the scene in place. Target: looks like a polished space visualization, still loads fast.

- **Textures:** download public-domain imagery into `web/public/textures/` and load it with `THREE.TextureLoader`:
  - Earth: NASA Visible Earth "Blue Marble" color map, a night-lights map (Black Marble), a clouds map, and a bump or normal map plus a specular/ocean mask if you can find NASA sources.
  - Moon: NASA SVS "CGI Moon Kit" (LRO color map + displacement/elevation map).
  - Mars: a NASA/USGS Astrogeology global color mosaic, plus elevation (MOLA) for bump if available.
  - Use 2K maps (4K max for Earth color). Convert to JPG, keep the whole `textures/` folder under about 15 MB.
  - Write `web/public/textures/CREDITS.md` with each file's source URL and license. Only use NASA/USGS public-domain sources. If something is not clearly public domain, do not use it.
  - **If your environment cannot download files:** keep the current procedural canvas textures as a fallback that loads automatically when an image fails, and list the exact URLs and target filenames in `CREDITS.md` so we can download them by hand. Do not invent URLs: only list ones you have verified exist.
- **Earth:** day/night blend on the dark side (city lights), clouds on a separate slowly rotating layer, Fresnel-style atmosphere rim glow (small custom shader or `onBeforeCompile`), subtle ocean specular.
- **Moon / Mars:** bump or displacement detail, correct roughness. Mars gets a thin reddish atmosphere rim.
- **Sun and space:** one directional sun with a soft glow sprite or lens flare at the light direction, a better starfield (varied size, brightness and slight color, plus a faint Milky Way band), proper tone mapping (`ACESFilmicToneMapping`) and `SRGBColorSpace` output.
- **Models (procedural, no glTF):** rebuild the ISS with recognizable parts (main truss, pressurized modules, large gold/blue solar array wings, radiators), a more human spacesuit (helmet with gold visor, backpack, arms and legs), a Moon base with several domes/modules and a landing pad, a rover with chassis, 6 wheels, mast and antenna, and a Mars habitat cluster. Keep them small and low-poly enough to stay smooth.
- **Keep all existing behavior:** same 6 selectable ids (`earth`, `iss`, `suit`, `moon_base`, `rover`, `mars`), same click picking and halo, label pins that follow the bodies, drag to look around, reduced-motion stops animation, no-WebGL fallback still shows clickable pins, full cleanup on unmount (dispose geometries, materials, all textures).
- Performance: keep `setPixelRatio(min(dpr, 2))`, avoid per-frame allocations (the current loop creates `new THREE.Vector3()` inside the label loop: reuse one), target 60 fps on a normal laptop.

## Requirement 3: Configuration window, top left, simpler and explained

Replace the right-side `EnvPanel` with a small floating window at the **top left**, under the navbar.

- Collapsible: a compact header (selected environment name + coverage status dot) that expands to the full controls. Default expanded on desktop, collapsed on screens under 820px.
- Simpler content, in this order:
  1. **"You are looking at"**: one or two plain sentences, for example: "Places where astronauts live and work. Click Earth, the ISS, a spacewalker, the Moon base, the rover or the Mars habitat to pick one." Then the selected place name and its blurb.
  2. **Two sliders**: Oxygen (%) and Cabin pressure (psi), each with a one-line plain explanation under it (what changing it means for fire: more oxygen or more pressure usually makes flames easier to start and spread). Keep the same ranges and steps as now (O₂ 10 to 100, step 0.5; pressure 3 to 20, step 0.1).
  3. **Small read-only facts row**: gravity and oxygen partial pressure (psi O₂), each with a short tooltip or helper text explaining it in plain words.
  4. **Coverage verdict** (same `nav` data as now) in plain language: "NASA flew N fire tests near these conditions" or "No NASA flight test is this close. The nearest is X steps away (1 step = 5 oxygen points or 2 psi)." Plus a link-style button "See details" that opens the Habitat risk navigator in the sidebar.
  5. "Reset to preset" when edited, otherwise show the preset basis in small text.
  6. Earth only: "See what this research gave Earth" opens the Earth benefits sidebar section.
- Short, plain words. No jargon without a one-line explanation.
- Same props/state wiring as `EnvPanel` today (`env`, `atmos`, `edited`, `nav`, `onEdit`, `onReset`, plus a callback to open a sidebar section). Rename the component if it helps clarity (e.g. `ConfigWindow`).
- Remove the old floating "Drag to look around · click a place" hint from the scene corner, or fold it into this window.

## Requirement 4: Transparent top navbar drives the sidebar

- Fixed navbar across the top, transparent (very light gradient from the top for legibility, no solid bar), over the scene.
- Left: app name "Flame in Freefall". Right or center: the 5 section buttons, same labels and same order as `TABS` today.
- Clicking a section opens the sidebar on that section. Clicking another section switches the sidebar content. Clicking the active one closes it. The active item has a clear highlight (use the existing orange accent).
- Keep `role="tablist"` / `role="tab"` / `aria-selected`, and give the sidebar `role="tabpanel"` with `aria-labelledby`. Move focus into the sidebar when it opens and back to the nav item when it closes.
- Internal handoffs must open the right section: Navigator's "Ask PSI about this environment" opens `ask` with the seeded question (same `ask()` logic as now), config window "See details" opens `nav`, Earth button opens `earth`.
- Mobile (under 820px): nav items collapse into a menu button or a horizontally scrollable row, and the sidebar becomes full width.

## State change in page.tsx

Replace `tab: Tab` (always set) with `open: Tab | null` (null = sidebar closed). Everything else in `page.tsx` (env loading, debounce, `atmos` memo, `select`, `ask`) stays the same in behavior.

## Look and feel

- Keep the existing dark palette and CSS variables (`--bg`, `--panel`, `--orange`, `--blue`, `--ok`, `--bad`, etc.). Glass panels: dark, semi-transparent, `backdrop-filter: blur`, thin `--line` border, 12px radius.
- One consistent spacing scale and type scale. System font is fine.
- The scene is the hero: overlays stay compact and never cover the center of the view on desktop.

## Infra note (web only)

`web/next.config.mjs` uses `output: 'standalone'`, and `web/Dockerfile` does not copy `public/` into the runtime image, so textures would 404 in Docker. Add `COPY --from=build /app/public ./public` to the runtime stage of `web/Dockerfile`. This is the only allowed non-component change outside `web/app`, `web/components`, `web/public`.

## Done means

Run these in `web/` and fix everything until they pass:

1. `npm ci` (or `npm install` without changing versions) then `npx tsc --noEmit` with zero errors.
2. `npm run build` succeeds.
3. Start `npm run dev` and check, with the backend down (alert toast shows, scene still renders, pins clickable) and, if you can run `docker compose up`, with it up:
   - Page loads to a full-screen scene, sidebar closed, no page scroll.
   - Each of the 5 nav items opens its section; switching and closing (same item, X, Esc) work.
   - Clicking each of the 6 bodies selects it; config window and navigator update.
   - Sliders change values and the verdict updates; reset works.
   - "Ask PSI about this environment" opens Ask PSI with the question filled in.
   - Layout works at 1440×900, 1024×768 and 390×844.
   - No console errors, textures load (or the fallback works and CREDITS.md lists the URLs).
4. `git diff --stat` shows no changes in `services/`, `pipeline/`, `docker-compose.yml`, `web/app/api/`, `web/lib/api.ts` request logic, or `web/package.json` dependency versions.

Finish with a short summary: files changed, where each requirement lives, texture sources, anything you could not do and why.
