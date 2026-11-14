import * as THREE from "three";
import { Textures, cellArt } from "./textures";

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const QUARTER = Math.PI / 2;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (r: number, len: number, sides = 14) => new THREE.CylinderGeometry(r, r, len, sides);
const dome = (r: number) => new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, QUARTER);
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 5, 12);

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], at: V3 = [0, 0, 0], turn: V3 = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...at); m.rotation.set(...turn);
  parent.add(m);
  return m;
}

/** A rod between two points. */
function rod(parent: THREE.Object3D, mat: THREE.Material, a: V3, b: V3, r: number) {
  const from = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(from);
  const m = new THREE.Mesh(cyl(r, dir.length(), 8), mat);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  parent.add(m);
}

/** Lit windows spaced around a dome. */
function windows(parent: THREE.Object3D, mat: THREE.Material, center: V3, r: number, angles: number[]) {
  for (const a of angles) part(parent, box(r * 0.22, r * 0.14, 0.012), mat, [center[0] + Math.sin(a) * r * 0.97, center[1] + r * 0.3, center[2] + Math.cos(a) * r * 0.97], [0, a, 0]);
}

/** Lowers each piece of a ground model so it sits on a sphere of the given radius instead of a flat plane. */
function settle(model: THREE.Group, sphereRadius: number) {
  for (const child of model.children) {
    const d2 = child.position.x ** 2 + child.position.z ** 2;
    child.position.y -= sphereRadius - Math.sqrt(sphereRadius ** 2 - d2);
  }
  return model;
}

const std = (color: number, roughness: number, metalness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

/** One shared palette for every model. */
export function createPalette(tex: Textures) {
  return {
    white: std(0xeef1f6, 0.55, 0.1),
    hull: std(0xd5dae3, 0.5, 0.2),
    metal: std(0x9aa3b2, 0.55, 0.3),
    dark: std(0x2a2f3a, 0.8, 0.2),
    gold: std(0xd9a441, 0.35, 0.6),
    foil: std(0xc98f3a, 0.5, 0.45),
    sand: std(0xd9b08a, 0.8, 0.05),
    cells: std(0xffffff, 0.4, 0.3, { map: tex.canvas(64, 128, cellArt), emissive: 0x16284f }),
    lamp: std(0xffe2a8, 0.6, 0, { emissive: 0xffc46b, emissiveIntensity: 1.8 }),
    glass: std(0x8fe0b0, 0.2, 0, { transparent: true, opacity: 0.55, emissive: 0x1e5a3a }),
  };
}
export type Palette = ReturnType<typeof createPalette>;

/** Space station: main truss, pressurized modules, eight solar array wings, radiators. X runs along the truss, Z along the modules. */
export function buildISS(p: Palette) {
  const g = new THREE.Group();

  part(g, box(4.4, 0.15, 0.15), p.metal);
  for (const x of [-1.8, -1.2, -0.6, 0.6, 1.2, 1.8]) part(g, box(0.08, 0.22, 0.22), p.dark, [x, 0, 0]);

  // Pressurized modules, back to front: service module, cargo block, node, laboratory, forward node.
  const y = -0.2;
  for (const [r, len, z] of [[0.17, 0.75, -1.05], [0.16, 0.7, -0.28], [0.17, 0.38, 0.3], [0.185, 0.78, 0.92], [0.17, 0.36, 1.52]]) part(g, cyl(r, len, 16), p.hull, [0, y, z], [QUARTER, 0, 0]);
  part(g, cyl(0.16, 0.55, 16), p.hull, [0.46, y, 1.52], [0, 0, QUARTER]);    // European laboratory
  part(g, cyl(0.175, 0.8, 16), p.hull, [-0.58, y, 1.52], [0, 0, QUARTER]);   // Japanese laboratory
  part(g, new THREE.ConeGeometry(0.15, 0.3, 16), p.white, [0, y, 1.86], [QUARTER, 0, 0]);   // docked crew capsule
  part(g, new THREE.SphereGeometry(0.12, 12, 8), p.foil, [0, y - 0.3, 0.3]);   // viewing cupola

  // Solar array wings: blue cells facing the sun, gold backing. Each pair is turned on the truss to catch the light.
  const wing = [p.dark, p.dark, p.cells, p.foil, p.dark, p.dark];
  for (const x of [-2.1, -1.55, 1.55, 2.1]) {
    const pair = new THREE.Group();
    pair.position.x = x; pair.rotation.x = x < 0 ? 0.5 : 0.35;
    for (const side of [-1, 1]) {
      part(pair, box(0.4, 0.014, 1.45), wing, [0, 0, side * 0.92]);
      part(pair, cyl(0.014, 1.45, 6), p.gold, [0, -0.016, side * 0.92], [QUARTER, 0, 0]);
    }
    g.add(pair);
  }
  // Smaller arrays on the two aft modules.
  for (const side of [-1, 1]) {
    part(g, box(0.75, 0.012, 0.2), wing, [side * 0.58, y, -1.05], [0.3, 0, 0]);
    part(g, box(0.6, 0.012, 0.18), wing, [side * 0.5, y, -0.28], [0.3, 0, 0]);
  }
  // Radiators: white panels hanging behind the truss.
  for (const x of [-0.95, 0.95]) for (const k of [-1, 0, 1]) part(g, box(0.19, 0.012, 0.85), p.white, [x + k * 0.21, 0.18, -0.52], [0.45, 0, 0]);
  return g;
}

/** Spacewalker: helmet with gold visor, life-support backpack, bent arms and legs. Faces +Z. */
export function buildSuit(p: Palette) {
  const g = new THREE.Group();
  part(g, capsule(0.26, 0.34), p.white, [0, 0.05, 0]);
  part(g, new THREE.SphereGeometry(0.24, 20, 16), p.white, [0, 0.58, 0]);
  part(g, new THREE.SphereGeometry(0.19, 20, 16), p.gold, [0, 0.58, 0.085]);
  part(g, box(0.46, 0.62, 0.22), p.hull, [0, 0.14, -0.3]);     // backpack
  part(g, box(0.24, 0.16, 0.1), p.metal, [0, 0.08, 0.26]);     // chest controls
  for (const s of [-1, 1]) {
    part(g, capsule(0.085, 0.2), p.white, [s * 0.38, 0.15, 0], [0, 0, s * 0.45]);       // upper arm
    part(g, capsule(0.075, 0.18), p.white, [s * 0.45, -0.08, 0.13], [-1.05, 0, 0]);     // forearm
    part(g, new THREE.SphereGeometry(0.085, 10, 8), p.dark, [s * 0.45, -0.17, 0.28]);   // glove
    part(g, capsule(0.105, 0.22), p.white, [s * 0.13, -0.49, 0.07], [-0.35, 0, 0]);     // thigh
    part(g, capsule(0.09, 0.22), p.white, [s * 0.13, -0.84, 0.05], [0.5, 0, 0]);        // shin
    part(g, box(0.15, 0.1, 0.25), p.dark, [s * 0.13, -1.05, -0.02], [0.5, 0, 0]);       // boot
  }
  return g;
}

/** Moon base: three domes and a buried module joined by tunnels, a landing pad with a lander, antenna and solar panels. */
export function buildMoonBase(p: Palette, moonRadius: number) {
  const g = new THREE.Group();
  const hub: V3 = [0, 0.04, 0], lab: V3 = [0.42, 0.04, 0.12], lock: V3 = [-0.06, 0.04, 0.42], bunk: V3 = [-0.4, 0.04, -0.12];
  part(g, dome(0.25), p.white);
  part(g, dome(0.16), p.white, [lab[0], 0, lab[2]]);
  part(g, dome(0.13), p.white, [lock[0], 0, lock[2]]);
  part(g, capsule(0.085, 0.3), p.hull, [bunk[0], 0.03, bunk[2]], [QUARTER, 0.5, 0]);
  for (const to of [lab, lock, bunk]) rod(g, p.metal, hub, to, 0.045);
  windows(g, p.lamp, [0, 0, 0], 0.25, [0.5, 1.6, 2.7, -0.6]);
  windows(g, p.lamp, [lab[0], 0, lab[2]], 0.16, [0.4, 1.9]);

  // Landing pad and lander.
  const pad: V3 = [0.3, 0.006, -0.42];
  part(g, cyl(0.2, 0.012, 24), p.dark, pad);
  part(g, new THREE.TorusGeometry(0.15, 0.008, 6, 24), p.lamp, [pad[0], 0.014, pad[2]], [QUARTER, 0, 0]);
  part(g, new THREE.CylinderGeometry(0.035, 0.06, 0.1, 8), p.foil, [pad[0], 0.09, pad[2]]);
  for (const a of [0.8, 2.4, 3.9, 5.5]) rod(g, p.metal, [pad[0], 0.07, pad[2]], [pad[0] + Math.cos(a) * 0.1, 0.012, pad[2] + Math.sin(a) * 0.1], 0.006);

  // Antenna mast with dish, and a row of solar panels.
  rod(g, p.metal, [-0.34, 0, 0.3], [-0.34, 0.3, 0.3], 0.008);
  part(g, new THREE.CylinderGeometry(0.07, 0.02, 0.03, 14), p.white, [-0.34, 0.31, 0.3], [0.5, 0, 0.3]);
  for (const k of [0, 1, 2]) part(g, box(0.11, 0.008, 0.16), p.cells, [-0.34 + k * 0.13, 0.06, -0.42], [-0.5, 0, 0]);
  return settle(g, moonRadius);
}

/** Rover: chassis, six wheels, pressurized cabin, camera mast and dish antenna. Drives along +X. */
export function buildRover(p: Palette) {
  const g = new THREE.Group();
  part(g, box(0.42, 0.035, 0.2), p.metal, [0, 0.095, 0]);
  part(g, capsule(0.075, 0.17), p.gold, [-0.03, 0.19, 0], [0, 0, QUARTER]);
  part(g, box(0.02, 0.06, 0.1), p.lamp, [0.125, 0.2, 0]);   // windshield glow
  for (const x of [-0.15, 0, 0.15]) for (const z of [-0.125, 0.125]) part(g, cyl(0.055, 0.045), p.dark, [x, 0.055, z], [QUARTER, 0, 0]);
  rod(g, p.metal, [0.17, 0.1, 0.06], [0.17, 0.37, 0.06], 0.008);
  part(g, box(0.06, 0.035, 0.045), p.white, [0.17, 0.385, 0.06]);
  rod(g, p.metal, [-0.16, 0.1, -0.05], [-0.16, 0.3, -0.05], 0.007);
  part(g, new THREE.CylinderGeometry(0.07, 0.02, 0.03, 14), p.white, [-0.16, 0.31, -0.05], [0.4, 0, -0.4]);
  return g;
}

/** Mars habitat cluster: main dome, two inflatable modules, greenhouse, solar field, antenna and an ascent rocket on its pad. */
export function buildMarsHabitat(p: Palette, marsRadius: number) {
  const g = new THREE.Group();
  const hub: V3 = [0, 0.045, 0], green: V3 = [0.4, 0.045, 0.2], east: V3 = [-0.4, 0.045, 0.14], north: V3 = [0.02, 0.045, -0.42];
  part(g, dome(0.28), p.white);
  part(g, dome(0.17), p.glass, [green[0], 0, green[2]]);
  part(g, capsule(0.1, 0.3), p.sand, [east[0], 0.04, east[2]], [QUARTER, 0.4, 0]);
  part(g, capsule(0.1, 0.3), p.sand, [north[0], 0.04, north[2]], [QUARTER, -1.2, 0]);
  for (const to of [green, east, north]) rod(g, p.metal, hub, to, 0.05);
  windows(g, p.lamp, [0, 0, 0], 0.28, [0.2, 1.3, 2.4, -0.9]);

  for (const k of [0, 1, 2]) part(g, box(0.12, 0.008, 0.18), p.cells, [-0.3 + k * 0.14, 0.07, 0.5], [-0.5, 0, 0]);
  rod(g, p.metal, [0.3, 0, -0.2], [0.3, 0.34, -0.2], 0.008);
  part(g, new THREE.CylinderGeometry(0.07, 0.02, 0.03, 14), p.white, [0.3, 0.35, -0.2], [0.5, 0, -0.3]);

  // Ascent rocket on its pad.
  const pad: V3 = [0.5, 0.006, -0.44];
  part(g, cyl(0.15, 0.012, 20), p.dark, pad);
  part(g, cyl(0.045, 0.22, 12), p.white, [pad[0], 0.15, pad[2]]);
  part(g, new THREE.ConeGeometry(0.045, 0.1, 12), p.foil, [pad[0], 0.31, pad[2]]);
  for (const a of [0.5, 2.6, 4.7]) rod(g, p.metal, [pad[0], 0.1, pad[2]], [pad[0] + Math.cos(a) * 0.09, 0.012, pad[2] + Math.sin(a) * 0.09], 0.007);
  return settle(g, marsRadius);
}
