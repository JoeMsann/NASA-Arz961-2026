import * as THREE from "three";
import { atmosphere, buildGlobe, buildRings, GlobeLook } from "./planets";
import { Art, Textures, bandArt, moonArt, rng } from "./textures";

/**
 * The solar system the crew's places sit in. Nothing here is to true scale: that would leave every planet an invisible dot.
 * Sizes keep the real order and compress the real ratios (radius = Earth's radius × real ratio ^ 0.7). The Sun is the
 * exception: that rule would give it radius 88 and swallow the inner orbits, so it is drawn at 25, still the largest body
 * (Jupiter is 17.9). Its glow fades out before Earth's orbit. Distances from the Sun keep the real order only.
 */
export const EARTH_R = 3.3, MOON_R = 1.33, MARS_R = 2.12, SUN_R = 25, SUN_GLOW = 60;
export const BELT = { inner: 100, outer: 112 };

/**
 * Motion. Every orbit and every spin runs counterclockwise seen from the north (+Y), as in the real system, except the
 * backward spins of Venus and Uranus (a negative `day`). Periods are the real sidereal ones (NASA planetary fact sheets),
 * so their ratios are real, but on two clocks: orbits run one day per second (Earth's year takes about 6 minutes),
 * spins run one day per 40 seconds (on the orbit clock Earth would turn once a second).
 */
export const ORBIT_DAY = 1, SPIN_DAY = 40;
const TURN = Math.PI * 2;
/** Angle along an orbit `t` seconds into the animation, in radians counterclockwise seen from the north. Start angle in degrees. */
export const orbitAngle = (startDeg: number, yearDays: number, t: number) => THREE.MathUtils.degToRad(startDeg) + (TURN * t) / (yearDays * ORBIT_DAY);
/** How far a body has turned about its own axis `t` seconds into the animation. A negative day is a backward spin. */
export const spinAngle = (dayDays: number, t: number) => (TURN * t) / (dayDays * SPIN_DAY);
/** Position on a circular orbit around the Sun, which sits at the origin. Angle in radians, counterclockwise seen from the north. */
export const orbitPos = (orbit: number, angle: number, out = new THREE.Vector3()) => out.set(orbit * Math.cos(angle), 0, -orbit * Math.sin(angle));

/** Orbit radius, start angle (degrees), year and day (Earth days) and axial tilt (degrees) of a planet. */
export interface Motion { orbit: number; angle: number; year: number; day: number; tilt: number }
// Mars starts just behind Earth. Earth is faster, so it pulls ahead; the two line up again every 780 days (13 minutes here).
export const EARTH: Motion = { orbit: 66, angle: 0, year: 365.256, day: 0.99727, tilt: 23.44 };
export const MARS: Motion = { orbit: 80, angle: -4.2, year: 686.98, day: 1.02596, tilt: 25.19 };
/**
 * The Moon: distance from Earth's center, start angle, orbit period (days) and orbit tilt to Earth's orbit (degrees).
 * It turns once per orbit, so it always shows Earth the same face, as the real Moon does.
 */
export const MOON = { distance: 7.2, angle: -23, year: 27.3217, inclination: 5.145 };
export const SUN_DAY = 25.38;   // the Sun's spin at its equator

interface Planet extends GlobeLook, Motion {
  label: string;
  air?: [color: number, thickness: number, strength: number];
  rings?: [inner: number, outer: number];   // in planet radii
}

const bands = (...colors: string[]): Art => bandArt(colors);
// The planets with no crewed place in this app. They are scenery: visible, named, not selectable.
// Venus and Uranus are given as a small tilt with a backward spin: the same motion as their real tilts of 177° and 98°.
const PLANETS: Planet[] = [
  { label: "Mercury", orbit: 40, angle: -235, year: 87.969, day: 58.646, tilt: 0.03, radius: 1.69, art: moonArt, seed: 7, color: "mercury_color.jpg", roughness: 0.95 },
  { label: "Venus", orbit: 52, angle: -75, year: 224.701, day: -243.025, tilt: 2.64, radius: 3.18, art: bands("#c9772a", "#e6a04a", "#d98a35", "#e6a04a", "#c9772a"), color: "venus_color.jpg", air: [0xffc98a, 0.05, 0.7] },
  { label: "Jupiter", orbit: 146, angle: -50, year: 4332.59, day: 0.41354, tilt: 3.13, radius: 17.9, art: bands("#8c8376", "#cdbfa6", "#b98f66", "#e2d6c0", "#b0825c", "#d9ccb4", "#8c8376"), color: "jupiter_color.jpg" },
  { label: "Saturn", orbit: 204, angle: 160, year: 10759.22, day: 0.44401, tilt: 26.73, radius: 15.9, art: bands("#a39269", "#d8c690", "#e6d7a8", "#cbb47c", "#e3d3a0", "#b9a574", "#a39269"), seed: 5, rings: [1.25, 2.3] },
  { label: "Uranus", orbit: 254, angle: -115, year: 30688.5, day: -0.71833, tilt: 82.23, radius: 8.7, art: bands("#9fdde2", "#b9eaed", "#a6e1e5", "#b9eaed", "#9fdde2"), seed: 3 },
  { label: "Neptune", orbit: 296, angle: 100, year: 60195, day: 0.67125, tilt: 28.32, radius: 8.5, art: bands("#2a49b8", "#3f69dc", "#3458c8", "#4472e2", "#2a49b8"), seed: 4 },
];

/** A named point in the scene that gets a text label. */
export interface Landmark { label: string; anchor: THREE.Object3D; radius: number }
/** Labels of the scenery, in the order `buildSolarSystem` returns its landmarks. */
export const SCENERY = ["Asteroid belt", ...PLANETS.map((p) => p.label)];

function buildOrbitLines(radii: number[]) {
  const pts: number[] = [];
  for (let i = 0; i < 256; i++) pts.push(Math.cos((i / 256) * Math.PI * 2), 0, Math.sin((i / 256) * Math.PI * 2));
  const circle = new THREE.BufferGeometry();
  circle.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.16, depthWrite: false });
  const lines = new THREE.Group();
  for (const r of radii) {
    const line = new THREE.LineLoop(circle, mat);
    line.scale.setScalar(r);
    lines.add(line);
  }
  return lines;
}

/** Asteroid belt between Mars and Jupiter: tumbling rocks for close views, plus fine dust that keeps the band visible from far away. */
function buildBelt(pixelRatio: number) {
  const r = rng(77), belt = new THREE.Group();
  const spot = (out: THREE.Vector3) => {
    const a = r() * Math.PI * 2, d = BELT.inner + (BELT.outer - BELT.inner) * (r() + r()) / 2;
    return out.set(Math.cos(a) * d, (r() + r() - 1) * 1.8, Math.sin(a) * d);
  };

  const count = 2200;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x6f685f, roughness: 1, metalness: 0, flatShading: true }), count);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const size = 0.05 + 0.25 * r() ** 3;
    q.setFromEuler(e.set(r() * 6, r() * 6, r() * 6));
    rocks.setMatrixAt(i, m.compose(spot(p), q, s.set(size, size * (0.6 + 0.4 * r()), size * (0.6 + 0.4 * r()))));
  }

  const dust = new Float32Array(3000 * 3);
  for (let i = 0; i < dust.length; i += 3) spot(p).toArray(dust, i);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
  belt.add(rocks, new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xa39a8c, size: 1.2 * pixelRatio, sizeAttenuation: false, transparent: true, opacity: 0.45, depthWrite: false })));
  return belt;
}

/** Sun-centered scenery: orbit lines, the asteroid belt and the six planets without a crewed place. `update(t)` moves them `t` seconds into the animation. */
export function buildSolarSystem(tex: Textures, pixelRatio: number) {
  const group = new THREE.Group();
  const landmarks: Landmark[] = [];
  const movers: ((t: number) => void)[] = [];

  // The belt turns as one ring, at the period of its middle (about 4.6 years at 2.8 times Earth's distance).
  const belt = buildBelt(pixelRatio);
  movers.push((t) => { belt.rotation.y = orbitAngle(0, 1680, t); });
  const beltTag = new THREE.Object3D();
  orbitPos((BELT.inner + BELT.outer) / 2, THREE.MathUtils.degToRad(35), beltTag.position);
  landmarks.push({ label: "Asteroid belt", anchor: beltTag, radius: 2 });
  group.add(buildOrbitLines([...PLANETS.map((p) => p.orbit), EARTH.orbit, MARS.orbit]), belt, beltTag);

  for (const planet of PLANETS) {
    const home = new THREE.Group();   // moves along the orbit without turning, so the spin axis keeps pointing the same way
    const axis = new THREE.Group();
    axis.rotation.z = THREE.MathUtils.degToRad(planet.tilt);
    const globe = buildGlobe(tex, planet);
    axis.add(globe);
    if (planet.rings) axis.add(buildRings(tex, planet.radius * planet.rings[0], planet.radius * planet.rings[1]));
    home.add(axis);
    const air = planet.air && atmosphere(planet.radius, planet.air[1], planet.air[0], planet.air[2], new THREE.Vector3());
    if (air) home.add(air);
    movers.push((t) => {
      orbitPos(planet.orbit, orbitAngle(planet.angle, planet.year, t), home.position);
      globe.rotation.y = spinAngle(planet.day, t);
      if (air) sunFrom(home.position, air.material.uniforms.sunDir.value);
    });
    landmarks.push({ label: planet.label, anchor: home, radius: planet.radius });
    group.add(home);
  }
  const update = (t: number) => { for (const move of movers) move(t); };
  update(0);
  return { group, landmarks, update };
}

/** Direction from a point toward the Sun at the origin. */
export const sunFrom = (p: THREE.Vector3, out = new THREE.Vector3()) => out.copy(p).negate().normalize();
