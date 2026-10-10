import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BOTTOM, HALF, LAKE, LAKE_R, RIVER, WL_MAX, WL_MIN,
  distRiver, fbm, hash, heightAt, inLakeDisc, mulberry32, smooth, vnoise,
} from './terrain';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rand = mulberry32(7);

// ---------- boot: WebGL 2 check, then the scene; otherwise a still picture ----------
// three.js needs WebGL 2. Phones without it (or that fail to create a context) get the
// static diorama and the four stage texts instead of a blank page.
function showFallback(message: string, reload = false) {
  const fb = $('fallback');
  $('fallbackMsg').textContent = message;
  $('fallbackReload').hidden = !reload;
  fb.hidden = false;
  const loading = document.getElementById('loading');
  if (loading) loading.parentNode!.removeChild(loading);
}
$('fallbackReload').addEventListener('click', () => location.reload());

function createRenderer(): THREE.WebGLRenderer | null {
  try {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) return null;
    return new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
  } catch {
    return null;
  }
}

const createdRenderer = createRenderer();
if (createdRenderer) start(createdRenderer);
else showFallback('这台设备暂时显示不了 3D 画面，先看看静态的展台吧。');

function start(renderer: THREE.WebGLRenderer) {
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
  function placeCamera() {
    // distance that fits the whole plinth in the narrower field of view
    const aspect = innerWidth / innerHeight, vf = THREE.MathUtils.degToRad(38);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const d = Math.max(16, 6.6 / Math.sin(Math.min(vf, hf) / 2));
    camera.position.set(0, d * 0.62, d * 0.78);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  placeCamera();

  // register our pointer handler before OrbitControls so dragging a cloud can switch the orbit off first
  canvas.addEventListener('pointerdown', onPointerDown);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.6, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 9;
  controls.maxDistance = 70;
  controls.maxPolarAngle = 1.38;

  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a2e22, 0.5);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xfff4e2, 3);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.03;
  sunLight.shadow.radius = 4;
  scene.add(sunLight, sunLight.target);
  const moonLight = new THREE.DirectionalLight(0x8aa2d8, 0);
  moonLight.position.set(-6, 10, 4);
  scene.add(moonLight);

  // ---------- generated textures ----------
  function normalMapFromHeights(N: number, H: Float32Array, strength: number, repeat: number): THREE.CanvasTexture {
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d')!, img = g.createImageData(N, N), v = new THREE.Vector3();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = H[y * N + (x + 1) % N] - H[y * N + (x - 1 + N) % N];
      const dy = H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x];
      v.set(-dx * strength, -dy * strength, 1).normalize();
      const o = (y * N + x) * 4;
      img.data[o] = (v.x * 0.5 + 0.5) * 255; img.data[o + 1] = (v.y * 0.5 + 0.5) * 255; img.data[o + 2] = (v.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
    return t;
  }

  // fine grain for grass and rock
  function detailNormalMap(): THREE.CanvasTexture {
    const N = 256, H = new Float32Array(N * N), r = mulberry32(5);
    for (let i = 0; i < N * N; i++) H[i] = r();
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      H[y * N + x] = (H[y * N + x] * 2 + H[y * N + (x + 1) % N] + H[((y + 1) % N) * N + x]) / 4;
    return normalMapFromHeights(N, H, 3, 24);
  }

  // tileable ripples: sums of sines with whole-number frequencies
  function waterNormalMap(): THREE.CanvasTexture {
    const N = 256, H = new Float32Array(N * N), r = mulberry32(11);
    const waves = Array.from({ length: 14 }, () => [Math.round((r() - 0.5) * 12), Math.round((r() - 0.5) * 12), r() * 6.28, 0.3 + r()]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let h = 0;
      for (const [kx, ky, ph, a] of waves) h += a * Math.sin(6.2832 * (kx * x + ky * y) / N + ph) / (1 + Math.hypot(kx, ky) * 0.3);
      H[y * N + x] = h;
    }
    return normalMapFromHeights(N, H, 2, 3);
  }

  // soil, gravel, clay and bedrock bands for the cut-away sides
  function layerTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
    const g = cv.getContext('2d')!, top = 0.4, span = 2.0, Y = (y: number) => (top - y) / span * 512;
    const r = mulberry32(3);
    const band = (y0: number, y1: number, color: string) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, Y(y0));
      for (let x = 0; x <= 1024; x += 16) g.lineTo(x, Y(y0) + Math.sin(x * 0.012) * 6 + (r() - 0.5) * 3);
      for (let x = 1024; x >= 0; x -= 16) g.lineTo(x, Y(y1) + Math.sin(x * 0.009 + 2) * 7 + (r() - 0.5) * 3);
      g.fill();
    };
    band(0.4, -0.18, '#6e4f33');
    band(-0.18, -0.68, '#594b3f');
    band(-0.68, -1.08, '#3b2d22');
    band(-1.08, -1.65, '#4a4844');
    for (let i = 0; i < 900; i++) {          // pebbles
      const x = r() * 1024, y = Y(-0.2 - r() * 0.45), rad = 2 + r() * 7, l = 90 + r() * 90;
      g.fillStyle = `rgb(${l},${l - 6},${l - 14})`; g.beginPath(); g.ellipse(x, y, rad * 1.3, rad, 0, 0, 7); g.fill();
    }
    for (let i = 0; i < 2500; i++) {         // sand specks
      const x = r() * 1024, y = r() * 512, l = 40 + r() * 70;
      g.fillStyle = `rgba(${l + 20},${l + 10},${l},0.5)`; g.fillRect(x, y, 2, 2);
    }
    g.strokeStyle = 'rgba(20,18,16,.6)'; g.lineWidth = 1.5;   // cracks in the bedrock
    for (let i = 0; i < 40; i++) {
      let x = r() * 1024, y = Y(-1.1 - r() * 0.5); g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.3) * 30; y += (r() - 0.5) * 12; g.lineTo(x, y); }
      g.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }

  function softDotTexture(inner: string, mid: string | null, outer: string, size: number): THREE.CanvasTexture {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d')!, c = size / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, inner); if (mid) gr.addColorStop(0.25, mid); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(cv);
  }

  // ---------- terrain ----------
  // 112 segments by default (~25k triangles); the lowest quality tier swaps in 64
  const SEG = 112, SEG_LOW = 64;
  function terrainGeometry(seg: number): THREE.PlaneGeometry {
    const terrainGeo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, seg, seg);
    terrainGeo.rotateX(-Math.PI / 2);
    const p = terrainGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
    terrainGeo.computeVertexNormals();
    const n = terrainGeo.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color(), tmp = new THREE.Color();
    const silt = new THREE.Color('#2f4a42'), sand = new THREE.Color('#bba979'), g1 = new THREE.Color('#3f5f27'),
      g2 = new THREE.Color('#6d8540'), rock = new THREE.Color('#6f6b63'), rock2 = new THREE.Color('#4f4c47'), snow = new THREE.Color('#eef1f4');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
      if (y < 0.33) c.copy(silt).lerp(sand, smooth(-0.45, 0.33, y));
      else c.copy(g1).lerp(g2, fbm(x * 1.7 + 5, z * 1.7)).lerp(sand, 1 - smooth(0.33, 0.45, y));
      tmp.copy(rock).lerp(rock2, fbm(x * 4, z * 4));
      c.lerp(tmp, Math.max(smooth(0.86, 0.66, ny), smooth(1.4, 2.2, y)));
      c.lerp(snow, smooth(2.75, 3.15, y) * smooth(0.5, 0.75, ny));
      c.multiplyScalar(0.9 + 0.2 * hash(x * 37.1, z * 53.7));
      col.set([c.r, c.g, c.b], i * 3);
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return terrainGeo;
  }
  const terrain = new THREE.Mesh(terrainGeometry(SEG), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0, normalMap: detailNormalMap(), normalScale: new THREE.Vector2(0.6, 0.6),
  }));
  // the land only receives shadows: casting them would double its triangles in the shadow pass
  terrain.receiveShadow = true;
  scene.add(terrain);

  // cut-away sides: grass edge, dark topsoil, then the layer texture down to the bottom
  function buildSkirt(): THREE.Mesh {
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    const grass = new THREE.Color('#4d7330'), soilA = new THREE.Color('#2f2117'), soilB = new THREE.Color('#47321f'), white = new THREE.Color('#ffffff');
    const sides: ((t: number) => [number, number])[] = [
      t => [-HALF + 2 * HALF * t, HALF], t => [HALF, HALF - 2 * HALF * t], t => [HALF - 2 * HALF * t, -HALF], t => [-HALF, -HALF + 2 * HALF * t],
    ];
    for (const side of sides) {
      const base = pos.length / 3;
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG, [x, z] = side(t), h = heightAt(x, z);
        const rows: [number, THREE.Color][] = [[h, grass], [h - 0.05, soilA], [h - 0.3, soilB], [h - 0.42, white], [BOTTOM, white]];
        for (const [y, c] of rows) { pos.push(x, y, z); col.push(c.r, c.g, c.b); uv.push(t * 5, (y - BOTTOM) / 2.0); }
      }
      for (let i = 0; i < SEG; i++) for (let r = 0; r < 4; r++) {
        const a = base + i * 5 + r, b = a + 5;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: layerTexture(), vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    return m;
  }
  scene.add(buildSkirt());

  // plain matte plinth; the floor shows only shadows so the page background shows through
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.5, 0.9, HALF * 2 + 0.5), new THREE.MeshStandardMaterial({ color: '#f1f1ef', roughness: 0.92 }));
  pedestal.position.y = BOTTOM - 0.45; pedestal.receiveShadow = true; pedestal.castShadow = true;
  scene.add(pedestal);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.09 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = BOTTOM - 0.9; floor.receiveShadow = true;
  scene.add(floor);

  // ---------- lake ----------
  const waterNormal = waterNormalMap();
  const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE_R, 64), new THREE.MeshStandardMaterial({
    color: '#1f6f78', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.84,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35),
  }));
  water.rotation.x = -Math.PI / 2; water.position.set(LAKE.x, 0, LAKE.z); water.receiveShadow = true;
  scene.add(water);

  // ---------- river: a ribbon with scrolling foam, brighter and faster when it carries rain ----------
  const riverUniforms = { uTime: { value: 0 }, uFlow: { value: 0.12 }, uDay: { value: 1 } };
  {
    const curve = new THREE.CatmullRomCurve3(RIVER.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const S = 160, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= S; i++) {
      const t = i / S, p = curve.getPoint(t), d = curve.getTangent(t), side = new THREE.Vector3(-d.z, 0, d.x).normalize();
      const y = heightAt(p.x, p.z) + 0.05, w = 0.2 + 0.12 * t;
      for (const s of [-1, 1]) { pos.push(p.x + side.x * w * s, y, p.z + side.z * w * s); uv.push(s < 0 ? 0 : 1, t); }
      if (i < S) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: riverUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uFlow, uDay; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float s = n(vec2(vUv.x * 5., vUv.y * 60. - uTime * (2. + 6. * uFlow)));
          s = s * 0.6 + n(vec2(vUv.x * 11., vUv.y * 120. - uTime * (3. + 9. * uFlow))) * 0.4;
          vec3 deep = vec3(0.015, 0.11, 0.15), foam = vec3(0.55, 0.72, 0.78);
          vec3 c = mix(deep, foam, smoothstep(0.55, 0.85, s) * (0.3 + 0.7 * uFlow));
          c *= 0.25 + 0.75 * uDay;
          gl_FragColor = vec4(c, edge * (0.8 + 0.2 * uFlow));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const river = new THREE.Mesh(g, m); river.renderOrder = 2;
    scene.add(river);
  }

  // ---------- trees and rocks ----------
  {
    const conGeo = mergeGeometries([
      new THREE.ConeGeometry(0.2, 0.42, 9).translate(0, 0.32, 0),
      new THREE.ConeGeometry(0.15, 0.34, 9).translate(0, 0.55, 0),
      new THREE.ConeGeometry(0.09, 0.24, 9).translate(0, 0.74, 0),
    ]);
    const crownGeo = new THREE.IcosahedronGeometry(0.24, 1);
    {
      const p = crownGeo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).multiplyScalar(0.8 + 0.35 * vnoise(v.x * 14 + 3, v.z * 14 + v.y * 9));
        p.setXYZ(i, v.x, v.y, v.z);
      }
      crownGeo.computeVertexNormals(); crownGeo.translate(0, 0.42, 0);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.025, 0.04, 0.3, 6).translate(0, 0.15, 0);
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3322', roughness: 1 });

    const spots: [number, number, number][] = [];
    for (let k = 0; k < 2500 && spots.length < 320; k++) {
      const x = (rand() * 2 - 1) * (HALF - 0.2), z = (rand() * 2 - 1) * (HALF - 0.2), h = heightAt(x, z);
      const slope = Math.abs(heightAt(x + 0.1, z) - h) + Math.abs(heightAt(x, z + 0.1) - h);
      if (h < WL_MAX + 0.15 || h > 2.1 || slope > 0.12 || distRiver(x, z) < 0.35) continue;
      if (spots.some(s => (s[0] - x) ** 2 + (s[2] - z) ** 2 < 0.03)) continue;
      if (fbm(x * 0.8 + 20, z * 0.8) < 0.42 && h < 1.0) continue;   // leave open meadows
      spots.push([x, h, z]);
    }
    const isConifer = (s: [number, number, number], i: number) => s[1] > 0.95 || i % 3 === 0;
    const con = spots.filter(isConifer), dec = spots.filter((s, i) => !isConifer(s, i));
    const conMesh = new THREE.InstancedMesh(conGeo, leafMat, con.length);
    const decMesh = new THREE.InstancedMesh(crownGeo, leafMat, dec.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    let ti = 0;
    con.forEach(([x, y, z], i) => {
      const s = 0.45 + rand() * 0.35;
      q.setFromAxisAngle(up, rand() * 6); sc.set(s, s * (0.9 + rand() * 0.4), s);
      m.compose(new THREE.Vector3(x, y - 0.03, z), q, sc); conMesh.setMatrixAt(i, m);
      conMesh.setColorAt(i, c.set('#22392a').offsetHSL(0, 0, (rand() - 0.5) * 0.06));
      trunks.setMatrixAt(ti++, m);
    });
    dec.forEach(([x, y, z], i) => {
      const s = 0.45 + rand() * 0.4;
      q.setFromAxisAngle(up, rand() * 6); sc.set(s, s, s);
      m.compose(new THREE.Vector3(x, y - 0.03, z), q, sc); decMesh.setMatrixAt(i, m);
      decMesh.setColorAt(i, rand() < 0.07 ? c.set('#d89fb5') : c.set('#4b6b2e').offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.1));
      trunks.setMatrixAt(ti++, m);
    });
    for (const mesh of [conMesh, decMesh, trunks]) { mesh.castShadow = mesh !== trunks; mesh.receiveShadow = true; scene.add(mesh); }

    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.16, 0), new THREE.MeshStandardMaterial({ color: '#77746d', roughness: 0.9, flatShading: true }), 26);
    for (let i = 0; i < 26; i++) {
      let x = 0, z = 0, h = 0;
      do { x = (rand() * 2 - 1) * (HALF - 0.3); z = (rand() * 2 - 1) * (HALF - 0.3); h = heightAt(x, z); } while (h < WL_MAX + 0.05);
      const s = 0.5 + rand() * 1.2;
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, 0)); sc.set(s * 1.3, s * 0.8, s);
      m.compose(new THREE.Vector3(x, h, z), q, sc); rocks.setMatrixAt(i, m);
    }
    rocks.castShadow = rocks.receiveShadow = true;
    scene.add(rocks);
  }

  // ---------- sun and time of day ----------
  const sunGroup = new THREE.Group();
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 1.3) }));
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture('rgba(255,240,200,1)', 'rgba(255,200,120,.45)', 'rgba(255,180,90,0)', 128),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  sunGlow.scale.set(4, 4, 1);
  sunGroup.add(sunBall, sunGlow);
  scene.add(sunGroup);

  const lowSun = new THREE.Color('#ffae70'), highSun = new THREE.Color('#fff3e0');
  const dayBg = new THREE.Color('#f5f5f4'), nightBg = new THREE.Color('#1c1c1e'), bg = new THREE.Color();
  let daylight = 1;
  function setTime(t: number) {
    const a = (t - 6) / 12 * Math.PI, el = Math.sin(a);   // 6:00 sunrise, 12:00 overhead, 18:00 sunset
    daylight = Math.max(0, Math.min(1, el * 1.6));
    sunGroup.position.set(Math.cos(a) * 8.5, 0.6 + el * 7.5, 2.5);
    sunGroup.visible = el > -0.05;
    sunLight.position.copy(sunGroup.position);
    sunLight.intensity = 3.2 * daylight;
    sunLight.color.copy(lowSun).lerp(highSun, smooth(0, 0.6, el));
    hemi.intensity = 0.12 + 0.45 * daylight;
    moonLight.intensity = 0.35 * (1 - daylight);
    scene.environmentIntensity = 0.12 + 0.5 * daylight;
    riverUniforms.uDay.value = 0.35 + 0.65 * daylight;
    document.body.style.background = '#' + bg.copy(nightBg).lerp(dayBg, smooth(0, 0.5, daylight)).getHexString();
    document.body.classList.toggle('night', daylight < 0.25);
    const hh = Math.floor((t + 24) % 24), mm = Math.round((t % 1) * 60) % 60;
    $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  // ---------- clouds ----------
  interface Cloud {
    group: THREE.Group; mat: THREE.MeshStandardMaterial;
    water: number; raining: boolean; squeezing: boolean; released: boolean;
    drift: THREE.Vector2; target: THREE.Vector2 | null; y: number; rainAcc: number;
  }
  const puffGeo = new THREE.IcosahedronGeometry(1, 2), puffGeoLow = new THREE.IcosahedronGeometry(1, 1);
  let lowDetail = false;   // set by the lowest quality tier
  const PUFFS: [number, number, number, number][] = (() => {
    const r = mulberry32(21), out: [number, number, number, number][] = [[0, 0, 0, 0.5]];
    for (let i = 0; i < 11; i++) {
      const a = r() * 6.283, d = 0.25 + r() * 0.7;
      out.push([Math.cos(a) * d * 1.3, (r() - 0.35) * 0.35, Math.sin(a) * d * 0.6, 0.18 + r() * 0.28]);
    }
    return out;
  })();
  const cloudWhite = new THREE.Color('#ffffff'), cloudGrey = new THREE.Color('#6f7882');
  const clouds: Cloud[] = [], puffMeshes: THREE.InstancedMesh[] = [];
  const cloudScale = (cl: Cloud) => 0.75 + 0.75 * cl.water;

  function makeCloud(x: number, z: number, w: number) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.12 });
    const group = new THREE.Group();
    const cl: Cloud = {
      group, mat, water: w, raining: false, squeezing: false, released: false,
      drift: new THREE.Vector2(rand() - 0.5, rand() - 0.5).multiplyScalar(0.15), target: null, y: 4.3 + rand() * 0.4, rainAcc: 0,
    };
    const puffs = new THREE.InstancedMesh(lowDetail ? puffGeoLow : puffGeo, mat, PUFFS.length), m4 = new THREE.Matrix4();
    PUFFS.forEach(([px, py, pz, r], i) => puffs.setMatrixAt(i, m4.makeScale(r, r * 0.85, r).setPosition(px, py, pz)));
    puffs.castShadow = true; puffs.userData.cloud = cl;
    group.add(puffs); puffMeshes.push(puffs);
    group.position.set(x, cl.y, z);
    scene.add(group); clouds.push(cl);
  }
  function nearestCloud(x: number, z: number): Cloud {
    let best = clouds[0], bd = Infinity;
    for (const c of clouds) { const d = (c.group.position.x - x) ** 2 + (c.group.position.z - z) ** 2; if (d < bd) { bd = d; best = c; } }
    return best;
  }

  // ---------- particles: rising vapour and falling rain ----------
  const VMAX = 700;
  const vapor = { pos: new Float32Array(VMAX * 3), col: new Float32Array(VMAX * 3), vel: new Float32Array(VMAX * 3), life: new Float32Array(VMAX), alive: new Uint8Array(VMAX) };
  const vaporGeo = new THREE.BufferGeometry();
  vaporGeo.setAttribute('position', new THREE.BufferAttribute(vapor.pos, 3));
  vaporGeo.setAttribute('color', new THREE.BufferAttribute(vapor.col, 3));
  const vaporPts = new THREE.Points(vaporGeo, new THREE.PointsMaterial({
    size: 0.2, map: softDotTexture('rgba(255,255,255,1)', null, 'rgba(255,255,255,0)', 64),
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  vaporPts.frustumCulled = false;
  scene.add(vaporPts);

  const RMAX = 1200;
  const rain = { pos: new Float32Array(RMAX * 6), alive: new Uint8Array(RMAX) };
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rain.pos, 3));
  const rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#b7dcef', transparent: true, opacity: 0.75 }));
  rainLines.frustumCulled = false;
  scene.add(rainLines);

  // ---------- water budget (abstract units; lake 1.0 = full) ----------
  // one vapour dot takes VAPOR_UNIT from the lake and gives VAPOR_UNIT * CLOUD_PER_UNIT to a cloud;
  // one raindrop takes it back, so water is conserved
  const VAPOR_UNIT = 0.00025, CLOUD_PER_UNIT = 8;
  let lake = 0.72, soil = 0.05, evapAcc = 0;
  const recent = { evap: 0, cond: 0, rain: 0, flow: 0 };
  const lakeLevel = () => THREE.MathUtils.lerp(WL_MIN, WL_MAX, lake);

  function resetWorld() {
    for (const c of clouds) scene.remove(c.group);
    clouds.length = 0; puffMeshes.length = 0;
    makeCloud(-2.2, -0.8, 0.25); makeCloud(1.4, 0.2, 0.5); makeCloud(3.0, -1.8, 0.7);
    lake = 0.72; soil = 0.05; evapAcc = 0;
    vapor.alive.fill(0); vapor.pos.fill(-100);
    rain.alive.fill(0); rain.pos.fill(-100);
  }
  resetWorld();

  function spawnVapor(): boolean {
    const wl = lakeLevel();
    for (let tries = 0; tries < 8; tries++) {
      const a = rand() * 6.283, r = Math.sqrt(rand()) * LAKE_R, x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
      if (heightAt(x, z) >= wl) continue;
      const i = vapor.alive.indexOf(0); if (i < 0) return false;
      vapor.alive[i] = 1; vapor.life[i] = 0;
      vapor.pos.set([x, wl + 0.02, z], i * 3);
      vapor.vel.set([(rand() - 0.5) * 0.1, 0.55 + rand() * 0.35, (rand() - 0.5) * 0.1], i * 3);
      return true;
    }
    return false;
  }
  function spawnRain(cl: Cloud) {
    const i = rain.alive.indexOf(0); if (i < 0) return;
    const s = cloudScale(cl), a = rand() * 6.283, r = Math.sqrt(rand()) * 0.75 * s;
    const x = cl.group.position.x + Math.cos(a) * r, z = cl.group.position.z + Math.sin(a) * r, y = cl.group.position.y - 0.25 * s;
    rain.alive[i] = 1; rain.pos.set([x, y, z, x, y - 0.18, z], i * 6);
  }

  // ---------- interaction: drag a cloud, hold it to squeeze out rain ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), dragPlane = new THREE.Plane(), hitP = new THREE.Vector3();
  let drag: { cl: Cloud; id: number; sx: number; sy: number; moved: boolean; off: THREE.Vector3; timer: number } | null = null;
  function setRay(e: PointerEvent) { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function onPointerDown(e: PointerEvent) {
    setRay(e);
    const hit = ray.intersectObjects(puffMeshes, false)[0];
    if (!hit) return;
    controls.enabled = false;
    const cl = hit.object.userData.cloud as Cloud;
    dragPlane.set(new THREE.Vector3(0, 1, 0), -cl.group.position.y);
    ray.ray.intersectPlane(dragPlane, hitP);
    cl.released = false;
    drag = {
      cl, id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, off: cl.group.position.clone().sub(hitP),
      timer: window.setTimeout(() => { if (drag && !drag.moved) cl.squeezing = true; }, 320),
    };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    hideHint();
  }
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
    setRay(e);
    if (ray.ray.intersectPlane(dragPlane, hitP)) {
      const p = hitP.add(drag.off);
      drag.cl.target = new THREE.Vector2(THREE.MathUtils.clamp(p.x, -HALF + 0.6, HALF - 0.6), THREE.MathUtils.clamp(p.z, -HALF + 0.6, HALF - 0.6));
    }
  });
  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    clearTimeout(drag.timer);
    drag.cl.squeezing = false; drag.cl.released = true;   // keep gliding to the last target, then drift again
    drag = null;
    controls.enabled = true;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- panel ----------
  type Stage = 'evap' | 'cond' | 'rain' | 'flow';
  const TEXT: Record<Stage, string> = {
    evap: '<b>蒸发：</b>太阳把湖面晒热，一部分水变成看不见的水蒸气，悄悄飘上天。太阳越高，蒸发得越快；到了晚上就慢下来了。',
    cond: '<b>凝结：</b>水蒸气升到高处，那里更冷，它会变回很多很小的小水滴，聚在一起就是云。云越厚，看起来越灰。',
    rain: '<b>降水：</b>云里的小水滴越聚越多、越来越重，空气托不住了，就落下来变成雨。按住一朵云不放，也能把雨挤出来。',
    flow: '<b>汇流：</b>雨落在山坡上，顺着地势往低处流，汇成小河，最后又回到湖里。然后，水再一次被太阳晒上天。',
  };
  const explainText = $('explainText'), stageNo = $('stageNo');
  const ORDER: Stage[] = ['evap', 'cond', 'rain', 'flow'], PRIORITY: Stage[] = ['rain', 'flow', 'cond', 'evap'];
  const chips = {} as Record<Stage, HTMLButtonElement>;
  document.querySelectorAll<HTMLButtonElement>('.chip').forEach(b => { chips[b.dataset.k as Stage] = b; });
  let heldUntil = 0, lastShown: Stage | null = null;
  const shownAt: Partial<Record<Stage, number>> = {};
  function show(k: Stage, ms: number) { explainText.innerHTML = TEXT[k]; stageNo.textContent = String(ORDER.indexOf(k) + 1); lastShown = k; shownAt[k] = performance.now(); heldUntil = performance.now() + ms; }
  (Object.keys(chips) as Stage[]).forEach(k => chips[k].addEventListener('click', () => show(k, 9000)));

  const timeInput = $<HTMLInputElement>('time');
  let timeT = parseFloat(timeInput.value), playing = false;
  timeInput.addEventListener('input', () => { timeT = parseFloat(timeInput.value); setTime(timeT); });
  const playBtn = $('play');
  playBtn.addEventListener('click', () => { playing = !playing; playBtn.textContent = playing ? '❚❚ 暂停' : '▶ 播放'; });
  $('reset').addEventListener('click', () => { resetWorld(); timeT = 10.5; timeInput.value = String(timeT); setTime(timeT); });
  const hint = $('hint');
  function hideHint() { hint.style.opacity = '0'; }
  setTimeout(hideHint, 9000);
  setTime(timeT);
  const mLake = $('mLake'), mCloud = $('mCloud'), mSoil = $('mSoil'), nLake = $('nLake'), nCloud = $('nCloud'), nSoil = $('nSoil');
  function meter(bar: HTMLElement, num: HTMLElement, v: number) { const pct = Math.round(Math.min(1, Math.max(0, v)) * 100); bar.style.width = pct + '%'; num.textContent = String(pct); }

  // ---------- quality tiers ----------
  // 0: DPR <= 1.5, <= 2M pixels, 2048 shadows · 1: DPR 1, <= 1M pixels, 1024 shadows · 2: no shadows
  let tier = 0;
  function applySize() {
    const w = innerWidth, h = innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, tier === 0 ? 1.5 : 1);
    const maxPx = tier === 0 ? 2e6 : 1e6;
    if (w * h * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * h));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
  }
  function setTier(t: number) {
    tier = t;
    applySize();
    if (tier >= 1 && sunLight.shadow.mapSize.x > 1024) {
      sunLight.shadow.mapSize.set(1024, 1024);
      if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    }
    if (tier >= 2 && sunLight.castShadow) {
      // lowest tier: no shadows, coarser land and clouds (stays under ~50k triangles)
      sunLight.castShadow = false;
      const old = terrain.geometry;
      terrain.geometry = terrainGeometry(SEG_LOW);
      old.dispose();
      for (const m of puffMeshes) m.geometry = puffGeoLow;
      lowDetail = true;
    }
  }
  applySize();

  // ?stats shows draw calls and triangles per frame (shadow pass included), to check the mobile budget
  const statsEl = /[?&]stats\b/.test(location.search) ? document.body.appendChild(document.createElement('div')) : null;
  if (statsEl) statsEl.style.cssText = 'position:fixed;left:8px;bottom:4px;font:11px monospace;color:#c00;z-index:9';

  // ---------- main loop ----------
  const timer = new THREE.Timer();
  let uiTick = 0, rafId = 0, running = false, halted = false, slowTime = 0, sampleTime = 0;
  function loop(stamp: number) { rafId = requestAnimationFrame(loop); frame(stamp); }
  function startLoop() { if (running) return; running = true; timer.reset(); slowTime = sampleTime = 0; rafId = requestAnimationFrame(loop); }
  function stopLoop() { running = false; cancelAnimationFrame(rafId); }

  // step down when frames stay slow; at the lowest tier fall back to the still picture
  function watchFrameTime(raw: number) {
    sampleTime += raw;
    // slow = below ~24 fps; at the lowest tier only give up below ~12 fps (no longer interactive)
    if (raw > (tier < 2 ? 1 / 24 : 1 / 12)) slowTime += raw;
    if (sampleTime < 3) return;
    const slowShare = slowTime / sampleTime;
    slowTime = sampleTime = 0;
    if (slowShare < 0.5) return;
    if (tier < 2) setTier(tier + 1);
    else { halted = true; stopLoop(); showFallback('这台设备画 3D 有点吃力，先看看静态的展台吧。'); }
  }

  function frame(stamp?: number) {
    timer.update(stamp);
    watchFrameTime(timer.getDelta());
    const dt = Math.min(timer.getDelta(), 0.05), now = performance.now(), T = timer.getElapsed();

    if (playing) { timeT += dt * 0.35; if (timeT > 20) timeT = 4; timeInput.value = String(timeT); setTime(timeT); }

    // evaporation: faster the higher the sun
    water.position.y = lakeLevel();
    evapAcc += (lake > 0.04 ? 55 * Math.pow(daylight, 1.3) : 0) * dt;
    while (evapAcc >= 1) { evapAcc -= 1; if (spawnVapor()) { lake -= VAPOR_UNIT; recent.evap = now; } }

    // vapour rises, is pulled toward the nearest cloud and absorbed there
    for (let i = 0; i < VMAX; i++) {
      if (!vapor.alive[i]) continue;
      const o = i * 3; vapor.life[i] += dt;
      const x = vapor.pos[o], y = vapor.pos[o + 1], z = vapor.pos[o + 2];
      const cl = nearestCloud(x, z), cp = cl.group.position;
      const pull = smooth(1.0, 3.5, y) * 0.9;
      vapor.vel[o] += ((cp.x - x) * pull + Math.sin(T * 2 + i) * 0.05) * dt;
      vapor.vel[o + 2] += (cp.z - z) * pull * dt;
      vapor.pos[o] += vapor.vel[o] * dt; vapor.pos[o + 1] += vapor.vel[o + 1] * dt; vapor.pos[o + 2] += vapor.vel[o + 2] * dt;
      vapor.col[o] = vapor.col[o + 1] = vapor.col[o + 2] = Math.min(1, vapor.life[i] * 2) * 0.9;
      const hd = Math.hypot(cp.x - vapor.pos[o], cp.z - vapor.pos[o + 2]);
      if ((vapor.pos[o + 1] > cp.y - 0.3 && hd < 0.9 * cloudScale(cl)) || vapor.pos[o + 1] > 6) {
        vapor.alive[i] = 0; vapor.pos[o + 1] = -100;
        cl.water = Math.min(1, cl.water + VAPOR_UNIT * CLOUD_PER_UNIT); recent.cond = now;
      }
    }
    vaporGeo.attributes.position.needsUpdate = true;
    vaporGeo.attributes.color.needsUpdate = true;

    // clouds: drift, grow greyer with water, rain when full or squeezed
    for (const cl of clouds) {
      const p = cl.group.position;
      if (cl.target) {
        p.x += (cl.target.x - p.x) * Math.min(1, dt * 10); p.z += (cl.target.y - p.z) * Math.min(1, dt * 10);
        if (cl.released && Math.hypot(cl.target.x - p.x, cl.target.y - p.z) < 0.05) { cl.target = null; cl.released = false; }
      } else {
        p.x += cl.drift.x * dt; p.z += cl.drift.y * dt;
        if (Math.abs(p.x) > HALF - 0.8) cl.drift.x = -Math.sign(p.x) * Math.abs(cl.drift.x);
        if (Math.abs(p.z) > HALF - 0.8) cl.drift.y = -Math.sign(p.z) * Math.abs(cl.drift.y);
        for (const o of clouds) if (o !== cl) {   // nudge apart when overlapping
          const dx = p.x - o.group.position.x, dz = p.z - o.group.position.z, d = Math.hypot(dx, dz) || 0.01;
          const min = 1.1 * (cloudScale(cl) + cloudScale(o));
          if (d < min) { p.x += dx / d * (min - d) * dt; p.z += dz / d * (min - d) * dt; }
        }
      }
      p.y = cl.y + Math.sin(T * 0.6 + cl.y * 10) * 0.08;
      if (cl.water > 0.92) cl.raining = true;
      if (cl.water < 0.3) cl.raining = false;
      if ((cl.raining || cl.squeezing) && cl.water > 0.02) {
        cl.rainAcc += (cl.squeezing ? 90 : 55) * dt;
        while (cl.rainAcc >= 1) { cl.rainAcc -= 1; spawnRain(cl); cl.water = Math.max(0, cl.water - VAPOR_UNIT * CLOUD_PER_UNIT); }
        recent.rain = now;
      }
      cl.group.scale.setScalar(cloudScale(cl) * (cl.squeezing ? 0.92 + 0.04 * Math.sin(T * 30) : 1));
      cl.mat.color.copy(cloudWhite).lerp(cloudGrey, smooth(0.35, 1, cl.water));
      cl.mat.emissiveIntensity = (0.04 + 0.12 * (1 - cl.water)) * (0.3 + 0.7 * daylight);
    }

    // raindrops fall onto the lake or the land
    const wl = lakeLevel();
    for (let i = 0; i < RMAX; i++) {
      if (!rain.alive[i]) continue;
      const o = i * 6, x = rain.pos[o], z = rain.pos[o + 2];
      rain.pos[o + 1] -= 7 * dt; rain.pos[o + 4] -= 7 * dt;
      const g = heightAt(x, z), onLake = inLakeDisc(x, z) && g < wl;
      const floorY = onLake ? wl : (Math.abs(x) > HALF || Math.abs(z) > HALF ? BOTTOM : g);
      if (rain.pos[o + 4] <= floorY) {
        rain.alive[i] = 0; rain.pos[o + 1] = rain.pos[o + 4] = -100;
        if (onLake) lake += VAPOR_UNIT; else soil += VAPOR_UNIT;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;

    // water on the slopes drains down the river back into the lake
    const drain = soil * 0.18 * dt;
    soil -= drain; lake = Math.min(1, Math.max(0, lake + drain));
    const flow = dt > 0 ? Math.min(1, drain / dt * 12) : 0;
    if (flow > 0.12) recent.flow = now;
    riverUniforms.uFlow.value += (Math.max(0.12, flow) - riverUniforms.uFlow.value) * Math.min(1, dt * 2);
    riverUniforms.uTime.value = T;
    waterNormal.offset.set(T * 0.012, T * 0.008);

    // panel: light up what is happening now, explain the newest stage
    uiTick += dt;
    if (uiTick > 0.2) {
      uiTick = 0;
      const active: Record<Stage, boolean> = { evap: now - recent.evap < 800, cond: now - recent.cond < 800, rain: now - recent.rain < 800, flow: now - recent.flow < 800 };
      for (const k of ORDER) chips[k].classList.toggle('on', active[k]);
      if (now > heldUntil) {
        const next = PRIORITY.find(k => active[k] && k !== lastShown && now - (shownAt[k] ?? 0) > 12000);
        if (next) show(next, 7000);
      }
      if (statsEl) statsEl.textContent = `tier ${tier} · ${renderer.info.render.calls} calls · ${renderer.info.render.triangles} tris · dpr ${renderer.getPixelRatio().toFixed(2)}`;
    meter(mLake, nLake, lake);
      meter(mCloud, nCloud, clouds.reduce((s, c) => s + c.water, 0) / clouds.length);
      meter(mSoil, nSoil, soil * 4);
    }

    controls.update();
    renderer.render(scene, camera);
  }
  $('loading').remove();
  startLoop();

  addEventListener('resize', () => { applySize(); placeCamera(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else if (!halted) startLoop(); });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); halted = true; stopLoop(); showFallback('画面暂停了。点下面的按钮重新打开。', true); });
}
