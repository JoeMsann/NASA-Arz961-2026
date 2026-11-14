import * as THREE from "three";

// Small seeded random generator so the procedural art looks the same on every load.
export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Art = (c: CanvasRenderingContext2D, r: () => number) => void;
export type MapSlot = "map" | "alphaMap" | "bumpMap" | "roughnessMap" | "emissiveMap";

/**
 * Owns every texture in the scene. Planets start with a procedural canvas and swap to the NASA image
 * when it loads. If an image fails to load, the canvas simply stays.
 */
export function createTextures(anisotropy: number) {
  const owned = new Set<THREE.Texture>();
  const loader = new THREE.TextureLoader();
  let alive = true;

  const canvas = (w: number, h: number, art: Art, seed = 1, color = true) => {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    art(cv.getContext("2d")!, rng(seed));
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    owned.add(t);
    return t;
  };

  const load = (mat: THREE.MeshStandardMaterial, slot: MapSlot, file: string, color: boolean, ready?: () => void) => {
    loader.load(`/textures/${file}`, (t) => {
      if (!alive) { t.dispose(); return; }
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = anisotropy;
      const old = mat[slot];
      if (old) { owned.delete(old); old.dispose(); }
      mat[slot] = t; owned.add(t);
      mat.needsUpdate = true;
      ready?.();
    });
  };

  const dispose = () => { alive = false; owned.forEach((t) => t.dispose()); owned.clear(); };
  return { canvas, load, dispose };
}
export type Textures = ReturnType<typeof createTextures>;

function blobs(c: CanvasRenderingContext2D, r: () => number, n: number, color: string, size: [number, number], band: [number, number] = [0, 1]) {
  const { width: w, height: h } = c.canvas;
  c.fillStyle = color;
  for (let i = 0; i < n; i++) {
    let x = r() * w, y = (band[0] + r() * (band[1] - band[0])) * h;
    for (let k = 0; k < 14; k++) {
      const s = size[0] + r() * (size[1] - size[0]);
      c.beginPath(); c.ellipse(x, y, s, s * (0.5 + r() * 0.6), r() * 3, 0, 7); c.fill();
      x += (r() - 0.5) * s * 2.2; y += (r() - 0.5) * s * 1.4;
    }
  }
}

// Stand-ins for the NASA maps (1024×512 or 512×256).
export const earthArt: Art = (c, r) => {
  const g = c.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#0a2f6b"); g.addColorStop(0.5, "#1463b8"); g.addColorStop(1, "#0a2f6b");
  c.fillStyle = g; c.fillRect(0, 0, 1024, 512);
  blobs(c, r, 9, "#2f7d4a", [14, 40], [0.18, 0.82]);
  blobs(c, r, 7, "#9a8552", [8, 22], [0.25, 0.7]);
  blobs(c, r, 5, "#1f5e39", [8, 20], [0.3, 0.75]);
  c.fillStyle = "#eef4fa"; c.fillRect(0, 0, 1024, 26); c.fillRect(0, 486, 1024, 26);
};

// White on black: used as an alpha map, like the NASA cloud image.
export const cloudArt: Art = (c, r) => {
  c.fillStyle = "#000"; c.fillRect(0, 0, 1024, 512);
  blobs(c, r, 26, "rgba(255,255,255,0.55)", [6, 22], [0.1, 0.9]);
};

export const moonArt: Art = (c, r) => {
  c.fillStyle = "#9a9da3"; c.fillRect(0, 0, 512, 256);
  blobs(c, r, 8, "#7b7e85", [10, 30]);
  for (let i = 0; i < 90; i++) {
    const x = r() * 512, y = r() * 256, s = 2 + r() * 9;
    c.fillStyle = "rgba(60,62,68,0.55)"; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill();
    c.strokeStyle = "rgba(220,222,228,0.5)"; c.lineWidth = 1; c.beginPath(); c.arc(x - 0.6, y - 0.6, s, 0, 7); c.stroke();
  }
};

export const marsArt: Art = (c, r) => {
  c.fillStyle = "#b5512d"; c.fillRect(0, 0, 512, 256);
  blobs(c, r, 9, "#8c3a22", [10, 32]);
  blobs(c, r, 6, "#d27a4b", [8, 22]);
  c.fillStyle = "#f1e6dc"; c.fillRect(0, 0, 512, 9); c.fillRect(0, 249, 512, 7);
};

// Solar cells: dark blue with a fine grid (64×128, repeated along each wing).
export const cellArt: Art = (c) => {
  c.fillStyle = "#16306e"; c.fillRect(0, 0, 64, 128);
  c.strokeStyle = "#4f7bd6"; c.lineWidth = 1;
  for (let x = 0; x <= 64; x += 16) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 128); c.stroke(); }
  for (let y = 0; y <= 128; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(64, y); c.stroke(); }
};

// Sun glow: a white core fading into a wide warm halo (256×256).
export const glowArt: Art = (c) => {
  const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.1, "rgba(255,244,214,0.9)");
  g.addColorStop(0.22, "rgba(255,214,140,0.34)");
  g.addColorStop(0.5, "rgba(255,170,90,0.08)");
  g.addColorStop(1, "rgba(255,150,80,0)");
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
};

// Sun surface: bright yellow-white with soft hotter and cooler patches (512×256).
export const sunSurfaceArt: Art = (c, r) => {
  c.fillStyle = "#ffd98a"; c.fillRect(0, 0, 512, 256);
  blobs(c, r, 40, "rgba(255,246,214,0.35)", [4, 14]);
  blobs(c, r, 24, "rgba(240,150,60,0.28)", [3, 10]);
};

/** Gas-giant look: the given colors run from pole to pole, with thin streaks along the bands (512×256). */
export const bandArt = (colors: string[]): Art => (c, r) => {
  const { width: w, height: h } = c.canvas;
  const g = c.createLinearGradient(0, 0, 0, h);
  colors.forEach((color, i) => g.addColorStop(i / (colors.length - 1), color));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 320; i++) {
    const x = r() * w, y = r() * h, len = (0.1 + r() * 0.5) * w, thick = 1 + r() * 2;
    c.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
    c.fillRect(x, y, len, thick); c.fillRect(x - w, y, len, thick);   // second copy wraps around the seam
  }
};

// Saturn's rings, inner edge on the left: bright bands with a dark gap two thirds of the way out (256×4).
export const ringArt: Art = (c, r) => {
  for (let x = 0; x < 256; x++) {
    const t = x / 255, gap = t < 0.03 || (t > 0.6 && t < 0.66);
    const alpha = gap ? 0.03 : (t < 0.6 ? 0.5 : 0.32) + 0.4 * r();
    c.fillStyle = `rgba(${Math.round(222 - 34 * t)},${Math.round(204 - 34 * t)},${Math.round(168 - 30 * t)},${alpha})`;
    c.fillRect(x, 0, 1, 4);
  }
};

// Milky Way: a faint, patchy band along the middle of an otherwise black sky map (256×128, stretched smoothly over the sky).
export const galaxyArt: Art = (c, r) => {
  const { width: w, height: h } = c.canvas;
  // A coarse grid of random values, read with smooth blending, gives soft patches that wrap around the sky.
  const gw = 48, gh = 24, grid = Float32Array.from({ length: gw * gh }, r);
  const patch = (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => grid[(((j % gh) + gh) % gh) * gw + (((i % gw) + gw) % gw)];
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  const img = c.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lat = (y / h - 0.5) * 2, u = (x / w) * gw, v = (y / h) * gh;
    const glow = Math.exp(-(lat * lat) / 0.03) * (0.25 + 0.5 * patch(u / 4, v / 4) + 0.5 * patch(u, v));
    const dust = Math.exp(-(lat * lat) / 0.004) * patch(u / 2 + 7, v / 2 + 3);   // dark lanes along the middle
    const k = Math.max(0, glow - 0.6 * dust), i = (y * w + x) * 4;
    img.data[i] = 3 + 58 * k; img.data[i + 1] = 5 + 62 * k; img.data[i + 2] = 10 + 84 * k; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
};
