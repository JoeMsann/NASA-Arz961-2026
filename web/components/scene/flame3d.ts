import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// The Predictor's droplet burn in 3D. Like the flat drawing in FlameSim.tsx it only draws numbers the ml service computed
// (droplet and flame diameters, brightness, soot glow, how the flame goes out); docs/flame-simulation.md has the physics.
// One scene unit is one millimetre, so the picture stays to scale from any angle.
//
// The flame is drawn the way a camera would see glowing gas: every pixel adds up the light along its line of sight through
// the flame (ray marching), in high dynamic range, and bright areas bleed a little as they do in a real lens (bloom).

export type Fuel = "Heptane" | "Methanol";
export type FlameFrame = {
  fuel: Fuel;
  d: number;              // droplet diameter, mm
  df: number;             // flame diameter, mm (0 = no flame)
  lum: number;            // relative brightness, 0 to 1
  soot: number;           // soot glow just after ignition, 0 to 1
  retreat: number | null; // radiative extinction: 0 to 1 through the retreat, null otherwise
  dfMax: number;          // largest flame diameter in this burn, for the reference rings
  cut: boolean;           // show only half of the flame, so its distance from the droplet can be seen from the side
};
export type FlameScene = {
  frame(f: FlameFrame): void;
  fit(fovMm: number): void;       // frame the camera so fovMm fills the shorter side of the view
  pxPerMm(): number;              // CSS pixels per millimetre at the droplet's depth
  onView(cb: () => void): void;   // called when the user turns or zooms the view
  dispose(): void;
};

// Blue of the reaction zone: heptane's from CH and C2 radicals, methanol's fainter and paler.
export const BLUE: Record<Fuel, [number, number, number]> = { Heptane: [80, 130, 255], Methanol: [140, 152, 255] };
export const SHELL = 0.25;   // glowing shell thickness as a fraction of the flame radius (a drawing choice, not data)
// Refractive index of the liquid, which sets how the droplet bends and reflects the flame's light (handbook values at 20 C).
const INDEX: Record<Fuel, number> = { Heptane: 1.39, Methanol: 1.33 };
const BG = 0x020306;
const FOV_Y = 30;            // degrees; narrow, so perspective barely distorts sizes
const BOUND = 1.3;           // the gas is marched out to this many flame radii
// The reaction zone glows most at RC flame radii and fades to either side (Gaussian, width SIG). Together they fill the same
// band as the flat drawing's shell, 0.75 to 1 flame radius, and give the same contrast between rim and centre (about 2.6).
const RC = 1 - SHELL / 2, SIG = 0.07;

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Everything in this shader is in flame radii: the flame's outer edge is r = 1 and the droplet sits at the centre.
// Blue gas only emits. Soot emits and also blocks what is behind it, so the result carries an alpha (premultiplied).
const GAS_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform float uR;        // flame radius, mm
  uniform float uDrop;     // droplet radius, flame radii
  uniform vec3 uColor;     // linear RGB of the reaction zone
  uniform float uLum; uniform float uSoot; uniform float uTime;
  uniform float uEdge;     // extinction sweep position along x (10 = none)
  uniform float uCut;      // 1 = only the half with x < 0
  const int STEPS = 80;
  const float BOUND = ${BOUND.toFixed(3)}, RC = ${RC.toFixed(4)}, SIG = ${SIG.toFixed(4)};

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.7) + 0.15 * noise(p * 4.3 - 1.3); }

  void main() {
    vec3 ro = cameraPosition / uR, rd = normalize(vWorld - cameraPosition);
    float b = dot(ro, rd), c = dot(ro, ro);
    float h = b * b - (c - BOUND * BOUND);
    if (h < 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0), t1 = -b + h;
    float hd = b * b - (c - uDrop * uDrop);          // the droplet hides the gas behind it
    if (hd > 0.0 && -b - sqrt(hd) > 0.0) t1 = min(t1, -b - sqrt(hd));
    if (t1 <= t0) discard;

    float dt = (t1 - t0) / float(STEPS);
    // start each ray at a slightly different depth, so the steps do not show as rings
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 inner = mix(uColor, vec3(0.30, 0.78, 1.0), 0.35);   // the fuel side of a hydrocarbon flame is a little greener
    vec3 sum = vec3(0.0);
    float trans = 1.0;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
      float r = length(p);
      float keep = (1.0 - smoothstep(uEdge - 0.3, uEdge, p.x)) * (uCut > 0.5 ? step(p.x, 0.0) : 1.0);
      if (keep <= 0.0) continue;
      float x = (r - RC) / SIG;
      vec3 emit = mix(inner, uColor, smoothstep(-1.0, 1.0, x)) * exp(-x * x) * 0.9 * uLum;
      float dens = 0.0;
      if (uSoot > 0.01) {
        // soot gathers between the droplet and the flame and glows by its own heat: yellow-white where it is hottest
        // (near the flame), deep orange nearer the cool droplet
        float s = (r - 0.52) / 0.2;
        dens = exp(-s * s) * uSoot * (0.45 + 1.1 * fbm(p * 3.2 + vec3(0.0, 0.0, uTime * 0.5)));
        emit += mix(vec3(1.0, 0.28, 0.03), vec3(1.0, 0.72, 0.16), smoothstep(0.25, 0.8, r)) * dens * 2.0;
      }
      float a = exp(-dens * 2.5 * dt);   // soot also hides what is behind it
      sum += trans * emit * keep * dt;
      trans *= mix(1.0, a, keep);
    }
    gl_FragColor = vec4(sum, 1.0 - trans);
  }
`;

// The liquid droplet: a clear sphere. It mirrors the flame at grazing angles (Fresnel), lets some of the flame behind it
// through, and has a faint cool fill light so that what is left of it can still be seen once the flame is out.
const DROP_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uColor; uniform float uLum; uniform float uSoot; uniform float uIndex;
  void main() {
    vec3 n = normalize(vWorld), v = normalize(cameraPosition - vWorld), l = normalize(vec3(-0.45, 0.6, 0.65));
    float mu = clamp(dot(n, v), 0.0, 1.0);
    float f0 = pow((uIndex - 1.0) / (uIndex + 1.0), 2.0);
    float fres = f0 + (1.0 - f0) * pow(1.0 - mu, 5.0);
    // the light the droplet sits in: the blue shell all around it, and the soot glow just after ignition
    vec3 around = uColor * uLum * 0.45 + vec3(1.0, 0.55, 0.16) * uSoot * 2.2;
    vec3 col = mix(vec3(0.006, 0.008, 0.012), vec3(0.07, 0.085, 0.125), pow(max(dot(n, l), 0.0), 1.5) * 0.8);
    col += around * (0.22 * (1.0 - fres) + 3.0 * fres);
    // a lens: light from behind is gathered toward the middle of the droplet
    col += around * 0.5 * pow(mu, 6.0);
    col += vec3(0.5) * pow(max(dot(reflect(-l, n), v), 0.0), 64.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const linear = (fuel: Fuel) => new THREE.Color().setRGB(BLUE[fuel][0] / 255, BLUE[fuel][1] / 255, BLUE[fuel][2] / 255, THREE.SRGBColorSpace);

/** Builds the scene in a new canvas inside `host`. Each scene gets its own canvas: a canvas whose WebGL context was released
 *  cannot be reused (React's development mode mounts every effect twice). Returns null when WebGL is not available, so the
 *  caller can fall back to the flat drawing. */
export function createFlameScene(host: HTMLElement, opts: { still: boolean }): FlameScene | null {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  host.appendChild(canvas);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  } catch {
    canvas.remove();
    return null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.NeutralToneMapping;   // keeps the flame's own colour; only over-bright areas roll off toward white

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);   // not the renderer's clear colour: that one is not colour-managed through the passes
  const camera = new THREE.PerspectiveCamera(FOV_Y, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.rotateSpeed = 0.8;

  const sphere = new THREE.SphereGeometry(1, 64, 48);
  const gasMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: GAS_FRAG, side: THREE.BackSide, transparent: true, premultipliedAlpha: true,
    depthTest: false, depthWrite: false,
    uniforms: {
      uR: { value: 1 }, uDrop: { value: 0.1 }, uColor: { value: new THREE.Color() }, uLum: { value: 1 }, uSoot: { value: 0 },
      uTime: { value: 0 }, uEdge: { value: 10 }, uCut: { value: 0 },
    },
  });
  const dropMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: DROP_FRAG,
    uniforms: { uColor: { value: new THREE.Color() }, uLum: { value: 0 }, uSoot: { value: 0 }, uIndex: { value: 1.39 } },
  });
  const gas = new THREE.Mesh(sphere, gasMat);
  const drop = new THREE.Mesh(sphere, dropMat);
  gas.renderOrder = 2;

  // three faint great circles at the largest flame size of this burn: a fixed reference to judge growth and orientation by
  const ringPts = Array.from({ length: 129 }, (_, i) => { const a = (i / 128) * Math.PI * 2; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0); });
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x93a1b8, transparent: true, opacity: 0.07, depthWrite: false });
  const rings = new THREE.Group();
  for (const [x, y] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) {
    const l = new THREE.Line(ringGeo, ringMat);
    l.rotation.set(x, y, 0);
    rings.add(l);
  }
  scene.add(drop, rings, gas);

  // High dynamic range, then bloom (the soft glow a lens puts around anything bright), then tone mapping to the screen
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.5, 0.12);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(dpr);

  let dirty = true, animate = false, raf = 0, viewCb: (() => void) | null = null;
  const t0 = performance.now();

  const size = () => {
    const w = Math.max(canvas.clientWidth, 1), h = Math.max(canvas.clientHeight, 1);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
    viewCb?.();
  };
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  size();

  controls.addEventListener("change", () => { dirty = true; viewCb?.(); });

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV_Y / 2));
  const api: FlameScene = {
    fit(fovMm) {
      const fit = (fovMm / 2) / (tanHalf * Math.min(1, camera.aspect));
      camera.position.set(0.55, 0.32, 1).normalize().multiplyScalar(fit);
      controls.target.set(0, 0, 0);
      controls.minDistance = fit * 0.25;
      controls.maxDistance = fit * 3;
      controls.update();
      dirty = true;
      viewCb?.();
    },
    pxPerMm() {
      return Math.max(canvas.clientHeight, 1) / (2 * camera.position.distanceTo(controls.target) * tanHalf);
    },
    onView(cb) { viewCb = cb; },
    frame(f) {
      const R = f.df / 2, on = R > 0, color = linear(f.fuel);
      const rDrop = Math.max(f.d / 2, 1.5 / api.pxPerMm());   // the droplet keeps at least a visible dot, like the flat drawing
      const fade = f.retreat == null ? 1 : Math.max(0, 1 - f.retreat);

      gas.visible = on;
      if (on) {
        const u = gasMat.uniforms;
        gas.scale.setScalar(R * BOUND);
        u.uR.value = R;
        u.uDrop.value = f.d > 0 ? rDrop / R : 0;
        u.uColor.value.copy(color);
        u.uLum.value = f.lum;
        u.uSoot.value = f.soot;
        u.uEdge.value = f.retreat == null ? 10 : 1.4 - 2.8 * f.retreat;   // same sweep as the flat drawing, in flame radii
        u.uCut.value = f.cut ? 1 : 0;
      }
      drop.visible = f.d > 0;
      drop.scale.setScalar(rDrop);
      dropMat.uniforms.uColor.value.copy(color);
      dropMat.uniforms.uLum.value = on ? f.lum * fade * (f.cut ? 0.6 : 1) : 0;
      dropMat.uniforms.uSoot.value = on ? f.soot * fade : 0;
      dropMat.uniforms.uIndex.value = INDEX[f.fuel];

      rings.visible = f.dfMax > 0;
      rings.scale.setScalar(f.dfMax / 2);
      animate = on && f.soot > 0.01 && !opts.still;
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      sphere.dispose(); ringGeo.dispose();
      for (const m of [gasMat, dropMat, ringMat]) m.dispose();
      bloom.dispose(); composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const moved = controls.update();
    if (animate) gasMat.uniforms.uTime.value = (performance.now() - t0) / 1000;
    if (dirty || moved || animate) {
      composer.render();
      dirty = false;
    }
  };
  loop();
  return api;
}
