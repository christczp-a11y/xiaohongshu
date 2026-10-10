import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Readings, Setup } from './physics';

// World units are centimetres; y is up, the wooden board's top is y = 0.

const CUP_X = -4;
const CUP_FLOOR = 0.6; // glass base thickness
const CUP_WALL = 0.32;
const CUP_HEIGHT = 17;
const BEAKER_X = 10;
const BEAKER_R = 3.6;
const BEAKER_FLOOR = 0.45;
const BEAKER_H = 9;
const ROD_X = -23;
const SCALE_LEN = 15;
const HOOK_LEN = 2;
const STRING_LEN = 6;
const DIAL_TOP_PAD = 1.6; // 0 N mark below the top of the scale body
const DIAL_SPAN = 11; // distance from the 0 N to the 5 N mark
const DIAL_MAX = 5;
const ARROW_CM_PER_N = 2.2;

export interface SceneView {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  update(r: Readings, cubeBottom: number, beakerWater: number, overflowing: boolean, time: number): void;
  setArrows(on: boolean): void;
  resize(w: number, h: number): void;
  render(): void;
  /** Screen-space position of the cube centre, for HTML labels. */
  anchors(): { cube: THREE.Vector3; spout: THREE.Vector3 };
  cmPerPixel(): number;
}

export function createScene(canvas: HTMLCanvasElement, s: Setup): SceneView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e7edf4');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 600);
  const target = new THREE.Vector3(-6.5, 23, 0);
  camera.position.set(-1, 34, 110);
  camera.lookAt(target);

  // --- lights -------------------------------------------------------------
  const key = new THREE.DirectionalLight('#fff6ea', 2.2);
  key.position.set(-40, 80, 50);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -45;
  key.shadow.camera.right = 35;
  key.shadow.camera.top = 60;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.far = 220;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#cfe6ff', 0.9);
  rim.position.set(50, 40, -60);
  scene.add(rim);

  // --- studio sweep + wooden board ----------------------------------------
  scene.add(studioSweep());
  const board = new THREE.Mesh(
    new RoundedBoxGeometry(64, 1.4, 30, 4, 0.5),
    new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0 }),
  );
  board.position.set(-6, -0.7, 0);
  board.receiveShadow = true;
  board.castShadow = true;
  scene.add(board);

  // --- materials ----------------------------------------------------------
  // Thin lab glass: a transparent (not transmissive) material, so the water
  // behind it stays visible; the water itself uses real transmission.
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.02,
    metalness: 0,
    transparent: true,
    opacity: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0,
    envMapIntensity: 2.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glassEdge = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.05,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 2,
  });
  const water = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.04,
    metalness: 0,
    transmission: 1,
    ior: 1.333,
    thickness: 9,
    attenuationColor: new THREE.Color('#62b7ea'),
    attenuationDistance: 22,
    specularIntensity: 1,
    envMapIntensity: 1.2,
  });
  const ripple = rippleTexture();
  const waterTop = water.clone();
  waterTop.normalMap = ripple;
  waterTop.normalScale.set(0.35, 0.35);
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 1, roughness: 0.28 });
  const castIron = new THREE.MeshStandardMaterial({ color: '#2d3440', metalness: 0.4, roughness: 0.55 });
  const aluminium = new THREE.MeshStandardMaterial({ color: '#dfe3e8', metalness: 1, roughness: 0.32 });

  // --- overflow cup -------------------------------------------------------
  const cupGroup = new THREE.Group();
  cupGroup.position.set(CUP_X, 0, 0);
  scene.add(cupGroup);
  const R = s.cupRadius;
  const cupProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(R + CUP_WALL - 0.2, 0),
    new THREE.Vector2(R + CUP_WALL, 0.2),
    new THREE.Vector2(R + CUP_WALL, CUP_HEIGHT),
    new THREE.Vector2(R, CUP_HEIGHT),
    new THREE.Vector2(R, CUP_FLOOR + 0.2),
    new THREE.Vector2(R - 0.2, CUP_FLOOR),
    new THREE.Vector2(0, CUP_FLOOR),
  ];
  const cup = new THREE.Mesh(new THREE.LatheGeometry(cupProfile, 96), glass);
  cup.renderOrder = 3;
  cupGroup.add(cup);
  const cupRim = new THREE.Mesh(new THREE.TorusGeometry(R + CUP_WALL / 2, CUP_WALL / 2, 10, 96), glassEdge);
  cupRim.rotation.x = Math.PI / 2;
  cupRim.position.y = CUP_HEIGHT;
  cupGroup.add(cupRim);
  const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(R + CUP_WALL, R + CUP_WALL, CUP_FLOOR, 96), glassEdge);
  cupBase.position.y = CUP_FLOOR / 2;
  cupBase.material = glass;
  cupGroup.add(cupBase);
  cupGroup.add(graduations(R + CUP_WALL + 0.02, CUP_FLOOR, CUP_HEIGHT - 1.5));

  // spout: a short glass tube leaving the wall just at spout height, angled down
  const spoutAngle = THREE.MathUtils.degToRad(24);
  const spoutLen = 5.2;
  const spoutStart = new THREE.Vector3(CUP_X + R - 0.4, CUP_FLOOR + s.spoutHeight + 0.35, 0);
  const spoutEnd = spoutStart.clone().add(new THREE.Vector3(Math.cos(spoutAngle), -Math.sin(spoutAngle), 0).multiplyScalar(spoutLen));
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, spoutLen, 32, 1, true), glass);
  spout.position.copy(spoutStart).lerp(spoutEnd, 0.5);
  spout.rotation.z = Math.PI / 2 + spoutAngle;
  spout.renderOrder = 3;
  scene.add(spout);
  const spoutLip = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 8, 32), glassEdge);
  spoutLip.position.copy(spoutEnd);
  spoutLip.rotation.y = Math.PI / 2;
  spoutLip.rotation.x = spoutAngle;
  scene.add(spoutLip);

  // water body in the cup (height follows the level)
  const cupWater = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.03, R - 0.03, 1, 96, 1, true), water);
  const cupWaterTop = new THREE.Mesh(new THREE.CircleGeometry(R - 0.03, 96), waterTop);
  cupWaterTop.rotation.x = -Math.PI / 2;
  cupWater.renderOrder = 2;
  cupWaterTop.renderOrder = 2;
  cupGroup.add(cupWater, cupWaterTop);
  const spoutWater = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, spoutLen - 0.6, 20), water);
  spoutWater.position.copy(spout.position);
  spoutWater.rotation.copy(spout.rotation);
  scene.add(spoutWater);

  // --- catch beaker -------------------------------------------------------
  const beaker = new THREE.Group();
  beaker.position.set(BEAKER_X, 0, 0);
  scene.add(beaker);
  const bProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(BEAKER_R + 0.25, 0),
    new THREE.Vector2(BEAKER_R + 0.25, BEAKER_H),
    new THREE.Vector2(BEAKER_R, BEAKER_H),
    new THREE.Vector2(BEAKER_R, BEAKER_FLOOR),
    new THREE.Vector2(0, BEAKER_FLOOR),
  ];
  const bMesh = new THREE.Mesh(new THREE.LatheGeometry(bProfile, 72), glass);
  bMesh.renderOrder = 3;
  beaker.add(bMesh);
  const bRim = new THREE.Mesh(new THREE.TorusGeometry(BEAKER_R + 0.12, 0.13, 8, 72), glassEdge);
  bRim.rotation.x = Math.PI / 2;
  bRim.position.y = BEAKER_H;
  beaker.add(bRim);
  beaker.add(graduations(BEAKER_R + 0.27, BEAKER_FLOOR, BEAKER_H - 1, 4));
  const bWater = new THREE.Mesh(new THREE.CylinderGeometry(BEAKER_R - 0.03, BEAKER_R - 0.03, 1, 72), water);
  bWater.renderOrder = 2;
  beaker.add(bWater);

  // falling stream from spout to beaker
  const streamMat = water.clone();
  streamMat.transparent = true;
  const stream = new THREE.Mesh(new THREE.BufferGeometry(), streamMat);
  stream.renderOrder = 2;
  scene.add(stream);

  // --- iron stand ---------------------------------------------------------
  const base = new THREE.Mesh(new RoundedBoxGeometry(15, 1.4, 10, 3, 0.4), castIron);
  base.position.set(ROD_X + 3, 0.7, 0);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 54, 32), steel);
  rod.position.set(ROD_X, 1.4 + 27, 0);
  const rodCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 12), steel);
  rodCap.position.set(ROD_X, 1.4 + 54, 0);
  scene.add(base, rod, rodCap);
  const armGroup = new THREE.Group(); // moves with the drag
  scene.add(armGroup);
  const boss = new THREE.Mesh(new RoundedBoxGeometry(2.6, 2.6, 2.6, 2, 0.35), castIron);
  boss.position.set(ROD_X, 0, 0);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.4, 12), steel);
  screw.rotation.x = Math.PI / 2;
  screw.position.set(ROD_X, 0, 2.2);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 20), castIron);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(ROD_X, 0, 3.3);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, CUP_X - ROD_X + 1.5, 24), steel);
  arm.rotation.z = Math.PI / 2;
  arm.position.set((ROD_X + CUP_X) / 2 + 0.6, 0, 0);
  const armHook = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 8, 24), steel);
  armHook.position.set(CUP_X, -0.7, 0);
  armGroup.add(boss, screw, knob, arm, armHook);

  // --- spring scale -------------------------------------------------------
  const scale = new THREE.Group();
  armGroup.add(scale);
  scale.position.set(CUP_X, -1.3, 0); // top of the scale body
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.13, 8, 24), steel);
  ring.position.y = 0.3;
  ring.rotation.y = Math.PI / 2;
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.4, SCALE_LEN, 1.3, 3, 0.45), aluminium);
  body.position.y = -SCALE_LEN / 2;
  const dial = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, SCALE_LEN - 1.2),
    new THREE.MeshStandardMaterial({ map: dialTexture(), roughness: 0.6 }),
  );
  dial.position.set(0, -SCALE_LEN / 2, 0.66);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(2.4, SCALE_LEN - 1.1), glass);
  cover.position.set(0, -SCALE_LEN / 2, 0.69);
  const pointer = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-1.05, 0), new THREE.Vector2(0.3, 0.22), new THREE.Vector2(0.3, -0.22)])),
    new THREE.MeshStandardMaterial({ color: '#e0392b', roughness: 0.4, emissive: '#5a0d06' }),
  );
  pointer.position.set(0.55, 0, 0.68);
  const hookRod = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, HOOK_LEN, 12), steel);
  hookRod.position.y = -SCALE_LEN - HOOK_LEN / 2;
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 24, Math.PI * 1.5), steel);
  hook.position.set(0, -SCALE_LEN - HOOK_LEN - 0.4, 0);
  hook.rotation.z = Math.PI / 2;
  scale.add(ring, body, dial, cover, pointer, hookRod, hook);
  for (const m of [body, ring, hookRod, hook]) m.castShadow = true;

  // --- string + cube ------------------------------------------------------
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, STRING_LEN, 6),
    new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.9 }),
  );
  scale.add(string);
  string.position.y = -SCALE_LEN - HOOK_LEN - 0.9 - STRING_LEN / 2;
  const a = s.cubeSide;
  const cube = new THREE.Mesh(new RoundedBoxGeometry(a, a, a, 4, 0.22), aluminium);
  cube.castShadow = true;
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.09, 8, 20), steel);
  eye.position.y = a / 2 + 0.3;
  cube.add(eye);
  scene.add(cube);

  for (const m of [base, rod, boss, arm, cube]) m.castShadow = true;
  cup.castShadow = false;

  // --- force arrows -------------------------------------------------------
  const arrows = new THREE.Group();
  scene.add(arrows);
  const gArrow = forceArrow('#f08a24');
  const bArrow = forceArrow('#1aa6e8');
  arrows.add(gArrow.group, bArrow.group);

  // --- api ----------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const anchorCube = new THREE.Vector3();
  const anchorSpout = new THREE.Vector3();
  let streamOpacity = 0;

  function update(r: Readings, cubeBottom: number, beakerWater: number, overflowing: boolean, time: number) {
    const bottomWorld = CUP_FLOOR + cubeBottom;
    cube.position.set(CUP_X, bottomWorld + a / 2, 0);
    const hangTop = bottomWorld + a + 0.65 + STRING_LEN + 0.9 + HOOK_LEN + SCALE_LEN + 1.3;
    armGroup.position.y = hangTop;

    // pointer: 0 N at DIAL_TOP_PAD below the body top, DIAL_SPAN per 5 N
    const F = Math.max(0, Math.min(DIAL_MAX, r.scaleReading));
    pointer.position.y = -DIAL_TOP_PAD - (F / DIAL_MAX) * DIAL_SPAN;

    // water in the cup
    const lvl = Math.max(r.level, 0.01);
    cupWater.scale.y = lvl;
    cupWater.position.y = CUP_FLOOR + lvl / 2;
    cupWaterTop.position.y = CUP_FLOOR + lvl + 0.001;
    ripple.offset.set(time * 0.015, time * 0.011);
    spoutWater.visible = r.level >= s.spoutHeight - 0.05;

    // beaker water
    const bh = Math.max(beakerWater / (Math.PI * (BEAKER_R - 0.03) ** 2), 0.001);
    bWater.scale.y = bh;
    bWater.position.y = BEAKER_FLOOR + bh / 2;
    bWater.visible = beakerWater > 0.05;

    // stream
    streamOpacity += ((overflowing ? 1 : 0) - streamOpacity) * 0.25;
    stream.visible = streamOpacity > 0.02;
    if (stream.visible) {
      const yEnd = BEAKER_FLOOR + bh;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector3(spoutEnd.x + 0.5 + t * 1.4, spoutEnd.y - 0.2 - (spoutEnd.y - 0.2 - yEnd) * t * t, 0));
      }
      stream.geometry.dispose();
      stream.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.22 * streamOpacity + 0.05, 10);
      streamMat.opacity = streamOpacity;
    }

    // arrows from the cube centre, drawn in front of the cube
    const c = cube.position;
    gArrow.set(tmp.set(c.x - 0.9, c.y, a / 2 + 0.6), -1, r.weight * ARROW_CM_PER_N);
    bArrow.set(tmp.set(c.x + 0.9, c.y, a / 2 + 0.6), 1, r.buoyancy * ARROW_CM_PER_N);

    anchorCube.copy(c);
    anchorSpout.copy(spoutEnd);
  }

  return {
    renderer,
    camera,
    update,
    setArrows(on) {
      arrows.visible = on;
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep the whole rig in frame on narrow (portrait) screens
      const needH = 64;
      const needW = 50;
      const dist = camera.position.distanceTo(target);
      const vFov = Math.max(needH, needW / camera.aspect) / dist;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(vFov / 2));
      camera.updateProjectionMatrix();
    },
    render() {
      renderer.render(scene, camera);
    },
    anchors() {
      return { cube: anchorCube, spout: anchorSpout };
    },
    cmPerPixel() {
      const dist = camera.position.distanceTo(target);
      const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      return h / renderer.domElement.clientHeight;
    },
  };
}

// ---------------------------------------------------------------------------

function forceArrow(color: string) {
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 12), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 20), mat);
  const group = new THREE.Group();
  group.add(shaft, head);
  group.renderOrder = 20;
  shaft.renderOrder = 20;
  head.renderOrder = 21;
  return {
    group,
    set(origin: THREE.Vector3, dir: 1 | -1, len: number) {
      group.position.copy(origin);
      const L = Math.max(len, 0.01);
      const shaftLen = Math.max(L - 1.2, 0.01);
      shaft.scale.y = shaftLen;
      shaft.position.y = (dir * shaftLen) / 2;
      head.position.y = dir * (shaftLen + 0.6);
      head.rotation.z = dir === 1 ? 0 : Math.PI;
      group.visible = len > 0.05;
    },
  };
}

function studioSweep(): THREE.Mesh {
  // floor running into a curved back wall, like a photo studio cyclorama
  const W = 400;
  const prof: [number, number][] = [];
  const r = 40;
  const floorY = -1.45;
  for (let i = 0; i <= 10; i++) prof.push([floorY, 160 - i * 16]); // (y, z)
  for (let i = 1; i <= 16; i++) {
    const t = (i / 16) * (Math.PI / 2);
    prof.push([floorY + r - r * Math.cos(t), -r * Math.sin(t)]);
  }
  for (let i = 1; i <= 8; i++) prof.push([floorY + r + i * 30, -r]);
  const zOff = -10;
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = 2;
  prof.forEach(([y, z]) => {
    for (let c = 0; c < cols; c++) pos.push(-W / 2 + c * W, y, z + zOff);
  });
  for (let i = 0; i < prof.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#eef2f7', roughness: 0.95 }));
  m.receiveShadow = true;
  return m;
}

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9b98f';
  g.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const y = rnd() * c.height;
    const amp = 2 + rnd() * 6;
    const freq = 0.002 + rnd() * 0.006;
    const ph = rnd() * 10;
    g.strokeStyle = `rgba(${120 + rnd() * 40},${80 + rnd() * 30},${40 + rnd() * 20},${0.05 + rnd() * 0.12})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 8) {
      const yy = y + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.3;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rippleTexture(): THREE.DataTexture {
  // tileable normal map from a few summed sine waves
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const waves = [
    [1, 2, 0.6],
    [3, -1, 0.35],
    [-2, 3, 0.25],
    [5, 4, 0.12],
  ];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let dx = 0;
      let dy = 0;
      for (const [kx, ky, amp] of waves) {
        const ph = ((kx * x + ky * y) / N) * Math.PI * 2;
        dx += amp * kx * Math.cos(ph);
        dy += amp * ky * Math.cos(ph);
      }
      const n = new THREE.Vector3(-dx * 0.08, -dy * 0.08, 1).normalize();
      const i = (y * N + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.needsUpdate = true;
  return t;
}

function dialTexture(): THREE.CanvasTexture {
  // matches the dial plane (2.3 × 13.8 cm); 0 N sits DIAL_TOP_PAD below the body top
  const W = 230;
  const H = 1380;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#fffdf5');
  grad.addColorStop(1, '#efe9da');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const pxPerCm = H / 13.8;
  const y0 = (DIAL_TOP_PAD - 0.6) * pxPerCm; // plane starts 0.6 cm below the body top
  const span = DIAL_SPAN * pxPerCm;
  g.fillStyle = '#26303d';
  g.strokeStyle = '#26303d';
  g.font = '600 46px -apple-system, "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let i = 0; i <= 25; i++) {
    const y = y0 + (i / 25) * span;
    const major = i % 5 === 0;
    g.lineWidth = major ? 5 : 2.5;
    g.beginPath();
    g.moveTo(major ? 120 : 150, y);
    g.lineTo(215, y);
    g.stroke();
    if (major) g.fillText(String(i / 5), 100, y);
  }
  g.font = '500 34px -apple-system, Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('N', W / 2, y0 + span + 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function graduations(radius: number, y0: number, y1: number, step = 2): THREE.Mesh {
  // printed white measuring marks on the front of the glass
  const H = 512;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = H;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  const n = Math.floor((y1 - y0) / step);
  for (let i = 1; i <= n; i++) {
    const y = H - (i * step * H) / (y1 - y0);
    g.lineWidth = i % 2 === 0 ? 4 : 3;
    g.beginPath();
    g.moveTo(i % 2 === 0 ? 30 : 60, y);
    g.lineTo(110, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  const arc = 0.5;
  const geo = new THREE.CylinderGeometry(radius, radius, y1 - y0, 24, 1, true, -arc / 2, arc);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.8 }));
  m.position.y = (y0 + y1) / 2;
  m.renderOrder = 4;
  return m;
}
