import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// The Predictor's droplet burn in 3D. Like the flat drawing in FlameSim.tsx it only draws numbers the ml service computed
// (droplet and flame diameters, brightness, soot glow, how the flame goes out); docs/flame-simulation.md has the physics.
// One scene unit is one millimetre, so the picture stays to scale from any angle.
//
// The flame is drawn the way a camera would see glowing gas: every pixel adds up the light along its line of sight through
// the flame (ray marching), in high dynamic range, and bright areas bleed a little as they do in a real lens (bloom).
// The look is modelled on photographs of microgravity flames (NASA's Researcher's Guide to Combustion Science, Figs. 1, 5
// and the cover): a soft hazy body with no hard outline, colour that runs from teal inside through azure to a violet edge,
// soot that burns out to white where it is thickest, and a little sensor grain.

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
  sootRgb: [number, number, number];   // colour of the soot glow (black-body, from the estimated soot temperature)
  sootGain: number;       // how brightly the soot glows relative to the reference flame
  stretch: number;        // 1 = round; above 1 the flame is drawn pulled upward by buoyancy (an illustration)
  needles: boolean;       // show the two fuel deployment needles
  time: number;           // seconds since ignition: everything that moves is a function of it, so a paused frame is still
  flickerHz: number;      // how often the buoyant flame flickers (0 without gravity)
  flickerAmp: number;     // how strongly, 0 to 1
  pulse: number;          // -1 to 1: the slow pulsing some flames showed before going out; scales brightness and size a little
};
export type FlameScene = {
  frame(f: FlameFrame): void;
  fit(fovMm: number, stretch?: number): void;   // frame the camera so the flame (fovMm across, stretched upward) fills the view
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
const BOUND = 1.2;           // the gas is marched out to this many flame radii
// Brightness across the flame, in flame radii: it peaks at RC, falls off quickly outward (width OUT) and slowly inward
// (width IN), where hot burnt gas still glows faintly. So the flame has a soft edge near 1 and a hazy, filled middle.
const RC = 0.9, OUT = 0.075, IN = 0.11;
// Colours of the glow, linear RGB: [inside, brightest zone, outer edge]. Hydrocarbon flames photograph blue-green where
// C2 radicals emit (the fuel side), blue from CH, and violet-blue at the lean outer edge. Methanol makes little C2, so its
// flame is a paler, more even blue. The exact shades are a drawing choice.
const GLOW: Record<Fuel, [number, number, number][]> = {
  Heptane: [[0.04, 0.38, 0.46], [0.07, 0.52, 0.85], [0.10, 0.07, 0.85]],
  Methanol: [[0.10, 0.28, 0.50], [0.18, 0.40, 0.95], [0.18, 0.14, 0.85]],
};

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
  uniform vec3 uInner; uniform vec3 uPeak; uniform vec3 uRim;   // linear RGB: inside, brightest zone, outer edge
  uniform float uLum; uniform float uSoot; uniform float uTime;
  uniform float uEdge;     // extinction sweep position along x (10 = none)
  uniform float uCut;      // 1 = only the half with x < 0
  uniform vec3 uSootCol;   // soot glow colour times its strength
  uniform float uStretch;  // 1 = round flame; above 1 = pulled upward by buoyancy
  uniform float uFlickHz; uniform float uFlickAmp;   // flicker of the buoyant flame: frequency, and strength 0 to 1
  uniform float uPulse;    // slow pulsing before extinction, -1 to 1
  const int STEPS = 96;
  const float BOUND = ${BOUND.toFixed(3)}, RC = ${RC.toFixed(4)}, OUT = ${OUT.toFixed(4)}, IN = ${IN.toFixed(4)};

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.7) + 0.15 * noise(p * 4.3 - 1.3); }

  // Buoyancy: maps a point of the buoyant flame back onto the round one, and returns how far up the flame it is (0 at the
  // droplet, about 1 at the tip). Above the droplet the flame is drawn out by uStretch; below, it sits closer to the
  // droplet, where fresh gas flows in. Weak buoyancy gives a blunt egg; strong buoyancy a narrower flame with a sharp tip.
  // The flicker: once per cycle a ring of rising hot gas squeezes the flame, so a bulge and a neck travel up it, the tip
  // bobs, and the whole plume leans a little this way and that.
  vec4 warp(vec3 p) {
    if (uStretch < 1.002) return vec4(p, 0.0);
    float strong = smoothstep(1.0, 3.4, uStretch);
    float ph = 6.2832 * uFlickHz * uTime;
    float s = uStretch * (1.0 + 0.11 * uFlickAmp * sin(ph));
    float up = max(p.y, 0.0) / s;
    float w = mix(1.0, mix(0.72, 0.2, strong), smoothstep(0.0, 1.05, up)) * mix(1.0, 0.82, strong * smoothstep(0.0, 0.5, up));
    w *= 1.0 + 0.42 * uFlickAmp * up * sin(ph - 7.5 * up);
    vec2 lean = 0.55 * uFlickAmp * up * up * vec2(noise(vec3(uTime * uFlickHz * 0.37, 0.5, 3.0)) - 0.5,
                                                  noise(vec3(7.0, uTime * uFlickHz * 0.31, 1.5)) - 0.5);
    float sy = p.y > 0.0 ? s : mix(1.0, 0.7, min(uStretch - 1.0, 1.0));
    return vec4((p.x - lean.x) / w, p.y / sy, (p.z - lean.y) / w, up);
  }

  void main() {
    vec3 ro = cameraPosition / uR, rd = normalize(vWorld - cameraPosition);
    float b = dot(ro, rd), c = dot(ro, ro);
    float bound = BOUND * max(uStretch, 1.0) * (1.0 + 0.15 * uFlickAmp);
    float h = b * b - (c - bound * bound);
    if (h < 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0), t1 = -b + h;
    float hd = b * b - (c - uDrop * uDrop);          // the droplet hides the gas behind it
    if (hd > 0.0 && -b - sqrt(hd) > 0.0) t1 = min(t1, -b - sqrt(hd));
    if (t1 <= t0) discard;

    float dt = (t1 - t0) / float(STEPS);
    // start each ray at a slightly different depth, so the steps do not show as rings
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 sum = vec3(0.0);
    float trans = 1.0;
    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
      vec4 q = warp(p);
      float r = length(q.xyz) / (1.0 + 0.05 * uPulse);
      // wrinkles carried up the flame with the gas, stronger toward the tip
      if (uFlickAmp > 0.01) r *= 1.0 + 0.22 * uFlickAmp * q.w * (noise(vec3(p.x * 2.4, p.y * 1.5 - uTime * uFlickHz * 0.9, p.z * 2.4)) - 0.5);
      float keep = (1.0 - smoothstep(uEdge - 0.3, uEdge, p.x)) * (uCut > 0.5 ? step(p.x, 0.0) : 1.0);
      if (keep <= 0.0) continue;
      float d = r - RC;
      float glow = d > 0.0 ? exp(-d * d / (OUT * OUT)) : exp(-pow(-d / IN, 1.4));
      vec3 col = mix(mix(uInner, uPeak, smoothstep(-0.30, -0.03, d)), uRim, smoothstep(0.0, 0.09, d));
      // real flames are never perfectly even: a faint, fixed mottling (it does not move, so the flame does not flicker)
      vec3 emit = col * glow * (1.0 + 0.16 * (noise(p * 1.7 + 11.0) - 0.5)) * 1.05 * uLum;
      float dens = 0.0;
      if (uSoot > 0.01) {
        // soot inside the flame glows by its own heat. Where the line of sight passes through a lot of it the picture
        // burns out to white-yellow, as in the photographs; toward its thin edge it stays orange
        float s = r / 0.4;
        dens = exp(-s * s) * uSoot * (0.5 + 1.0 * fbm(p * 3.2 + vec3(0.0, 0.0, uTime * 0.5)));
        emit += uSootCol * dens * 2.6;
      }
      float a = exp(-dens * 0.9 * dt);   // soot also dims what is behind it
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

// The two fuel needles: brushed steel, lit by the flame from the middle of the scene.
const NEEDLE_VERT = /* glsl */ `
  varying vec3 vWorld; varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const NEEDLE_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld; varying vec3 vN;
  uniform vec3 uLight; uniform float uR;   // colour and strength of the flame's light; flame radius, mm
  void main() {
    vec3 n = normalize(vN), v = normalize(cameraPosition - vWorld), l = normalize(-vWorld), fill = normalize(vec3(-0.45, 0.6, 0.65));
    float reach = min(1.0, uR * uR / max(dot(vWorld, vWorld), 1e-4));   // light falls off with distance from the flame
    vec3 steel = vec3(0.56, 0.57, 0.58);
    vec3 col = steel * 0.02 * (0.35 + 0.65 * max(dot(n, fill), 0.0));
    col += steel * uLight * reach * (0.15 + 0.85 * max(dot(n, l), 0.0));
    col += uLight * reach * 0.6 * pow(max(dot(reflect(-l, n), v), 0.0), 24.0);
    col += vec3(0.05) * pow(max(dot(reflect(-fill, n), v), 0.0), 40.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;
const NEEDLE_D = 0.4, NEEDLE_LEN = 80;   // mm. A drawing choice: no needle size is recorded in the PSI table

// Sensor grain, added after tone mapping: a little everywhere, a little more where the picture is bright.
const GRAIN = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float n = h(gl_FragCoord.xy) + h(gl_FragCoord.yx + 17.0) - 1.0;
      c.rgb += n * (0.008 + 0.03 * dot(c.rgb, vec3(0.3, 0.5, 0.2)));
      gl_FragColor = vec4(max(c.rgb, 0.0), 1.0);
    }
  `,
};

/** Builds the scene in a new canvas inside `host`. Each scene gets its own canvas: a canvas whose WebGL context was released
 *  cannot be reused (React's development mode mounts every effect twice). Returns null when WebGL is not available, so the
 *  caller can fall back to the flat drawing. */
export function createFlameScene(host: HTMLElement): FlameScene | null {
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
      uR: { value: 1 }, uDrop: { value: 0.1 }, uInner: { value: new THREE.Vector3() }, uPeak: { value: new THREE.Vector3() },
      uRim: { value: new THREE.Vector3() }, uLum: { value: 1 }, uSoot: { value: 0 },
      uTime: { value: 0 }, uEdge: { value: 10 }, uCut: { value: 0 },
      uSootCol: { value: new THREE.Vector3(1, 0.5, 0.1) }, uStretch: { value: 1 },
      uFlickHz: { value: 0 }, uFlickAmp: { value: 0 }, uPulse: { value: 0 },
    },
  });
  const dropMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: DROP_FRAG,
    uniforms: { uColor: { value: new THREE.Color() }, uLum: { value: 0 }, uSoot: { value: 0 }, uIndex: { value: 1.39 } },
  });
  const gas = new THREE.Mesh(sphere, gasMat);
  const drop = new THREE.Mesh(sphere, dropMat);
  gas.renderOrder = 2;

  // FLEX formed each droplet between two opposed needles, then pulled them back before ignition. They are drawn pulled
  // back to just outside the largest flame of this burn.
  const needleGeo = new THREE.CylinderGeometry(NEEDLE_D / 2, NEEDLE_D / 2, NEEDLE_LEN, 20);
  const needleMat = new THREE.ShaderMaterial({
    vertexShader: NEEDLE_VERT, fragmentShader: NEEDLE_FRAG,
    uniforms: { uLight: { value: new THREE.Vector3() }, uR: { value: 1 } },
  });
  const needles = new THREE.Group();
  for (const side of [-1, 1]) {
    const n = new THREE.Mesh(needleGeo, needleMat);
    n.rotation.z = Math.PI / 2;            // the cylinder's axis runs along x
    n.userData.side = side;
    needles.add(n);
  }

  // three faint great circles at the largest flame size of this burn, shown with the cutaway only: a photograph has none
  const ringPts = Array.from({ length: 129 }, (_, i) => { const a = (i / 128) * Math.PI * 2; return new THREE.Vector3(Math.cos(a), Math.sin(a), 0); });
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineBasicMaterial({ color: 0x93a1b8, transparent: true, opacity: 0.07, depthWrite: false });
  const rings = new THREE.Group();
  for (const [x, y] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) {
    const l = new THREE.Line(ringGeo, ringMat);
    l.rotation.set(x, y, 0);
    rings.add(l);
  }
  scene.add(drop, needles, rings, gas);

  // High dynamic range, then bloom (the soft glow a lens puts around anything bright), then tone mapping to the screen
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.45, 0.35);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GRAIN));
  composer.setPixelRatio(dpr);

  let dirty = true, raf = 0, viewCb: (() => void) | null = null;

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
    fit(fovMm, stretch = 1) {
      // a stretched flame reaches about `stretch` flame radii above the droplet and less than one below it
      const tall = stretch > 1.05, grow = tall ? (0.8 + stretch) / 2 : 1;
      const fit = (fovMm * grow / 2) / (tanHalf * Math.min(1, camera.aspect));
      controls.target.set(0, tall ? (fovMm / 2.3) * (0.92 * stretch - 0.75) / 2 : 0, 0);
      camera.position.set(0.55, 0.32, 1).normalize().multiplyScalar(fit).add(controls.target);
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
      const R = f.df / 2, on = R > 0, [inner, peak, edge] = GLOW[f.fuel];
      const rDrop = Math.max(f.d / 2, 1.5 / api.pxPerMm());   // the droplet keeps at least a visible dot, like the flat drawing
      const fade = f.retreat == null ? 1 : Math.max(0, 1 - f.retreat);

      gas.visible = on;
      if (on) {
        const u = gasMat.uniforms;
        gas.scale.setScalar(R * BOUND * Math.max(f.stretch, 1) * (1 + 0.15 * f.flickerAmp));
        u.uStretch.value = f.stretch;
        u.uTime.value = f.time; u.uFlickHz.value = f.flickerHz; u.uFlickAmp.value = f.flickerAmp; u.uPulse.value = f.pulse;
        u.uSootCol.value.set(f.sootRgb[0] * f.sootGain, f.sootRgb[1] * f.sootGain, f.sootRgb[2] * f.sootGain);
        u.uR.value = R;
        u.uDrop.value = f.d > 0 ? rDrop / R : 0;
        u.uInner.value.set(...inner); u.uPeak.value.set(...peak); u.uRim.value.set(...edge);
        u.uLum.value = f.lum * (1 + 0.3 * f.pulse);
        u.uSoot.value = f.soot;
        u.uEdge.value = f.retreat == null ? 10 : 1.4 - 2.8 * f.retreat;   // same sweep as the flat drawing, in flame radii
        u.uCut.value = f.cut ? 1 : 0;
      }
      drop.visible = f.d > 0;
      drop.scale.setScalar(rDrop);
      dropMat.uniforms.uColor.value.setRGB(...peak);
      dropMat.uniforms.uLum.value = on ? f.lum * fade * (f.cut ? 0.6 : 1) : 0;
      dropMat.uniforms.uSoot.value = on ? Math.min(f.soot, 1.2) * fade : 0;
      dropMat.uniforms.uIndex.value = INDEX[f.fuel];

      needles.visible = f.needles && f.dfMax > 0;
      if (needles.visible) {
        const tip = 1.15 * f.dfMax / 2, glow = on ? fade : 0, sootLight = Math.min(f.soot, 1.2) * f.sootGain * 0.8;
        for (const n of needles.children) n.position.x = n.userData.side * (tip + NEEDLE_LEN / 2);
        needleMat.uniforms.uR.value = Math.max(R, 0.5);
        needleMat.uniforms.uLight.value.set(
          glow * (peak[0] * f.lum + f.sootRgb[0] * sootLight), glow * (peak[1] * f.lum + f.sootRgb[1] * sootLight),
          glow * (peak[2] * f.lum + f.sootRgb[2] * sootLight));
      }
      rings.visible = f.cut && f.dfMax > 0;
      rings.scale.setScalar(f.dfMax / 2);
      dirty = true;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      sphere.dispose(); ringGeo.dispose(); needleGeo.dispose();
      for (const m of [gasMat, dropMat, ringMat, needleMat]) m.dispose();
      bloom.dispose(); composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const moved = controls.update();
    if (dirty || moved) {
      composer.render();
      dirty = false;
    }
  };
  loop();
  return api;
}
