import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Readings, Setup } from './physics';
import * as T from './textures';
import { createPost } from './post';

// World units are centimetres; y is up and the top of the walnut display base
// is y = 0. The rig sits on the base like a museum teaching model.

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
const K = 2.4; // cm of stretch per newton
const DIAL_MAX = 5;
const SPRING_TOP = SC_TOP - 0.6;
const FACE_Z = SC_DEPTH / 2 + 0.3; // spring, pointer and pull rod ride here
const PULL_ROD = 15.9; // pointer to hook
const HOOK = 1.0;
const STRING_LEN = 4.5;
const EYE = 0.8; // cube top to where the string ties on

// display base
const PL = { x0: -27, x1: 21, z0: -17, z1: 13, h: 4.5, bevel: 0.35 };
const FLOOR_Y = -(PL.h + PL.bevel * 2);

const VIEW_AZIMUTH = THREE.MathUtils.degToRad(26);
const VIEW_ELEVATION = THREE.MathUtils.degToRad(12);
const VIEW_DIST = 125;
const ARROW_CM_PER_N = 2.1;

/** What the camera keeps in frame, in cm. */
const RIG = { width: 46, height: 44, centerY: 16.5, centerX: -2 };

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

export interface SceneView {
  camera: THREE.PerspectiveCamera;
  update(r: Readings, cubeBottom: number, beakerWater: number, overflowing: boolean, time: number): void;
  setArrows(on: boolean): void;
  setInset(rect: InsetRect | null): void;
  resize(w: number, h: number, free: FreeArea): void;
  render(time: number): void;
  /** World positions for HTML labels. */
  anchors(): { G: THREE.Vector3; Fb: THREE.Vector3; Ft: THREE.Vector3 };
  cmPerPixel(): number;
}

export function createScene(canvas: HTMLCanvasElement, s: Setup): SceneView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1312');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
  scene.environmentIntensity = 1.0;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 10, 600);
  const target = new THREE.Vector3(RIG.centerX, RIG.centerY, 0);
  const viewDir = new THREE.Vector3(
    Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
    Math.sin(VIEW_ELEVATION),
    Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION),
  );
  camera.position.copy(target).addScaledVector(viewDir, VIEW_DIST);
  camera.lookAt(target);
  camera.layers.enable(1); // force arrows live on layer 1

  // --- lights ---------------------------------------------------------------
  const key = new THREE.SpotLight('#ffe2bd', 5.2, 0, 0.5, 0.75, 0);
  key.position.set(-42, 92, 58);
  key.target.position.set(-2, 8, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.03;
  key.shadow.camera.near = 50;
  key.shadow.camera.far = 230;
  scene.add(key, key.target);
  // a soft pool of light on the backdrop behind the rig, so glass and water
  // have something bright to refract
  const back = new THREE.SpotLight('#8fc2b4', 7, 0, 0.42, 1, 0);
  back.position.set(25, 70, 40);
  back.target.position.set(-22, -4, -42);
  scene.add(back, back.target);
  const rim = new THREE.DirectionalLight('#c4ece1', 1.5);
  rim.position.set(45, 35, -70);
  scene.add(rim);

  // --- backdrop + walnut base ---------------------------------------------------
  scene.add(sweep());
  const wood = T.walnut(50, 31);
  wood.offset.set(-PL.x0 / 50 + 0.01, PL.z1 / 31 + 0.01);
  const plinth = new THREE.Mesh(
    plinthGeometry(),
    new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  );
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);
  const plate = new THREE.Mesh(
    new RoundedBoxGeometry(15, 2.7, 0.14, 2, 0.05),
    new THREE.MeshStandardMaterial({
      map: T.nameplate(15, 2.7, '浮力', 'BUOYANCY · No.01'),
      metalness: 0.7,
      roughness: 0.38,
    }),
  );
  plate.position.set((PL.x0 + PL.x1) / 2, -PL.h / 2 - PL.bevel, PL.z1 + PL.bevel + 0.07);
  scene.add(plate);
  addDecal(scene, T.softBlob('rect'), (PL.x0 + PL.x1) / 2, (PL.z0 + PL.z1) / 2, PL.x1 - PL.x0 + 9, PL.z1 - PL.z0 + 9, 0, 0.75, FLOOR_Y + 0.02);

  // --- materials ------------------------------------------------------------------
  const glass = glassMaterials();
  const water = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    ior: 1.333,
    thickness: 12,
    attenuationColor: new THREE.Color('#6cc0cc'),
    attenuationDistance: 40,
    specularIntensity: 1,
    // a faint glow stands in for light scattered inside the water, so the
    // water body still reads against a dark backdrop
    emissive: new THREE.Color('#0f3a3e'),
    emissiveIntensity: 0.07,
  });
  const ripple = T.ripple();
  ripple.repeat.set(1.6, 1.6);
  const waterTop = water.clone();
  waterTop.normalMap = ripple;
  waterTop.normalScale.set(0.25, 0.25);
  waterTop.thickness = 2;
  const chrome = new THREE.MeshStandardMaterial({ color: '#d9dde1', metalness: 1, roughness: 0.22 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 1, roughness: 0.3 });
  const castIron = new THREE.MeshStandardMaterial({
    color: '#222a29',
    metalness: 0.3,
    roughness: 0.6,
    bumpMap: T.speckle(),
    bumpScale: 0.4,
  });
  const brushed = T.brushed();
  const anodised = new THREE.MeshStandardMaterial({ color: '#c3c9ce', metalness: 1, roughness: 1, roughnessMap: brushed });
  // bead-blasted aluminium, as school sample blocks usually are: part metal,
  // part matte, so it stays readable under water in a dark room
  const aluminium = new THREE.MeshStandardMaterial({
    color: '#d6dade',
    metalness: 0.6,
    roughness: 1,
    roughnessMap: T.brushed(256, 0.44, 0.3),
  });

  // --- overflow cup ------------------------------------------------------------------
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

  // water columns are rebuilt rather than scaled: transmission stretches its
  // refraction ray by the mesh scale, which would turn the water opaque
  const cupWater = new THREE.Mesh(new THREE.BufferGeometry(), water);
  const cupWaterTop = new THREE.Mesh(new THREE.CircleGeometry(R - 0.02, 128), waterTop);
  cupWaterTop.rotation.x = -Math.PI / 2;
  const meniscus = new THREE.Mesh(
    new THREE.TorusGeometry(R - 0.06, 0.06, 6, 128),
    new THREE.MeshBasicMaterial({ color: '#dff6f2', transparent: true, opacity: 0.35, depthWrite: false }),
  );
  meniscus.rotation.x = Math.PI / 2;
  meniscus.renderOrder = 4;
  cupGroup.add(cupWater, cupWaterTop, meniscus);
  const spoutWater = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, spoutLen - 0.5, 24), water);
  spoutWater.position.copy(spoutMid);
  spoutWater.quaternion.copy(spoutQ);
  scene.add(spoutWater);

  // --- catch beaker ------------------------------------------------------------------
  const beaker = new THREE.Group();
  beaker.position.set(BEAKER_X, 0, 0);
  scene.add(beaker);
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
  const bWater = new THREE.Mesh(new THREE.BufferGeometry(), water);
  const bWaterTop = new THREE.Mesh(new THREE.CircleGeometry(BR - 0.02, 96), waterTop);
  bWaterTop.rotation.x = -Math.PI / 2;
  beaker.add(bWater, bWaterTop);

  const streamMat = water.clone();
  streamMat.thickness = 0.6;
  const stream = new THREE.Mesh(new THREE.BufferGeometry(), streamMat);
  scene.add(stream);

  // light through the water columns: faint shadows and moving caustics
  const lightDir = new THREE.Vector2(key.target.position.x - key.position.x, key.target.position.z - key.position.z).normalize();
  const lightYaw = -Math.atan2(lightDir.y, lightDir.x);
  const gShadow = T.glassShadow();
  addDecal(scene, T.softBlob('ring', 0.8), CUP_X, 0, (R + CUP_WALL) * 2 / 0.8, (R + CUP_WALL) * 2 / 0.8, 0, 0.55, 0.012);
  addDecal(scene, gShadow, CUP_X + lightDir.x * 8.7, lightDir.y * 8.7, 35, 17.5, lightYaw, 0.32, 0.014);
  const cupCaustic = causticMaterial('#ffe9c4', 0.5);
  addDecal(scene, null, CUP_X + lightDir.x * 7.5, lightDir.y * 7.5, 15, 10, lightYaw, 1, 0.016, cupCaustic);
  addDecal(scene, T.softBlob('ring', 0.8), BEAKER_X, 0, (BR + BEAKER_WALL) * 2 / 0.8, (BR + BEAKER_WALL) * 2 / 0.8, 0, 0.5, 0.012);
  addDecal(scene, gShadow, BEAKER_X + lightDir.x * 5.3, lightDir.y * 5.3, 21, 10.5, lightYaw, 0.28, 0.014);
  const beakerCaustic = causticMaterial('#ffe9c4', 0);
  const cupCausticBase = 0.5;
  addDecal(scene, null, BEAKER_X + lightDir.x * 4.5, lightDir.y * 4.5, 9, 6, lightYaw, 1, 0.016, beakerCaustic);

  // --- iron stand --------------------------------------------------------------------
  const base = new THREE.Mesh(new RoundedBoxGeometry(10, BASE_H, 19, 3, 0.4), castIron);
  base.position.set(ROD_X, BASE_H / 2, ROD_Z + 7.5);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, ROD_H, 40), chrome);
  rod.position.set(ROD_X, BASE_H + ROD_H / 2, ROD_Z);
  const rodCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 12), chrome);
  rodCap.position.set(ROD_X, BASE_H + ROD_H, ROD_Z);
  const rodFoot = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 0.8, 32), castIron);
  rodFoot.position.set(ROD_X, BASE_H + 0.4, ROD_Z);
  scene.add(base, rod, rodCap, rodFoot);
  addDecal(scene, T.softBlob('rect'), ROD_X, ROD_Z + 7.5, 13, 22, 0, 0.6, 0.012);

  const armGroup = new THREE.Group(); // slides on the rod with the drag
  scene.add(armGroup);
  const armFrom = new THREE.Vector3(ROD_X, 0, ROD_Z);
  const armTo = new THREE.Vector3(CUP_X, 0, 0);
  const armDir = armTo.clone().sub(armFrom).normalize();
  const armLen = armTo.distanceTo(armFrom) + 0.8;
  const armQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, armLen, 32), chrome);
  arm.quaternion.copy(armQ);
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
  for (const m of [arm, boss, knob1, knob2]) m.traverse((o) => (o.castShadow = true));

  // --- spring scale -----------------------------------------------------------------
  const scale = new THREE.Group();
  scale.rotation.y = VIEW_AZIMUTH;
  scene.add(scale);
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
  const springMat = steel;
  const spring = new THREE.Mesh(new THREE.BufferGeometry(), springMat);
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
  for (const m of [ring, casing, pull, hook, pointer, spring]) m.traverse((o) => (o.castShadow = true));

  // --- string + aluminium cube ------------------------------------------------------
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, STRING_LEN + 0.9, 8),
    new THREE.MeshStandardMaterial({ color: '#efeadc', roughness: 0.95 }),
  );
  string.castShadow = true;
  scene.add(string);
  const a = s.cubeSide;
  const cube = new THREE.Mesh(new RoundedBoxGeometry(a, a, a, 5, 0.14), aluminium);
  cube.rotation.y = VIEW_AZIMUTH - 0.6;
  cube.castShadow = true;
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 10, 24), steel);
  eye.position.y = a / 2 + 0.42;
  const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.2, 12), steel);
  stud.position.y = a / 2 + 0.1;
  cube.add(eye, stud);
  scene.add(cube);
  for (const m of [base, rod, rodFoot, cube]) m.castShadow = true;

  // --- force arrows ------------------------------------------------------------------
  const arrows = new THREE.Group();
  arrows.rotation.y = VIEW_AZIMUTH;
  scene.add(arrows);
  const gArrow = forceArrow('#ff8a5c');
  const bArrow = forceArrow('#5cc8ff');
  const tArrow = forceArrow('#ffd166');
  arrows.add(gArrow.group, bArrow.group, tArrow.group);
  arrows.traverse((o) => o.layers.set(1));

  // --- dial close-up camera -----------------------------------------------------------
  const insetCam = new THREE.PerspectiveCamera(20, 1, 1, 200);
  let inset: InsetRect | null = null;

  // --- post ------------------------------------------------------------------------------
  const post = createPost(renderer, scene, camera);
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __lab: { scene, renderer, THREE } });

  // --- api -------------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const tipG = new THREE.Vector3();
  const tipB = new THREE.Vector3();
  const tipT = new THREE.Vector3();
  let streamAmount = 0;
  let springLen = -1;
  let cupLevel = -1;
  let beakerLevel = -1;
  let size = { w: 1, h: 1 };
  let lastFree: FreeArea = { top: 0, bottom: 0, left: 0, right: 0 };
  let cmPerPx = 0.1;
  let lift = 0; // extra height framed when the rig is raised

  function update(r: Readings, cubeBottom: number, beakerWater: number, overflowing: boolean, time: number) {
    // hang the chain from the cube up: cube → string → hook → pull rod → pointer
    const bottomWorld = CUP_FLOOR + cubeBottom;
    cube.position.set(CUP_X, bottomWorld + a / 2, 0);
    const knot = bottomWorld + a + EYE;
    const F = THREE.MathUtils.clamp(r.scaleReading, 0, DIAL_MAX);
    const pointerY = P0 - F * K;
    const hookY = pointerY - PULL_ROD - HOOK;
    const ringY = knot + STRING_LEN - hookY;
    scale.position.set(CUP_X, ringY, 0);
    armGroup.position.y = ringY + 1.1;
    // let the camera ease up when the scale is lifted out of the base framing
    const want = Math.max(0, ringY + 7 - (RIG.centerY + RIG.height / 2));
    if (Math.abs(want - lift) > 0.02) {
      lift += (want - lift) * 0.12;
      frame(size.w, size.h, lastFree);
    }
    string.position.set(CUP_X, knot + (STRING_LEN - 0.9) / 2 + 0.45, 0);

    pointer.position.y = pointerY;
    pull.position.set(0, pointerY - PULL_ROD / 2, FACE_Z - 0.1);
    hook.position.set(0, hookY + 0.5, FACE_Z - 0.1);
    const len = SPRING_TOP - 0.25 - (pointerY + 0.2);
    if (Math.abs(len - springLen) > 0.01) {
      springLen = len;
      spring.geometry.dispose();
      spring.geometry = helix(SPRING_TOP - 0.25, len, 0.22, 0.045, 18);
    }

    // water in the cup
    const lvl = Math.max(r.level, 0.01);
    if (Math.abs(lvl - cupLevel) > 0.003) {
      cupLevel = lvl;
      setColumn(cupWater, R - 0.02, lvl, 128);
      cupWater.position.y = CUP_FLOOR + lvl / 2;
    }
    cupWaterTop.position.y = CUP_FLOOR + lvl;
    meniscus.position.y = CUP_FLOOR + lvl;
    ripple.offset.set(time * 0.012, time * 0.009);
    spoutWater.visible = r.level >= s.spoutHeight - 0.05;

    // beaker
    const bh = beakerWater / (Math.PI * (BR - 0.02) ** 2);
    bWater.visible = bWaterTop.visible = beakerWater > 0.5;
    if (Math.abs(bh - beakerLevel) > 0.003) {
      beakerLevel = bh;
      setColumn(bWater, BR - 0.02, Math.max(bh, 0.01), 96);
      bWater.position.y = BEAKER_FLOOR + bh / 2;
    }
    bWaterTop.position.y = BEAKER_FLOOR + bh;

    // overflow stream
    streamAmount += ((overflowing ? 1 : 0) - streamAmount) * 0.25;
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

    cupCaustic.uniforms.uTime.value = time;
    beakerCaustic.uniforms.uTime.value = time;
    beakerCaustic.uniforms.uStrength.value = THREE.MathUtils.clamp(beakerWater / 60, 0, 1) * cupCausticBase * 0.4;

    // arrows from the cube centre: G down, F浮 and F拉 up, side by side
    const c = cube.position;
    gArrow.set(tmp.set(0, 0, 0), -1, r.weight * ARROW_CM_PER_N);
    bArrow.set(tmp.set(-1.15, 0, 0), 1, r.buoyancy * ARROW_CM_PER_N);
    tArrow.set(tmp.set(1.15, 0, 0), 1, r.scaleReading * ARROW_CM_PER_N);
    arrows.position.copy(c).addScaledVector(viewDir, a * 0.75);
    arrows.updateMatrixWorld();
    arrows.localToWorld(tipG.set(0, -r.weight * ARROW_CM_PER_N, 0));
    arrows.localToWorld(tipB.set(-1.15, r.buoyancy * ARROW_CM_PER_N, 0));
    arrows.localToWorld(tipT.set(1.15, r.scaleReading * ARROW_CM_PER_N, 0));

    // close-up camera looks straight at the pointer
    if (inset) {
      scale.updateMatrixWorld();
      const p = scale.localToWorld(tmp.set(0, pointerY, SC_DEPTH / 2));
      insetCam.position.copy(p).addScaledVector(viewDir.clone().setY(0).normalize(), 15).add(new THREE.Vector3(0, 0.8, 0));
      insetCam.lookAt(p);
    }
  }

  function frame(w: number, h: number, free: FreeArea) {
    target.set(RIG.centerX, RIG.centerY + lift / 2, 0);
    camera.position.copy(target).addScaledVector(viewDir, VIEW_DIST);
    camera.lookAt(target);
    // centre the rig in the uncovered area by shifting the view window
    const freeW = Math.max(w - free.left - free.right, w * 0.35);
    const freeH = Math.max(h - free.top - free.bottom, h * 0.35);
    const cx = free.left + freeW / 2;
    const cy = free.top + freeH / 2;
    cmPerPx = Math.max((RIG.height + lift) / freeH, RIG.width / freeW);
    const fullW = 2 * Math.max(cx, w - cx);
    const fullH = 2 * Math.max(cy, h - cy);
    camera.aspect = fullW / fullH;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((fullH * cmPerPx) / 2 / VIEW_DIST));
    camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, w, h);
    camera.updateProjectionMatrix();
  }

  return {
    camera,
    update,
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
      post.setSize(w, h);
      frame(w, h, free);
    },
    render(time) {
      post.render(time);
      if (inset) {
        const y = size.h - inset.y - inset.h;
        renderer.shadowMap.autoUpdate = false; // reuse the main pass's shadows
        renderer.setScissorTest(true);
        renderer.setScissor(inset.x, y, inset.w, inset.h);
        renderer.setViewport(inset.x, y, inset.w, inset.h);
        renderer.render(scene, insetCam);
        renderer.setScissorTest(false);
        renderer.shadowMap.autoUpdate = true;
        renderer.setViewport(0, 0, size.w, size.h);
      }
    },
    anchors() {
      return { G: tipG, Fb: tipB, Ft: tipT };
    },
    cmPerPixel() {
      return cmPerPx;
    },
  };
}

// ---------------------------------------------------------------------------------------

/** A dark studio with three softboxes, used only to light reflections. */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(200, 120, 200),
    new THREE.MeshBasicMaterial({ color: '#0d1615', side: THREE.BackSide }),
  );
  env.add(room);
  const softbox = (w: number, h: number, pos: [number, number, number], color: string, power: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  softbox(60, 34, [-55, 60, 50], '#fff1dc', 5); // key, matches the spotlight
  softbox(14, 70, [80, 10, -40], '#d2f1e8', 3.5); // tall strip behind right
  softbox(70, 10, [0, 58, -70], '#ffffff', 1.6); // top back
  softbox(120, 30, [0, -55, 0], '#3b2a1c', 0.6); // warm bounce from the base
  softbox(90, 50, [50, 20, 95], '#e9f1ee', 0.9); // big white card on the camera side
  return env;
}

function sweep(): THREE.Mesh {
  // a photo-studio cyclorama: floor curving up into the back wall
  const W = 600;
  const r = 50;
  const zBack = -60;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) prof.push([FLOOR_Y, 220 - i * ((220 - (zBack + r)) / 10)]);
  for (let i = 1; i <= 20; i++) {
    const t = (i / 20) * (Math.PI / 2);
    prof.push([FLOOR_Y + r - r * Math.cos(t), zBack + r - r * Math.sin(t)]);
  }
  for (let i = 1; i <= 8; i++) prof.push([FLOOR_Y + r + i * 40, zBack]);
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
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#46605a', roughness: 0.92 }));
  return m;
}

function plinthGeometry(): THREE.ExtrudeGeometry {
  // rounded rectangle in (x, -z), extruded upward; UVs are in centimetres
  const { x0, x1, z0, z1, h, bevel } = PL;
  const r = 1.2;
  const shape = new THREE.Shape();
  const y0 = -z1;
  const y1 = -z0;
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: h,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 8,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(h + bevel), 0);
  return g;
}

function addDecal(
  scene: THREE.Scene,
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
  const mat =
    material ??
    new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = yaw;
  m.renderOrder = 1;
  scene.add(m);
  return m;
}

// Clear glass is mostly what it reflects plus darker edges where you look
// through more of it. Two layers fake that without hiding the water inside:
// one multiplies a tint that grows toward grazing angles, one adds reflections.
function glassMaterials() {
  const tint = new THREE.ShaderMaterial({
    uniforms: { uTint: { value: new THREE.Color('#7fa49d') } },
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
        f = pow(f, 2.4);
        gl_FragColor = vec4(mix(vec3(0.97), uTint, f), 1.0);
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
    envMapIntensity: 2.6,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return { tint, shine };
}

function glassMesh(geo: THREE.BufferGeometry, m: ReturnType<typeof glassMaterials>): THREE.Group {
  const g = new THREE.Group();
  const a = new THREE.Mesh(geo, m.tint);
  const b = new THREE.Mesh(geo, m.shine);
  a.renderOrder = 5;
  b.renderOrder = 6;
  g.add(a, b);
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
      // light bent by the water column gathers into a soft crescent on the far
      // side, mottled by the moving surface
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
  // flat-shaded arrow with a dark outline, drawn over everything
  const fill = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
  const edge = new THREE.MeshBasicMaterial({
    color: '#0d1a1a',
    depthTest: false,
    depthWrite: false,
    transparent: true,
    side: THREE.BackSide,
  });
  const shaftGeo = new THREE.CylinderGeometry(0.17, 0.17, 1, 14);
  const headGeo = new THREE.ConeGeometry(0.55, 1.3, 24);
  const shaft = new THREE.Mesh(shaftGeo, fill);
  const head = new THREE.Mesh(headGeo, fill);
  const shaftEdge = new THREE.Mesh(shaftGeo, edge);
  const headEdge = new THREE.Mesh(headGeo, edge);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8), fill);
  const group = new THREE.Group();
  group.add(shaftEdge, headEdge, shaft, head, dot);
  shaftEdge.renderOrder = headEdge.renderOrder = 30;
  shaft.renderOrder = head.renderOrder = dot.renderOrder = 31;
  return {
    group,
    set(origin: THREE.Vector3, dir: 1 | -1, len: number) {
      group.position.copy(origin);
      const shaftLen = Math.max(len - 1.3, 0.01);
      shaft.scale.y = shaftLen;
      shaft.position.y = (dir * shaftLen) / 2;
      head.position.y = dir * (shaftLen + 0.65);
      head.rotation.z = dir === 1 ? 0 : Math.PI;
      shaftEdge.scale.set(1.5, shaftLen, 1.5);
      shaftEdge.position.copy(shaft.position);
      headEdge.scale.set(1.25, 1.18, 1.25);
      headEdge.position.copy(head.position);
      headEdge.rotation.copy(head.rotation);
      group.visible = len > 0.3;
    },
  };
}
