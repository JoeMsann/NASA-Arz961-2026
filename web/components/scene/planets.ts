import * as THREE from "three";
import { Art, Textures, cloudArt, earthArt, ringArt } from "./textures";

/**
 * Rim glow around a planet: a slightly larger shell, drawn from the inside with additive blending.
 * It is brightest where the shell meets the surface, fades to nothing at its outer edge, and dims on the night side.
 */
export function atmosphere(radius: number, thickness: number, color: number, strength: number, sunDir: THREE.Vector3) {
  const outer = radius * (1 + thickness);
  return new THREE.Mesh(new THREE.SphereGeometry(outer, 64, 32), new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(color) },
      sunDir: { value: sunDir },
      edge: { value: Math.sqrt(1 - (radius / outer) ** 2) },
      strength: { value: strength },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec4 p = modelMatrix * vec4(position, 1.0);
        vPosW = p.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * p;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 tint;
      uniform vec3 sunDir;
      uniform float edge;
      uniform float strength;
      varying vec3 vNormalW;
      varying vec3 vPosW;
      void main() {
        vec3 n = normalize(vNormalW);
        float depth = clamp(dot(n, normalize(vPosW - cameraPosition)) / edge, 0.0, 1.0);
        float lit = 0.02 + 0.98 * smoothstep(-0.3, 0.45, dot(n, sunDir));
        gl_FragColor = vec4(tint * pow(depth, 3.0) * lit * strength, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
}

/** Earth: day map, city lights on the dark side, glossy oceans, relief, and a separate cloud layer. Lit by the scene's one point light, the Sun. */
export function buildEarth(tex: Textures, radius: number, tilt: number) {
  const surface = new THREE.MeshStandardMaterial({ map: tex.canvas(1024, 512, earthArt, 11), roughness: 1, metalness: 0, emissive: 0x000000, bumpScale: 2.5 });
  // City lights only where the sun is not, plus a blue haze toward the limb.
  surface.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <emissivemap_fragment>", /* glsl */`#include <emissivemap_fragment>
        float daylight = smoothstep(-0.2, 0.3, dot(nonPerturbedNormal, normalize(pointLights[0].position + vViewPosition)));
        totalEmissiveRadiance *= 1.0 - daylight;`)
      .replace("#include <opaque_fragment>", /* glsl */`
        float limb = pow(1.0 - saturate(dot(nonPerturbedNormal, normalize(vViewPosition))), 3.0);
        outgoingLight += vec3(0.22, 0.5, 1.0) * limb * (0.02 + 0.6 * daylight);
        #include <opaque_fragment>`);
  };
  tex.load(surface, "map", "earth_day.jpg", true);
  tex.load(surface, "bumpMap", "earth_bump.jpg", false);
  tex.load(surface, "roughnessMap", "earth_ocean.jpg", false);
  tex.load(surface, "emissiveMap", "earth_night.jpg", true, () => { surface.emissive.set(0xffe9c4); surface.emissiveIntensity = 1.6; });

  const veil = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: tex.canvas(1024, 512, cloudArt, 5, false), transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
  tex.load(veil, "alphaMap", "earth_clouds.jpg", false);

  const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), surface);
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 64, 32), veil);
  const axis = new THREE.Group();   // tilted spin axis shared by the surface and the clouds
  axis.rotation.z = tilt;
  axis.add(globe, clouds);
  return { axis, globe, clouds };
}

export interface GlobeLook {
  radius: number;
  art: Art;            // procedural surface: the final look, or the stand-in while `color` loads
  seed?: number;
  color?: string;      // NASA color map in /textures
  bump?: string;       // NASA elevation map in /textures
  bumpScale?: number;
  roughness?: number;
}

/** Any other planet or moon: a color map, plus relief when an elevation map exists. */
export function buildGlobe(tex: Textures, look: GlobeLook) {
  const mat = new THREE.MeshStandardMaterial({ map: tex.canvas(512, 256, look.art, look.seed), roughness: look.roughness ?? 0.9, metalness: 0, bumpScale: look.bumpScale ?? 1 });
  if (look.color) tex.load(mat, "map", look.color, true);
  if (look.bump) tex.load(mat, "bumpMap", look.bump, false);
  return new THREE.Mesh(new THREE.SphereGeometry(look.radius, 96, 48), mat);
}

/** Flat ring system in the planet's equatorial plane. The texture runs from the inner edge to the outer edge. */
export function buildRings(tex: Textures, inner: number, outer: number) {
  const geo = new THREE.RingGeometry(inner, outer, 128, 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), 0.5);
  const rings = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex.canvas(256, 4, ringArt, 17), color: 0xb9b2a2, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  rings.rotation.x = -Math.PI / 2;
  return rings;
}
