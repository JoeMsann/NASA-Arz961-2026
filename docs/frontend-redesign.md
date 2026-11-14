# Frontend redesign: full-screen solar system, sidebar sections

Frontend only. No request path, request body or response handling changed, and nothing in `services/`, `pipeline/` or `data/` was touched.

## What changed

| Area | Change | Files |
| --- | --- | --- |
| Layout | The 3D scene fills the screen. Every tab opens in a right sidebar (closed on load; close with the same nav item, X or Esc). The backend alert is a toast, the data credit is a line at the bottom | `web/app/page.tsx`, `web/components/Sidebar.tsx`, `web/app/globals.css` |
| Navbar | Transparent bar with the tabs. `TABS` is still registered in `page.tsx`; each entry now also has `about`, the one-line question shown in the sidebar header | `web/components/NavBar.tsx`, `web/app/page.tsx` |
| Config window | Replaces `EnvPanel`. Top left, collapsible, plain-language sliders, facts and coverage verdict | `web/components/ConfigWindow.tsx` |
| Scene | Sun-centered solar system: all eight planets, the Moon, the asteroid belt, orbit lines. NASA maps where they exist, real day/night on Earth. Zoom, turn and move freely | `web/components/SpaceScene.tsx`, `web/components/scene/` |
| Textures | Twelve 2K JPGs with sources and licences | `web/public/textures/`, `CREDITS.md` there |
| Docker | The runtime image now copies `public/`, otherwise textures 404 | `web/Dockerfile` |

## Adding a tab

Same as before: one component in `web/components/`, one entry in `TABS` in `web/app/page.tsx`, one line in the `<Sidebar>` block below it.
The sidebar is about 560 px wide (full width on phones), so use single-column `grid` and the `chart` class for chart height. Card titles are `h3`; the sidebar header already shows the tab's name as `h2`.

## The scene is not to scale

True scale would leave every planet an invisible dot. Sizes keep the real order and compress the real ratios (radius = Earth's radius × real ratio ^ 0.7).
Distances from the Sun keep the real order only, and the Sun is drawn far smaller than it is. The constants and the rule are at the top of `web/components/scene/system.ts`.
Saturn, Uranus, Neptune, the Sun and the asteroid belt are drawn in code because no NASA global map was used for them; `CREDITS.md` lists which is which.

## How the camera frames things

- `.scene-safe` in `globals.css` is the part of the screen no overlay covers. CSS moves its edges when the config window or sidebar opens; the scene slides the picture to the middle of it.
- Until the user moves the camera, it also glides to a preset pose that fits that area: the home view (wide or tall) or the whole system. After the user zooms, turns or moves, only the slide happens. The home button restores the preset.
- Controls: drag to turn, scroll or pinch to zoom, right-drag or two fingers to move, arrow keys when the scene has focus, and four buttons bottom right.

## Checks that were run

- `npx tsc --noEmit` and `npm run build` in `web/`.
- A scripted pass in headless Chrome at 1440×900, 1024×768 and 390×844 against the dev server with the `ml` and `agent` containers up: all six tabs open, switch and close; all six places selectable by click and by pin; sliders, verdict, reset; the three hand-offs to other tabs, including Compare's "Ask PSI to explain the difference"; zoom, move and both preset views.
- Backend down: toast shows, scene renders, pins work.
- Reduced motion stops all animation; with WebGL disabled the six places show as plain buttons.

## Not checked

- **Browsers other than Chrome.** The framing relies on CSS `:has()`, which current Safari and Firefox support.
- **A live Groq answer.** No API key here, so Ask PSI was only seen in its evidence-only fallback.
- **Touch gestures on a real phone.** Pinch and two-finger move come from three.js `OrbitControls` and were not exercised by the scripted pass.
