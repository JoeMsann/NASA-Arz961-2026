import * as THREE from "three";
import { Textures, galaxyArt, glowArt, rng, sunSurfaceArt } from "./textures";

const SKY_R = 6000;
// Rough star colors, from blue-white to orange.
const TINTS = [[0.72, 0.8, 1], [0.88, 0.92, 1], [1, 1, 1], [1, 0.95, 0.84], [1, 0.84, 0.66]];

/**
 * Milky Way backdrop plus stars of varied size, brightness and color. A third of the stars crowd the galactic band.
 * Keep the returned group at the camera's position so the sky never gets closer.
 */
export function buildSky(tex: Textures, pixelRatio: number) {
  const sky = new THREE.Group();
  sky.rotation.set(0.5, 0.3, 1.05);   // tilt the galactic band so it crosses the view diagonally

  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_R, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex.canvas(256, 128, galaxyArt, 9), side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  backdrop.renderOrder = -2;   // drawn first, behind everything

  const r = rng(3), n = 7000;
  const pos = new Float32Array(n * 3), tint = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const inBand = i % 3 === 0;
    const lon = r() * Math.PI * 2;
    const lat = inBand ? (r() + r() + r() - 1.5) * 0.22 : Math.asin(r() * 2 - 1);
    pos.set([Math.cos(lat) * Math.cos(lon) * SKY_R * 0.98, Math.sin(lat) * SKY_R * 0.98, Math.cos(lat) * Math.sin(lon) * SKY_R * 0.98], i * 3);
    const bright = Math.pow(r(), 4);   // most stars faint, a few bright
    const c = TINTS[Math.floor(r() * TINTS.length)], gain = 0.35 + 0.65 * bright;
    tint.set([c[0] * gain, c[1] * gain, c[2] * gain], i * 3);
    size[i] = (inBand ? 1 : 1.3) + bright * 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const stars = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { scale: { value: pixelRatio } },
    vertexShader: /* glsl */`
      attribute vec3 tint;
      attribute float size;
      uniform float scale;
      varying vec3 vTint;
      void main() {
        vTint = tint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vTint;
      void main() {
        float glow = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vTint * glow, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
  }));
  stars.renderOrder = -1;
  sky.add(backdrop, stars);
  return sky;
}

/** The Sun at the middle of the system: a glowing ball with a soft halo that fades out at `glowRadius`. Not to scale with the planets. */
export function buildSun(tex: Textures, radius: number, glowRadius: number) {
  const sun = new THREE.Group();
  sun.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), new THREE.MeshBasicMaterial({ map: tex.canvas(512, 256, sunSurfaceArt, 31), toneMapped: false })));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.canvas(256, 256, glowArt), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
  glow.scale.setScalar(glowRadius * 2);
  sun.add(glow);
  return sun;
}
