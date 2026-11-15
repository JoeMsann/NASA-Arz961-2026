# Planet motion: orbits, spins and a camera that follows

Frontend only. Nothing in `services/`, `pipeline/` or `data/` was touched.

## What it does

- Every planet goes around the Sun and turns on its own axis, counterclockwise as seen from the north, like the real system. Venus and Uranus spin backwards.
- Earth and Mars are no longer placed side by side. Each one moves on its own orbit. Earth is faster, so it pulls ahead of Mars, and the two line up again every 780 days.
- The Moon goes around Earth on an orbit tilted 5° to Earth's orbit. It turns once per orbit, so the near side, where the base and the rover are, always faces Earth.
- The Sun turns too (25.4 days at its equator), and the asteroid belt turns as one ring.
- Spin axes keep their real tilts and keep pointing the same way all year.

## The clocks

The periods are the real sidereal ones from NASA's planetary fact sheets, so the ratios between them are real. One clock for both would not work: either Earth spins once a second or its year takes hours. So there are two clocks:

| What | Clock | Examples |
| --- | --- | --- |
| Orbits (and the Moon's turn, which follows its orbit) | 1 day per second | Moon 27 s, Earth 6 min, Mars 11.5 min, Neptune 17 h |
| Spins | 1 day per 40 seconds | Jupiter 17 s, Earth 40 s, Mars 41 s, Venus 2.7 h (backwards) |

The station's orbit around Earth keeps its old speed (31 s per lap). It is not on either clock.

## The camera

Because everything moves, the camera follows the body of the selected place: Earth for Earth, the ISS and the spacesuit, the Moon for the base and the rover, Mars for the habitat. It moves with that body and turns with it around the Sun, so the lit side stays toward the camera. The Moon is the exception: the camera moves with it but keeps Earth's heading, so you see the Moon turn.

- Selecting a place on another body flies the camera there. Selecting another place on the same body leaves the camera alone.
- The home button goes back to the selected place's view. The system button shows every orbit and follows nothing.
- After the user drags, zooms or moves the camera, it still follows the body.
- Reduced motion: nothing moves. The bodies stay at their starting positions.

## Files

| File | Change |
| --- | --- |
| `web/components/scene/system.ts` | Real periods and tilts, the two clocks, `orbitAngle`, `spinAngle`, `orbitPos`, and `update(t)` for the six scenery planets and the belt |
| `web/components/SpaceScene.tsx` | Earth, Moon and Mars move each frame; camera poses per body; `follow` |
| `web/components/scene/planets.ts` | `buildEarth` takes the axial tilt |

## How to check it

`cd web && npm run dev`, open http://localhost:3000 and watch for a minute. Earth turns, the Moon goes around Earth with the same face toward it, and Mars falls behind and leaves the view. Select the Moon base, then the Mars habitat, then the system view, then home.

## Checks that were run

- `npx tsc --noEmit` in `web/`.
- Headless Chrome in real time against `next dev`, at 1440×900 and 390×844, with the backend down: the home view at 0, 11, 20 and 45 s; selecting the Mars habitat and the Moon base by their pins; the system view and the home button.

## Not checked

- Browsers other than Chrome, real phones and touch, low-end GPUs.
- Long sessions (beyond a minute or two), and reduced-motion mode.
- The Docker image.
