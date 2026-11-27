'use client';

/**
 * The Athena mark's A as a chunky glass form, lit from inside in ember and carmine with gold highlights.
 *
 * Loaded only by athena-a.tsx through next/dynamic, behind the WebGL gate, so three never reaches the
 * server, the first bundle, a reduced-motion visitor or a weak device.
 *
 * Scene units are the mark's own viewBox units (components/brand.tsx: the stroke M9.25 23.25 16 8.75l6.75 14.5
 * at width 2.75 with round caps and joins, and the sealed point at (16, 18.6), r 1.9), with y up and the origin
 * on the sealed point. Every turn pivots about that point, so it never leaves (50%, 58%) of the square and a
 * 2D disc can take over from it at any moment.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, MeshTransmissionMaterial, PerformanceMonitor } from '@react-three/drei';
import { stillIn, watchScroll } from './scroll-quiet';

/* The mark */

const POINT = { x: 16, y: 18.6, r: 1.9 };
const at = (x: number, y: number) => new THREE.Vector2(x - POINT.x, POINT.y - y);
const FOOT_L = at(9.25, 23.25);
const APEX = at(16, 8.75);
const FOOT_R = at(22.75, 23.25);
const HALF_WIDTH = 2.75 / 2;
/** The mark's 32-unit square; its centre sits 2.6 units above the sealed point. */
const SQUARE_HALF = 16;
const SQUARE_CY = POINT.y - SQUARE_HALF;

/* Palette: never violet or blue */

const EMBER = '#E8432E';
const CARMINE = '#9C1220';
const GOLD = '#F2DFA7';

/* Camera: a long lens straight on, so at rest the A sits on the mark's own outline */

const FOV = 22;
const CAMERA_Z = SQUARE_HALF / Math.tan(THREE.MathUtils.degToRad(FOV / 2));

/* Glass and light */

const GLASS = { depth: 1, bevel: 0.62, bevelSegments: 6, curveSegments: 16 };
/** The light inside: a rounded rod along the stroke, and a bead inside the sealed point. */
const ROD = { halfWidth: 0.6, depth: 0.12, bevel: 0.52 };
const BEAD_RADIUS = 0.9;
const HALO_Z = -3.4;
/** The halo draws in its own pass on this layer, so the glass never refracts it. */
const HALO_LAYER = 1;

/*
 * Quality tiers. It starts at the top and the PerformanceMonitor only ever lowers it, one step at a time. A step
 * changes either the pixel ratio (with the buffer resolution) or the sample count, never both: a new sample count
 * recompiles the glass while the canvas holds its last frame, and resizing the canvas then would blank it.
 */

interface Tier {
  dpr: number | [number, number];
  samples: number;
  resolution: number;
}
const TOP_DPR: [number, number] = [1, 1.5];
const TIERS: readonly Tier[] = [
  { dpr: 1, samples: 4, resolution: 256 },
  { dpr: 1, samples: 6, resolution: 256 },
  { dpr: [1, 1.25], samples: 6, resolution: 384 },
  { dpr: TOP_DPR, samples: 6, resolution: 512 },
];
const TOP = TIERS.length - 1;

const GL_OPTIONS = { alpha: true, antialias: true, powerPreference: 'high-performance' } as const;
// Explicit rotation, so r3f does not aim the camera at the origin: it looks straight down -z from the square's centre.
const CAMERA_OPTIONS: { fov: number; near: number; far: number; position: [number, number, number]; rotation: [number, number, number] } = {
  fov: FOV,
  near: 40,
  far: 140,
  position: [0, SQUARE_CY, CAMERA_Z],
  rotation: [0, 0, 0],
};
const CANVAS_STYLE = { pointerEvents: 'none' } as const;
const RESIZE = { scroll: false } as const;
/** Neutral keeps ember and carmine on hue where ACES would wash them toward salmon. */
const onCreated = ({ gl }: { gl: THREE.WebGLRenderer }) => {
  gl.toneMapping = THREE.NeutralToneMapping;
};

/* Geometry */

const angle = (v: THREE.Vector2) => Math.atan2(v.y, v.x);

/**
 * The stroke's outline at half width `w`: round caps, a round apex join and, under the apex, the inner corner
 * eased by a small `fillet` so the bevel stays smooth there.
 */
function strokeShape(w: number, fillet: number): THREE.Shape {
  const up = APEX.clone().sub(FOOT_L).normalize();
  const down = FOOT_R.clone().sub(APEX).normalize();
  const outL = new THREE.Vector2(-up.y, up.x);
  const outR = new THREE.Vector2(-down.y, down.x);
  const off = (p: THREE.Vector2, n: THREE.Vector2, s: number) => p.clone().addScaledVector(n, s);

  // The two inner edges meet on the axis, w / sin(half-angle) below the apex.
  const half = Math.atan2(up.x, up.y);
  const corner = new THREE.Vector2(APEX.x, APEX.y - w / up.x);
  const centre = new THREE.Vector2(corner.x, corner.y - fillet / Math.sin(half));
  const toR = corner.clone().addScaledVector(down, fillet / Math.tan(half));
  const toL = corner.clone().addScaledVector(up, -fillet / Math.tan(half));

  const s = new THREE.Shape();
  const start = off(FOOT_L, outL, w);
  s.moveTo(start.x, start.y);
  const a = off(APEX, outL, w);
  s.lineTo(a.x, a.y);
  s.absarc(APEX.x, APEX.y, w, angle(outL), angle(outR), true);
  const b = off(FOOT_R, outR, w);
  s.lineTo(b.x, b.y);
  s.absarc(FOOT_R.x, FOOT_R.y, w, angle(outR), angle(outR) - Math.PI, true);
  s.lineTo(toR.x, toR.y);
  s.absarc(centre.x, centre.y, fillet, angle(toR.clone().sub(centre)), angle(toL.clone().sub(centre)), false);
  const c = off(FOOT_L, outL, -w);
  s.lineTo(c.x, c.y);
  s.absarc(FOOT_L.x, FOOT_L.y, w, angle(outL) + Math.PI, angle(outL), true);
  return s;
}

/** Extrudes with a round bevel inset by its own size, so the silhouette keeps the mark's exact outline. */
function extrude(shape: THREE.Shape, depth: number, bevel: number, bevelSegments: number, curveSegments: number) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Welds the extrusion so the bevel shades as one smooth surface instead of facets. */
function smooth(g: THREE.BufferGeometry) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const welded = mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  g.dispose();
  return welded;
}

/** The glass: the A and the point, one mesh, one material, one transmission pass for the whole mark. */
function buildGlass() {
  const { depth, bevel, bevelSegments, curveSegments } = GLASS;
  const disc = new THREE.Shape().absarc(0, 0, POINT.r, 0, Math.PI * 2, false);
  const glassA = smooth(extrude(strokeShape(HALF_WIDTH, 0.35), depth, bevel, bevelSegments, curveSegments));
  const glassDisc = smooth(extrude(disc, depth, bevel, bevelSegments, curveSegments * 2));
  const glass = mergeGeometries([glassA, glassDisc]) ?? glassA;
  if (glass !== glassA) glassA.dispose();
  glassDisc.dispose();
  return glass;
}

/** The light inside, and the halo plane behind. */
function buildCores() {
  const rod = smooth(extrude(strokeShape(ROD.halfWidth, 0.3), ROD.depth, ROD.bevel, 5, 12));
  const bead = new THREE.SphereGeometry(BEAD_RADIUS, 32, 20);
  // The halo plane covers the square, in the same units, so its shader can measure distance to the stroke.
  const halo = new THREE.PlaneGeometry(SQUARE_HALF * 2, SQUARE_HALF * 2);
  halo.translate(0, SQUARE_CY, 0);
  return { rod, bead, halo };
}

/* Materials */

/** A colour from the palette, pushed past 1 so the glass and the tone curve read it as light. */
const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

const CORE_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

// Hot where the core faces the eye, cooling to its rim, so through the glass it reads as a glowing volume.
const CORE_FRAGMENT = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uRim;
uniform float uGain;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = pow(max(dot(normalize(vNormal), normalize(vView)), 0.0), 3.0);
  gl_FragColor = vec4(mix(uRim, uHot, facing) * uGain, 1.0);
  #include <colorspace_fragment>
}`;

function coreMaterial(hot: THREE.Color, rim: THREE.Color) {
  return new THREE.ShaderMaterial({
    vertexShader: CORE_VERTEX,
    fragmentShader: CORE_FRAGMENT,
    uniforms: { uHot: { value: hot }, uRim: { value: rim }, uGain: { value: 1 } },
    toneMapped: false,
  });
}

const HALO_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Light spilling from the glass onto the dark field: it follows the letter's own outline (distance to the
// two strokes and the point), and fades out well inside the square so the canvas edge never shows.
const HALO_FRAGMENT = /* glsl */ `
uniform vec3 uNear;
uniform vec3 uFar;
uniform float uStrength;
uniform vec2 uFootL;
uniform vec2 uApex;
uniform vec2 uFootR;
varying vec2 vPos;
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  float d = min(segment(vPos, uFootL, uApex), segment(vPos, uApex, uFootR)) - ${HALF_WIDTH.toFixed(4)};
  d = max(min(d, length(vPos) - ${POINT.r.toFixed(4)}), 0.0);
  float near = exp(-d * 0.95);
  float far = exp(-d * 0.55);
  float r = length(vPos - vec2(0.0, ${SQUARE_CY.toFixed(4)})) / ${SQUARE_HALF.toFixed(1)};
  float edge = 1.0 - smoothstep(0.6, 0.98, r);
  float a = (near * 0.5 + far * 0.5) * edge * uStrength;
  gl_FragColor = vec4(mix(uFar, uNear, near), a);
  #include <colorspace_fragment>
}`;

function haloMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    uniforms: {
      uNear: { value: new THREE.Color(EMBER) },
      uFar: { value: new THREE.Color(CARMINE) },
      uStrength: { value: 0.32 },
      uFootL: { value: FOOT_L.clone() },
      uApex: { value: APEX.clone() },
      uFootR: { value: FOOT_R.clone() },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

/* Motion */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The rest pose (and the poster's): a slight three-quarter view, turned about the sealed point. */
const REST = { yaw: 0.24, pitch: 0.1 };

/**
 * A slow idle sway, a damped follow of the pointer and a turn with page scroll, all from elapsed time so the
 * motion is the same at any frame rate. Everything starts at rest, which is the pose the poster shows.
 */
function useMotion(pivotRef: RefObject<THREE.Group | null>, coreRef: RefObject<THREE.Mesh | null>) {
  const gl = useThree((s) => s.gl);
  const input = useRef({ x: 0, y: 0, scroll: 0 });
  const state = useRef({ time: 0, x: 0, y: 0, scroll: 0 });

  useEffect(() => {
    const el = gl.domElement;
    let centre = 0;
    // The host's page position is measured on layout changes only; a scroll reads window.scrollY and nothing else.
    const read = () => {
      const h = window.innerHeight || 1;
      input.current.scroll = clamp((window.scrollY + h / 2 - centre) / h, -1.25, 1.25);
    };
    const measure = () => {
      const r = el.getBoundingClientRect();
      centre = r.top + window.scrollY + r.height / 2;
      read();
    };
    const move = (e: PointerEvent) => {
      input.current.x = clamp((e.clientX / (window.innerWidth || 1)) * 2 - 1, -1, 1);
      input.current.y = clamp((e.clientY / (window.innerHeight || 1)) * 2 - 1, -1, 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', read);
      window.removeEventListener('pointermove', move);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const g = pivotRef.current;
    if (!g) return;
    // A long gap (a paused loop, a background tab) resumes from where it stopped instead of jumping.
    const dt = Math.min(delta, 0.05);
    const s = state.current;
    const i = input.current;
    s.time += dt;
    const follow = 1 - Math.exp(-2.4 * dt);
    const turn = 1 - Math.exp(-3.2 * dt);
    s.x += (i.x - s.x) * follow;
    s.y += (i.y - s.y) * follow;
    s.scroll += (i.scroll - s.scroll) * turn;
    const tau = Math.PI * 2;
    g.rotation.y = REST.yaw + 0.18 * Math.sin((s.time * tau) / 17) + s.x * 0.26 + s.scroll * 0.55;
    g.rotation.x = REST.pitch + 0.05 * Math.sin((s.time * tau) / 11) + s.y * 0.14 + s.scroll * 0.08;
    // The light inside breathes a little.
    const core = coreRef.current;
    if (core && core.material instanceof THREE.ShaderMaterial) {
      const gain = core.material.uniforms.uGain;
      if (gain) gain.value = 1 + 0.05 * Math.sin((s.time * tau) / 7);
    }
  });
}

/* First mount, spread over idle tasks */

/**
 * Without parallel shader compile (Linux ANGLE, for one), compiling and linking block the main thread until the
 * GPU process is done. Done all at once, the first frame was one long task; here each heavy step gets an idle
 * task of its own, with the poster still covering, and nothing draws until the last one is in.
 */
const STAGE = { mount: 0, shapes: 1, environment: 2, smalls: 3, reflections: 4, cores: 5, glass: 6, live: 7 } as const;
/**
 * Each step after the first compiles waits this long, so the GPU process can finish the last step's work first:
 * otherwise the step's first call that needs an answer from it stalls until it has.
 */
const COMPILE_GAP_MS = 160;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (h: number) => void;
};

/** Runs `cb` in an idle moment at least `after` ms from now, and only once the page has stopped scrolling. */
function whenIdle(cb: () => void, after = 0): () => void {
  const w = window as IdleWindow;
  let t = 0;
  let h = 0;
  const step = (idle: boolean) => {
    if (!idle) {
      if (w.requestIdleCallback) h = w.requestIdleCallback(() => step(true), { timeout: 300 });
      else step(true);
      return;
    }
    h = 0;
    const wait = stillIn();
    if (wait > 0) t = window.setTimeout(() => step(false), wait);
    else cb();
  };
  t = window.setTimeout(() => step(false), after || 16);
  return () => {
    window.clearTimeout(t);
    if (h) w.cancelIdleCallback?.(h);
  };
}

interface LinkedProgram {
  getUniforms(): unknown;
}

/** Starts compiling `root`'s programs for the screen and for a linear target, without waiting for them. */
function startCompile(gl: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene | null) {
  const stand = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const previous = gl.getRenderTarget();
  if (scene) gl.compile(root, camera, scene);
  gl.setRenderTarget(stand);
  gl.compile(root, camera, scene);
  gl.setRenderTarget(previous);
  stand.dispose();
}

/**
 * The PMREM filter compiles three programs on first use, inside fromCubemap, and waits for them there. A dry run
 * with its draw step stubbed out collects them without drawing, so they can start compiling now and be ready
 * when the real filtering runs in a later task. Falls back to doing nothing if three's internals change.
 */
function startPmremCompile(gl: THREE.WebGLRenderer, pmrem: THREE.PMREMGenerator, cube: THREE.CubeTexture) {
  const inner = pmrem as unknown as Record<string, unknown>;
  if (typeof inner._renderCube !== 'function') return;
  const used = new Set<THREE.Material>();
  inner._renderCube = (_target: unknown, _lod: number, material: THREE.Material) => void used.add(material);
  try {
    pmrem.fromCubemap(cube).dispose();
  } catch {
    // Only a head start; the real filtering compiles them anyway.
    return;
  } finally {
    delete inner._renderCube;
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const eye = new THREE.PerspectiveCamera();
  used.forEach((m) => {
    box.material = m;
    startCompile(gl, box, eye, null);
  });
  box.geometry.dispose();
}

/** Compiles `root` (all of it, or one object) and waits for its programs to link now, in this task. */
function compileNow(gl: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera, scene: THREE.Scene) {
  const materials = gl.compile(root, camera, scene);
  materials.forEach((m) => {
    const programs = (gl.properties.get(m) as { programs?: Map<string, LinkedProgram> }).programs;
    programs?.forEach((p) => p.getUniforms());
  });
}

/** Takes over rendering once every program is linked, and reports the first frame once it is on screen. */
function useRender(drawing: RefObject<boolean>, onReady?: () => void) {
  const frames = useRef(0);
  const ready = useRef(onReady);
  useLayoutEffect(() => {
    ready.current = onReady;
  });
  useFrame((s) => {
    // Until then the canvas keeps its last frame (or stays empty under the poster).
    if (!drawing.current) return;
    const { gl: r, scene: sc, camera: cam } = s;
    r.render(sc, cam);
    // The halo goes in after the glass, depth-tested against it, without clearing.
    const auto = r.autoClear;
    r.autoClear = false;
    cam.layers.set(HALO_LAYER);
    r.render(sc, cam);
    cam.layers.set(0);
    r.autoClear = auto;
    if (frames.current < 2 && ++frames.current === 2) ready.current?.();
  }, 1);
}

/** Keeps the mark's square inside the view at any aspect, centred, straight on. */
function useFraming() {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    const { camera } = get();
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const aspect = size.width / Math.max(1, size.height);
    const half = aspect >= 1 ? SQUARE_HALF : SQUARE_HALF / aspect;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(half / CAMERA_Z));
    camera.position.set(0, SQUARE_CY, CAMERA_Z);
    camera.rotation.set(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [get, size]);
}

/* Scene */

interface SceneProps {
  samples: number;
  resolution: number;
  onReady?: () => void;
  onDecline: () => void;
}

function Scene({ samples, resolution, onReady, onDecline }: SceneProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const pivot = useRef<THREE.Group>(null);
  const glassMesh = useRef<THREE.Mesh>(null);
  const rodMesh = useRef<THREE.Mesh>(null);
  const [glassShape, setGlassShape] = useState<THREE.BufferGeometry | null>(null);
  const [shapes, setShapes] = useState<ReturnType<typeof buildCores> | null>(null);
  const [stage, setStage] = useState<number>(STAGE.mount);
  const [reflections, setReflections] = useState<THREE.WebGLRenderTarget | null>(null);
  const pmrem = useRef<THREE.PMREMGenerator | null>(null);
  /** The sample count whose glass program is linked; the glass draws only when it matches. */
  const [linked, setLinked] = useState<number | null>(null);
  const live = stage >= STAGE.live && linked === samples;
  const drawing = useRef(false);
  useLayoutEffect(() => {
    drawing.current = live;
  }, [live]);
  const materials = useMemo(
    () => ({
      rod: coreMaterial(hdr(EMBER, 1.4).lerp(hdr(GOLD, 1.2), 0.3), hdr(CARMINE, 0.5)),
      bead: coreMaterial(hdr(GOLD, 1.5).lerp(hdr(EMBER, 1.6), 0.45), hdr(EMBER, 0.55)),
      depth: hdr(CARMINE, 0.14),
      halo: haloMaterial(),
    }),
    [],
  );

  useEffect(() => () => reflections?.dispose(), [reflections]);
  useEffect(() => watchScroll(), []);

  // One heavy step per idle task: the environment's reflections, the small programs, then the glass.
  useEffect(() => {
    if (stage >= STAGE.glass) return;
    const after = stage >= STAGE.smalls ? COMPILE_GAP_MS : 0;
    return whenIdle(() => {
      if (stage === STAGE.mount) {
        setGlassShape(buildGlass());
      } else if (stage === STAGE.shapes) {
        // Mounting these also mounts the environment, whose cube drei renders in that commit.
        setShapes(buildCores());
      } else if (stage === STAGE.environment) {
        // drei rendered the Lightformers into a cube in the previous commit: start the PMREM filter's programs.
        const cube = scene.environment as THREE.CubeTexture | null;
        if (cube) {
          pmrem.current = new THREE.PMREMGenerator(gl);
          startPmremCompile(gl, pmrem.current, cube);
        }
        gl.getContext().flush();
      } else if (stage === STAGE.smalls) {
        // And the cores' and halo's, for the screen and for the transmission buffer.
        const glass = glassMesh.current;
        if (glass) glass.visible = false;
        startCompile(gl, scene, camera, scene);
        if (glass) glass.visible = true;
        gl.getContext().flush();
      } else if (stage === STAGE.reflections) {
        // Prefilter the cube for the glass's reflections, its programs now compiled.
        const cube = scene.environment as THREE.CubeTexture | null;
        if (cube && pmrem.current) setReflections(pmrem.current.fromCubemap(cube));
        pmrem.current?.dispose();
        pmrem.current = null;
      } else if (stage === STAGE.cores) {
        // Wait for the small programs (long done by now), so no frame waits for them later.
        const glass = glassMesh.current;
        const stand = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
        const previous = gl.getRenderTarget();
        if (glass) glass.visible = false;
        compileNow(gl, scene, camera, scene);
        gl.setRenderTarget(stand);
        compileNow(gl, scene, camera, scene);
        gl.setRenderTarget(previous);
        if (glass) glass.visible = true;
        stand.dispose();
      }
      setStage(stage + 1);
    }, after);
  }, [stage, gl, scene, camera]);

  useEffect(
    () => () => {
      pmrem.current?.dispose();
      pmrem.current = null;
    },
    [],
  );

  // The glass program, in a task of its own: on the first mount and again whenever the sample count changes.
  useEffect(() => {
    if (stage < STAGE.glass || linked === samples) return;
    return whenIdle(() => {
      const glass = glassMesh.current;
      if (glass) compileNow(gl, glass, camera, scene);
      setLinked(samples);
      setStage((s) => Math.max(s, STAGE.live));
    });
  }, [stage, linked, samples, gl, scene, camera]);

  useEffect(() => () => glassShape?.dispose(), [glassShape]);
  useEffect(
    () => () => {
      shapes?.rod.dispose();
      shapes?.bead.dispose();
      shapes?.halo.dispose();
    },
    [shapes],
  );
  useEffect(
    () => () => {
      materials.rod.dispose();
      materials.bead.dispose();
      materials.halo.dispose();
    },
    [materials],
  );

  // Each sample count compiles its own program; without its own cache key three would reuse the last one.
  const keyProgram = useCallback(
    (m: unknown) => {
      if (m instanceof THREE.Material) {
        const key = `athena-glass-${samples}`;
        m.customProgramCacheKey = () => key;
      }
    },
    [samples],
  );

  useFraming();
  useMotion(pivot, rodMesh);
  useRender(drawing, onReady);

  const haloScale = (CAMERA_Z - HALO_Z) / CAMERA_Z;

  return (
    <>
      {/* Mounted from the first live frame on, and kept through recompiles, so its count carries over. */}
      {stage >= STAGE.live && <PerformanceMonitor onDecline={onDecline} />}

      {stage >= STAGE.environment && (
        <Environment resolution={256}>
          {/* Gold key from the upper left, an ember strip to the right, carmine below, a gold rim behind. */}
          <Lightformer form="rect" color={GOLD} intensity={16} position={[-5, 6, 4]} scale={[8, 1.1, 1]} />
          <Lightformer form="rect" color={EMBER} intensity={6} position={[7, -1, 1]} scale={[0.8, 6, 1]} />
          <Lightformer form="rect" color={CARMINE} intensity={3} position={[0, -7, 2]} scale={[8, 1, 1]} />
          <Lightformer form="rect" color={GOLD} intensity={5} position={[-2, 1, -8]} scale={[1, 6, 1]} />
          <Lightformer form="circle" color={GOLD} intensity={10} position={[3, 3.5, 8]} scale={0.7} />
        </Environment>
      )}

      {shapes && <mesh geometry={shapes.halo} material={materials.halo} position={[0, 0, HALO_Z]} scale={haloScale} layers={HALO_LAYER} />}

      <group ref={pivot} rotation-order="YXZ" rotation-x={REST.pitch} rotation-y={REST.yaw}>
        {glassShape && (
          <mesh ref={glassMesh} geometry={glassShape}>
            <MeshTransmissionMaterial
              key={samples}
              ref={keyProgram}
              samples={samples}
              resolution={resolution}
              visible={live}
              envMap={reflections?.texture ?? null}
              transmission={1}
              thickness={1.3}
              background={materials.depth}
              roughness={0.11}
              anisotropicBlur={0.25}
              chromaticAberration={0.04}
              distortion={0}
              ior={1.5}
              color="#ffffff"
              envMapIntensity={0.9}
              clearcoat={1}
              clearcoatRoughness={0.04}
            />
          </mesh>
        )}
        {shapes && <mesh ref={rodMesh} geometry={shapes.rod} material={materials.rod} />}
        {shapes && <mesh geometry={shapes.bead} material={materials.bead} />}
      </group>
    </>
  );
}

export default function AthenaACanvas({ paused, onReady }: { paused: boolean; onReady?: () => void }) {
  const [tier, setTier] = useState(TOP);
  const { dpr, samples, resolution } = TIERS[tier] ?? TIERS[TOP]!;
  const decline = useCallback(() => setTier((t) => Math.max(0, t - 1)), []);

  return (
    <Canvas
      dpr={dpr}
      frameloop={paused ? 'never' : 'always'}
      gl={GL_OPTIONS}
      camera={CAMERA_OPTIONS}
      resize={RESIZE}
      style={CANVAS_STYLE}
      onCreated={onCreated}
    >
      <Scene samples={samples} resolution={resolution} onReady={onReady} onDecline={decline} />
    </Canvas>
  );
}
