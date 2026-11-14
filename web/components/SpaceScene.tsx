"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const BODIES = [
  { id: "earth", label: "Earth" },
  { id: "iss", label: "ISS" },
  { id: "suit", label: "Spacesuit" },
  { id: "moon_base", label: "Moon base" },
  { id: "rover", label: "Rover", below: true },
  { id: "mars", label: "Mars habitat" },
] as const;

// Small seeded random generator so the planets look the same on every load.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function texture(w: number, h: number, draw: (c: CanvasRenderingContext2D, r: () => number) => void, seed: number) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!, rng(seed));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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

const earthTex = () => texture(1024, 512, (c, r) => {
  const g = c.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#0a2f6b"); g.addColorStop(0.5, "#1463b8"); g.addColorStop(1, "#0a2f6b");
  c.fillStyle = g; c.fillRect(0, 0, 1024, 512);
  blobs(c, r, 9, "#2f7d4a", [14, 40], [0.18, 0.82]);
  blobs(c, r, 7, "#9a8552", [8, 22], [0.25, 0.7]);
  blobs(c, r, 5, "#1f5e39", [8, 20], [0.3, 0.75]);
  c.fillStyle = "#eef4fa"; c.fillRect(0, 0, 1024, 26); c.fillRect(0, 486, 1024, 26);
}, 11);

const cloudTex = () => texture(1024, 512, (c, r) => {
  c.clearRect(0, 0, 1024, 512);
  blobs(c, r, 26, "rgba(255,255,255,0.55)", [6, 22], [0.1, 0.9]);
}, 5);

const moonTex = () => texture(512, 256, (c, r) => {
  c.fillStyle = "#9a9da3"; c.fillRect(0, 0, 512, 256);
  blobs(c, r, 8, "#7b7e85", [10, 30]);
  for (let i = 0; i < 90; i++) {
    const x = r() * 512, y = r() * 256, s = 2 + r() * 9;
    c.fillStyle = "rgba(60,62,68,0.55)"; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill();
    c.strokeStyle = "rgba(220,222,228,0.5)"; c.lineWidth = 1; c.beginPath(); c.arc(x - 0.6, y - 0.6, s, 0, 7); c.stroke();
  }
}, 23);

const marsTex = () => texture(512, 256, (c, r) => {
  c.fillStyle = "#b5512d"; c.fillRect(0, 0, 512, 256);
  blobs(c, r, 9, "#8c3a22", [10, 32]);
  blobs(c, r, 6, "#d27a4b", [8, 22]);
  c.fillStyle = "#f1e6dc"; c.fillRect(0, 0, 512, 9); c.fillRect(0, 249, 512, 7);
}, 42);

export default function SpaceScene({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const labels = useRef<Record<string, HTMLButtonElement | null>>({});
  const sel = useRef(selected);
  const pick = useRef(onSelect);
  sel.current = selected; pick.current = onSelect;

  useEffect(() => {
    const el = wrap.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.dataset.nogl = "1";   // labels stay usable as plain buttons
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    camera.position.set(0.6, 3.2, 19.5);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = true;
    controls.minPolarAngle = 0.9; controls.maxPolarAngle = 1.75; controls.minAzimuthAngle = -0.7; controls.maxAzimuthAngle = 0.7;
    controls.target.set(0.6, -0.2, -1);

    scene.add(new THREE.AmbientLight(0x8fa3c8, 0.55));
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
    sun.position.set(-14, 9, 16); scene.add(sun);

    // stars
    const r = rng(3), pos: number[] = [];
    for (let i = 0; i < 1800; i++) {
      const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(120 + r() * 60);
      pos.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.85 })));

    const anchors: Record<string, THREE.Object3D> = {};
    const hits: THREE.Mesh[] = [];
    const hit = (id: string, parent: THREE.Object3D, radius: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
      m.userData.id = id; parent.add(m); hits.push(m); anchors[id] = m;
    };
    const std = (color: number, extra: object = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, ...extra });

    // Earth
    const earthG = new THREE.Group(); earthG.position.set(-7.4, -0.6, 0); scene.add(earthG);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(3.3, 64, 64), new THREE.MeshStandardMaterial({ map: earthTex(), roughness: 0.8 }));
    earth.rotation.z = 0.41; earthG.add(earth);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(3.36, 48, 48), new THREE.MeshStandardMaterial({ map: cloudTex(), transparent: true, depthWrite: false }));
    earthG.add(clouds);
    earthG.add(new THREE.Mesh(new THREE.SphereGeometry(3.62, 48, 48), new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.13, side: THREE.BackSide })));
    hit("earth", earthG, 3.3);

    // ISS: truss, modules, solar arrays
    const orbit = new THREE.Group(); orbit.rotation.set(0.5, 0, 0.25); earthG.add(orbit);
    const iss = new THREE.Group(); iss.position.set(4.9, 0, 0); iss.scale.setScalar(0.62); orbit.add(iss);
    iss.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.12), std(0xb9c0cc, { metalness: 0.6 })));
    const mod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 16), std(0xe5e8ee, { metalness: 0.4 }));
    mod.rotation.x = Math.PI / 2; iss.add(mod);
    const panel = std(0x1c3f8f, { metalness: 0.5, roughness: 0.4, emissive: 0x0b1c44 });
    for (const x of [-1.5, -1.0, 1.0, 1.5]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 1.9), panel); p.position.x = x; iss.add(p);
    }
    hit("iss", iss, 2.0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.9, 0.012, 8, 120), new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.35 }));
    ring.rotation.x = Math.PI / 2; orbit.add(ring);

    // Spacewalking astronaut, trailing the station
    const suit = new THREE.Group(); suit.position.set(1.9, 0.5, 4.5); suit.scale.setScalar(0.62); orbit.add(suit);
    const white = std(0xf2f4f8, { roughness: 0.5 });
    suit.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 12), white));
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 16), white); helmet.position.y = 0.62; suit.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), std(0xd9a441, { metalness: 0.9, roughness: 0.2 })); visor.position.set(0, 0.62, 0.13); suit.add(visor);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.25), std(0xcfd4dc)); pack.position.set(0, 0.1, -0.3); suit.add(pack);
    hit("suit", suit, 1.2);

    // Moon with base dome and rover
    const moonG = new THREE.Group(); moonG.position.set(2.2, 1.5, -1); scene.add(moonG);
    moonG.add(new THREE.Mesh(new THREE.SphereGeometry(2.3, 48, 48), new THREE.MeshStandardMaterial({ map: moonTex(), roughness: 0.95 })));
    const onSurface = (obj: THREE.Object3D, dir: THREE.Vector3, radius: number) => {
      dir.normalize(); obj.position.copy(dir).multiplyScalar(radius);
      obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    };
    const base = new THREE.Group();
    base.add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0xe8ecf2, { emissive: 0x2a3550, metalness: 0.3 })));
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 12), std(0xcfd4dc)); tube.rotation.z = Math.PI / 2; tube.position.set(0.4, 0.07, 0); base.add(tube);
    base.scale.setScalar(1.25); onSurface(base, new THREE.Vector3(-0.5, 0.55, 0.67), 2.3); moonG.add(base); hit("moon_base", base, 0.6);
    const rover = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.17, 0.22), std(0xd9a441, { metalness: 0.4 })); cab.position.y = 0.15; rover.add(cab);
    for (const x of [-0.13, 0.13]) for (const z of [-0.12, 0.12]) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 12), std(0x2b2f38)); wh.rotation.x = Math.PI / 2; wh.position.set(x, 0.06, z); rover.add(wh);
    }
    rover.scale.setScalar(1.5); onSurface(rover, new THREE.Vector3(0.5, -0.45, 0.74), 2.3); moonG.add(rover); hit("rover", rover, 0.42);

    // Mars with habitat
    const marsG = new THREE.Group(); marsG.position.set(9.6, -1.3, -3); scene.add(marsG);
    const mars = new THREE.Mesh(new THREE.SphereGeometry(2.8, 48, 48), new THREE.MeshStandardMaterial({ map: marsTex(), roughness: 0.9 }));
    marsG.add(mars);
    const hab = new THREE.Group();
    hab.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf2f4f8, { emissive: 0x3a2a20 })));
    hab.scale.setScalar(1.3); onSurface(hab, new THREE.Vector3(-0.3, 0.4, 0.86), 2.8); marsG.add(hab);
    hit("mars", marsG, 2.8);

    // selection halo, drawn facing the camera
    const halo = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: 0xff9d4d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
    halo.renderOrder = 10; scene.add(halo);

    const size = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // pull the camera back on narrow screens so Earth and Mars both stay in frame
      const d = Math.max(19.5, 11.8 / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect));
      const dir = camera.position.clone().sub(controls.target).normalize();
      camera.position.copy(controls.target).addScaledVector(dir, d);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(size); ro.observe(el); size();

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const at = (e: PointerEvent) => {
      const b = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      // smallest target wins, so the dome is selectable in front of its planet
      const h = ray.intersectObjects(hits).sort((a, b2) => (a.object as THREE.Mesh).geometry.boundingSphere!.radius * a.object.getWorldScale(new THREE.Vector3()).x
        - (b2.object as THREE.Mesh).geometry.boundingSphere!.radius * b2.object.getWorldScale(new THREE.Vector3()).x);
      return h[0]?.object.userData.id as string | undefined;
    };
    hits.forEach((m) => m.geometry.computeBoundingSphere());
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;   // it was a drag, not a click
      const id = at(e); if (id) pick.current(id);
    };
    const onMove = (e: PointerEvent) => { renderer.domElement.style.cursor = at(e) ? "pointer" : "grab"; };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const v = new THREE.Vector3(), clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!still) {
        earth.rotation.y += dt * 0.08; clouds.rotation.y += dt * 0.11; mars.rotation.y += dt * 0.05;
        orbit.rotation.y += dt * 0.22; iss.rotation.y -= dt * 0.22;
      }
      controls.update();
      const a = anchors[sel.current];
      if (a) {
        a.getWorldPosition(halo.position);
        const rad = (a as THREE.Mesh).geometry.boundingSphere!.radius * a.getWorldScale(v).x;
        halo.scale.setScalar(rad * 1.12); halo.quaternion.copy(camera.quaternion);
      }
      const w = el.clientWidth, h = el.clientHeight;
      for (const b of BODIES) {
        const l = labels.current[b.id], o = anchors[b.id];
        if (!l || !o) continue;
        o.getWorldPosition(v);
        const rad = (o as THREE.Mesh).geometry.boundingSphere!.radius * o.getWorldScale(new THREE.Vector3()).x;
        const under = "below" in b && b.below;
        v.y += (rad + 0.25) * (under ? -1 : 1); v.project(camera);
        l.style.transform = `translate(-50%,${under ? "0" : "-100%"}) translate(${((v.x + 1) / 2) * w}px,${((1 - v.y) / 2) * h}px)`;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      renderer.domElement.remove(); renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.MeshStandardMaterial | undefined;
        mat?.map?.dispose(); mat?.dispose?.();
      });
    };
  }, []);

  return (
    <div ref={wrap} className="scene" aria-label="Interactive map of crewed environments. Drag to look around, select a place.">
      {BODIES.map((b) => (
        <button key={b.id} ref={(n) => { labels.current[b.id] = n; }} className="pin" aria-pressed={selected === b.id} onClick={() => onSelect(b.id)}>
          {b.label}
        </button>
      ))}
      <span className="hint">Drag to look around · click a place</span>
    </div>
  );
}
