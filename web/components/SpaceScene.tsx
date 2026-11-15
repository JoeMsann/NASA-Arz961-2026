"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildISS, buildMarsHabitat, buildMoonBase, buildRover, buildSuit, createPalette } from "./scene/models";
import { atmosphere, buildEarth, buildGlobe } from "./scene/planets";
import { buildSky, buildSun } from "./scene/sky";
import { EARTH, EARTH_R, Landmark, MARS, MARS_R, MOON, MOON_R, SCENERY, SUN_DAY, SUN_GLOW, SUN_R, buildSolarSystem, orbitAngle, orbitPos, spinAngle, sunFrom } from "./scene/system";
import { createTextures, marsArt, moonArt } from "./scene/textures";

// The six selectable places. `detail` marks the small ones, whose pins hide when the camera is far away.
// From that far, Earth and Mars nearly touch when they pass each other, so Mars's pin drops below it (`belowFar`) to keep both readable.
export const BODIES: { id: string; label: string; below?: boolean; belowFar?: boolean; detail?: boolean }[] = [
  { id: "earth", label: "Earth" },
  { id: "iss", label: "ISS", detail: true },
  { id: "suit", label: "Spacesuit", detail: true },
  { id: "moon_base", label: "Moon base", detail: true },
  { id: "rover", label: "Rover", below: true, detail: true },
  { id: "mars", label: "Mars habitat", belowFar: true },
];

const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const Y = at(0, 1, 0);
const ORBIT_R = 4.9;        // the station's orbit around Earth
const DETAIL_RANGE = 130;   // camera distance beyond which the small places' pins would pile up
const deg = THREE.MathUtils.degToRad;

// What the camera follows. It moves with the body and turns with it around the Sun, so the lighting on the body stays the same.
// The Moon is followed in Earth's frame instead: the camera does not swing around Earth with it, so the Moon is seen turning.
type Focus = "sun" | "earth" | "moon" | "mars";
const FOCUS: Record<string, Focus> = { earth: "earth", iss: "earth", suit: "earth", moon_base: "moon", rover: "moon", mars: "mars" };

// Camera poses. The camera orbits `target` from the given direction, far enough to keep halfW × halfH around it in view.
// `target` and `azimuth` are relative to the followed body, as it sits at the start (Earth on the +X axis, the Sun behind it).
interface Pose { target: THREE.Vector3; azimuth: number; polar: number; halfW: number; halfH: number }
const POSES: Record<Focus, { wide: Pose; tall: Pose }> = {
  earth: {   // Earth, the station and the whole of the Moon's orbit
    wide: { target: at(0, 0, 0), azimuth: -0.4, polar: 1.17, halfW: 10.4, halfH: 7.8 },
    tall: { target: at(0, 0, 0), azimuth: -0.4, polar: 0.8, halfW: 9.6, halfH: 9 },
  },
  moon: {    // the Moon's near side, where the base and the rover are
    wide: { target: at(0, 0, 0), azimuth: -1.2, polar: 1.1, halfW: 3.6, halfH: 2.6 },
    tall: { target: at(0, 0, 0), azimuth: -1.2, polar: 1.1, halfW: 2.6, halfH: 3.4 },
  },
  mars: {
    wide: { target: at(0, 0, 0), azimuth: -0.7, polar: 1.2, halfW: 3.8, halfH: 2.8 },
    tall: { target: at(0, 0, 0), azimuth: -0.7, polar: 1.2, halfW: 2.8, halfH: 3.8 },
  },
  sun: {     // every orbit out to Neptune
    wide: { target: at(0, 0, 0), azimuth: -0.5, polar: 0.35, halfW: 318, halfH: 305 },
    tall: { target: at(0, 0, 0), azimuth: -0.5, polar: 0.35, halfW: 318, halfH: 305 },
  },
};
type View = "home" | "system";

export default function SpaceScene({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const safeArea = useRef<HTMLDivElement>(null);
  const labels = useRef<Record<string, HTMLElement | null>>({});
  const view = useRef<{ zoom: (factor: number) => void; show: (v: View) => void; select: (id: string) => void } | null>(null);
  const sel = useRef(selected);
  const pick = useRef(onSelect);
  sel.current = selected; pick.current = onSelect;

  useEffect(() => {
    const el = wrap.current!, safe = safeArea.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      el.dataset.nogl = "1";   // labels stay usable as plain buttons
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Solar system view. Arrow keys move it.");
    el.prepend(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 20000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.rotateSpeed = 0.6; controls.zoomToCursor = true;
    controls.minDistance = 3; controls.maxDistance = 2600; controls.minPolarAngle = 0.1; controls.maxPolarAngle = 2.4;
    controls.listenToKeyEvents(canvas);

    const tex = createTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    const palette = createPalette(tex);
    const pixelRatio = renderer.getPixelRatio();

    // One light source: the Sun, at the middle of the system. No falloff, so the outer planets stay visible.
    const sky = buildSky(tex, pixelRatio), system = buildSolarSystem(tex, pixelRatio), sun = buildSun(tex, SUN_R, SUN_GLOW);
    scene.add(new THREE.AmbientLight(0x7f93bd, 0.32), new THREE.PointLight(0xfff4e6, 4.4, 0, 0), sky, system.group, sun);
    const landmarks: Landmark[] = [...system.landmarks, { label: "Sun", anchor: sun, radius: SUN_R }];

    // Invisible spheres used for click picking, label pins and the selection halo.
    const unitSphere = new THREE.SphereGeometry(1, 12, 12), unseen = new THREE.MeshBasicMaterial({ visible: false });
    const anchors: Record<string, THREE.Mesh> = {};
    const hits: THREE.Mesh[] = [];
    const hit = (id: string, parent: THREE.Object3D, radius: number) => {
      const m = new THREE.Mesh(unitSphere, unseen);
      m.scale.setScalar(radius); m.userData.id = id;
      parent.add(m); hits.push(m); anchors[id] = m;
    };
    /** Stands a ground model on a planet: `size` is its scale, `dir` the spot on the surface. */
    const onSurface = (obj: THREE.Object3D, size: number, dir: THREE.Vector3, radius: number) => {
      dir.normalize(); obj.scale.setScalar(size); obj.position.copy(dir).multiplyScalar(radius);
      obj.quaternion.setFromUnitVectors(at(0, 1, 0), dir);
    };

    // Earth, with the station and a spacewalker on a tilted orbit
    // Each body's group only moves, it never turns, so spin axes keep pointing the same way all year (which is what makes seasons).
    const earthG = new THREE.Group(); scene.add(earthG);
    const earth = buildEarth(tex, EARTH_R, deg(EARTH.tilt));
    const earthAir = atmosphere(EARTH_R, 0.055, 0x4f9dff, 1.1, at(0, 0, 0));
    earthG.add(earth.axis, earthAir);
    hit("earth", earthG, EARTH_R);

    const orbitPlane = new THREE.Group(); orbitPlane.rotation.set(0.5, 0, 0.25); earthG.add(orbitPlane);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ORBIT_R, 0.012, 8, 120), new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.35 }));
    ring.rotation.x = Math.PI / 2;
    const orbit = new THREE.Group();   // spins inside the orbit plane and carries the station and the spacewalker
    orbit.rotation.y = -0.9;
    orbitPlane.add(ring, orbit);

    const iss = buildISS(palette);
    iss.position.set(ORBIT_R, 0, 0); iss.rotation.z = -Math.PI / 2; iss.scale.setScalar(0.6);   // truss across the orbit, modules along it
    orbit.add(iss); hit("iss", iss, 2.1);

    const suit = buildSuit(palette);
    suit.position.set(1.9, 0.5, 4.5); suit.rotation.y = -orbit.rotation.y; suit.scale.setScalar(0.62);   // trailing the station, facing the camera
    orbit.add(suit); hit("suit", suit, 1.25);

    // Moon with base and rover. Models shrink with their planet, so they keep the same footprint on it.
    // The Moon hangs off an arm that turns around Earth, so it turns once per orbit and its near side (-X) always faces Earth.
    const moonArm = new THREE.Group(); earthG.add(moonArm);
    const moonG = new THREE.Group(); moonG.position.x = MOON.distance; moonArm.add(moonG);
    const moon = buildGlobe(tex, { radius: MOON_R, art: moonArt, seed: 23, color: "moon_color.jpg", bump: "moon_bump.jpg", bumpScale: 6, roughness: 0.96 });
    moon.rotation.y = Math.PI;   // the middle of the map, the near side, toward Earth
    const baseSize = 0.54 * MOON_R, roverSize = 0.65 * MOON_R;
    const base = buildMoonBase(palette, MOON_R / baseSize), rover = buildRover(palette);
    onSurface(base, baseSize, at(-0.6, 0.62, 0.5), MOON_R); onSurface(rover, roverSize, at(-0.8, -0.15, 0.58), MOON_R);
    moonG.add(moon, base, rover);
    hit("moon_base", base, 0.6); hit("rover", rover, 0.42);

    // Mars with habitat cluster, which turns with the ground under it
    const marsG = new THREE.Group(); scene.add(marsG);
    const marsAxis = new THREE.Group(); marsAxis.rotation.z = deg(MARS.tilt);
    const marsSpin = new THREE.Group(); marsAxis.add(marsSpin);
    const mars = buildGlobe(tex, { radius: MARS_R, art: marsArt, seed: 42, color: "mars_color.jpg", bump: "mars_bump.jpg", bumpScale: 5, roughness: 0.9 });
    const habSize = 0.46 * MARS_R, hab = buildMarsHabitat(palette, MARS_R / habSize);
    onSurface(hab, habSize, at(-0.55, 0.4, 0.73), MARS_R);
    marsSpin.add(mars, hab);
    const marsAir = atmosphere(MARS_R, 0.035, 0xff8a5c, 0.8, at(0, 0, 0));
    marsG.add(marsAxis, marsAir);
    hit("mars", marsG, MARS_R);

    /** Puts every body where it is `t` seconds into the animation. */
    let earthYaw = 0, marsYaw = 0;
    const move = (t: number) => {
      system.update(t);
      sun.children[0].rotation.y = spinAngle(SUN_DAY, t);
      earthYaw = orbitAngle(EARTH.angle, EARTH.year, t);
      orbitPos(EARTH.orbit, earthYaw, earthG.position);
      const turn = spinAngle(EARTH.day, t);
      earth.globe.rotation.y = -1.2 + turn;   // starts with the Atlantic facing the camera
      earth.clouds.rotation.y = turn * 1.04;  // clouds drift slowly over the ground
      sunFrom(earthG.position, earthAir.material.uniforms.sunDir.value);
      orbit.rotation.y = -0.9 + t * 0.2; suit.rotation.y = -orbit.rotation.y;   // the spacewalker keeps facing the camera
      moonArm.rotation.set(deg(MOON.inclination), orbitAngle(MOON.angle, MOON.year, t), 0);
      marsYaw = orbitAngle(MARS.angle, MARS.year, t);
      orbitPos(MARS.orbit, marsYaw, marsG.position);
      marsSpin.rotation.y = spinAngle(MARS.day, t);
      sunFrom(marsG.position, marsAir.material.uniforms.sunDir.value);
    };
    move(0);

    /** Where a followed body is now (written to `out`), and how far it has gone around the Sun (returned). */
    const frame = (f: Focus, out: THREE.Vector3) => {
      if (f === "earth") { out.copy(earthG.position); return earthYaw; }
      if (f === "mars") { out.copy(marsG.position); return marsYaw; }
      if (f === "moon") { out.set(MOON.distance, 0, 0).applyEuler(moonArm.rotation).add(earthG.position); return earthYaw; }
      out.set(0, 0, 0); return 0;
    };

    // selection halo, drawn facing the camera
    const halo = new THREE.Mesh(new THREE.RingGeometry(1, 1.06, 64), new THREE.MeshBasicMaterial({ color: 0xff9d4d, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
    halo.renderOrder = 10; scene.add(halo);

    const v = at(0, 0, 0), up = at(0, 1, 0), offset = at(0, 0, 0), goal = at(0, 0, 0), orbitAngles = new THREE.Spherical();
    scene.updateMatrixWorld(true);
    for (const m of hits) m.userData.radius = m.getWorldScale(v).x;

    // Framing. The picture is slid so the orbit target sits in the middle of the area no overlay covers.
    // While the user has not moved the camera, it also glides to the pose that fits that area: the selected place (wide or tall) or the whole system.
    // Moved or not, the camera keeps following the body it is on, so that body does not drift out of view (`follow` below).
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const shift = { x: 0, y: 0 }, shiftGoal = { x: 0, y: 0 };
    let w = 1, h = 1, started = false, shifting = false, gliding = false;
    let mode: View | "free" = "home", focus: Focus = FOCUS[sel.current] ?? "earth", pose = POSES[focus].wide, distance = 0;
    const release = () => { mode = "free"; gliding = false; };
    const step = (k: number) => {
      if (shifting) {
        shift.x += (shiftGoal.x - shift.x) * k; shift.y += (shiftGoal.y - shift.y) * k;
        shifting = Math.abs(shiftGoal.x - shift.x) > 0.5 || Math.abs(shiftGoal.y - shift.y) > 0.5;
        if (!shifting) Object.assign(shift, shiftGoal);
        camera.setViewOffset(w, h, shift.x, shift.y, w, h);
      }
      if (gliding) {
        const yaw = frame(focus, goal), azimuth = pose.azimuth + yaw;   // the pose, moved and turned with its body
        goal.add(offset.copy(pose.target).applyAxisAngle(Y, yaw));
        orbitAngles.setFromVector3(offset.copy(camera.position).sub(controls.target));
        const turn = Math.atan2(Math.sin(azimuth - orbitAngles.theta), Math.cos(azimuth - orbitAngles.theta));   // the short way round
        gliding = k < 1 && (Math.abs(turn) > 0.002 || Math.abs(pose.polar - orbitAngles.phi) > 0.002 || Math.abs(distance - orbitAngles.radius) > distance * 0.002 || controls.target.distanceTo(goal) > distance * 0.002);
        const t = gliding ? k : 1;
        orbitAngles.theta += turn * t; orbitAngles.phi += (pose.polar - orbitAngles.phi) * t; orbitAngles.radius += (distance - orbitAngles.radius) * t;
        controls.target.lerp(goal, t);
        camera.position.setFromSpherical(orbitAngles).add(controls.target);
      }
    };
    const measure = () => {
      w = el.clientWidth; h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const free = safe.getBoundingClientRect(), fw = Math.max(free.width, 1), fh = Math.max(free.height, 1);
      shiftGoal.x = w / 2 - (free.left + free.width / 2);
      shiftGoal.y = h / 2 - (free.top + free.height / 2);
      shifting = true;
      if (mode !== "free") {
        pose = POSES[focus][fw < fh * 0.9 ? "tall" : "wide"];
        distance = Math.min(controls.maxDistance, (Math.max(pose.halfW / fw, pose.halfH / fh) * h) / tanHalfFov);
        gliding = true;
      }
      if (!started || still) step(1);
      started = true;
    };
    const ro = new ResizeObserver(measure); ro.observe(el); ro.observe(safe); measure();

    // Following: each frame, the camera and its target move and turn with the followed body.
    const followAt = at(0, 0, 0), now = at(0, 0, 0), drag = at(0, 0, 0);
    let followYaw = frame(focus, followAt);
    const follow = () => {
      const yaw = frame(focus, now), turn = yaw - followYaw;
      drag.copy(camera.position).sub(controls.target).applyAxisAngle(Y, turn);
      controls.target.sub(followAt).applyAxisAngle(Y, turn).add(now);
      camera.position.copy(controls.target).add(drag);
      followAt.copy(now); followYaw = yaw;
    };
    /** Switches the followed body. Returns false if it was already followed. */
    const refocus = (next: Focus) => {
      if (next === focus) return false;
      focus = next; followYaw = frame(focus, followAt);
      return true;
    };
    controls.addEventListener("start", release);
    canvas.addEventListener("keydown", release);

    view.current = {
      zoom: (factor) => {
        release();
        offset.copy(camera.position).sub(controls.target);
        camera.position.copy(controls.target).add(offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance)));
      },
      show: (next) => { mode = next; refocus(next === "system" ? "sun" : FOCUS[sel.current] ?? "earth"); measure(); },
      select: (id) => { if (refocus(FOCUS[id] ?? "earth")) { mode = "home"; measure(); } },   // fly over only when the place is on another body
    };

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), found: THREE.Intersection[] = [];
    const under = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      found.length = 0;
      ray.intersectObjects(hits, false, found);
      // smallest target wins, so the base is selectable in front of its planet
      let best: THREE.Object3D | undefined;
      for (const f of found) if (!best || f.object.userData.radius < best.userData.radius) best = f.object;
      return best?.userData.id as string | undefined;
    };
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;   // it was a drag, not a click
      const id = under(e); if (id) pick.current(id);
    };
    const onMove = (e: PointerEvent) => { canvas.style.cursor = under(e) ? "pointer" : "grab"; };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);

    /** Moves a label to sit just above (or below) its body on screen, or hides it when the body is out of view. */
    const place = (label: HTMLElement | null | undefined, anchor: THREE.Object3D, radius: number, body?: (typeof BODIES)[number]) => {
      if (!label) return;
      anchor.getWorldPosition(v);
      const far = v.distanceTo(camera.position) > DETAIL_RANGE;
      const below = body?.below || (far && body?.belowFar);
      v.addScaledVector(up, (radius + 0.25) * (below ? -1 : 1)).project(camera);
      const hide = (far && body?.detail) || v.z > 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15;
      if (label.hidden !== hide) label.hidden = hide;
      if (!hide) label.style.transform = `translate(-50%,${below ? "0" : "-100%"}) translate(${((v.x + 1) / 2) * w}px,${((1 - v.y) / 2) * h}px)`;
    };

    let raf = 0, last = performance.now(), clock = 0;
    const tick = (time: number) => {
      const dt = Math.min((time - last) / 1000, 0.05); last = time;
      if (!still) { clock += dt; move(clock); follow(); }
      if (shifting || gliding) step(1 - Math.exp(-dt * 5));
      controls.update();
      camera.updateMatrixWorld();   // the camera moves every frame now, so place the labels with this frame's camera
      sky.position.copy(camera.position);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);

      const a = anchors[sel.current];
      halo.visible = !!a;
      if (a) {
        a.getWorldPosition(halo.position);
        halo.scale.setScalar(a.userData.radius * 1.12); halo.quaternion.copy(camera.quaternion);
      }
      for (const b of BODIES) place(labels.current[b.id], anchors[b.id], anchors[b.id].userData.radius, b);
      for (const l of landmarks) place(labels.current[l.label], l.anchor, l.radius);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      view.current = null;
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      canvas.remove();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of [m.material ?? []].flat()) mat.dispose();
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      tex.dispose(); renderer.dispose(); renderer.forceContextLoss();
    };
  }, []);

  useEffect(() => { view.current?.select(selected); }, [selected]);

  return (
    <div ref={wrap} className="scene" role="group" aria-label="Interactive solar system with the places where crews live. Drag to turn it, scroll to zoom, right-drag to move, select a place.">
      <div ref={safeArea} className="scene-safe" />
      <p className="scene-note">The 3D view is not available in this browser. Pick a place:</p>
      {BODIES.map((b) => (
        <button key={b.id} ref={(n) => { labels.current[b.id] = n; }} className="pin" aria-pressed={selected === b.id} onClick={() => onSelect(b.id)}>
          {b.label}
        </button>
      ))}
      {["Sun", ...SCENERY].map((name) => <span key={name} ref={(n) => { labels.current[name] = n; }} className="place-name" hidden>{name}</span>)}
      <div className="view-controls" role="group" aria-label="View">
        <button className="icon" aria-label="Zoom in" title="Zoom in" onClick={() => view.current?.zoom(0.7)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <button className="icon" aria-label="Zoom out" title="Zoom out" onClick={() => view.current?.zoom(1 / 0.7)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <button className="icon" aria-label="Show the whole solar system" title="Show the whole solar system" onClick={() => view.current?.show("system")}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /></svg>
        </button>
        <button className="icon" aria-label="Back to the selected place" title="Back to the selected place" onClick={() => view.current?.show("home")}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 8L8 3l5.5 5M4.5 7v6h7V7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  );
}
