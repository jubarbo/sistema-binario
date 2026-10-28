import * as THREE from 'three';

const BAKE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Renderiza un shader procedimental una única vez en una textura equirectangular
 * (half float, con mipmaps) y devuelve el render target. El llamador es
 * responsable de liberarlo con `target.dispose()`.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {{width:number, height:number, fragmentShader:string, uniforms?:object, defines?:object}} options
 * @returns {THREE.WebGLRenderTarget}
 */
export function bakeEquirect(renderer, { width, height, fragmentShader, uniforms = {}, defines = {} }) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
  target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX_SHADER,
    fragmentShader,
    uniforms,
    defines,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const previousTarget = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(previousTarget);
    geometry.dispose();
    material.dispose();
  }
  return target;
}
