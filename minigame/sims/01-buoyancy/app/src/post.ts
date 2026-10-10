import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Runs after tone mapping, in display space: a lens-like vignette, a hint of
// edge colour fringing and fine grain, so the frame reads as a photograph.
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float ca = dot(d, d) * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - d * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + d * ca).b;
      float r = length(d * vec2(uRes.x / uRes.y, 1.0));
      col *= mix(0.62, 1.0, smoothstep(0.95, 0.28, r));
      col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.028;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(Math.max(size.x, 1), Math.max(size.y, 1), {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.18, 0.5, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  return {
    setSize(w: number, h: number) {
      const pr = renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      grade.uniforms.uRes.value.set(w * pr, h * pr);
    },
    render(time: number) {
      grade.uniforms.uTime.value = time;
      composer.render();
    },
  };
}
