import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Perfiles de calidad. Se pueden forzar con ?quality=high|low en la URL. */
export const QUALITY_PRESETS = Object.freeze({
  high: {
    name: 'high',
    maxPixelRatio: 2,
    minPixelRatio: 1,
    msaaSamples: 4,
    sphereSegments: 160,
    rockyTextureWidth: 2048,
    skyTextureWidth: 2048,
    starCount: 9000,
    gasOctaves: 5,
  },
  low: {
    name: 'low',
    maxPixelRatio: 1.25,
    minPixelRatio: 0.75,
    msaaSamples: 0,
    sphereSegments: 96,
    rockyTextureWidth: 1024,
    skyTextureWidth: 1024,
    starCount: 4000,
    gasOctaves: 3,
  },
});

/**
 * Crea el renderizador con gestión de color y tone mapping cinematográfico.
 * El antialiasing se resuelve con MSAA en el render target del posprocesado
 * (el antialias del canvas no tendría efecto al dibujar a través del composer).
 */
export function createRenderer(container, config) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.toneMappingExposure;
  renderer.setClearColor(0x000000, 1);
  renderer.domElement.classList.add('scene-canvas');
  container.appendChild(renderer.domElement);
  return renderer;
}

/** Detecta un perfil de calidad razonable para el dispositivo. */
export function detectQuality(renderer) {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced && QUALITY_PRESETS[forced]) return QUALITY_PRESETS[forced];
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency || 4;
  const weakGpu = renderer.capabilities.maxTextureSize < 8192;
  return coarsePointer || cores <= 4 || weakGpu ? QUALITY_PRESETS.low : QUALITY_PRESETS.high;
}

export function createCamera(config) {
  const camera = new THREE.PerspectiveCamera(config.fov, 1, config.near, config.far);
  camera.position.set(...config.position);
  return camera;
}

/** OrbitControls con amortiguación; sin paneo para conservar la composición. */
export function createCameraControls(camera, domElement, config) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.enablePan = false;
  controls.minDistance = config.minDistance;
  controls.maxDistance = config.maxDistance;
  controls.target.set(...config.target);
  controls.update();
  return controls;
}

/**
 * Encuadre inicial: en pantallas estrechas (móvil vertical) aleja la cámara
 * para que ambos planetas y sus órbitas quepan horizontalmente.
 */
export function frameInitialView(camera, controls, config) {
  const offset = new THREE.Vector3(...config.position).sub(controls.target);
  const factor = Math.max(1, config.referenceAspect / camera.aspect);
  const distance = Math.min(offset.length() * factor, config.maxDistance);
  camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);
  camera.lookAt(controls.target);
  controls.update();
}

/** Pase final: viñeta suave y grano mínimo (también actúa como dithering). */
const CinematicFinishShader = {
  name: 'CinematicFinishShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.008 },
    uVignette: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;
    float grainHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      color.rgb *= 1.0 - uVignette * smoothstep(0.2, 1.0, dot(q, q) * 2.0);
      color.rgb += (grainHash(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) * uGrain;
      gl_FragColor = color;
    }
  `,
};

/**
 * Cadena de posprocesado: render HDR (half float, MSAA) → bloom sutil →
 * tone mapping + sRGB (OutputPass) → viñeta/grano.
 */
export function createPostProcessing(renderer, scene, camera, quality, config) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.msaaSamples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), config.bloom.strength, config.bloom.radius, config.bloom.threshold);
  composer.addPass(bloomPass);
  const outputPass = new OutputPass();
  composer.addPass(outputPass);
  const finishPass = new ShaderPass(CinematicFinishShader);
  finishPass.uniforms.uGrain.value = config.grain;
  finishPass.uniforms.uVignette.value = config.vignette;
  composer.addPass(finishPass);

  return {
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    render(deltaTime, time) {
      finishPass.uniforms.uTime.value = time;
      composer.render(deltaTime);
    },
    setBloomEnabled(enabled) {
      bloomPass.enabled = enabled;
    },
    dispose() {
      bloomPass.dispose();
      outputPass.dispose();
      finishPass.dispose();
      composer.dispose();
    },
  };
}

/** Observa el tamaño del contenedor y notifica cambios (en píxeles CSS). */
export function observeResize(container, onResize) {
  const observer = new ResizeObserver((entries) => {
    const box = entries[0].contentRect;
    onResize(Math.max(1, Math.floor(box.width)), Math.max(1, Math.floor(box.height)));
  });
  observer.observe(container);
  return observer;
}
