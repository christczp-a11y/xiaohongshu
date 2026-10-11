// Shader patches that make the procedural scene read as real materials:
// terrain with grass / sand / layered rock / snow detail, bump and lake-bed caustics,
// a lake with depth-based colour, see-through shallows, shore foam and two wave layers,
// leafy bump on foliage, and soft-edged clouds. All generated in the shader, no texture files.
import * as THREE from 'three';

const NOISE = /* glsl */`
float wcH(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wcN(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(wcH(i), wcH(i + vec2(1., 0.)), f.x), mix(wcH(i + vec2(0., 1.)), wcH(i + vec2(1., 1.)), f.x), f.y);
}
float wcF(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 3; i++) { s += a * wcN(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
// bump from a scalar field using screen-space derivatives (same idea as three's bump map)
vec3 wcBump(vec3 pos, vec3 n, float h, float k) {
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g * k);
}
vec3 wcLin(vec3 c) { return pow(c, vec3(2.2)); }
`;

const WORLD_VARYINGS_VERTEX = (sh: { vertexShader: string }) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
    .replace('#include <fog_vertex>', `#include <fog_vertex>
      #ifdef USE_INSTANCING
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
      #else
        vWPos = (modelMatrix * vec4(transformed, 1.)).xyz;
      #endif
      vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
};

export interface SceneUniforms {
  uTime: { value: number };
  uWL: { value: number };     // lake surface height
  uSun: { value: number };    // 0 night .. 1 full sun
}

/** Terrain: albedo from height, slope and noise; bump detail; caustics under the lake. */
export function patchTerrain(mat: THREE.MeshStandardMaterial, u: SceneUniforms, lake: { x: number; z: number; r: number }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uLake: { value: new THREE.Vector3(lake.x, lake.z, lake.r) } });
    WORLD_VARYINGS_VERTEX(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform float uTime, uWL, uSun; uniform vec3 uLake;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 tp = vWPos.xz; float ty = vWPos.y; float tny = clamp(vWNrm.y, 0., 1.);
        float tn1 = wcF(tp * 3.1), tn2 = wcN(tp * 38.), tn3 = wcN(tp * 97.);
        vec3 tGrass = mix(vec3(.27, .33, .17), vec3(.43, .47, .26), tn1);
        tGrass = mix(tGrass, vec3(.52, .49, .29), smoothstep(.55, .8, wcF(tp * 1.3 + 7.)) * .4);
        tGrass *= .78 + .34 * tn2 * (.7 + .3 * tn3);
        vec3 tSand = vec3(.70, .63, .47) * (.88 + .16 * tn3);
        vec3 tSilt = vec3(.30, .32, .25) * (.85 + .2 * tn2);
        float tStrata = .5 + .5 * sin(ty * 30. + tn1 * 9. + wcN(tp * 6.) * 4.);
        vec3 tRock = mix(vec3(.40, .36, .31), vec3(.56, .52, .45), tn2) * (.84 + .18 * tStrata);
        vec3 tSnow = vec3(.93, .95, .97) * (.95 + .05 * tn3);
        vec3 tc = tGrass;
        tc = mix(tc, tSand, 1. - smoothstep(.30, .46, ty + (tn1 - .5) * .08));
        tc = mix(tc, tSilt, 1. - smoothstep(-.45, .25, ty));
        float tRocky = clamp(max(smoothstep(.86, .64, tny), smoothstep(1.35, 2.2, ty)) + (tn1 - .5) * .35, 0., 1.);
        tc = mix(tc, tRock, tRocky);
        tc = mix(tc, tSnow, smoothstep(2.7, 3.15, ty + (tn2 - .5) * .2) * smoothstep(.5, .75, tny));
        // underwater: light caustics dancing on the lake bed
        float tUnder = step(ty, uWL) * step(length(tp - uLake.xy), uLake.z);
        vec2 cq = tp * 6.;
        float tCaus = pow(abs(sin(cq.x + uTime * .9 + wcN(cq + uTime * .4) * 3.) * sin(cq.y - uTime * .7 + wcN(cq * 1.3 - uTime * .3) * 3.)), 6.);
        tc += tUnder * tCaus * .35 * uSun * smoothstep(-.5, uWL, ty);
        diffuseColor.rgb = wcLin(tc);
        float tBumpH = mix(tn2 * .55 + tn3 * .45, tStrata * .55 + tn2 * .45, tRocky);
        float tRough = mix(.97, .82, tRocky) - tUnder * .25;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = wcBump(-vViewPosition, normal, tBumpH, mix(.010, .028, tRocky));`);
  };
}

/** Foliage: leafy bump and light at the crown tops. */
export function patchFoliage(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (sh) => {
    WORLD_VARYINGS_VERTEX(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;\n${NOISE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float fLeaf = wcN(vWPos.xz * 70. + vWPos.y * 50.) * .6 + wcN(vWPos.xy * 140.) * .4;
        normal = wcBump(-vViewPosition, normal, fLeaf, .02);
        diffuseColor.rgb *= .8 + .4 * fLeaf;`);
  };
}

/** Clouds: soft, see-through edges and a little lumpy bump. */
export function patchCloud(mat: THREE.MeshStandardMaterial) {
  mat.transparent = true;
  mat.onBeforeCompile = (sh) => {
    WORLD_VARYINGS_VERTEX(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;\n${NOISE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float cPuff = wcF(vWPos.xz * 5. + vWPos.y * 4.);
        normal = wcBump(-vViewPosition, normal, cPuff, .05);`)
      .replace('#include <opaque_fragment>', `
        float cEdge = abs(dot(normal, normalize(vViewPosition)));
        diffuseColor.a *= smoothstep(.04, .5, cEdge) * (.85 + .15 * cPuff);
        #include <opaque_fragment>`);
  };
}

/**
 * Lake surface. Colour and opacity follow the real depth under each point (from a baked height
 * texture), so shallows are clear and show the bed, deep water turns dark teal; foam where it meets
 * the shore; two wave layers moving in different directions.
 */
export function makeWaterMaterial(u: SceneUniforms, waves: THREE.Texture, bed: THREE.DataTexture,
  bedBox: THREE.Vector4, bedRange: THREE.Vector2): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.0, transparent: true, envMapIntensity: 1.2 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, {
      uWaves: { value: waves }, uBed: { value: bed }, uBedBox: { value: bedBox }, uBedRange: { value: bedRange },
    });
    WORLD_VARYINGS_VERTEX(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform float uTime, uWL, uSun; uniform sampler2D uWaves, uBed; uniform vec4 uBedBox; uniform vec2 uBedRange;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wUv = (vWPos.xz - uBedBox.xy) / uBedBox.zw;
        float wBed = mix(uBedRange.x, uBedRange.y, texture(uBed, wUv).r);
        float wDepth = max(uWL - wBed, 0.);
        vec3 wShallow = wcLin(vec3(.36, .70, .66)), wDeep = wcLin(vec3(.03, .22, .27));
        vec3 wCol = mix(wShallow, wDeep, smoothstep(0., .55, wDepth));
        float wFoam = smoothstep(.022, .0, wDepth) * smoothstep(.45, .75, wcN(vWPos.xz * 26. + vec2(uTime * .6, -uTime * .4)));
        diffuseColor.rgb = mix(wCol, vec3(.95), wFoam);
        diffuseColor.a = mix(.42, .94, smoothstep(0., .4, wDepth)) + wFoam * .5;
        diffuseColor.a *= smoothstep(0., .012, wDepth + wFoam * .02);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 wa = vWPos.xz * .55 + vec2(uTime * .035, uTime * .021);
        vec2 wb = vWPos.xz * 1.6 - vec2(uTime * .028, -uTime * .039);
        vec3 nA = texture(uWaves, wa).xyz * 2. - 1., nB = texture(uWaves, wb).xyz * 2. - 1.;
        vec2 wSlope = (nA.xy + nB.xy) * .55;
        vec3 wN = normalize(vec3(wSlope.x, 1., wSlope.y));
        normal = normalize((viewMatrix * vec4(wN, 0.)).xyz);`);
  };
  return mat;
}

/** Bake the lake-bed heights into an 8-bit texture covering the lake's bounding square. */
export function bakeBed(heightAt: (x: number, z: number) => number, cx: number, cz: number, r: number, n = 128) {
  const lo = -0.7, hi = 0.7, data = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = cx - r + (i + 0.5) / n * 2 * r, z = cz - r + (j + 0.5) / n * 2 * r;
    data[j * n + i] = Math.round(THREE.MathUtils.clamp((heightAt(x, z) - lo) / (hi - lo), 0, 1) * 255);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, box: new THREE.Vector4(cx - r, cz - r, 2 * r, 2 * r), range: new THREE.Vector2(lo, hi) };
}

/** Darken geometry toward its base: cheap ambient occlusion for trees. */
export function shadeByHeight(geo: THREE.BufferGeometry, low: number) {
  geo.computeBoundingBox();
  const b = geo.boundingBox!, p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - b.min.y) / Math.max(1e-6, b.max.y - b.min.y);
    const s = low + (1 - low) * Math.pow(t, 0.8);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
