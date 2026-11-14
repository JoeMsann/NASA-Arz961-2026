import * as THREE from "three";
import { atmosphere, buildGlobe, buildRings, GlobeLook } from "./planets";
import { Art, Textures, bandArt, moonArt, rng } from "./textures";

/**
 * The solar system the crew's places sit in. Nothing here is to true scale: that would leave every planet an invisible dot.
 * Sizes keep the real order and compress the real ratios (radius = Earth's radius × real ratio ^ 0.7).
 * Distances from the Sun keep the real order only. The Sun itself is drawn far smaller than it is.
 */
export const EARTH_R = 3.3, MOON_R = 1.33, MARS_R = 2.12, SUN_R = 12;
export const EARTH_ORBIT = 66, MARS_ORBIT = 80, BELT = { inner: 100, outer: 112 };

/** Position on a circular orbit around the Sun, which sits at the origin. Angle in degrees. */
export const onOrbit = (orbit: number, angle: number) => {
  const a = THREE.MathUtils.degToRad(angle);
  return new THREE.Vector3(orbit * Math.cos(a), 0, orbit * Math.sin(a));
};

interface Planet extends GlobeLook {
  label: string;
  orbit: number;
  angle: number;       // where on its orbit, degrees
  tilt: number;        // spin axis tilt, radians
  spin: number;        // radians per second
  air?: [color: number, thickness: number, strength: number];
  rings?: [inner: number, outer: number];   // in planet radii
}

const bands = (...colors: string[]): Art => bandArt(colors);
// The planets with no crewed place in this app. They are scenery: visible, named, not selectable.
const PLANETS: Planet[] = [
  { label: "Mercury", orbit: 30, angle: 160, radius: 1.69, tilt: 0, spin: 0.01, art: moonArt, seed: 7, color: "mercury_color.jpg", roughness: 0.95 },
  { label: "Venus", orbit: 46, angle: 75, radius: 3.18, tilt: 0.05, spin: -0.006, art: bands("#c9772a", "#e6a04a", "#d98a35", "#e6a04a", "#c9772a"), color: "venus_color.jpg", air: [0xffc98a, 0.05, 0.7] },
  { label: "Jupiter", orbit: 146, angle: 50, radius: 17.9, tilt: 0.05, spin: 0.05, art: bands("#8c8376", "#cdbfa6", "#b98f66", "#e2d6c0", "#b0825c", "#d9ccb4", "#8c8376"), color: "jupiter_color.jpg" },
  { label: "Saturn", orbit: 204, angle: -160, radius: 15.9, tilt: 0.47, spin: 0.045, art: bands("#a39269", "#d8c690", "#e6d7a8", "#cbb47c", "#e3d3a0", "#b9a574", "#a39269"), seed: 5, rings: [1.25, 2.3] },
  { label: "Uranus", orbit: 254, angle: 115, radius: 8.7, tilt: 1.71, spin: 0.03, art: bands("#9fdde2", "#b9eaed", "#a6e1e5", "#b9eaed", "#9fdde2"), seed: 3 },
  { label: "Neptune", orbit: 296, angle: -100, radius: 8.5, tilt: 0.49, spin: 0.03, art: bands("#2a49b8", "#3f69dc", "#3458c8", "#4472e2", "#2a49b8"), seed: 4 },
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

/** Sun-centered scenery: orbit lines, the asteroid belt and the six planets without a crewed place. */
export function buildSolarSystem(tex: Textures, pixelRatio: number) {
  const group = new THREE.Group();
  const spinning: { mesh: THREE.Object3D; speed: number }[] = [];
  const landmarks: Landmark[] = [];

  const belt = buildBelt(pixelRatio);
  spinning.push({ mesh: belt, speed: 0.004 });
  const beltTag = new THREE.Object3D();
  beltTag.position.copy(onOrbit((BELT.inner + BELT.outer) / 2, -35));
  landmarks.push({ label: "Asteroid belt", anchor: beltTag, radius: 2 });
  group.add(buildOrbitLines([...PLANETS.map((p) => p.orbit), EARTH_ORBIT, MARS_ORBIT]), belt, beltTag);

  for (const planet of PLANETS) {
    const home = new THREE.Group();
    home.position.copy(onOrbit(planet.orbit, planet.angle));
    const axis = new THREE.Group();
    axis.rotation.z = planet.tilt;
    const globe = buildGlobe(tex, planet);
    axis.add(globe);
    if (planet.rings) axis.add(buildRings(tex, planet.radius * planet.rings[0], planet.radius * planet.rings[1]));
    home.add(axis);
    if (planet.air) home.add(atmosphere(planet.radius, planet.air[1], planet.air[0], planet.air[2], home.position.clone().negate().normalize()));
    spinning.push({ mesh: globe, speed: planet.spin });
    landmarks.push({ label: planet.label, anchor: home, radius: planet.radius });
    group.add(home);
  }
  return { group, spinning, landmarks };
}
