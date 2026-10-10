import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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

/** What the camera keeps in frame, in cm: the stand and both glasses, or
 *  just the cup when there is no scale. */
const RIG = { width: 46, height: 44, centerY: 16.5, centerX: -2 };
const CUP_ONLY = { width: 24, height: 27, centerY: 9.5, centerX: CUP_X };

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
  resize(w: number, h: number, free: FreeArea): void;
  render(): void;
  /** World positions for HTML labels. */
  anchors(): { G: THREE.Vector3; Fb: THREE.Vector3; Ft: THREE.Vector3; N: THREE.Vector3; cup: THREE.Vector3 };
  cmPerPixel(): number;
}

export function createScene(canvas: HTMLCanvasElement, s: Setup): SceneView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

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
  tableTop.castShadow = true;
  scene.add(tableTop);
  const legMat = new THREE.MeshStandardMaterial({ color: '#1d1d1f', metalness: 0.4, roughness: 0.45 });
  const legLen = -TABLE.t - FLOOR_Y;
  for (const [x, z] of [
    [TABLE.x0 + 4, TABLE.z0 + 4],
    [TABLE.x1 - 4, TABLE.z0 + 4],
    [TABLE.x0 + 4, TABLE.z1 - 4],
    [TABLE.x1 - 4, TABLE.z1 - 4],
  ]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.leg, TABLE.leg, legLen, 24), legMat);
    leg.position.set(x, -TABLE.t - legLen / 2, z);
    leg.castShadow = true;
    scene.add(leg);
    addDecal(scene, T.softBlob('round'), x, z, 9, 9, 0, 0.35, FLOOR_Y + 0.05);
  }
  addDecal(scene, T.softBlob('rect'), (TABLE.x0 + TABLE.x1) / 2, (TABLE.z0 + TABLE.z1) / 2, 80, 50, 0, 0.18, FLOOR_Y + 0.04);

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
  cupGroup.add(glassMesh(new THREE.LatheGeometry(cupProfile, 128), glass));

  // spout: a glass tube leaving the wall at the spout height, angled down
  const spoutAngle = THREE.MathUtils.degToRad(24);
  const spoutLen = 5.2;
  const spoutStart = new THREE.Vector3(CUP_X + R - 0.4, CUP_FLOOR + s.spoutHeight + 0.35, 0);
  const spoutDir = new THREE.Vector3(Math.cos(spoutAngle), -Math.sin(spoutAngle), 0);
  const spoutEnd = spoutStart.clone().addScaledVector(spoutDir, spoutLen);
  const spoutMid = spoutStart.clone().lerp(spoutEnd, 0.5);
  const spoutQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), spoutDir);
  const spout = glassMesh(new THREE.CylinderGeometry(0.62, 0.62, spoutLen, 40, 1, true), glass);
  spout.position.copy(spoutMid);
  spout.quaternion.copy(spoutQ);
  scene.add(spout);
  const spoutLip = glassMesh(new THREE.TorusGeometry(0.62, 0.1, 10, 40), glass);
  spoutLip.position.copy(spoutEnd);
  spoutLip.quaternion.copy(spoutQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  scene.add(spoutLip);

  // liquid columns are rebuilt rather than scaled: transmission stretches its
  // refraction ray by the mesh scale, which would turn the liquid opaque
  const cupLiquid = new THREE.Mesh(new THREE.BufferGeometry(), liquidMat);
  const cupLiquidTop = new THREE.Mesh(new THREE.CircleGeometry(R - 0.02, 128), liquidTop);
  cupLiquidTop.rotation.x = -Math.PI / 2;
  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(R - 0.06, 0.06, 6, 128),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
  );
  meniscus.rotation.x = Math.PI / 2;
  meniscus.renderOrder = 4;
  cupGroup.add(cupLiquid, cupLiquidTop, meniscus);
  const spoutLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, spoutLen - 0.5, 24), liquidMat);
  spoutLiquid.position.copy(spoutMid);
  spoutLiquid.quaternion.copy(spoutQ);
  scene.add(spoutLiquid);

  // light through the liquid column: a faint shadow and a moving caustic
  const lightDir = new THREE.Vector2(key.target.position.x - key.position.x, key.target.position.z - key.position.z).normalize();
  const lightYaw = -Math.atan2(lightDir.y, lightDir.x);
  const gShadow = T.glassShadow();
  addDecal(scene, T.softBlob('ring', 0.8), CUP_X, 0, ((R + CUP_WALL) * 2) / 0.8, ((R + CUP_WALL) * 2) / 0.8, 0, 0.4, 0.012);
  addDecal(scene, gShadow, CUP_X + lightDir.x * 8.7, lightDir.y * 8.7, 35, 17.5, lightYaw, 0.13, 0.014);
  const cupCaustic = causticMaterial('#fff6e6', 0.3);
  addDecal(scene, null, CUP_X + lightDir.x * 7.5, lightDir.y * 7.5, 15, 10, lightYaw, 1, 0.016, cupCaustic);

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
  beaker.add(glassMesh(new THREE.LatheGeometry(bProfile, 96), glass));
  const mlPerCm = Math.PI * BR * BR;
  const markArc = 0.9;
  const marks = new THREE.Mesh(
    new THREE.CylinderGeometry(BR + BEAKER_WALL + 0.01, BR + BEAKER_WALL + 0.01, 8, 24, 1, true, VIEW_AZIMUTH - markArc / 2 - 0.25, markArc),
    new THREE.MeshStandardMaterial({ map: T.beakerMarks(8, mlPerCm, 300), transparent: true, depthWrite: false, roughness: 0.5 }),
  );
  marks.position.y = BEAKER_FLOOR + 4;
  marks.renderOrder = 7;
  beaker.add(marks);
  const bWater = new THREE.Mesh(new THREE.BufferGeometry(), liquidMat);
  const bWaterTop = new THREE.Mesh(new THREE.CircleGeometry(BR - 0.02, 96), liquidTop);
  bWaterTop.rotation.x = -Math.PI / 2;
  beaker.add(bWater, bWaterTop);
  addDecal(catcher, T.softBlob('ring', 0.8), BEAKER_X, 0, ((BR + BEAKER_WALL) * 2) / 0.8, ((BR + BEAKER_WALL) * 2) / 0.8, 0, 0.35, 0.012);
  addDecal(catcher, gShadow, BEAKER_X + lightDir.x * 5.3, lightDir.y * 5.3, 21, 10.5, lightYaw, 0.18, 0.014);
  const beakerCaustic = causticMaterial('#fff6e6', 0);
  addDecal(catcher, null, BEAKER_X + lightDir.x * 4.5, lightDir.y * 4.5, 9, 6, lightYaw, 1, 0.016, beakerCaustic);
  const stream = new THREE.Mesh(new THREE.BufferGeometry(), liquidMat);
  catcher.add(stream);

  // --- iron stand + spring scale (scales A and B only) --------------------------------------
  const rig = new THREE.Group();
  scene.add(rig);
  const base = new THREE.Mesh(new RoundedBoxGeometry(10, BASE_H, 19, 3, 0.4), castIron);
  base.position.set(ROD_X, BASE_H / 2, ROD_Z + 7.5);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, ROD_H, 40), chrome);
  rod.position.set(ROD_X, BASE_H + ROD_H / 2, ROD_Z);
  const rodCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 12), chrome);
  rodCap.position.set(ROD_X, BASE_H + ROD_H, ROD_Z);
  const rodFoot = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.8, 32), castIron);
  rodFoot.position.set(ROD_X, BASE_H + 0.4, ROD_Z);
  rig.add(base, rod, rodCap, rodFoot);
  addDecal(rig, T.softBlob('rect'), ROD_X, ROD_Z + 7.5, 13, 22, 0, 0.45, 0.012);

  const armGroup = new THREE.Group(); // slides on the rod with the drag
  rig.add(armGroup);
  const armFrom = new THREE.Vector3(ROD_X, 0, ROD_Z);
  const armTo = new THREE.Vector3(CUP_X, 0, 0);
  const armDir = armTo.clone().sub(armFrom).normalize();
  const armLen = armTo.distanceTo(armFrom) + 0.8;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, armLen, 32), chrome);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir);
  arm.position.copy(armFrom).addScaledVector(armDir, armLen / 2);
  const boss = new THREE.Mesh(new RoundedBoxGeometry(2.8, 2.8, 2.8, 3, 0.45), castIron);
  boss.position.copy(armFrom);
  boss.rotation.y = -Math.atan2(armDir.z, armDir.x);
  const side = new THREE.Vector3(-armDir.z, 0, armDir.x); // horizontal, across the arm
  const knob1 = knob(castIron, steel);
  knob1.position.copy(armFrom).addScaledVector(side, -1.4);
  knob1.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), side.clone().negate());
  const knob2 = knob(castIron, steel);
  knob2.position.copy(armFrom).addScaledVector(armDir, -1.4);
  knob2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir.clone().negate());
  const armHook = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.11, 10, 32), steel);
  armHook.position.set(CUP_X, -0.55, 0);
  armHook.rotation.y = VIEW_AZIMUTH;
  armGroup.add(arm, boss, knob1, knob2, armHook);

  const scale = new THREE.Group();
  scale.rotation.y = VIEW_AZIMUTH;
  rig.add(scale);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 10, 28), steel);
  ring.rotation.y = Math.PI / 2;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 12), steel);
  stem.position.y = SC_TOP + 0.45;
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
  const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.5, 20), steel);
  anchor.position.set(0, SPRING_TOP, FACE_Z);
  const cover = glassMesh(new THREE.BoxGeometry(PLATE_W + 0.2, PLATE_H + 0.2, 0.08), glass);
  cover.position.set(0, PLATE_TOP - PLATE_H / 2, FACE_Z + 0.42);
  const guide = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.6, 0.9, 2, 0.15), steel);
  guide.position.set(0, SC_TOP - SC_LEN + 0.3, FACE_Z - 0.1);
  const spring = new THREE.Mesh(new THREE.BufferGeometry(), steel);
  spring.position.set(0, 0, FACE_Z);
  const pointer = new THREE.Group();
  const bar = new THREE.Mesh(
    new RoundedBoxGeometry(2.5, 0.16, 0.1, 1, 0.04),
    new THREE.MeshStandardMaterial({ color: '#d2352a', roughness: 0.35 }),
  );
  const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.45, 0.45, 2, 0.1), steel);
  bar.position.z = 0.22;
  pointer.add(bar, clamp);
  pointer.position.z = FACE_Z;
  const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, PULL_ROD, 12), steel);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 10, 28, Math.PI * 1.45), steel);
  hook.rotation.z = Math.PI * 0.78;
  scale.add(ring, stem, casing, face, anchor, cover, guide, spring, pointer, pull, hook);
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, STRING_LEN + 0.9, 8),
    new THREE.MeshStandardMaterial({ color: '#efeadc', roughness: 0.95 }),
  );
  rig.add(string);
  rig.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== cover.children[0] && o !== cover.children[1]) o.castShadow = true;
  });

  // --- the cube --------------------------------------------------------------------------------------
  const a = s.cubeSide;
  const cube = new THREE.Mesh(new RoundedBoxGeometry(a, a, a, 5, 0.13), solids.aluminium);
  cube.rotation.y = VIEW_AZIMUTH - 0.6;
  cube.castShadow = true;
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.075, 10, 24), steel);
  eye.position.y = a / 2 + 0.4;
  const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.2, 12), steel);
  stud.position.y = a / 2 + 0.1;
  cube.add(eye, stud);
  scene.add(cube);

  // --- force arrows ------------------------------------------------------------------------------
  const arrows = new THREE.Group();
  arrows.rotation.y = VIEW_AZIMUTH;
  scene.add(arrows);
  const arrowG = forceArrow('#1d1d1f');
  const arrowFb = forceArrow('#0071e3');
  const arrowFt = forceArrow('#8e8e93');
  const arrowN = forceArrow('#8e8e93');
  arrows.add(arrowG.group, arrowFb.group, arrowFt.group, arrowN.group);
  arrows.traverse((o) => o.layers.set(1));

  // --- dial close-up camera ------------------------------------------------------------------------
  const insetCam = new THREE.PerspectiveCamera(22, 1, 1, 200);
  let inset: InsetRect | null = null;

  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __lab: { scene, renderer, THREE } });

  // --- api ---------------------------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const tips = { G: new THREE.Vector3(), Fb: new THREE.Vector3(), Ft: new THREE.Vector3(), N: new THREE.Vector3() };
  const cupAnchor = new THREE.Vector3(CUP_X - R - 0.6, CUP_HEIGHT - 1.5, 0);
  let streamAmount = 0;
  let springLen = -1;
  let cupLevel = -1;
  let beakerLevel = -1;
  let size = { w: 1, h: 1 };
  let lastFree: FreeArea = { top: 0, bottom: 0, left: 0, right: 0 };
  let cmPerPx = 0.1;
  let lift = 0; // extra height framed when the rig is raised
  let mode: Mode = 'weigh';
  let perN = 2;

  function update(f: SceneFrame) {
    const bottomWorld = CUP_FLOOR + f.cubeBottom;
    cube.position.set(CUP_X, bottomWorld + a / 2, 0);
    const hasScale = mode !== 'float';
    let top = bottomWorld + a + 2;

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
      pull.position.set(0, pointerY - PULL_ROD / 2, FACE_Z - 0.1);
      hook.position.set(0, hookY + 0.5, FACE_Z - 0.1);
      const len = SPRING_TOP - 0.25 - (pointerY + 0.2);
      if (Math.abs(len - springLen) > 0.01) {
        springLen = len;
        spring.geometry.dispose();
        spring.geometry = helix(SPRING_TOP - 0.25, len, 0.22, 0.045, 18);
      }
      top = ringY;
      if (inset) {
        scale.updateMatrixWorld();
        const p = scale.localToWorld(tmp.set(0, pointerY, SC_DEPTH / 2));
        insetCam.position.copy(p).addScaledVector(viewDir.clone().setY(0).normalize(), 15).add(new THREE.Vector3(0, 0.8, 0));
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
      setColumn(cupLiquid, R - 0.02, lvl, 128);
      cupLiquid.position.y = CUP_FLOOR + lvl / 2;
    }
    cupLiquidTop.position.y = CUP_FLOOR + lvl;
    meniscus.position.y = CUP_FLOOR + lvl;
    ripple.offset.set(f.time * 0.012, f.time * 0.009);
    spoutLiquid.visible = hasScale && f.level >= s.spoutHeight - 0.05;

    // beaker
    const bh = f.beakerWater / (Math.PI * (BR - 0.02) ** 2);
    bWater.visible = bWaterTop.visible = f.beakerWater > 0.5;
    if (Math.abs(bh - beakerLevel) > 0.003) {
      beakerLevel = bh;
      setColumn(bWater, BR - 0.02, Math.max(bh, 0.01), 96);
      bWater.position.y = BEAKER_FLOOR + bh / 2;
    }
    bWaterTop.position.y = BEAKER_FLOOR + bh;

    // overflow stream
    streamAmount += ((f.overflowing ? 1 : 0) - streamAmount) * 0.25;
    stream.visible = streamAmount > 0.03;
    if (stream.visible) {
      const yEnd = BEAKER_FLOOR + Math.max(bh, 0);
      const start = spoutEnd.clone().addScaledVector(spoutDir, 0.2);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push(new THREE.Vector3(start.x + t * 1.6, start.y - (start.y - yEnd) * t * t, 0));
      }
      stream.geometry.dispose();
      stream.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.2 * streamAmount + 0.04, 12);
    }

    cupCaustic.uniforms.uTime.value = f.time;
    beakerCaustic.uniforms.uTime.value = f.time;
    beakerCaustic.uniforms.uStrength.value = THREE.MathUtils.clamp(f.beakerWater / 60, 0, 1) * 0.25;

    // force arrows from the cube centre; the longest one is kept a readable
    // length, and all of them share that scale so they compare honestly
    const { G, Fb, Ft, N } = f.forces;
    const wantPerN = THREE.MathUtils.clamp(7 / Math.max(G, Fb + Ft + N, 0.1), 0.6, 6);
    perN += (wantPerN - perN) * 0.15;
    arrowG.set(tmp.set(0, 0, 0), -1, G * perN);
    arrowFb.set(tmp.set(-1.1, 0, 0), 1, Fb * perN);
    arrowFt.set(tmp.set(1.1, 0, 0), 1, Ft * perN);
    arrowN.set(tmp.set(1.1, 0, 0), 1, N * perN);
    arrows.position.copy(cube.position).addScaledVector(viewDir, a * 0.75);
    arrows.updateMatrixWorld();
    arrows.localToWorld(tips.G.set(0, -G * perN, 0));
    arrows.localToWorld(tips.Fb.set(-1.1, Fb * perN, 0));
    arrows.localToWorld(tips.Ft.set(1.1, Ft * perN, 0));
    arrows.localToWorld(tips.N.set(1.1, N * perN, 0));
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
      rig.visible = catcher.visible = spout.visible = spoutLip.visible = scaled;
      eye.visible = stud.visible = scaled;
      arrowFt.group.visible = scaled;
      arrowN.group.visible = !scaled;
      view = scaled ? RIG : CUP_ONLY;
      lift = 0;
      frame(size.w, size.h, lastFree);
    },
    setSolid(id) {
      cube.material = solids[id];
    },
    setLiquid(id) {
      const [color, dist] = liquidLooks[id];
      for (const m of [liquidMat, liquidTop]) {
        m.attenuationColor.set(color);
        m.attenuationDistance = dist;
      }
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
    resize(w, h, free) {
      size = { w, h };
      lastFree = free;
      renderer.setSize(w, h, false);
      frame(w, h, free);
    },
    render() {
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
      return { ...tips, cup: cupAnchor };
    },
    cmPerPixel() {
      return cmPerPx;
    },
  };
}

// -----------------------------------------------------------------------------------------------------

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
    m.position.set(...pos);
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

function setColumn(mesh: THREE.Mesh, radius: number, height: number, segments: number) {
  mesh.geometry.dispose();
  mesh.geometry = new THREE.CylinderGeometry(radius, radius, height, segments, 1, true);
}

function helix(top: number, length: number, radius: number, wire: number, coils: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const n = coils * 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * radius, top - t * length, Math.sin(ang) * radius));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, wire, 6);
}

function knob(body: THREE.Material, metal: THREE.Material): THREE.Group {
  // a thumbscrew: short threaded shaft with a ribbed head, pointing along +y
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 12), metal);
  shaft.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.55, 18), body);
  head.position.y = 1.4;
  g.add(shaft, head);
  return g;
}

function forceArrow(color: string) {
  // flat arrow with a white halo, drawn over everything
  const fill = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
  const edge = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.BackSide,
  });
  const shaftGeo = new THREE.CylinderGeometry(0.15, 0.15, 1, 14);
  const headGeo = new THREE.ConeGeometry(0.48, 1.15, 24);
  const shaft = new THREE.Mesh(shaftGeo, fill);
  const head = new THREE.Mesh(headGeo, fill);
  const shaftEdge = new THREE.Mesh(shaftGeo, edge);
  const headEdge = new THREE.Mesh(headGeo, edge);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8), fill);
  const group = new THREE.Group();
  group.add(shaftEdge, headEdge, shaft, head, dot);
  shaftEdge.renderOrder = headEdge.renderOrder = 30;
  shaft.renderOrder = head.renderOrder = dot.renderOrder = 31;
  return {
    group,
    set(origin: THREE.Vector3, dir: 1 | -1, len: number) {
      group.position.copy(origin);
      const shaftLen = Math.max(len - 1.15, 0.01);
      shaft.scale.y = shaftLen;
      shaft.position.y = (dir * shaftLen) / 2;
      head.position.y = dir * (shaftLen + 0.575);
      head.rotation.z = dir === 1 ? 0 : Math.PI;
      shaftEdge.scale.set(1.6, shaftLen, 1.6);
      shaftEdge.position.copy(shaft.position);
      headEdge.scale.set(1.25, 1.18, 1.25);
      headEdge.position.copy(head.position);
      headEdge.rotation.copy(head.rotation);
      // hidden when the force is absent
      shaft.visible = head.visible = shaftEdge.visible = headEdge.visible = dot.visible = len > 0.05;
    },
  };
}
