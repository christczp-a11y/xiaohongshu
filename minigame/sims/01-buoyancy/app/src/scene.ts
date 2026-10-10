import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Liquid, Solid } from './data';
import type { Setup } from './physics';
import * as T from './textures';

// World units are centimetres; y is up and the table top is y = 0. A white
// photo studio with a minimal table, lit like a product shot.

const CUP_X = -2;
const CUP_FLOOR = 0.6; // glass base thickness, same offset the physics uses
const CUP_WALL = 0.3;
const CUP_HEIGHT = 17;
const BEAKER_X = 10.6;
const BEAKER_R = 3.6; // inner radius
const BEAKER_WALL = 0.22;
const BEAKER_FLOOR = 0.5;
const BEAKER_H = 9;
const ROD_X = -16;
const ROD_Z = -10;
const ROD_H = 64;
const BASE_H = 1.6;

// spring scale, local frame: y = 0 at the hanging ring, dial facing +z
const SC_W = 4.2;
const SC_DEPTH = 1.0;
const SC_TOP = -1.2;
const SC_LEN = 17;
const PLATE_W = 3.5;
const PLATE_H = 16.2;
const PLATE_TOP = SC_TOP - 0.4;
const P0 = -3; // pointer height at 0 N
const K = 1.2; // cm of stretch per newton
const DIAL_MAX = 10;
const SPRING_TOP = SC_TOP - 0.6;
const FACE_Z = SC_DEPTH / 2 + 0.3; // spring, pointer and pull rod ride here
const PULL_ROD = 15.9; // pointer to hook
const HOOK = 1.0;
const STRING_LEN = 4.5;
const EYE = 0.8; // cube top to where the string ties on

// table
const TABLE = { x0: -30, x1: 24, z0: -18, z1: 14, t: 2.4, leg: 0.9 };
const FLOOR_Y = -74;

const VIEW_AZIMUTH = THREE.MathUtils.degToRad(26);
const VIEW_ELEVATION = THREE.MathUtils.degToRad(12);
const VIEW_DIST = 125;

const G_CM = 980; // gravity, cm/s²

/** What the camera keeps in frame, in cm: the stand and both glasses, or
 *  just the cup when there is no scale. */
const RIG = { width: 46, height: 44, centerY: 16.5, centerX: -2 };
const CUP_ONLY = { width: 24, height: 27, centerY: 9.5, centerX: CUP_X };

/**
 * Rendering tiers, best first, inside the mini-tool's phone budget (drawing
 * buffer ≤ 2M pixels at DPR ≤ 1.5, then ≤ 1M at DPR 1). The page starts at 0
 * and steps down while frames run long; each step drops one costly effect.
 */
const TIERS = [
  { dpr: 1.5, pixels: 2.0e6, shadow: 2048, transmission: 1, extras: true },
  { dpr: 1, pixels: 1.0e6, shadow: 1024, transmission: 0.5, extras: true },
  { dpr: 1, pixels: 1.0e6, shadow: 0, transmission: 0.5, extras: true },
  // transmission 0: liquids drawn as plain tinted glass; no extras: no caustics, no glass over the dial
  { dpr: 1, pixels: 1.0e6, shadow: 0, transmission: 0, extras: false },
];
export const QUALITY_TIERS = TIERS.length;

export type Mode = 'weigh' | 'vary' | 'float';

/** CSS px along each edge that the UI covers; the rig is framed in the rest. */
export interface FreeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface InsetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Forces {
  G: number;
  Fb: number;
  Ft: number; // pull of the spring scale
  N: number; // support from the cup floor
}

export interface SceneFrame {
  cubeBottom: number; // above the cup floor
  level: number; // liquid surface above the cup floor
  beakerWater: number; // cm³
  overflowing: boolean;
  scaleReading: number;
  forces: Forces;
  time: number;
}

export interface SceneView {
  camera: THREE.PerspectiveCamera;
  update(f: SceneFrame): void;
  setMode(m: Mode): void;
  setSolid(id: Solid['id']): void;
  setLiquid(id: Liquid['id']): void;
  setArrows(on: boolean): void;
  setInset(rect: InsetRect | null): void;
  setQuality(tier: number): void;
  resize(w: number, h: number, free: FreeArea): void;
  render(): void;
  /** World positions for HTML labels. */
  anchors(): { G: THREE.Vector3; Fb: THREE.Vector3; Ft: THREE.Vector3; N: THREE.Vector3; cup: THREE.Vector3 };
  cmPerPixel(): number;
  /** Last frame's draw calls and triangles over every pass (shadow, transmission, main, inset). */
  info(): { calls: number; triangles: number; dpr: number };
}

/** `onFail` is called if a shader cannot be built on this device. */
export function createScene(canvas: HTMLCanvasElement, s: Setup, onFail: () => void): SceneView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.debug.onShaderError = () => onFail();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e4e4e8');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 10, 800);
  let view = RIG;
  const target = new THREE.Vector3(view.centerX, view.centerY, 0);
  const viewDir = new THREE.Vector3(
    Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
    Math.sin(VIEW_ELEVATION),
    Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
  );
  camera.position.copy(target).addScaledVector(viewDir, VIEW_DIST);
  camera.lookAt(target);
  camera.layers.enable(1); // force arrows live on layer 1

  // --- lights -------------------------------------------------------------------------
  const key = new THREE.SpotLight('#fffaf3', 3.4, 0, 0.55, 0.9, 0);
  key.position.set(-42, 92, 58);
  key.target.position.set(-2, 8, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 7;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  key.shadow.camera.near = 50;
  key.shadow.camera.far = 260;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffffff', 0.9);
  rim.position.set(45, 35, -70);
  scene.add(rim);
  const lightDir = new THREE.Vector2(key.target.position.x - key.position.x, key.target.position.z - key.position.z).normalize();
  const lightYaw = -Math.atan2(lightDir.y, lightDir.x);

  // --- studio + table -------------------------------------------------------------------------
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
  const legs = new THREE.Mesh(
    merge(legSpots.map(([x, z]) => at(new THREE.CylinderGeometry(TABLE.leg, TABLE.leg, legLen, 20), x, -TABLE.t - legLen / 2, z))),
    new THREE.MeshStandardMaterial({ color: '#1d1d1f', metalness: 0.4, roughness: 0.45 }),
  );
  scene.add(legs);
  // the soft shadow of the table and its feet on the studio floor, baked once
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

  // --- materials -------------------------------------------------------------------------------
  const glass = glassMaterials();
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    ior: 1.333,
    // thinner than the real column on purpose: at full depth the refraction
    // smears the submerged block, and the block is what the lesson is about
    thickness: 4,
    attenuationColor: new THREE.Color('#7cc6d2'),
    attenuationDistance: 13,
    specularIntensity: 1,
  });
  const ripple = T.ripple();
  ripple.repeat.set(1.6, 1.6);
  const liquidTop = liquidMat.clone();
  liquidTop.normalMap = ripple;
  liquidTop.normalScale.set(0.25, 0.25);
  liquidTop.thickness = 2;
  // the lowest tier skips the transmission pass: tinted, see-through liquid
  const liquidLite = new THREE.MeshStandardMaterial({
    color: '#7cc6d2',
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const liquidTopLite = liquidLite.clone();
  liquidTopLite.normalMap = ripple;
  liquidTopLite.normalScale.set(0.25, 0.25);
  liquidTopLite.opacity = 0.5;
  const cupWaves = rippleField(s.cupRadius - 0.02);
  const beakerWaves = rippleField(BEAKER_R - 0.02);
  const cupTop = withRipples(liquidTop.clone(), cupWaves);
  const beakerTop = withRipples(liquidTop.clone(), beakerWaves);
  const cupTopLite = withRipples(liquidTopLite.clone(), cupWaves);
  const beakerTopLite = withRipples(liquidTopLite.clone(), beakerWaves);

  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dde1', metalness: 1, roughness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 1, roughness: 0.3 });
  const castIron = new THREE.MeshStandardMaterial({
    color: '#2a2c2f',
    metalness: 0.3,
    roughness: 0.62,
    bumpMap: T.speckle(),
    bumpScale: 0.4,
  });
  const brushed = T.brushed();
  // space-grey casing: a shade darker than the backdrop so the scale reads as
  // a framed instrument on white
  const anodised = new THREE.MeshStandardMaterial({ color: '#5b6066', metalness: 0.75, roughness: 1, roughnessMap: brushed });
  const solids: Record<Solid['id'], THREE.Material> = {
    // bead-blasted, the way school sample blocks usually are
    aluminium: new THREE.MeshStandardMaterial({
      color: '#b6bbc1',
      metalness: 0.5,
      roughness: 1,
      roughnessMap: T.brushed(256, 0.5, 0.3),
      envMapIntensity: 0.7, // keep the key light's shading readable in a white room
    }),
    iron: new THREE.MeshStandardMaterial({
      color: '#74787d',
      metalness: 0.7,
      roughness: 1,
      roughnessMap: T.brushed(256, 0.5, 0.5),
    }),
    copper: new THREE.MeshStandardMaterial({
      color: '#d38d62',
      metalness: 1,
      roughness: 1,
      roughnessMap: T.brushed(256, 0.34, 0.4),
    }),
    wood: new THREE.MeshStandardMaterial({ map: T.maple(), roughness: 0.72 }),
    wax: new THREE.MeshPhysicalMaterial({ color: '#f1ebdd', roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 }),
  };

  // --- overflow cup ------------------------------------------------------------------------------
  const R = s.cupRadius;
  const cupGroup = new THREE.Group();
  cupGroup.position.set(CUP_X, 0, 0);
  scene.add(cupGroup);
  const cupProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(R + CUP_WALL - 0.25, 0),
    new THREE.Vector2(R + CUP_WALL, 0.25),
    new THREE.Vector2(R + CUP_WALL, CUP_HEIGHT - 0.1),
    new THREE.Vector2(R + CUP_WALL * 0.5, CUP_HEIGHT),
    new THREE.Vector2(R, CUP_HEIGHT - 0.1),
    new THREE.Vector2(R, CUP_FLOOR + 0.3),
    new THREE.Vector2(R - 0.3, CUP_FLOOR),
    new THREE.Vector2(0, CUP_FLOOR),
  ];
  cupGroup.add(glassMesh(new THREE.LatheGeometry(cupProfile, 96), glass));

  // spout: a glass tube leaving the wall at the spout height, angled down
  const spoutAngle = THREE.MathUtils.degToRad(24);
  const spoutLen = 5.2;
  const spoutStart = new THREE.Vector3(CUP_X + R - 0.4, CUP_FLOOR + s.spoutHeight + 0.35, 0);
  const spoutDir = new THREE.Vector3(Math.cos(spoutAngle), -Math.sin(spoutAngle), 0);
  const spoutEnd = spoutStart.clone().addScaledVector(spoutDir, spoutLen);
  const spoutMid = spoutStart.clone().lerp(spoutEnd, 0.5);
  const spoutQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), spoutDir);
  const lipQ = spoutQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  const spout = glassMesh(
    merge([
      at(new THREE.CylinderGeometry(0.62, 0.62, spoutLen, 32, 1, true), spoutMid.x, spoutMid.y, spoutMid.z, spoutQ),
      at(new THREE.TorusGeometry(0.62, 0.1, 8, 32), spoutEnd.x, spoutEnd.y, spoutEnd.z, lipQ),
    ]),
    glass,
  );
  scene.add(spout);

  // liquid columns are reshaped in place rather than scaled: transmission
  // stretches its refraction ray by the mesh scale, which would turn the
  // liquid opaque
  const cupLiquid = column(R - 0.02, 72, liquidMat);
  const cupLiquidTop = new THREE.Mesh(new THREE.CircleGeometry(R - 0.02, 72), cupTop);
  cupLiquidTop.rotation.x = -Math.PI / 2;
  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(R - 0.06, 0.06, 6, 72),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
  );
  meniscus.rotation.x = Math.PI / 2;
  meniscus.renderOrder = 4;
  cupGroup.add(cupLiquid.mesh, cupLiquidTop, meniscus);
  const spoutLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, spoutLen - 0.5, 16), liquidMat);
  spoutLiquid.position.copy(spoutMid);
  spoutLiquid.quaternion.copy(spoutQ);
  scene.add(spoutLiquid);

  // light through the liquid column: a faint shadow, baked, and a moving caustic
  const cupShadow = T.shadowSheet(TABLE.x0, TABLE.z0, TABLE.x1 - TABLE.x0, TABLE.z1 - TABLE.z0, 16, [
    { shape: 'ring', inner: 0.8, x: CUP_X, z: 0, w: ((R + CUP_WALL) * 2) / 0.8, d: ((R + CUP_WALL) * 2) / 0.8, alpha: 0.4 },
    { shape: 'glass', x: CUP_X + lightDir.x * 8.7, z: lightDir.y * 8.7, w: 35, d: 17.5, yaw: lightYaw, alpha: 0.13 },
  ]);
  tableDecal(scene, cupShadow, 0.013);
  const cupCaustic = causticMaterial('#fff6e6', 0.3);
  const caustics = [addDecal(scene, null, CUP_X + lightDir.x * 7.5, lightDir.y * 7.5, 15, 10, lightYaw, 1, 0.016, cupCaustic)];

  // --- catch beaker (scales A and B only) --------------------------------------------------
  const catcher = new THREE.Group();
  scene.add(catcher);
  const beaker = new THREE.Group();
  beaker.position.set(BEAKER_X, 0, 0);
  catcher.add(beaker);
  const BR = BEAKER_R;
  const bProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(BR + BEAKER_WALL - 0.2, 0),
    new THREE.Vector2(BR + BEAKER_WALL, 0.2),
    new THREE.Vector2(BR + BEAKER_WALL, BEAKER_H - 0.1),
    new THREE.Vector2(BR + BEAKER_WALL * 0.5, BEAKER_H),
    new THREE.Vector2(BR, BEAKER_H - 0.1),
    new THREE.Vector2(BR, BEAKER_FLOOR + 0.2),
    new THREE.Vector2(BR - 0.2, BEAKER_FLOOR),
    new THREE.Vector2(0, BEAKER_FLOOR),
  ];
  beaker.add(glassMesh(new THREE.LatheGeometry(bProfile, 64), glass));
  const mlPerCm = Math.PI * BR * BR;
  const markArc = 0.9;
  const marks = new THREE.Mesh(
    new THREE.CylinderGeometry(BR + BEAKER_WALL + 0.01, BR + BEAKER_WALL + 0.01, 8, 24, 1, true, VIEW_AZIMUTH - markArc / 2 - 0.25, markArc),
    new THREE.MeshStandardMaterial({ map: T.beakerMarks(8, mlPerCm, 300), transparent: true, depthWrite: false, roughness: 0.5 }),
  );
  marks.position.y = BEAKER_FLOOR + 4;
  marks.renderOrder = 7;
  beaker.add(marks);
  const bWater = column(BR - 0.02, 48, liquidMat);
  const bWaterTop = new THREE.Mesh(new THREE.CircleGeometry(BR - 0.02, 48), beakerTop);
  bWaterTop.rotation.x = -Math.PI / 2;
  beaker.add(bWater.mesh, bWaterTop);
  const beakerCaustic = causticMaterial('#fff6e6', 0);
  caustics.push(addDecal(catcher, null, BEAKER_X + lightDir.x * 4.5, lightDir.y * 4.5, 9, 6, lightYaw, 1, 0.016, beakerCaustic));
  const stream = streamMesh(liquidMat);
  catcher.add(stream.mesh);

  // --- iron stand + spring scale (scales A and B only) --------------------------------------
  const rig = new THREE.Group();
  scene.add(rig);
  const rigIron = new THREE.Mesh(
    merge([
      at(new RoundedBoxGeometry(10, BASE_H, 19, 3, 0.4), ROD_X, BASE_H / 2, ROD_Z + 7.5),
      at(new THREE.CylinderGeometry(1.0, 1.15, 0.8, 32), ROD_X, BASE_H + 0.4, ROD_Z),
    ]),
    castIron,
  );
  const rigChrome = new THREE.Mesh(
    merge([
      at(new THREE.CylinderGeometry(0.55, 0.55, ROD_H, 32), ROD_X, BASE_H + ROD_H / 2, ROD_Z),
      at(new THREE.SphereGeometry(0.55, 24, 12), ROD_X, BASE_H + ROD_H, ROD_Z),
    ]),
    chrome,
  );
  rig.add(rigIron, rigChrome);
  // the stand's base, the beaker and the glass's shadow go away together in 浮还是沉
  tableDecal(
    catcher,
    T.shadowSheet(TABLE.x0, TABLE.z0, TABLE.x1 - TABLE.x0, TABLE.z1 - TABLE.z0, 16, [
      { shape: 'rect', x: ROD_X, z: ROD_Z + 7.5, w: 13, d: 22, alpha: 0.45 },
      { shape: 'ring', inner: 0.8, x: BEAKER_X, z: 0, w: ((BR + BEAKER_WALL) * 2) / 0.8, d: ((BR + BEAKER_WALL) * 2) / 0.8, alpha: 0.35 },
      { shape: 'glass', x: BEAKER_X + lightDir.x * 5.3, z: lightDir.y * 5.3, w: 21, d: 10.5, yaw: lightYaw, alpha: 0.18 },
    ]),
    0.012,
  );

  // the boss and arm slide up and down the rod with the drag
  const armGroup = new THREE.Group();
  rig.add(armGroup);
  const armFrom = new THREE.Vector3(ROD_X, 0, ROD_Z);
  const armTo = new THREE.Vector3(CUP_X, 0, 0);
  const armDir = armTo.clone().sub(armFrom).normalize();
  const armLen = armTo.distanceTo(armFrom) + 0.8;
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3(-armDir.z, 0, armDir.x); // horizontal, across the arm
  const armQ = new THREE.Quaternion().setFromUnitVectors(up, armDir);
  const knob1Q = new THREE.Quaternion().setFromUnitVectors(up, side.clone().negate());
  const knob2Q = new THREE.Quaternion().setFromUnitVectors(up, armDir.clone().negate());
  const knob1At = armFrom.clone().addScaledVector(side, -1.4);
  const knob2At = armFrom.clone().addScaledVector(armDir, -1.4);
  // a thumbscrew: short threaded shaft with a ribbed head, along its own +y
  const knobPart = (r: number, h: number, y: number, seg: number, p: THREE.Vector3, q: THREE.Quaternion) =>
    at(new THREE.CylinderGeometry(r, r, h, seg).translate(0, y, 0), p.x, p.y, p.z, q);
  const armHookQ = new THREE.Quaternion().setFromAxisAngle(up, VIEW_AZIMUTH);
  armGroup.add(
    new THREE.Mesh(merge([at(new THREE.CylinderGeometry(0.42, 0.42, armLen, 24), 0, 0, 0, armQ).translate(
      armFrom.x + (armDir.x * armLen) / 2,
      0,
      armFrom.z + (armDir.z * armLen) / 2,
    )]), chrome),
    new THREE.Mesh(
      merge([
        at(new RoundedBoxGeometry(2.8, 2.8, 2.8, 3, 0.45), armFrom.x, armFrom.y, armFrom.z, new THREE.Quaternion().setFromAxisAngle(up, -Math.atan2(armDir.z, armDir.x))),
        knobPart(0.75, 0.55, 1.4, 18, knob1At, knob1Q),
        knobPart(0.75, 0.55, 1.4, 18, knob2At, knob2Q),
      ]),
      castIron,
    ),
    new THREE.Mesh(
      merge([
        knobPart(0.22, 1.2, 0.6, 12, knob1At, knob1Q),
        knobPart(0.22, 1.2, 0.6, 12, knob2At, knob2Q),
        at(new THREE.TorusGeometry(0.5, 0.11, 10, 32), CUP_X, -0.55, 0, armHookQ),
      ]),
      steel,
    ),
  );

  const scale = new THREE.Group();
  scale.rotation.y = VIEW_AZIMUTH;
  rig.add(scale);
  const scaleSteel = new THREE.Mesh(
    merge([
      at(new THREE.TorusGeometry(0.55, 0.1, 10, 28), 0, 0, 0, new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2)),
      at(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 12), 0, SC_TOP + 0.45, 0),
      at(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 20), 0, SPRING_TOP, FACE_Z),
      at(new RoundedBoxGeometry(1.2, 0.6, 0.9, 2, 0.15), 0, SC_TOP - SC_LEN + 0.3, FACE_Z - 0.1),
    ]),
    steel,
  );
  const casing = new THREE.Mesh(new RoundedBoxGeometry(SC_W, SC_LEN, SC_DEPTH, 3, 0.3), anodised);
  casing.position.y = SC_TOP - SC_LEN / 2;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(PLATE_W, PLATE_H),
    new THREE.MeshStandardMaterial({
      map: T.dialPlate({ width: PLATE_W, height: PLATE_H, top: PLATE_TOP, p0: P0, k: K, max: DIAL_MAX }),
      roughness: 0.55,
    }),
  );
  face.position.set(0, PLATE_TOP - PLATE_H / 2, SC_DEPTH / 2 + 0.01);
  const cover = glassMesh(new THREE.BoxGeometry(PLATE_W + 0.2, PLATE_H + 0.2, 0.08), glass);
  cover.position.set(0, PLATE_TOP - PLATE_H / 2, FACE_Z + 0.42);
  const spring = springCoil(steel, SPRING_TOP - 0.25, 4, 0.22, 0.045, 18);
  spring.mesh.position.set(0, 0, FACE_Z);
  // pointer, pull rod and hook move together; the hook is where the string hangs
  const pointer = new THREE.Group();
  const bar = new THREE.Mesh(
    new RoundedBoxGeometry(2.5, 0.16, 0.1, 1, 0.04),
    new THREE.MeshStandardMaterial({ color: '#d2352a', roughness: 0.35 }),
  );
  bar.position.z = 0.22;
  const pointerSteel = new THREE.Mesh(
    merge([
      new RoundedBoxGeometry(0.6, 0.45, 0.45, 2, 0.1),
      at(new THREE.CylinderGeometry(0.1, 0.1, PULL_ROD, 12), 0, -PULL_ROD / 2, -0.1),
      at(
        new THREE.TorusGeometry(0.5, 0.1, 10, 28, Math.PI * 1.45),
        0,
        -PULL_ROD - HOOK + 0.5,
        -0.1,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI * 0.78),
      ),
    ]),
    steel,
  );
  pointer.add(bar, pointerSteel);
  pointer.position.z = FACE_Z;
  scale.add(scaleSteel, casing, face, cover, spring.mesh, pointer);
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, STRING_LEN + 0.9, 8),
    new THREE.MeshStandardMaterial({ color: '#efeadc', roughness: 0.95 }),
  );
  rig.add(string);
  // shadows only from what is outside the casing and not already baked into the sheets
  for (const o of [rigChrome, ...armGroup.children, scaleSteel, casing, pointerSteel, string]) o.castShadow = true;
  // the dial close-up draws only the scale (layer 2), not the whole scene again
  scale.traverse((o) => o.layers.enable(2));

  // --- the cube --------------------------------------------------------------------------------------
  const a = s.cubeSide;
  const cubeYaw = VIEW_AZIMUTH - 0.6;
  const cube = new THREE.Mesh(new RoundedBoxGeometry(a, a, a, 4, 0.13), solids.aluminium);
  cube.rotation.y = cubeYaw;
  cube.castShadow = true;
  const fittings = new THREE.Mesh(
    merge([
      at(new THREE.TorusGeometry(0.32, 0.075, 10, 24), 0, a / 2 + 0.4, 0),
      at(new THREE.CylinderGeometry(0.15, 0.19, 0.2, 12), 0, a / 2 + 0.1, 0),
    ]),
    steel,
  );
  cube.add(fittings);
  scene.add(cube);

  // --- bubbles and drops ------------------------------------------------------------------------
  const beads = beadPool(40);
  scene.add(beads.mesh);

  // --- force arrows ------------------------------------------------------------------------------
  const arrows = new THREE.Group();
  arrows.rotation.y = VIEW_AZIMUTH;
  scene.add(arrows);
  // G, F浮, F拉, F支
  const forces = forceArrows(['#44454b', '#0071e3', '#8e8e93', '#8e8e93']);
  arrows.add(forces.group);
  arrows.traverse((o) => o.layers.set(1));

  // --- dial close-up camera ------------------------------------------------------------------------
  const insetCam = new THREE.PerspectiveCamera(22, 1, 1, 200);
  insetCam.layers.set(2);
  key.layers.enable(2);
  rim.layers.enable(2);
  const insetOffset = viewDir.clone().setY(0).normalize().multiplyScalar(15).add(new THREE.Vector3(0, 0.8, 0));
  let inset: InsetRect | null = null;

  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __lab: { scene, renderer } });

  // --- quality --------------------------------------------------------------------------------------
  const liquidSwaps: [THREE.Mesh, THREE.Material, THREE.Material][] = [
    [cupLiquid.mesh, liquidMat, liquidLite],
    [spoutLiquid, liquidMat, liquidLite],
    [bWater.mesh, liquidMat, liquidLite],
    [stream.mesh, liquidMat, liquidLite],
    [cupLiquidTop, cupTop, cupTopLite],
    [bWaterTop, beakerTop, beakerTopLite],
  ];
  let tier = 0;
  function applySize() {
    const t = TIERS[tier];
    const pr = Math.min(window.devicePixelRatio || 1, t.dpr, Math.sqrt(t.pixels / Math.max(1, size.w * size.h)));
    renderer.setPixelRatio(pr);
    renderer.setSize(size.w, size.h, false);
  }

  // --- api ---------------------------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const tips = { G: new THREE.Vector3(), Fb: new THREE.Vector3(), Ft: new THREE.Vector3(), N: new THREE.Vector3() };
  const cupAnchor = new THREE.Vector3(CUP_X - R - 0.6, CUP_HEIGHT - 1.5, 0);
  const anchorSet = { G: tips.G, Fb: tips.Fb, Ft: tips.Ft, N: tips.N, cup: cupAnchor };
  const streamStart = spoutEnd.clone().addScaledVector(spoutDir, 0.2);
  let cupLevel = -1;
  let beakerLevel = -1;
  let size = { w: 1, h: 1 };
  let lastFree: FreeArea = { top: 0, bottom: 0, left: 0, right: 0 };
  let cmPerPx = 0.1;
  let lift = 0; // extra height framed when the rig is raised
  let mode: Mode = 'weigh';
  let perN = 2;
  // what the water did last frame, for ripples, bubbles and the overflow
  let lastTime = -1;
  let lastSub = 0;
  let lastLevel = 0;
  let lastBottom = 0;
  let lastBeaker = 0;
  let flow = 0; // cm³/s into the beaker, smoothed
  let cupEmitAt = -9;
  let beakerEmitAt = -9;
  let dropClock = 0;

  function update(f: SceneFrame) {
    const bottomWorld = CUP_FLOOR + f.cubeBottom;
    cube.position.set(CUP_X, bottomWorld + a / 2, 0);
    const hasScale = mode !== 'float';
    let top = bottomWorld + a + 2;
    const dt = lastTime < 0 ? 0 : Math.min(Math.max(f.time - lastTime, 0), 0.05);
    lastTime = f.time;

    if (hasScale) {
      // hang the chain from the cube up: cube → string → hook → pull rod → pointer
      const knot = bottomWorld + a + EYE;
      const F = THREE.MathUtils.clamp(f.scaleReading, 0, DIAL_MAX);
      const pointerY = P0 - F * K;
      const hookY = pointerY - PULL_ROD - HOOK;
      const ringY = knot + STRING_LEN - hookY;
      scale.position.set(CUP_X, ringY, 0);
      armGroup.position.y = ringY + 1.1;
      string.position.set(CUP_X, knot + STRING_LEN / 2, 0);
      pointer.position.y = pointerY;
      spring.setLength(SPRING_TOP - 0.25 - (pointerY + 0.2));
      top = ringY;
      if (inset) {
        scale.updateMatrixWorld();
        const p = scale.localToWorld(tmp.set(0, pointerY, SC_DEPTH / 2));
        insetCam.position.copy(p).add(insetOffset);
        insetCam.lookAt(p);
      }
    }
    // let the camera ease up when the scale is lifted out of the base framing
    const want = Math.max(0, top + 7 - (view.centerY + view.height / 2));
    if (Math.abs(want - lift) > 0.02) {
      lift += (want - lift) * 0.12;
      frame(size.w, size.h, lastFree);
    }

    // liquid in the cup
    const lvl = Math.max(f.level, 0.01);
    if (Math.abs(lvl - cupLevel) > 0.003) {
      cupLevel = lvl;
      cupLiquid.set(lvl);
      cupLiquid.mesh.position.y = CUP_FLOOR + lvl / 2;
    }
    cupLiquidTop.position.y = CUP_FLOOR + lvl;
    meniscus.position.y = CUP_FLOOR + lvl;
    ripple.offset.set(f.time * 0.012, f.time * 0.009);
    spoutLiquid.visible = hasScale && f.level >= s.spoutHeight - 0.05;

    // the block breaking the surface sends rings out from its sides, and
    // drags a few bubbles under with it
    const sub = THREE.MathUtils.clamp(f.level - f.cubeBottom, 0, a);
    if (dt > 0) {
      const dSub = (sub - lastSub) / dt;
      const stir = Math.abs(dSub) + 3 * Math.abs((lvl - lastLevel) / dt) + (sub > 0 ? 0.15 * Math.abs((f.cubeBottom - lastBottom) / dt) : 0);
      if (stir > 0.6 && f.time - cupEmitAt > 0.16) {
        cupEmitAt = f.time;
        cupWaves.emit(0, 0, THREE.MathUtils.clamp(stir / 25, 0.05, 1), f.time, a * 0.62);
      }
      if (dSub > 2 && sub < a) {
        const n = Math.min(4, Math.floor(dSub * dt * 5 + Math.random()));
        for (let i = 0; i < n; i++) spawnBubble(bottomWorld + Math.random() * 0.4);
      }
      if (lastSub < a - 1e-3 && sub >= a - 1e-3) {
        for (let i = 0; i < 5; i++) spawnBubble(bottomWorld + a + Math.random() * 0.3);
      }
    }
    lastSub = sub;
    lastLevel = lvl;
    lastBottom = f.cubeBottom;
    cupWaves.uniforms.uTime.value = f.time;

    // beaker
    const bh = f.beakerWater / (Math.PI * (BR - 0.02) ** 2);
    bWater.mesh.visible = bWaterTop.visible = f.beakerWater > 0.5;
    if (Math.abs(bh - beakerLevel) > 0.003) {
      beakerLevel = bh;
      bWater.set(Math.max(bh, 0.01));
      bWater.mesh.position.y = BEAKER_FLOOR + bh / 2;
    }
    bWaterTop.position.y = BEAKER_FLOOR + bh;
    beakerWaves.uniforms.uTime.value = f.time;

    // overflow: a jet when it pours, single drops when it only dribbles
    if (dt > 0) flow += ((f.beakerWater - lastBeaker) / dt - flow) * Math.min(1, dt * 6);
    lastBeaker = f.beakerWater;
    if (!hasScale || f.beakerWater < lastBeaker - 1) flow = 0;
    const waterTop = BEAKER_FLOOR + Math.max(bh, 0);
    stream.mesh.visible = hasScale && flow > 5;
    if (stream.mesh.visible) {
      const landX = stream.shape(streamStart, spoutDir, flow, waterTop, BEAKER_X + BR * 0.35);
      if (f.time - beakerEmitAt > 0.1 && f.beakerWater > 0.5) {
        beakerEmitAt = f.time;
        beakerWaves.emit(landX - BEAKER_X, 0, THREE.MathUtils.clamp(flow / 30, 0.15, 0.6), f.time, 0.25);
      }
    } else if (hasScale && flow > 0.05) {
      dropClock += dt * Math.min(flow / 0.6, 12);
      while (dropClock >= 1) {
        dropClock -= 1;
        beads.spawn(1, streamStart.x, streamStart.y - 0.1, 0, spoutDir.x * 6, spoutDir.y * 6, 0, 0.12 + Math.random() * 0.05);
      }
    }
    beads.step(dt, (b) => {
      if (b.kind === 0) {
        // a bubble pops at the surface
        if (b.y >= CUP_FLOOR + lvl - b.r) {
          cupWaves.emit(b.x - CUP_X, -b.z, 0.08, f.time, 0.1);
          return false;
        }
        return true;
      }
      if (b.y <= waterTop && Math.abs(b.x - BEAKER_X) < BR) {
        if (f.beakerWater > 0.5) beakerWaves.emit(b.x - BEAKER_X, -b.z, 0.25, f.time, 0.15);
        return false;
      }
      return b.y > 0;
    });
    beads.mesh.visible = hasScale || beads.live > 0;

    cupCaustic.uniforms.uTime.value = f.time;
    beakerCaustic.uniforms.uTime.value = f.time;
    beakerCaustic.uniforms.uStrength.value = THREE.MathUtils.clamp(f.beakerWater / 60, 0, 1) * 0.25;

    // force arrows from the cube centre; the longest one is kept a readable
    // length, and all of them share that scale so they compare honestly
    const { G, Fb, Ft, N } = f.forces;
    const wantPerN = THREE.MathUtils.clamp(7 / Math.max(G, Fb + Ft + N, 0.1), 0.6, 6);
    perN += (wantPerN - perN) * 0.15;
    forces.set(0, 0, -1, G * perN);
    forces.set(1, -1.1, 1, Fb * perN);
    forces.set(2, 1.1, 1, Ft * perN);
    forces.set(3, 1.1, 1, N * perN);
    arrows.position.copy(cube.position).addScaledVector(viewDir, a * 0.75);
    arrows.updateMatrixWorld();
    arrows.localToWorld(tips.G.set(0, -G * perN, 0));
    arrows.localToWorld(tips.Fb.set(-1.1, Fb * perN, 0));
    arrows.localToWorld(tips.Ft.set(1.1, Ft * perN, 0));
    arrows.localToWorld(tips.N.set(1.1, N * perN, 0));
  }

  /** A bubble just outside one of the block's side faces, at height y. */
  function spawnBubble(y: number) {
    const u = (Math.random() - 0.5) * a;
    const out = a / 2 + 0.12;
    const k = Math.floor(Math.random() * 4);
    const lx = k === 0 ? out : k === 1 ? -out : u;
    const lz = k === 2 ? out : k === 3 ? -out : u;
    const c = Math.cos(cubeYaw);
    const sn = Math.sin(cubeYaw);
    const x = CUP_X + lx * c + lz * sn;
    const z = -lx * sn + lz * c;
    beads.spawn(0, x, y, z, 0, 14 + Math.random() * 10, 0, 0.05 + Math.random() * 0.1);
  }

  function frame(w: number, h: number, free: FreeArea) {
    target.set(view.centerX, view.centerY + lift / 2, 0);
    camera.position.copy(target).addScaledVector(viewDir, VIEW_DIST);
    camera.lookAt(target);
    // centre the rig in the uncovered area by shifting the view window
    const freeW = Math.max(w - free.left - free.right, w * 0.35);
    const freeH = Math.max(h - free.top - free.bottom, h * 0.35);
    const cx = free.left + freeW / 2;
    const cy = free.top + freeH / 2;
    cmPerPx = Math.max((view.height + lift) / freeH, view.width / freeW);
    const fullW = 2 * Math.max(cx, w - cx);
    const fullH = 2 * Math.max(cy, h - cy);
    camera.aspect = fullW / fullH;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((fullH * cmPerPx) / 2 / VIEW_DIST));
    camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, w, h);
    camera.updateProjectionMatrix();
  }

  const liquidLooks: Record<Liquid['id'], [string, number]> = {
    water: ['#7cc6d2', 13],
    brine: ['#9fcfc8', 10],
    alcohol: ['#cfe9ee', 24],
  };

  return {
    camera,
    update,
    setMode(m) {
      mode = m;
      const scaled = m !== 'float';
      // without the scale the overflow cup becomes a plain glass of liquid
      rig.visible = catcher.visible = spout.visible = scaled;
      fittings.visible = scaled;
      forces.show(2, scaled);
      forces.show(3, !scaled);
      view = scaled ? RIG : CUP_ONLY;
      lift = 0;
      flow = 0;
      beads.clear();
      frame(size.w, size.h, lastFree);
    },
    setSolid(id) {
      cube.material = solids[id];
    },
    setLiquid(id) {
      const [color, dist] = liquidLooks[id];
      for (const m of [liquidMat, cupTop, beakerTop]) {
        m.attenuationColor.set(color);
        m.attenuationDistance = dist;
      }
      for (const m of [liquidLite, cupTopLite, beakerTopLite]) m.color.set(color);
    },
    setArrows(on) {
      arrows.visible = on;
    },
    setInset(rect) {
      inset = rect;
      if (rect) {
        insetCam.aspect = rect.w / rect.h;
        insetCam.updateProjectionMatrix();
      }
    },
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
        for (const m of Object.values(solids)) m.needsUpdate = true;
      }
      if (shadows && key.shadow.mapSize.x !== t.shadow) {
        key.shadow.mapSize.set(t.shadow, t.shadow);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
      renderer.transmissionResolutionScale = t.transmission || 1;
      for (const c of caustics) c.visible = t.extras;
      cover.visible = t.extras;
      for (const [mesh, full, lite] of liquidSwaps) mesh.material = t.transmission ? full : lite;
    },
    resize(w, h, free) {
      size = { w, h };
      lastFree = free;
      applySize();
      frame(w, h, free);
    },
    render() {
      renderer.info.reset();
      renderer.render(scene, camera);
      if (inset && mode !== 'float') {
        const y = size.h - inset.y - inset.h;
        renderer.shadowMap.autoUpdate = false; // reuse the main pass's shadows
        renderer.setScissorTest(true);
        renderer.setScissor(inset.x, y, inset.w, inset.h);
        renderer.setViewport(inset.x, y, inset.w, inset.h);
        renderer.render(scene, insetCam);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.w, size.h);
        renderer.shadowMap.autoUpdate = true;
      }
    },
    anchors() {
      return anchorSet;
    },
    cmPerPixel() {
      return cmPerPx;
    },
    info() {
      const r = renderer.info.render;
      return { calls: r.calls, triangles: r.triangles, dpr: renderer.getPixelRatio() };
    },
  };
}

// -----------------------------------------------------------------------------------------------------

/** Place a geometry: optional rotation first, then a move. */
function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, q?: THREE.Quaternion): THREE.BufferGeometry {
  if (q) geo.applyQuaternion(q);
  return geo.translate(x, y, z);
}

/** Parts that share a material and never move apart are drawn as one mesh. */
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of geos) for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  // mergeGeometries needs all indexed or none (lathes and tubes are, extrusions aren't)
  if (geos.some((g) => !g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const m = mergeGeometries(geos);
  if (!m) throw new Error('merge failed');
  for (const g of geos) g.dispose();
  return m;
}

/** A bright studio with softboxes, used only to light reflections. */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(200, 120, 200),
    new THREE.MeshBasicMaterial({ color: '#8f9195', side: THREE.BackSide }),
  );
  env.add(room);
  // negative fill: black flags beside the set put dark edges on glass and
  // metal, the way product photographers keep white objects off a white sweep
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
  softbox(60, 34, [-55, 60, 50], 6); // key, matches the spotlight
  softbox(14, 70, [80, 10, -40], 3.5); // tall strip behind right
  softbox(70, 10, [0, 58, -70], 2); // top back
  softbox(90, 50, [50, 20, 95], 1.6); // big white card on the camera side
  softbox(160, 40, [0, -55, 0], 0.9); // light bouncing off the white table
  return env;
}

function sweep(): THREE.Mesh {
  // a photo-studio cyclorama: floor curving up into the back wall
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
  // unlit: a soft pool of light behind the bench fading to pale grey, so the
  // backdrop stays clean whatever the lights do
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: new THREE.Color('#fbfbfc') },
      uOuter: { value: new THREE.Color('#e4e4e8') },
    },
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
        float d = length((vW.xy - vec2(-2.0, 22.0)) * vec2(0.55, 1.0));
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
  material?: THREE.Material,
) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const mat = material ?? new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = yaw;
  m.renderOrder = 1;
  parent.add(m);
  return m;
}

/** A baked shadow sheet covering the whole table top. */
function tableDecal(parent: THREE.Object3D, map: THREE.Texture, y: number) {
  const w = TABLE.x1 - TABLE.x0;
  const d = TABLE.z1 - TABLE.z0;
  return addDecal(parent, map, TABLE.x0 + w / 2, TABLE.z0 + d / 2, w, d, 0, 1, y);
}

// Clear glass is mostly what it reflects plus darker edges where you look
// through more of it. Two layers fake that without hiding the liquid inside:
// one multiplies a tint that grows toward grazing angles, one adds reflections.
function glassMaterials() {
  const tint = new THREE.ShaderMaterial({
    uniforms: { uTint: { value: new THREE.Color('#5f6867') } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        f = pow(f, 1.8);
        gl_FragColor = vec4(mix(vec3(0.985), uTint, f), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
  });
  const shine = new THREE.MeshPhysicalMaterial({
    color: '#000000',
    roughness: 1,
    roughnessMap: T.smudge(),
    metalness: 0,
    specularIntensity: 1,
    envMapIntensity: 1.4,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return { tint, shine };
}

function glassMesh(geo: THREE.BufferGeometry, m: ReturnType<typeof glassMaterials>): THREE.Group {
  const g = new THREE.Group();
  const tint = new THREE.Mesh(geo, m.tint);
  const shine = new THREE.Mesh(geo, m.shine);
  tint.renderOrder = 5;
  shine.renderOrder = 6;
  g.add(tint, shine);
  return g;
}

function causticMaterial(color: THREE.ColorRepresentation, strength: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      // light bent by the liquid column gathers into a soft crescent on the
      // far side, mottled by the moving surface
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float r = length(q * vec2(1.0, 1.35));
        float arc = exp(-pow((r - 0.5) * 6.0, 2.0)) * smoothstep(-0.3, 0.7, q.x);
        float core = exp(-dot(q, q) * 5.0) * 0.35;
        float t = uTime;
        float mottle = 0.7 + 0.3 * sin(q.x * 9.0 + t * 0.9 + sin(q.y * 7.0 - t * 0.6) * 1.5)
                           * sin(q.y * 11.0 - t * 0.7 + sin(q.x * 6.0 + t * 0.5) * 1.5);
        float c = (arc + core) * mottle;
        float mask = smoothstep(1.0, 0.6, length(q));
        gl_FragColor = vec4(uColor * c * mask * uStrength, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** An open cylinder of liquid whose height is changed in place, centred on its origin. */
function column(radius: number, segments: number, material: THREE.Material) {
  const geo = new THREE.CylinderGeometry(radius, radius, 1, segments, 1, true);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const sign = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) sign[i] = Math.sign(pos.getY(i));
  pos.setUsage(THREE.DynamicDrawUsage);
  const mesh = new THREE.Mesh(geo, material);
  return {
    mesh,
    set(height: number) {
      for (let i = 0; i < pos.count; i++) pos.setY(i, (sign[i] * height) / 2);
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
    },
  };
}

/**
 * Rings spreading over a liquid surface, drawn by tilting its normals (no
 * extra geometry). Each emit starts a ring at (x, y) on the disc, in cm.
 */
function rippleField(radius: number) {
  const SLOTS = 8;
  const drops: THREE.Vector4[] = [];
  const starts: number[] = [];
  for (let i = 0; i < SLOTS; i++) {
    drops.push(new THREE.Vector4(0, 0, -100, 0));
    starts.push(0.1);
  }
  let next = 0;
  const uniforms = {
    uTime: { value: 0 },
    uRadius: { value: radius },
    uDrops: { value: drops },
    uStart: { value: starts },
  };
  return {
    uniforms,
    emit(x: number, y: number, amp: number, time: number, r0: number) {
      drops[next].set(x, y, time, amp);
      starts[next] = r0;
      next = (next + 1) % SLOTS;
    },
  };
}

function withRipples<M extends THREE.MeshStandardMaterial>(material: M, field: ReturnType<typeof rippleField>): M {
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, field.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRipple;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRipple = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vRipple;
        uniform float uTime;
        uniform float uRadius;
        uniform vec4 uDrops[8];
        uniform float uStart[8];
        // capillary-gravity rings: a short wave packet running outwards at
        // ~18 cm/s, fading with time and spreading as 1/sqrt(r)
        vec2 rippleSlope(vec2 uv) {
          vec2 p = (uv * 2.0 - 1.0) * uRadius;
          vec2 g = vec2(0.0);
          for (int i = 0; i < 8; i++) {
            vec4 d = uDrops[i];
            float age = uTime - d.z;
            if (age < 0.0 || age > 3.0) continue;
            vec2 q = p - d.xy;
            float r = length(q) + 1e-3;
            float x = r - uStart[i] - 18.0 * age;
            float env = exp(-x * x * 1.2) * exp(-age * 1.6) * sqrt(uStart[i] / max(r, uStart[i]));
            g += d.w * 0.35 * 5.7 * cos(5.7 * x) * env * (q / r);
          }
          return g;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale;\n\tmapN.xy -= rippleSlope(vRipple);'),
      );
  };
  material.customProgramCacheKey = () => 'ripples';
  return material;
}

/** Wire coil of a spring that stretches in place: the turns spread, the wire stays round. */
function springCoil(material: THREE.Material, top: number, refLen: number, radius: number, wire: number, coils: number) {
  const n = coils * 12;
  const radial = 6;
  const pts: THREE.Vector3[] = [];
  const centre = (t: number, len: number, v: THREE.Vector3) => {
    const ang = t * coils * Math.PI * 2;
    return v.set(Math.cos(ang) * radius, top - t * len, Math.sin(ang) * radius);
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

/**
 * The overflow as a falling jet: a projectile from the spout lip whose radius
 * follows continuity (flow = π r² v), so it thins as it speeds up.
 */
function streamMesh(material: THREE.Material) {
  const RINGS = 24;
  const SIDES = 10;
  const count = (RINGS + 1) * (SIDES + 1);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const idx: number[] = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * (SIDES + 1) + j;
      const b = a + SIDES + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    /** Shape the jet for a flow (cm³/s) landing on a surface at yEnd; returns where it lands. */
    shape(start: THREE.Vector3, dir: THREE.Vector3, flow: number, yEnd: number, maxX: number): number {
      const drop = Math.max(start.y - yEnd, 0.5);
      // the fastest the water can leave and still land before maxX
      const reach = maxX - start.x;
      const slope = -dir.y / dir.x;
      const room = drop - reach * slope;
      const vMax = room > 0 ? Math.sqrt((G_CM * reach * reach) / (2 * dir.x * dir.x * room)) : 6;
      const v0 = Math.min(6 + flow * 0.9, vMax);
      const vx = v0 * dir.x;
      const vy = v0 * dir.y;
      const tEnd = (vy + Math.sqrt(vy * vy + 2 * G_CM * drop)) / G_CM;
      for (let i = 0; i <= RINGS; i++) {
        const t = (tEnd * i) / RINGS;
        const px = start.x + vx * t;
        const py = start.y + vy * t - 0.5 * G_CM * t * t;
        const ux = vx;
        const uy = vy - G_CM * t;
        const sp = Math.hypot(ux, uy);
        const r = Math.min(Math.max(Math.sqrt(flow / (Math.PI * sp)) * 0.85, 0.035), 0.3);
        // ring frame: in-plane normal and z
        const nx = -uy / sp;
        const ny = ux / sp;
        for (let j = 0; j <= SIDES; j++) {
          const th = (j / SIDES) * Math.PI * 2;
          const cx = Math.cos(th);
          const sz = Math.sin(th);
          const k = (i * (SIDES + 1) + j) * 3;
          nor[k] = cx * nx;
          nor[k + 1] = cx * ny;
          nor[k + 2] = sz;
          pos[k] = px + r * nor[k];
          pos[k + 1] = py + r * nor[k + 1];
          pos[k + 2] = r * sz;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.normal.needsUpdate = true;
      return start.x + vx * tEnd;
    },
  };
}

interface Bead {
  kind: 0 | 1; // 0 bubble rising in the cup, 1 drop falling from the spout
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  phase: number;
}

/**
 * Bubbles and drops: little silvery beads, all in one instanced draw. They are
 * opaque on purpose so the liquid's transmission pass sees (and bends) them.
 */
function beadPool(capacity: number) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
        float spec = pow(max(dot(n, normalize(v + vec3(-0.35, 0.8, 0.45))), 0.0), 40.0);
        vec3 c = mix(vec3(0.80, 0.88, 0.90), vec3(0.98), rim) + spec;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  const pool: Bead[] = [];
  for (let i = 0; i < capacity; i++) pool.push({ kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, phase: 0 });
  let live = 0;
  let clock = 0;
  const m = new THREE.Matrix4();
  return {
    mesh,
    get live() {
      return live;
    },
    spawn(kind: 0 | 1, x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number) {
      if (live >= capacity) return;
      const b = pool[live++];
      b.kind = kind;
      b.x = x;
      b.y = y;
      b.z = z;
      b.vx = vx;
      b.vy = vy;
      b.vz = vz;
      b.r = r;
      b.phase = Math.random() * 6.3;
    },
    clear() {
      live = 0;
      mesh.count = 0;
    },
    /** Move every bead; `keep` returns false for the ones that are done. */
    step(dt: number, keep: (b: Bead) => boolean) {
      clock += dt;
      let i = 0;
      while (i < live) {
        const b = pool[i];
        if (b.kind === 0) {
          // rising at terminal speed, wobbling side to side
          b.y += b.vy * dt;
          b.x += Math.sin(clock * 11 + b.phase) * 0.6 * dt;
          b.z += Math.cos(clock * 9 + b.phase) * 0.6 * dt;
        } else {
          b.vy -= G_CM * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.z += b.vz * dt;
        }
        if (keep(b)) {
          m.makeScale(b.r, b.kind === 1 ? b.r * 1.25 : b.r, b.r).setPosition(b.x, b.y, b.z);
          mesh.setMatrixAt(i, m);
          i++;
        } else {
          // swap the last live bead into this slot
          live--;
          const last = pool[live];
          pool[live] = b;
          pool[i] = last;
        }
      }
      mesh.count = live;
      if (live) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** The four force arrows as two draws: every fill, then every white halo
 *  behind them. Each arrow is an instance; its shaft is stretched in the
 *  vertex shader, so moving or resizing one costs no geometry upload. */
function forceArrows(colors: string[]) {
  // template along +y: shaft 0..1, head 1..2.15, dot at the origin
  const parts = (shaftR: number, headR: number, headH: number, withDot: boolean) => {
    const list: [THREE.BufferGeometry, number][] = [
      [new THREE.CylinderGeometry(shaftR, shaftR, 1, 14).translate(0, 0.5, 0), 1],
      [new THREE.ConeGeometry(headR, headH, 24).translate(0, 1.575, 0), 2],
    ];
    if (withDot) list.push([new THREE.SphereGeometry(0.28, 16, 8), 0]);
    const kinds: number[] = [];
    for (const [g, k] of list) for (let i = 0; i < g.attributes.position.count; i++) kinds.push(k);
    const geo = merge(list.map(([g]) => g));
    geo.setAttribute('kind', new THREE.Float32BufferAttribute(kinds, 1));
    return geo;
  };
  const n = colors.length;
  const lens = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  lens.setUsage(THREE.DynamicDrawUsage);
  const stretch = (m: THREE.Material) => {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float kind;\nattribute float aLen;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          transformed.y = kind > 1.5 ? transformed.y - 1.0 + aLen : kind > 0.5 ? transformed.y * aLen : transformed.y;`,
        );
    };
    m.customProgramCacheKey = () => 'arrow';
    return m;
  };
  const make = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
    geo.setAttribute('aLen', lens);
    const mesh = new THREE.InstancedMesh(geo, stretch(mat), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  };
  const fill = make(parts(0.15, 0.48, 1.15, true), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true }), 31);
  const halo = make(
    parts(0.24, 0.6, 1.357, false),
    new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, depthWrite: false, transparent: true, side: THREE.BackSide }),
    30,
  );
  const c = new THREE.Color();
  colors.forEach((col, i) => fill.setColorAt(i, c.set(col)));
  const group = new THREE.Group();
  group.add(halo, fill);
  const shown = colors.map(() => true);
  const m4 = new THREE.Matrix4();
  const flip = new THREE.Matrix4().makeRotationZ(Math.PI);
  return {
    group,
    show(i: number, on: boolean) {
      shown[i] = on;
    },
    set(i: number, x: number, dir: 1 | -1, len: number) {
      const visible = shown[i] && len > 0.05;
      if (!visible) m4.makeScale(0, 0, 0);
      else (dir === 1 ? m4.identity() : m4.copy(flip)).setPosition(x, 0, 0);
      fill.setMatrixAt(i, m4);
      halo.setMatrixAt(i, m4);
      lens.setX(i, Math.max(len - 1.15, 0.01));
      fill.instanceMatrix.needsUpdate = halo.instanceMatrix.needsUpdate = lens.needsUpdate = true;
    },
  };
}
