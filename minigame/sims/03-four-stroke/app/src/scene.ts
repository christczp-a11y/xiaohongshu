import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as E from './engine';
import * as T from './textures';

// World units are centimetres; y is up and the table top is y = 0. The same white photo
// studio and minimal table as the buoyancy lab. On it stands a single-cylinder engine cut
// open along z = 0: the casing, cylinder and piston are sectioned (their cut faces drawn with
// the stencil buffer), the moving parts behind them are whole.

const YC = 14; // crank centre
const BORE = 4; // radius
const PIN_UP = 3.2; // piston pin to crown
const SKIRT = 3.2; // piston pin to skirt bottom
const DECK = YC + E.CRANK_R + E.ROD_L + PIN_UP + 0.6; // top of the bore, 0.6 above the crown at the top
const CASE_TOP = YC + 8;
const HEAD_H = 6.2;
const COVER_IN = 11.6; // inside of the cam cover, above the deck
const COVER_OUT = 12.3;
const PORT_Y = DECK + 3.6; // where the ports leave the head
const FLY_R = 11.5;
const FLY_Z = -9.5; // flywheel mid-plane, behind the crankcase
const PLINTH = { x: 12, z0: -6.8, z1: 5.5, h: 1.6 };

// valves: axis leaning out by this much, seat centre on the pent roof
const VALVE_TILT = Math.atan2(0.9, 2.45);
const SEAT = new THREE.Vector2(1.975, 1.15); // x mirrored for the intake side, y above the deck
const VALVE_R = 1.25;
const LIFT = 0.85; // full valve opening, cm
const BUCKET_AT = 7.2; // along the valve axis from the seat
const CAM_BASE = 0.95;
const CAM_AT = BUCKET_AT + 0.8 + CAM_BASE;
const PLUG_TIP = DECK + 1.45;
/** Turns a geometry's y axis onto x (pipes lying along the engine). */
const xAxisQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

const TABLE = { x0: -27, x1: 27, z0: -19, z1: 12, t: 2.4, leg: 0.9 };
const FLOOR_Y = -74;

const VIEW_AZIMUTH = THREE.MathUtils.degToRad(20);
const VIEW_ELEVATION = THREE.MathUtils.degToRad(11);
const VIEW_DIST = 150;
/** What the camera keeps in frame, in cm: the whole engine, pipes and filter included. */
const VIEW = { width: 37.5, height: 51, centerY: 24.6, centerX: 0 };

/** Rendering tiers, best first, inside the mini-tool's phone budget (as the buoyancy lab). */
const TIERS = [
  { dpr: 1.5, pixels: 2.0e6, shadow: 2048, extras: true },
  { dpr: 1, pixels: 1.0e6, shadow: 1024, extras: true },
  { dpr: 1, pixels: 1.0e6, shadow: 0, extras: true },
  { dpr: 1, pixels: 1.0e6, shadow: 0, extras: false },
];
export const QUALITY_TIERS = TIERS.length;

/** CSS px along each edge that the UI covers; the engine is framed in the rest. */
export interface FreeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface SceneFrame {
  theta: number;
  burnt: boolean;
  sparkAge: number; // seconds since the plug last fired
  time: number;
  kind: E.Kind;
}

export interface Anchors {
  intake: THREE.Vector3;
  exhaust: THREE.Vector3;
  plug: THREE.Vector3; // the spark plug, or the diesel's injector
  piston: THREE.Vector3;
  fins: THREE.Vector3; // cooling fins on the barrel, where heat leaves
  crank: THREE.Vector3;
  flywheel: THREE.Vector3;
}

export interface SceneView {
  camera: THREE.PerspectiveCamera;
  update(f: SceneFrame): void;
  setQuality(tier: number): void;
  resize(w: number, h: number, free: FreeArea): void;
  render(): void;
  anchors(): Anchors;
  /** The crank centre on screen, CSS px: the finger turns the flywheel around it. */
  crankOnScreen(): { x: number; y: number };
  info(): { calls: number; triangles: number; dpr: number };
}

/** `onFail` is called if a shader cannot be built on this device. */
export function createScene(canvas: HTMLCanvasElement, onFail: () => void): SceneView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
  renderer.debug.onShaderError = () => onFail();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e4e4e8');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 10, 900);
  const target = new THREE.Vector3(VIEW.centerX, VIEW.centerY, 0);
  const viewDir = new THREE.Vector3(
    Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
    Math.sin(VIEW_ELEVATION),
    Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
  );
  camera.position.copy(target).addScaledVector(viewDir, VIEW_DIST);
  camera.lookAt(target);

  // --- lights: the buoyancy lab's key and rim, plus the fire inside the cylinder ----------------
  const key = new THREE.SpotLight('#fffaf3', 3.4, 0, 0.55, 0.9, 0);
  key.position.set(-44, 100, 64);
  key.target.position.set(0, 20, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 7;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  key.shadow.camera.near = 60;
  key.shadow.camera.far = 260;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffffff', 0.9);
  rim.position.set(45, 40, -70);
  scene.add(rim);
  const fire = new THREE.PointLight('#ff8a3a', 0, 26, 1.6);
  fire.position.set(0, DECK + 0.2, -1.6);
  scene.add(fire);

  // --- studio + table, as in the buoyancy lab -----------------------------------------------------
  scene.add(sweep());
  const tableTop = new THREE.Mesh(
    new RoundedBoxGeometry(TABLE.x1 - TABLE.x0, TABLE.t, TABLE.z1 - TABLE.z0, 4, 0.5),
    new THREE.MeshPhysicalMaterial({
      color: '#f6f6f4',
      roughness: 0.42,
      roughnessMap: T.speckle(256, 13),
      clearcoat: 0.25,
      clearcoatRoughness: 0.3,
    }),
  );
  tableTop.position.set((TABLE.x0 + TABLE.x1) / 2, -TABLE.t / 2, (TABLE.z0 + TABLE.z1) / 2);
  tableTop.receiveShadow = true;
  scene.add(tableTop);
  const legLen = -TABLE.t - FLOOR_Y;
  const legSpots = [
    [TABLE.x0 + 4, TABLE.z0 + 4],
    [TABLE.x1 - 4, TABLE.z0 + 4],
    [TABLE.x0 + 4, TABLE.z1 - 4],
    [TABLE.x1 - 4, TABLE.z1 - 4],
  ];
  scene.add(
    new THREE.Mesh(
      merge(legSpots.map(([x, z]) => at(new THREE.CylinderGeometry(TABLE.leg, TABLE.leg, legLen, 20), x, -TABLE.t - legLen / 2, z))),
      new THREE.MeshStandardMaterial({ color: '#1d1d1f', metalness: 0.4, roughness: 0.45 }),
    ),
  );
  {
    const x0 = TABLE.x0 - 16;
    const z0 = TABLE.z0 - 16;
    const w = TABLE.x1 - TABLE.x0 + 32;
    const d = TABLE.z1 - TABLE.z0 + 32;
    const items: T.ShadowItem[] = [
      { shape: 'rect', x: (TABLE.x0 + TABLE.x1) / 2, z: (TABLE.z0 + TABLE.z1) / 2, w: 80, d: 50, alpha: 0.18 },
      ...legSpots.map(([x, z]): T.ShadowItem => ({ shape: 'round', x, z, w: 9, d: 9, alpha: 0.35 })),
    ];
    addDecal(scene, T.shadowSheet(x0, z0, w, d, 6, items), x0 + w / 2, z0 + d / 2, w, d, 0, 1, FLOOR_Y + 0.04);
  }
  // contact shadow of the plinth and the flywheel, baked
  addDecal(
    scene,
    T.shadowSheet(TABLE.x0, TABLE.z0, TABLE.x1 - TABLE.x0, TABLE.z1 - TABLE.z0, 12, [
      { shape: 'rect', x: 0, z: (PLINTH.z0 + PLINTH.z1) / 2, w: PLINTH.x * 2 + 3, d: PLINTH.z1 - PLINTH.z0 + 3, alpha: 0.5 },
      { shape: 'rect', x: 0, z: FLY_Z, w: 9, d: 4, alpha: 0.35 },
    ]),
    (TABLE.x0 + TABLE.x1) / 2,
    (TABLE.z0 + TABLE.z1) / 2,
    TABLE.x1 - TABLE.x0,
    TABLE.z1 - TABLE.z0,
    0,
    1,
    0.012,
  );

  // --- materials -------------------------------------------------------------------------------------
  const cut = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); // keeps z ≤ 0
  const clip = [cut];
  const speck = T.speckle();
  const brushed = T.brushed();
  // space-grey castings, the same finish as the buoyancy lab's spring scale: a shade darker than
  // the white set, so the engine reads as a framed object on white
  const paint = new THREE.MeshStandardMaterial({
    color: '#4a4e55',
    metalness: 0.6,
    roughness: 0.62,
    bumpMap: speck,
    bumpScale: 0.25,
    clippingPlanes: clip,
    clipShadows: true,
  });
  const honed = new THREE.MeshStandardMaterial({
    color: '#c3c7cc',
    metalness: 1,
    roughness: 1,
    roughnessMap: brushed,
    clippingPlanes: clip,
    clipShadows: true,
  });
  const pistonMat = new THREE.MeshStandardMaterial({
    color: '#d4d7da',
    metalness: 0.7,
    roughness: 1,
    roughnessMap: T.brushed(256, 0.5, 0.4),
    clippingPlanes: clip,
    clipShadows: true,
  });
  const steel = new THREE.MeshStandardMaterial({ color: '#b4b9bf', metalness: 1, roughness: 1, roughnessMap: brushed });
  const forged = new THREE.MeshStandardMaterial({ color: '#a3a8ae', metalness: 0.85, roughness: 1, roughnessMap: T.brushed(256, 0.48, 0.6) });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dde1', metalness: 1, roughness: 0.18 });
  const ironMat = new THREE.MeshStandardMaterial({ color: '#3d4045', metalness: 0.55, roughness: 0.6, bumpMap: speck, bumpScale: 0.4 });
  const plinthMat = new THREE.MeshStandardMaterial({ color: '#2b2c30', metalness: 0.1, roughness: 0.6 });
  const ceramic = new THREE.MeshPhysicalMaterial({ color: '#f4f2ec', roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const hotValve = new THREE.MeshStandardMaterial({ color: '#8c8178', metalness: 0.9, roughness: 0.45 });
  const blackMat = new THREE.MeshStandardMaterial({ color: '#1e1f22', metalness: 0.2, roughness: 0.6 });
  const whiteMark = new THREE.MeshStandardMaterial({ color: '#f2f2f0', roughness: 0.5 });
  // the cut faces: freshly machined aluminium, the brightest thing on the engine; the piston's a
  // touch whiter so it stands apart from the cylinder walls around it
  const capMat = new THREE.MeshStandardMaterial({
    color: '#d3d5d8',
    metalness: 0.4,
    roughness: 1,
    roughnessMap: T.brushed(256, 0.5, 0.7),
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });

  // --- plinth -------------------------------------------------------------------------------------
  const plinth = new THREE.Mesh(
    new RoundedBoxGeometry(PLINTH.x * 2, PLINTH.h, PLINTH.z1 - PLINTH.z0, 3, 0.4),
    plinthMat,
  );
  plinth.position.set(0, PLINTH.h / 2, (PLINTH.z0 + PLINTH.z1) / 2);
  plinth.castShadow = plinth.receiveShadow = true;
  scene.add(plinth);

  // --- the sectioned casing ---------------------------------------------------------------------------
  // every part is a closed solid; the stencil passes count how many of them each pixel of the cut
  // plane lies inside, and the cap plane fills those pixels
  const D = DECK;
  const P = (pts: number[][], dy = 0) => pts.map(([x, y]) => new THREE.Vector2(x, y + dy));
  const mirror = (pts: number[][]) => pts.map(([x, y]) => [-x, y]).reverse();
  // head, in four pieces around the chamber, the two ports and the plug well
  const lowL = [[-8.5, 0], [-4.1, 0], [-3.2, 0.7], [-4.4, 1.6], [-6.2, 2.2], [-8.5, 2.4]];
  const topL = [[-8.5, 4.8], [-6.2, 4.7], [-3.9, 4.4], [-1.9, 3.4], [-0.75, 1.6], [-0.75, HEAD_H], [-8.5, HEAD_H]];
  const coverL = [[-8, HEAD_H], [-7.3, HEAD_H], [-7.3, COVER_IN], [-0.75, COVER_IN], [-0.75, COVER_OUT], [-8, COVER_OUT]];
  const headDepth = 4.1;
  const headParts = [lowL, topL, coverL, mirror(lowL), mirror(topL), mirror(coverL)].map((pts) =>
    extrude(P(pts, D), -headDepth, headDepth),
  );
  const headBack = at(new RoundedBoxGeometry(17, COVER_OUT, 7 - headDepth, 2, 0.4), 0, D + COVER_OUT / 2, -(7 + headDepth) / 2);
  // crankcase: a C around the crank, open at the top where the bore comes in
  const RO = 8.4;
  const RI = 7.6;
  const caseOutline: THREE.Vector2[] = [];
  {
    const yi = Math.sqrt(RI * RI - BORE * BORE * 1.05);
    caseOutline.push(new THREE.Vector2(-6.2, CASE_TOP), new THREE.Vector2(-4.1, CASE_TOP), new THREE.Vector2(-4.1, YC + yi));
    const a0 = Math.atan2(yi, -4.1);
    const a1 = Math.atan2(yi, 4.1) + Math.PI * 2;
    for (let i = 1; i < 40; i++) {
      const a = a0 + ((a1 - a0) * i) / 40;
      caseOutline.push(new THREE.Vector2(Math.cos(a) * RI, YC + Math.sin(a) * RI));
    }
    caseOutline.push(new THREE.Vector2(4.1, YC + yi), new THREE.Vector2(4.1, CASE_TOP), new THREE.Vector2(6.2, CASE_TOP));
    caseOutline.push(new THREE.Vector2(RO, YC + 3));
    for (let i = 0; i <= 40; i++) {
      const a = -(Math.PI * i) / 40;
      caseOutline.push(new THREE.Vector2(Math.cos(a) * RO, YC + Math.sin(a) * RO));
    }
    caseOutline.push(new THREE.Vector2(-RO, YC + 3));
  }
  const crankcase = extrude(caseOutline, -6, 6);
  const caseBack = new THREE.CylinderGeometry(RO, RO, 1.2, 64);
  caseBack.rotateX(Math.PI / 2);
  caseBack.translate(0, YC, -6.6);
  const feet = [-5, 5].map((x) => at(new THREE.BoxGeometry(2.6, YC - RO + 2.2 - PLINTH.h, 12), x, (PLINTH.h + YC - RO + 2.2) / 2, -0.6));
  // cylinder barrel with cooling fins, and its honed liner
  const finProfile: THREE.Vector2[] = [new THREE.Vector2(4.6, CASE_TOP), new THREE.Vector2(5.8, CASE_TOP)];
  for (let y = CASE_TOP + 0.7; y < D - 0.7; y += 1.22) {
    finProfile.push(new THREE.Vector2(5.8, y), new THREE.Vector2(8.2, y + 0.08), new THREE.Vector2(8.2, y + 0.46), new THREE.Vector2(5.8, y + 0.54));
  }
  finProfile.push(new THREE.Vector2(5.8, D), new THREE.Vector2(4.6, D), new THREE.Vector2(4.6, CASE_TOP));
  const barrel = new THREE.LatheGeometry(finProfile, 48);
  const liner = new THREE.LatheGeometry(P([[4.0, CASE_TOP - 0.4], [4.6, CASE_TOP - 0.4], [4.6, D], [4.0, D], [4.0, CASE_TOP - 0.4]]), 48);

  const casingSolids = [...headParts, headBack, crankcase, caseBack, ...feet, barrel, liner];
  const housing = new THREE.Group();
  scene.add(housing);
  const castMeshes = [
    new THREE.Mesh(merge([...headParts.map((g) => g.clone()), headBack.clone(), crankcase.clone(), caseBack.clone(), ...feet.map((g) => g.clone())]), paint),
    new THREE.Mesh(barrel.clone(), paint),
    new THREE.Mesh(liner.clone(), honed),
  ];
  for (const m of castMeshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.renderOrder = 3;
    housing.add(m);
  }
  housing.add(stencilPasses(merge(casingSolids), cut, 1));

  // --- piston, sectioned too -------------------------------------------------------------------------
  const pistonProfile: number[][] = [[0, PIN_UP], [3.85, PIN_UP], [3.95, PIN_UP - 0.1]];
  for (const g of [0.55, 1.0, 1.45]) pistonProfile.push([3.95, PIN_UP - g], [3.68, PIN_UP - g], [3.68, PIN_UP - g - 0.2], [3.95, PIN_UP - g - 0.2]);
  pistonProfile.push([3.95, -SKIRT], [3.45, -SKIRT], [3.45, PIN_UP - 1.0], [0, PIN_UP - 1.0], [0, PIN_UP]);
  // lathe faces point outward only for a counter-clockwise outline (the stencil count relies on it)
  const pistonGeo = new THREE.LatheGeometry(P(pistonProfile.reverse()), 48);
  const pinGeo = new THREE.CylinderGeometry(0.8, 0.8, 7.3, 32);
  pinGeo.rotateX(Math.PI / 2);
  const bosses = [-1, 1].map((s) => {
    const g = new THREE.CylinderGeometry(1.3, 1.3, 2.4, 32);
    g.rotateX(Math.PI / 2);
    return g.translate(0, 0, s * 2.4);
  });
  const piston = new THREE.Group();
  const pistonBody = new THREE.Mesh(merge([pistonGeo.clone(), ...bosses.map((g) => g.clone())]), pistonMat);
  const pistonPin = new THREE.Mesh(pinGeo.clone(), honed);
  pistonBody.receiveShadow = true;
  pistonBody.renderOrder = pistonPin.renderOrder = 3;
  piston.add(pistonBody, pistonPin, stencilPasses(merge([pistonGeo, pinGeo, ...bosses]), cut, 2.2));
  scene.add(piston);

  // the caps: a plane in the cut, drawn where the stencil says we are inside metal; one for the
  // casing, then the stencil is cleared and counted again for the piston
  const caps = [capMat, pistonCapMat()].map((m, i) => {
    // just big enough to cover the casing's cut, so few pixels run the lit shader for nothing
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(17.4, D + COVER_OUT - PLINTH.h + 0.4), m);
    cap.position.set(0, (D + COVER_OUT + PLINTH.h) / 2, 0);
    cap.renderOrder = i === 0 ? 2 : 2.4;
    cap.receiveShadow = true;
    cap.onAfterRender = (r) => r.clearStencil();
    scene.add(cap);
    return cap;
  });
  void caps;
  function pistonCapMat() {
    const m = capMat.clone();
    m.color.set('#f1f2f3');
    m.metalness = 0.45;
    m.roughness = 0.38;
    return m;
  }

  // --- connecting rod, crank, flywheel: whole -----------------------------------------------------------
  const rod = new THREE.Mesh(rodGeometry(), forged);
  rod.receiveShadow = true;
  scene.add(rod);
  const crank = new THREE.Group();
  crank.position.set(0, YC, 0);
  scene.add(crank);
  const web = new THREE.Mesh(webGeometry(), forged);
  web.receiveShadow = true;
  const shaft = new THREE.Mesh(
    merge([
      at(new THREE.CylinderGeometry(1.5, 1.5, 9.2, 32), 0, 0, -6.2, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)),
      at(new THREE.CylinderGeometry(1.1, 1.1, 3.6, 32), 0, E.CRANK_R, -0.8, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)),
      at(new THREE.CylinderGeometry(1.45, 1.45, 0.3, 32), 0, E.CRANK_R, 1.0, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)),
    ]),
    steel,
  );
  crank.add(web, shaft);
  const flywheel = new THREE.Group();
  flywheel.position.set(0, YC, FLY_Z);
  scene.add(flywheel);
  const flyMesh = new THREE.Mesh(flywheelGeometry(), ironMat);
  flyMesh.castShadow = flyMesh.receiveShadow = true;
  // a white paint mark on the rim, so turning is easy to see
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.08), whiteMark);
  mark.position.set(0, FLY_R - 1.4, 1.16);
  flywheel.add(flyMesh, mark);

  // --- valves, springs, buckets, cams ---------------------------------------------------------------------
  interface ValveSet {
    group: THREE.Group;
    valve: THREE.Mesh;
    bucket: THREE.Mesh;
    spring: ReturnType<typeof springCoil>;
    cam: THREE.Mesh;
    sign: number;
  }
  const springMat = new THREE.MeshStandardMaterial({ color: '#6f757c', metalness: 0.9, roughness: 0.35 });
  const makeValve = (sign: number): ValveSet => {
    // the valve's own frame: origin at the seat centre, +y up its stem
    const group = new THREE.Group();
    group.position.set(sign * SEAT.x, D + SEAT.y, 0);
    group.rotation.z = -sign * VALVE_TILT; // the top leans outward
    scene.add(group);
    const head = new THREE.LatheGeometry(P([[0, -0.12], [VALVE_R, -0.12], [VALVE_R, 0.05], [0.42, 0.55], [0.2, 0.85], [0.2, BUCKET_AT + 0.2], [0, BUCKET_AT + 0.2]]), 40);
    const valve = new THREE.Mesh(head, sign < 0 ? steel : hotValve);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.8, 32), steel);
    const spring = springCoil(springMat, 0, 1.8, 0.62, 0.11, 6);
    group.add(valve, bucket, spring.mesh);
    // the cam: its outline is the lift curve wrapped around the camshaft at half crank speed
    const pts: THREE.Vector2[] = [];
    const N = 144;
    for (let i = 0; i < N; i++) {
      const th = (720 * i) / N;
      const lift = sign < 0 ? E.valveLift(th).intake : E.valveLift(th).exhaust;
      const r = CAM_BASE + lift * LIFT;
      const b = -Math.PI / 2 + (th * Math.PI) / 360; // the point that faces down the stem at angle th
      pts.push(new THREE.Vector2(Math.cos(b) * r, Math.sin(b) * r));
    }
    const camGeo = extrude(pts, -1.1, 1.1, 0.12);
    const shaftGeo = new THREE.CylinderGeometry(0.55, 0.55, 6.4, 24);
    shaftGeo.rotateX(Math.PI / 2);
    shaftGeo.translate(0, 0, -3.6);
    const cam = new THREE.Mesh(merge([camGeo, shaftGeo]), steel);
    cam.position.set(0, CAM_AT, 0);
    group.add(cam);
    return { group, valve, bucket, spring, cam, sign };
  };
  const valves = [makeValve(-1), makeValve(1)];

  // --- spark plug ---------------------------------------------------------------------------------------------
  const plug = new THREE.Group();
  plug.position.set(0, PLUG_TIP, 0);
  scene.add(plug);
  {
    const threadGeo = new THREE.CylinderGeometry(0.55, 0.55, HEAD_H - 1.45, 24);
    threadGeo.translate(0, (HEAD_H - 1.45) / 2, 0);
    const hex = new THREE.CylinderGeometry(1.05, 1.05, 0.9, 6);
    hex.translate(0, HEAD_H - 1.45 + 0.45, 0);
    const ground = new THREE.BoxGeometry(0.16, 0.6, 0.16);
    ground.translate(0.42, -0.3, 0);
    const groundTip = new THREE.BoxGeometry(0.56, 0.14, 0.16);
    groundTip.translate(0.2, -0.53, 0);
    plug.add(new THREE.Mesh(merge([threadGeo, hex, ground, groundTip]), chrome));
    const ins: number[][] = [[0, HEAD_H - 0.55], [0.62, HEAD_H - 0.55]];
    for (let i = 0; i < 5; i++) {
      const y = HEAD_H + 0.1 + i * 0.85;
      ins.push([0.62, y], [0.72, y + 0.2], [0.72, y + 0.5], [0.62, y + 0.7]);
    }
    ins.push([0.45, HEAD_H + 4.6], [0.3, HEAD_H + 5.4], [0, HEAD_H + 5.4]);
    const insulator = new THREE.Mesh(new THREE.LatheGeometry(P(ins), 32), ceramic);
    const tip = new THREE.CylinderGeometry(0.14, 0.14, 0.4, 12);
    tip.translate(0, -0.1, 0);
    const term = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16);
    term.translate(0, HEAD_H + 5.8, 0);
    plug.add(insulator, new THREE.Mesh(merge([tip, term]), steel));
  }

  // --- the diesel's injector, in the plug's place: a nozzle into the chamber and a fuel line on top ------------
  const injector = new THREE.Group();
  injector.position.copy(plug.position);
  injector.visible = false;
  scene.add(injector);
  {
    const below = HEAD_H - 1.45; // from the nozzle up to the top of the head
    const nozzle = new THREE.CylinderGeometry(0.3, 0.14, 0.5, 16);
    nozzle.translate(0, -0.05, 0);
    const body = new THREE.CylinderGeometry(0.5, 0.5, below, 24);
    body.translate(0, below / 2, 0);
    const upper = new THREE.CylinderGeometry(0.78, 0.78, 3.2, 32);
    upper.translate(0, below + 2.0, 0);
    injector.add(new THREE.Mesh(merge([nozzle, body, upper]), steel));
    const clamp = new THREE.CylinderGeometry(1.05, 1.05, 0.9, 6);
    clamp.translate(0, below + 0.45, 0);
    const cap = new THREE.CylinderGeometry(0.5, 0.62, 0.6, 24);
    cap.translate(0, below + 3.9, 0);
    const banjo = at(new THREE.CylinderGeometry(0.34, 0.34, 1.5, 20), 0.95, below + 3.0, 0, xAxisQ);
    injector.add(new THREE.Mesh(merge([clamp, cap, banjo]), chrome));
    const band = new THREE.CylinderGeometry(0.82, 0.82, 0.5, 32);
    band.translate(0, below + 1.3, 0);
    injector.add(new THREE.Mesh(band, blackMat));
    // the high-pressure fuel line runs back behind the head
    const line = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.6, below + 3.0, 0),
      new THREE.Vector3(2.6, below + 3.3, -0.8),
      new THREE.Vector3(3.0, below + 4.2, -3.2),
      new THREE.Vector3(3.0, below + 4.6, -7.0),
    ]);
    injector.add(new THREE.Mesh(new THREE.TubeGeometry(line, 24, 0.2, 10), steel));
    injector.traverse((o) => (o.castShadow = true));
  }

  // --- intake: manifold, carburettor, air filter; exhaust: header and silencer ---------------------------------
  const pipes = new THREE.Group();
  scene.add(pipes);
  // petrol: the carburettor mixes fuel into the air; a diesel draws plain air through a bare pipe
  const carb = new THREE.Mesh(new RoundedBoxGeometry(2.6, 3.4, 3.2, 2, 0.4), blackMat);
  const airPipe = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.7, 32), chrome);
  airPipe.visible = false;
  const xAxis = xAxisQ;
  {
    const polished = new THREE.Mesh(
      merge([
        at(new THREE.CylinderGeometry(1.25, 1.25, 3.2, 32), -10.0, PORT_Y, -1.5, xAxis),
        at(new THREE.CylinderGeometry(1.7, 1.7, 0.5, 32), -8.75, PORT_Y, -1.5, xAxis),
      ]),
      chrome,
    );
    carb.position.set(-12.9, PORT_Y, -1.5);
    airPipe.position.set(-12.9, PORT_Y, -1.5);
    airPipe.quaternion.copy(xAxis);
    const filter = new THREE.Mesh(
      merge([
        at(new THREE.CylinderGeometry(3.1, 3.1, 4.0, 48), -16.2, PORT_Y + 0.4, -1.5, xAxis),
      ]),
      ironMat,
    );
    const filterLid = new THREE.Mesh(
      merge([
        at(new THREE.CylinderGeometry(3.25, 3.25, 0.45, 48), -18.3, PORT_Y + 0.4, -1.5, xAxis),
        at(new THREE.CylinderGeometry(3.25, 3.25, 0.45, 48), -14.1, PORT_Y + 0.4, -1.5, xAxis),
        at(new THREE.CylinderGeometry(0.5, 0.5, 0.6, 16), -18.7, PORT_Y + 0.4, -1.5, xAxis),
      ]),
      chrome,
    );
    const header = new THREE.Mesh(
      merge([
        at(new THREE.CylinderGeometry(1.25, 1.25, 3.2, 32), 10.0, PORT_Y, -1.5, xAxis),
        at(new THREE.CylinderGeometry(1.7, 1.7, 0.5, 32), 8.75, PORT_Y, -1.5, xAxis),
      ]),
      heatBlued(),
    );
    const muffler = new THREE.Mesh(
      merge([
        at(new THREE.CylinderGeometry(2.0, 2.0, 5.0, 40), 14.0, PORT_Y, -1.5, xAxis),
        at(new THREE.SphereGeometry(2.0, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), 11.5, PORT_Y, -1.5, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)),
        at(new THREE.SphereGeometry(2.0, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), 16.5, PORT_Y, -1.5, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2)),
      ]),
      chrome,
    );
    const tail = new THREE.Mesh(
      at(new THREE.CylinderGeometry(0.55, 0.55, 2.6, 20), 18.4, PORT_Y + 0.55, -1.5, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2 - 0.35)),
      steel,
    );
    for (const m of [polished, carb, airPipe, filter, filterLid, header, muffler, tail]) {
      m.castShadow = true;
      m.receiveShadow = true;
      pipes.add(m);
    }
  }
  const tailOut = new THREE.Vector3(19.6, PORT_Y + 1.0, -1.5);

  // --- the charge: a haze in the cylinder and specks that come in and go out ----------------------------------
  const gas = gasHaze();
  scene.add(gas.mesh);
  const specks = speckCloud(150);
  scene.add(specks.mesh);
  const puffs = puffCloud(24);
  scene.add(puffs.points);
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#cfe4ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  spark.position.set(0.05, PLUG_TIP - 0.4, 0.5);
  spark.scale.setScalar(0.01);
  spark.renderOrder = 9;
  scene.add(spark);

  // --- quality ----------------------------------------------------------------------------------------------
  let tier = 0;
  let size = { w: 1, h: 1 };
  function applySize() {
    const t = TIERS[tier];
    const pr = Math.min(window.devicePixelRatio || 1, t.dpr, Math.sqrt(t.pixels / Math.max(1, size.w * size.h)));
    renderer.setPixelRatio(pr);
    renderer.setSize(size.w, size.h, false);
  }

  function frame(w: number, h: number, free: FreeArea) {
    target.set(VIEW.centerX, VIEW.centerY, 0);
    camera.position.copy(target).addScaledVector(viewDir, VIEW_DIST);
    camera.lookAt(target);
    const freeW = Math.max(w - free.left - free.right, w * 0.35);
    const freeH = Math.max(h - free.top - free.bottom, h * 0.35);
    const cx = free.left + freeW / 2;
    const cy = free.top + freeH / 2;
    const cmPerPx = Math.max(VIEW.height / freeH, VIEW.width / freeW);
    const fullW = 2 * Math.max(cx, w - cx);
    const fullH = 2 * Math.max(cy, h - cy);
    camera.aspect = fullW / fullH;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((fullH * cmPerPx) / 2 / VIEW_DIST));
    camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, w, h);
    camera.updateProjectionMatrix();
  }

  // --- per frame ----------------------------------------------------------------------------------------------
  const anchors: Anchors = {
    intake: new THREE.Vector3(-10.4, PORT_Y + 1.6, -1.5),
    exhaust: new THREE.Vector3(10.4, PORT_Y + 1.6, -1.5),
    plug: new THREE.Vector3(0, D + HEAD_H + 6.6, 0),
    piston: new THREE.Vector3(-8.6, 0, 0),
    fins: new THREE.Vector3(-8.8, (CASE_TOP + DECK) / 2, 0),
    crank: new THREE.Vector3(-RO - 0.4, YC, 0),
    flywheel: new THREE.Vector3(11.4, YC - 6, FLY_Z),
  };
  const crankScreen = new THREE.Vector3();
  let lastTheta = 0;
  let lastTime = -1;

  function update(f: SceneFrame) {
    const th = f.theta;
    const diesel = f.kind === 'diesel';
    plug.visible = !diesel;
    injector.visible = diesel;
    carb.visible = !diesel;
    airPipe.visible = diesel;
    anchors.plug.y = D + HEAD_H + (diesel ? 4.9 : 6.6);
    const a = THREE.MathUtils.degToRad(th);
    const pinY = YC + E.pinHeight(th);
    piston.position.set(0, pinY, 0);
    const cpX = E.CRANK_R * Math.sin(a);
    const cpY = YC + E.CRANK_R * Math.cos(a);
    rod.position.set(cpX, cpY, 0);
    rod.rotation.z = Math.atan2(cpX, pinY - cpY);
    crank.rotation.z = -a;
    flywheel.rotation.z = -a;
    anchors.piston.y = pinY + 0.5;

    const lift = E.valveLift(th);
    for (const v of valves) {
      const l = (v.sign < 0 ? lift.intake : lift.exhaust) * LIFT;
      v.valve.position.y = -l;
      v.bucket.position.y = BUCKET_AT + 0.4 - l;
      v.spring.mesh.position.y = BUCKET_AT - l;
      v.spring.setLength(BUCKET_AT - l - (HEAD_H - SEAT.y) / Math.cos(VALVE_TILT));
      v.cam.rotation.z = -a / 2; // half crank speed; the outline already holds the timing
    }

    // gas
    const c = E.cycleAngle(th);
    const crown = pinY + PIN_UP;
    const dt = lastTime < 0 ? 0 : Math.max(0, f.time - lastTime);
    lastTime = f.time;
    const look = gasLook(c, f.burnt, f.kind);
    gas.set(crown, D, look, f.time, E.burnFraction(th, f.burnt));
    specks.update(c, crown, f.burnt, f.time, diesel);
    fire.intensity = look.heat * 30;

    // a puff from the silencer for every bit of exhaust pushed out
    const moved = Math.max(0, th - lastTheta);
    lastTheta = th;
    if (c >= 540 && moved > 0 && moved < 200) puffs.emit(moved, tailOut, f.burnt || c > 540);
    puffs.step(dt);

    // the spark: a short blue-white flash between the electrodes (a diesel has none: it lights itself)
    const s = f.sparkAge;
    const on = !diesel && s >= 0 && s < 0.22;
    const flick = on ? (1 - s / 0.22) * (0.75 + 0.25 * Math.sin(f.time * 90)) : 0;
    spark.scale.setScalar(0.01 + flick * 3.2);
    spark.material.opacity = flick;
    if (on) fire.intensity += flick * 14;
  }

  return {
    camera,
    update,
    setQuality(n) {
      tier = THREE.MathUtils.clamp(Math.round(n), 0, TIERS.length - 1);
      const t = TIERS[tier];
      applySize();
      const shadows = t.shadow > 0;
      if (shadows !== renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = shadows;
        scene.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
        });
      }
      if (shadows && key.shadow.mapSize.x !== t.shadow) {
        key.shadow.mapSize.set(t.shadow, t.shadow);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
      puffs.points.visible = t.extras;
      fire.visible = t.extras;
      specks.setDense(t.extras);
    },
    resize(w, h, free) {
      size = { w, h };
      applySize();
      frame(w, h, free);
    },
    render() {
      // point sprites are sized in drawing-buffer pixels per cm at unit distance
      puffs.setScale((renderer.getPixelRatio() * (camera.view ? camera.view.fullHeight : size.h)) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
      renderer.info.reset();
      renderer.render(scene, camera);
    },
    anchors() {
      return anchors;
    },
    crankOnScreen() {
      crankScreen.set(0, YC, 0).project(camera);
      return { x: (crankScreen.x * 0.5 + 0.5) * size.w, y: (-crankScreen.y * 0.5 + 0.5) * size.h };
    },
    info() {
      const r = renderer.info.render;
      return { calls: r.calls, triangles: r.triangles, dpr: renderer.getPixelRatio() };
    },
  };
}

// --- what the charge looks like through the cycle ---------------------------------------------------------------

export interface GasLook {
  color: THREE.Color;
  alpha: number;
  flame: THREE.Color; // colour behind the flame front
  heat: number; // 0..1, drives the glow and the light inside
}

const C = (h: string) => new THREE.Color(h);
const MIX = C('#a8d4e6');
const WARM = C('#f0b48a');
const AIR = C('#d3e8f0'); // a diesel draws in plain air: paler than the petrol mixture
const HOT_AIR = C('#f39a5c'); // and squeezes it harder, until it is hot enough to light the fuel
const HOT = C('#ffd166');
const RED = C('#e0592a');
const SMOKE = C('#6c6560');

export function gasLook(c: number, burnt: boolean, kind: E.Kind = 'petrol'): GasLook {
  const s = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
  const color = new THREE.Color();
  const flame = new THREE.Color();
  const diesel = kind === 'diesel';
  const fresh = diesel ? AIR : MIX;
  const base = diesel ? 0.24 : 0.32;
  let alpha = 0;
  let heat = 0;
  if (c < 180) {
    color.copy(fresh);
    alpha = base * s(0, 150, c);
  } else if (c < 360) {
    const k = s(180, 360, c);
    color.copy(fresh).lerp(diesel ? HOT_AIR : WARM, k * k * (diesel ? 1 : 0.85));
    alpha = base + (diesel ? 0.28 : 0.16) * k;
  } else if (c < 540) {
    if (burnt) {
      const cool = s(385, 540, c);
      color.copy(HOT).lerp(RED, Math.min(1, cool * 1.6)).lerp(SMOKE, s(0.45, 1, cool));
      alpha = 0.78 - 0.3 * cool;
      heat = c < 385 ? 1 : 1 - cool * 0.9;
    } else {
      const k = s(360, 540, c);
      color.copy(diesel ? HOT_AIR : WARM).lerp(fresh, k);
      alpha = base + (diesel ? 0.28 : 0.16) * (1 - k);
    }
  } else {
    color.copy(burnt ? SMOKE : fresh);
    alpha = (burnt ? 0.46 : base) * (1 - 0.7 * s(560, 715, c));
  }
  if (burnt && c >= E.SPARK_AT && c < 390) {
    flame.copy(HOT);
    heat = Math.max(heat, E.burnFraction(c, true));
  } else flame.copy(color);
  return { color, alpha, flame, heat };
}

// --- geometry helpers ----------------------------------------------------------------------------------------------

/** Place a geometry: optional rotation first, then a move. */
function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, q?: THREE.Quaternion): THREE.BufferGeometry {
  if (q) geo.applyQuaternion(q);
  return geo.translate(x, y, z);
}

/** Parts that share a material and never move apart are drawn as one mesh. */
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of geos) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (geos.some((g) => !g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(geos);
  if (!m) throw new Error('merge failed');
  for (const g of geos) g.dispose();
  m.clearGroups();
  return m;
}

/** A flat outline pushed out along z from z0 to z1: a closed solid. */
function extrude(pts: THREE.Vector2[], z0: number, z1: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts);
  const depth = z1 - z0 - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  g.translate(0, 0, z0 + bevel);
  return g;
}

/**
 * Two invisible passes that count, per pixel, how many of the clipped solids the cut plane is
 * inside (back faces add one, front faces take one away). The cap plane then fills those pixels.
 * Same scheme as three.js's clipping-stencil example.
 */
function stencilPasses(geo: THREE.BufferGeometry, plane: THREE.Plane, order: number): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc });
  const back = base.clone();
  back.side = THREE.BackSide;
  back.clippingPlanes = [plane];
  back.stencilFail = back.stencilZFail = back.stencilZPass = THREE.IncrementWrapStencilOp;
  const front = base.clone();
  front.side = THREE.FrontSide;
  front.clippingPlanes = [plane];
  front.stencilFail = front.stencilZFail = front.stencilZPass = THREE.DecrementWrapStencilOp;
  const m0 = new THREE.Mesh(geo, back);
  const m1 = new THREE.Mesh(geo, front);
  m0.renderOrder = m1.renderOrder = order;
  g.add(m0, m1);
  return g;
}

function rodGeometry(): THREE.BufferGeometry {
  const L = E.ROD_L;
  const R1 = 2.05;
  const R2 = 1.32;
  const al = Math.asin((R1 - R2) / L);
  const shape = new THREE.Shape();
  // outline: up the right side, round the small end, down the left side, round the big end
  shape.moveTo(Math.cos(al) * R1, Math.sin(al) * R1);
  shape.lineTo(Math.cos(al) * R2, L + Math.sin(al) * R2);
  shape.absarc(0, L, R2, al, Math.PI - al, false);
  shape.lineTo(-Math.cos(al) * R1, Math.sin(al) * R1);
  shape.absarc(0, 0, R1, Math.PI - al, Math.PI * 2 + al, false);
  const big = new THREE.Path();
  big.absarc(0, 0, 1.12, 0, Math.PI * 2, true);
  const small = new THREE.Path();
  small.absarc(0, L, 0.82, 0, Math.PI * 2, true);
  shape.holes.push(big, small);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2, curveSegments: 28 });
  g.translate(0, 0, -0.7);
  return g;
}

function webGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const r = E.CRANK_R;
  shape.absarc(0, r, 1.95, -0.35, Math.PI + 0.35, false);
  shape.lineTo(-2.7, 0.3);
  shape.absarc(0, 0, 6.0, Math.PI + 0.25, Math.PI * 2 - 0.25, false);
  shape.lineTo(2.7, 0.3);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2, curveSegments: 32 });
  g.translate(0, 0, -2.75);
  return g;
}

function flywheelGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, FLY_R, 0, Math.PI * 2, false);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const h = new THREE.Path();
    h.absarc(Math.cos(a) * 6.4, Math.sin(a) * 6.4, 2.3, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 1, curveSegments: 36 });
  g.translate(0, 0, -1.15);
  const hub = new THREE.CylinderGeometry(2.6, 2.6, 2.4, 40);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, 1.2);
  return merge([g, hub]);
}

/** Exhaust header steel, straw and blue where it leaves the hot head. */
function heatBlued(): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 8;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#5b4a7a');
  grad.addColorStop(0.3, '#9b7a52');
  grad.addColorStop(0.55, '#c9b08a');
  grad.addColorStop(1, '#d6d9dd');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // CylinderGeometry's v runs along its length; after turning it along x, v=1 is at -x... map along v
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return new THREE.MeshStandardMaterial({ map: t, metalness: 1, roughness: 0.25 });
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(220,235,255,0.9)');
  grad.addColorStop(0.45, 'rgba(140,180,255,0.35)');
  grad.addColorStop(1, 'rgba(120,160,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// --- the charge ---------------------------------------------------------------------------------------------------

/** Pent roof of the combustion chamber above |x|, relative to the deck (matches the head outline). */
function roofAt(ax: number): number {
  if (ax > 3.2) return Math.max(0, (0.7 * (4.1 - ax)) / 0.9);
  if (ax > 0.75) return 0.7 + (0.9 * (3.2 - ax)) / 2.45;
  return 1.6;
}

/**
 * The gas in the cylinder, as a few translucent sheets stacked behind the cut: each is trimmed
 * in the shader to the bore at its depth, between the piston crown and the roof. A flame front
 * grows from the plug after the spark.
 */
function gasHaze() {
  const layers = [-0.15, -1.6, -3.0];
  const geos = layers.map((z) => {
    const g = new THREE.PlaneGeometry(8.4, 13);
    g.translate(0, DECK - 4.4, z);
    return g;
  });
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCrown: { value: 0 },
      uDeck: { value: DECK },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color() },
      uFlame: { value: new THREE.Color() },
      uBurn: { value: 0 },
      uPlug: { value: new THREE.Vector3(0, PLUG_TIP - 0.4, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uCrown, uDeck, uTime, uAlpha, uBurn;
      uniform vec3 uColor, uFlame, uPlug;
      varying vec3 vW;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float roof(float ax) {
        if (ax > 3.2) return max(0.0, 0.7 * (4.1 - ax) / 0.9);
        if (ax > 0.75) return 0.7 + 0.9 * (3.2 - ax) / 2.45;
        return 1.6;
      }
      void main() {
        float ax = abs(vW.x);
        float hw = vW.y < uDeck ? sqrt(max(0.0, 15.9 - vW.z * vW.z)) : 4.05;
        float top = uDeck + roof(ax);
        float e = min(min(vW.y - uCrown, top - vW.y), hw - ax);
        if (e <= 0.0) discard;
        float edge = smoothstep(0.0, 0.45, e);
        vec2 q = vW.xy * 0.75;
        float n = noise(q + vec2(uTime * 0.35, -uTime * 0.22)) * 0.6 + noise(q * 2.3 - vec2(uTime * 0.5, uTime * 0.1)) * 0.4;
        float d = distance(vW, uPlug);
        float inside = uBurn > 0.0 ? 1.0 - smoothstep(uBurn - 0.9, uBurn, d) : 0.0;
        vec3 col = mix(uColor, uFlame, inside);
        float front = uBurn > 0.0 && uBurn < 9.0 ? exp(-pow((d - uBurn) / 0.5, 2.0)) : 0.0;
        col += vec3(1.0, 0.9, 0.6) * front * 1.4;
        float a = mix(uAlpha, max(uAlpha, 0.85), inside) + front * 0.4;
        float alpha = clamp(a * edge * (0.7 + 0.6 * n), 0.0, 1.0);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col * (0.85 + 0.3 * n), alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(merge(geos), mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return {
    mesh,
    set(crown: number, deck: number, look: GasLook, time: number, burn: number) {
      const u = mat.uniforms;
      u.uCrown.value = crown;
      u.uDeck.value = deck;
      u.uTime.value = time;
      u.uAlpha.value = look.alpha;
      (u.uColor.value as THREE.Color).copy(look.color);
      (u.uFlame.value as THREE.Color).copy(look.flame);
      u.uBurn.value = burn > 0 ? 0.4 + burn * 9 : 0;
      // stays visible at zero alpha, so its shader is built at start rather than mid-turn
    },
  };
}

/**
 * Specks of the charge: pale air and amber fuel. Their places are a pure function of the crank
 * angle, so turning by hand, running, or jumping to a stroke all look the same: during intake
 * each one comes in through the port past the open valve to its own spot in the cylinder; it is
 * squeezed with the gas; it glows when the flame reaches it; during exhaust it leaves through
 * the other port.
 */
function speckCloud(n: number) {
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', clippingPlanes: [] });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const rnd = mulberry(7);
  const slots = Array.from({ length: n }, (_, i) => {
    let x = 0;
    let z = 0;
    do {
      x = (rnd() * 2 - 1) * 3.5;
      z = -0.25 - rnd() * 3.2;
    } while (x * x + z * z > 13);
    return { x, z, h: 0.06 + rnd() * 0.88, fuel: i % 3 === 0, phase: rnd() * 6.28, r: i % 3 === 0 ? 0.15 : 0.1 };
  });
  // paths through the ports (x for the intake side; mirrored for the exhaust), y above the deck
  const port = [new THREE.Vector2(-8.6, 3.6), new THREE.Vector2(-5.6, 3.4), new THREE.Vector2(-3.4, 2.7), new THREE.Vector2(-2.6, 0.9)];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const air = C('#eef7fb');
  const fuel = C('#f2b33d');
  const glow = C('#fff1b8');
  const ember = C('#ff7a2c');
  const soot = C('#4c4744');
  const warmAir = C('#ffd0a0');
  const hotAir = C('#ff9a5a');
  const nozzle = new THREE.Vector3(0, PLUG_TIP - 0.35, -0.3);
  const SPRAY = 16; // crank degrees for the spray to reach across the chamber
  let dense = true;
  const p = new THREE.Vector3();
  const along = (pts: THREE.Vector2[], u: number, out: THREE.Vector3) => {
    const k = Math.min(pts.length - 1.0001, u * (pts.length - 1));
    const i = Math.floor(k);
    const f = k - i;
    out.x = pts[i].x + (pts[i + 1].x - pts[i].x) * f;
    out.y = DECK + pts[i].y + (pts[i + 1].y - pts[i].y) * f;
  };
  return {
    mesh,
    setDense(on: boolean) {
      dense = on;
    },
    update(c: number, crown: number, burnt: boolean, time: number, diesel = false) {
      let shown = 0;
      const use = dense ? n : Math.floor(n * 0.6);
      for (let i = 0; i < use; i++) {
        const s = slots[i];
        const enter = 5 + (i / n) * 125; // intake: starts coming in here, 40° to reach its spot
        const leave = 548 + (i / n) * 125; // exhaust: starts leaving here, 35° to get out
        // its spot in the cylinder, squeezed between crown and roof, with a slow tumble
        const top = DECK + roofAt(Math.abs(s.x));
        const sw = 0.35 * Math.sin(time * 1.1 + s.phase);
        const hx = s.x + 0.25 * Math.cos(time * 0.9 + s.phase);
        const hy = crown + (top - crown) * THREE.MathUtils.clamp(s.h + sw * 0.08, 0.04, 0.96);
        let visible = true;
        p.z = s.z;
        if (c < enter) visible = false;
        else if (c < enter + 40 && c < 180) {
          const u = (c - enter) / 40;
          if (u < 0.75) along(port, u / 0.75, p);
          else {
            along(port, 1, p);
            const v = (u - 0.75) / 0.25;
            p.x += (hx - p.x) * v;
            p.y += (hy - p.y) * v;
          }
          p.z = -1.2 + (s.z + 1.2) * Math.min(1, u * 1.5);
        } else if (c >= leave && c < leave + 35) {
          const u = (c - leave) / 35;
          if (u < 0.25) {
            along(port, 1, p);
            p.x = -p.x;
            const v = u / 0.25;
            p.x = hx + (p.x - hx) * v;
            p.y = hy + (p.y - hy) * v;
          } else {
            along(port, 1 - (u - 0.25) / 0.75, p);
            p.x = -p.x;
          }
          p.z = s.z + (-1.2 - s.z) * Math.min(1, u * 1.5);
        } else if (c >= leave + 35) visible = false;
        else {
          p.x = hx;
          p.y = hy;
        }
        // a diesel draws in air only: its fuel specks are sprayed in from the injector at the end of
        // compression, fanning out from the nozzle to their places, and are never there unburnt
        if (diesel && s.fuel) {
          if (!burnt || c < E.SPARK_AT) visible = false;
          else if (c < E.SPARK_AT + SPRAY) {
            const u = 1 - (1 - (c - E.SPARK_AT) / SPRAY) ** 2;
            p.set(nozzle.x + (hx - nozzle.x) * u, nozzle.y + (hy - nozzle.y) * u, nozzle.z + (s.z - nozzle.z) * u);
          }
        }
        if (!visible) continue;
        // colour: the charge, warmed by squeezing; glowing where the flame has been; then soot
        if (!burnt || c < E.SPARK_AT) {
          col.copy(s.fuel ? fuel : air);
          if (c >= 180 && c < 540) col.lerp(diesel ? hotAir : warmAir, (diesel ? 0.8 : 0.45) * Math.sin(Math.min(1, (c - 180) / 180) * Math.PI * 0.5));
        } else {
          const reach = 0.4 + E.burnFraction(c, true) * 9;
          const d = Math.hypot(p.x, p.y - (PLUG_TIP - 0.4), p.z);
          if (d > reach) col.copy(s.fuel ? fuel : air);
          else if (c < 540) {
            const cool = THREE.MathUtils.smoothstep(c, 380, 540);
            col.copy(glow).lerp(ember, Math.min(1, cool * 1.7)).lerp(soot, THREE.MathUtils.smoothstep(cool, 0.4, 1));
          } else col.copy(soot);
        }
        const r = s.r * (burnt && c >= E.SPARK_AT && c < 420 ? 1.25 : 1);
        m.makeScale(r, r, r).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(shown, m);
        mesh.setColorAt(shown, col);
        shown++;
      }
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

/** Exhaust puffs from the silencer: soft grey points that drift up and fade. */
function puffCloud(cap: number) {
  const pos = new Float32Array(cap * 3);
  const alpha = new Float32Array(cap);
  const sizes = new Float32Array(cap);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color('#77716c') } },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      uniform float uScale;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = aAlpha;
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = vA * smoothstep(1.0, 0.2, r);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  const live: { x: number; y: number; z: number; vx: number; vy: number; age: number; life: number; a: number }[] = [];
  let budget = 0;
  return {
    points,
    setScale(s: number) {
      mat.uniforms.uScale.value = s;
    },
    emit(degrees: number, at: THREE.Vector3, burnt: boolean) {
      budget += degrees / 14;
      while (budget >= 1) {
        budget -= 1;
        if (live.length >= cap) live.shift();
        live.push({
          x: at.x + (Math.random() - 0.5) * 0.3,
          y: at.y + (Math.random() - 0.5) * 0.3,
          z: at.z,
          vx: 2.2 + Math.random() * 1.5,
          vy: 1.6 + Math.random() * 1.2,
          age: 0,
          life: 1.4 + Math.random() * 0.8,
          a: burnt ? 0.42 : 0.2,
        });
      }
    },
    step(dt: number) {
      for (let i = live.length - 1; i >= 0; i--) {
        const q = live[i];
        q.age += dt;
        if (q.age > q.life) {
          live.splice(i, 1);
          continue;
        }
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vx *= 1 - dt * 0.9;
        q.vy += dt * 0.8;
      }
      for (let i = 0; i < cap; i++) {
        const q = live[i];
        if (q) {
          pos[i * 3] = q.x;
          pos[i * 3 + 1] = q.y;
          pos[i * 3 + 2] = q.z;
          const t = q.age / q.life;
          alpha[i] = q.a * (1 - t) * Math.min(1, q.age * 8);
          sizes[i] = 1.4 + t * 4.5;
        } else alpha[i] = 0;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    },
  };
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- studio (as the buoyancy lab) ------------------------------------------------------------------------------------

/** A bright studio with softboxes, used only to light reflections. */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(200, 120, 200), new THREE.MeshBasicMaterial({ color: '#8f9195', side: THREE.BackSide }));
  env.add(room);
  // negative fill: black flags beside the set put dark edges on metal
  const flag = (x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 110), new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.DoubleSide }));
    m.position.set(x, 10, z);
    m.lookAt(0, 10, 0);
    env.add(m);
  };
  flag(-96, 10);
  flag(96, 30);
  const softbox = (w: number, h: number, pos: [number, number, number], power: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  softbox(60, 34, [-55, 60, 50], 6);
  softbox(14, 70, [80, 10, -40], 3.5);
  softbox(70, 10, [0, 58, -70], 2);
  softbox(90, 50, [50, 20, 95], 1.6);
  softbox(160, 40, [0, -55, 0], 0.9);
  return env;
}

function sweep(): THREE.Mesh {
  const W = 800;
  const r = 60;
  const zBack = -90;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) prof.push([FLOOR_Y, 260 - i * ((260 - (zBack + r)) / 10)]);
  for (let i = 1; i <= 20; i++) {
    const t = (i / 20) * (Math.PI / 2);
    prof.push([FLOOR_Y + r - r * Math.cos(t), zBack + r - r * Math.sin(t)]);
  }
  for (let i = 1; i <= 8; i++) prof.push([FLOOR_Y + r + i * 50, zBack]);
  const pos: number[] = [];
  const idx: number[] = [];
  prof.forEach(([y, z]) => pos.push(-W / 2, y, z, W / 2, y, z));
  for (let i = 0; i < prof.length - 1; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uInner: { value: new THREE.Color('#fbfbfc') }, uOuter: { value: new THREE.Color('#e4e4e8') } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInner;
      uniform vec3 uOuter;
      varying vec3 vW;
      void main() {
        float d = length((vW.xy - vec2(0.0, 26.0)) * vec2(0.55, 1.0));
        gl_FragColor = vec4(mix(uInner, uOuter, smoothstep(15.0, 120.0, d)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(g, mat);
}

function addDecal(
  parent: THREE.Object3D,
  map: THREE.Texture | null,
  x: number,
  z: number,
  w: number,
  d: number,
  yaw: number,
  opacity: number,
  y: number,
) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false }));
  m.position.set(x, y, z);
  m.rotation.y = yaw;
  m.renderOrder = 1;
  parent.add(m);
  return m;
}

/** Wire coil of a spring along +y from `bottom`, squeezed in place (from the buoyancy lab's scale). */
function springCoil(material: THREE.Material, bottom: number, refLen: number, radius: number, wire: number, coils: number) {
  const n = coils * 12;
  const radial = 6;
  const pts: THREE.Vector3[] = [];
  const centre = (t: number, len: number, v: THREE.Vector3) => {
    const ang = t * coils * Math.PI * 2;
    return v.set(Math.cos(ang) * radius, bottom - t * len, Math.sin(ang) * radius);
  };
  for (let i = 0; i <= n; i++) pts.push(centre(i / n, refLen, new THREE.Vector3()));
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, wire, radial);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  pos.setUsage(THREE.DynamicDrawUsage);
  const offset = new Float32Array(pos.count * 3);
  const tOf = new Float32Array(pos.count);
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (radial + 1)) / n;
    tOf[i] = t;
    centre(t, refLen, c);
    offset[i * 3] = pos.getX(i) - c.x;
    offset[i * 3 + 1] = pos.getY(i) - c.y;
    offset[i * 3 + 2] = pos.getZ(i) - c.z;
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  let current = refLen;
  return {
    mesh,
    /** The coil hangs down from the mesh origin by `len`. */
    setLength(len: number) {
      if (Math.abs(len - current) < 0.005) return;
      current = len;
      for (let i = 0; i < pos.count; i++) {
        centre(tOf[i], len, c);
        pos.setXYZ(i, c.x + offset[i * 3], c.y + offset[i * 3 + 1], c.z + offset[i * 3 + 2]);
      }
      pos.needsUpdate = true;
    },
  };
}
