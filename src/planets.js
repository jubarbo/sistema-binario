import * as THREE from 'three';
import { bakeEquirect } from './textureBaker.js';
import { rockyBakeFragmentShader } from './shaders/rockySurface.js';
import { gasGiantGLSL } from './shaders/gasGiant.js';
import { atmosphereFragmentShader, atmosphereVertexShader } from './shaders/atmosphere.js';
import { eclipseGLSL, noiseGLSL } from './shaders/common.js';

const TAU = Math.PI * 2;

/** Reemplaza un fragmento de shader y falla con un error claro si no existe. */
function replaceOrThrow(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`No se encontró "${search}" en el shader de Three.js (¿versión incompatible?).`);
  }
  return source.replace(search, replacement);
}

/**
 * Extiende MeshStandardMaterial (PBR) con:
 *  - sombra analítica de eclipse del otro planeta sobre la luz directa,
 *  - dispersión atmosférica en el limbo iluminado (Fresnel),
 *  - opcionalmente, un albedo/rugosidad procedimental propio.
 */
function patchSurfaceShader(shader, uniforms, { surfaceFragment, roughnessFragment, extraFragmentPars = '', objectPosition = false } = {}) {
  Object.assign(shader.uniforms, uniforms);
  const objVarying = objectPosition ? 'varying vec3 vSurfObjPos;' : '';

  let vs = replaceOrThrow(shader.vertexShader, '#include <common>', `#include <common>
varying vec3 vSurfWorldPos;
${objVarying}`);
  vs = replaceOrThrow(vs, '#include <project_vertex>', `#include <project_vertex>
vSurfWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
${objectPosition ? 'vSurfObjPos = position;' : ''}`);

  let fs = replaceOrThrow(shader.fragmentShader, '#include <common>', `#include <common>
varying vec3 vSurfWorldPos;
${objVarying}
uniform vec3 uSunDir;
uniform vec3 uOccluderPos;
uniform float uOccluderRadius;
uniform float uSunAngularRadius;
uniform vec3 uRimColor;
uniform float uRimIntensity;
uniform float uRimPower;
${eclipseGLSL}
${extraFragmentPars}`);
  if (surfaceFragment) fs = replaceOrThrow(fs, '#include <map_fragment>', surfaceFragment);
  if (roughnessFragment) fs = replaceOrThrow(fs, '#include <roughnessmap_fragment>', roughnessFragment);
  fs = replaceOrThrow(fs, '#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  float eclipse = eclipseFactor(vSurfWorldPos, uSunDir, uOccluderPos, uOccluderRadius, uSunAngularRadius);
  reflectedLight.directDiffuse *= eclipse;
  reflectedLight.directSpecular *= eclipse;

  vec3 rimN = normalize(vNormal);
  vec3 rimV = normalize(vViewPosition);
  vec3 sunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  float rimDay = smoothstep(-0.12, 0.45, dot(rimN, sunView));
  float rim = pow(1.0 - clamp(dot(rimN, rimV), 0.0, 1.0), uRimPower);
  totalEmissiveRadiance += uRimColor * (rim * rimDay * uRimIntensity * eclipse);
}`);

  shader.vertexShader = vs;
  shader.fragmentShader = fs;
}

/** Uniforms por planeta; uSunDir y uSunAngularRadius se comparten con el entorno. */
function createPlanetUniforms(def, sun) {
  const atm = def.atmosphere;
  return {
    uSunDir: sun.uSunDir,
    uSunAngularRadius: sun.uSunAngularRadius,
    uOccluderPos: { value: new THREE.Vector3() },
    uOccluderRadius: { value: 0 },
    uPlanetCenter: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uRimColor: { value: new THREE.Color(atm.color) },
    uRimIntensity: { value: atm.rimIntensity },
    uRimPower: { value: atm.rimPower },
  };
}

function createHaloMaterial(def, u) {
  const atm = def.atmosphere;
  return new THREE.ShaderMaterial({
    name: `${def.name} · halo`,
    uniforms: {
      uSunDir: u.uSunDir,
      uSunAngularRadius: u.uSunAngularRadius,
      uOccluderPos: u.uOccluderPos,
      uOccluderRadius: u.uOccluderRadius,
      uPlanetCenter: u.uPlanetCenter,
      uColor: { value: new THREE.Color(atm.color) },
      uTwilightColor: { value: new THREE.Color(atm.twilightColor) },
      uIntensity: { value: atm.haloIntensity },
      uPower: { value: atm.haloPower },
      uLimb: { value: Math.sqrt(1 - 1 / (atm.haloScale * atm.haloScale)) },
    },
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Crea los dos planetas.
 * Jerarquía de cada uno: pivot (posición orbital) → tilt (oblicuidad) → body (rotación axial);
 * el halo cuelga del pivot porque es esféricamente simétrico.
 *
 * @returns {{group: THREE.Group, planetA: object, planetB: object, update: Function, dispose: Function}}
 */
export function createPlanets(renderer, quality, { planetA: defA, planetB: defB, sun }) {
  const disposables = [];
  const group = new THREE.Group();
  group.name = 'planets';

  // Una sola geometría de esfera unidad, reutilizada por superficies y halos.
  const segments = quality.sphereSegments;
  const geometry = new THREE.SphereGeometry(1, segments, Math.round(segments / 2));
  disposables.push(geometry);

  // --- Planeta A: texturas horneadas en GPU (albedo, normal map, rugosidad) ---
  const texW = quality.rockyTextureWidth;
  const texH = texW / 2;
  const bakeUniforms = {
    uSeed: { value: defA.surface.seed },
    uRelief: { value: defA.surface.relief },
    uTexelAngle: { value: Math.PI / texH },
  };
  const bake = (w, h, define) =>
    bakeEquirect(renderer, { width: w, height: h, fragmentShader: rockyBakeFragmentShader, uniforms: bakeUniforms, defines: { [define]: '' } });
  const albedoTarget = bake(texW, texH, 'BAKE_ALBEDO');
  const normalTarget = bake(texW, texH, 'BAKE_NORMAL');
  const roughnessTarget = bake(texW / 2, texH / 2, 'BAKE_ROUGHNESS');
  disposables.push(albedoTarget, normalTarget, roughnessTarget);

  const uniformsA = createPlanetUniforms(defA, sun);
  const rockyMaterial = new THREE.MeshStandardMaterial({
    name: defA.name,
    map: albedoTarget.texture,
    normalMap: normalTarget.texture,
    normalMapType: THREE.ObjectSpaceNormalMap,
    roughnessMap: roughnessTarget.texture,
    roughness: 1.0,
    metalness: 0.0,
  });
  rockyMaterial.onBeforeCompile = (shader) => patchSurfaceShader(shader, uniformsA);
  rockyMaterial.customProgramCacheKey = () => 'binary-rocky-surface';
  disposables.push(rockyMaterial);

  // --- Planeta B: shader procedimental animado sobre PBR ---
  const uniformsB = createPlanetUniforms(defB, sun);
  const gasMaterial = new THREE.MeshStandardMaterial({
    name: defB.name,
    color: new THREE.Color().setRGB(defB.surface.albedo, defB.surface.albedo, defB.surface.albedo),
    roughness: defB.surface.roughness,
    metalness: 0.0,
  });
  gasMaterial.onBeforeCompile = (shader) =>
    patchSurfaceShader(shader, uniformsB, {
      objectPosition: true,
      extraFragmentPars: `uniform float uTime;\n#define GAS_OCTAVES ${quality.gasOctaves}\n${noiseGLSL}\n${gasGiantGLSL}`,
      surfaceFragment: `float gasDetail = 0.0;
diffuseColor.rgb *= gasGiantColor(normalize(vSurfObjPos), uTime, gasDetail);`,
      roughnessFragment: 'float roughnessFactor = clamp(roughness + gasDetail * 0.06, 0.0, 1.0);',
    });
  gasMaterial.customProgramCacheKey = () => `binary-gas-surface-${quality.gasOctaves}`;
  disposables.push(gasMaterial);

  function buildPlanet(def, material, uniforms) {
    const pivot = new THREE.Group();
    pivot.name = def.name;
    const tilt = new THREE.Group();
    tilt.rotation.z = THREE.MathUtils.degToRad(def.axialTilt);
    const body = new THREE.Mesh(geometry, material);
    body.scale.setScalar(def.radius);
    tilt.add(body);
    pivot.add(tilt);

    const haloMaterial = createHaloMaterial(def, uniforms);
    disposables.push(haloMaterial);
    const halo = new THREE.Mesh(geometry, haloMaterial);
    halo.scale.setScalar(def.radius * def.atmosphere.haloScale);
    halo.renderOrder = 2;
    pivot.add(halo);
    group.add(pivot);

    return {
      def,
      pivot,
      body,
      halo,
      uniforms,
      radius: def.radius,
      outerRadius: def.radius * def.atmosphere.haloScale,
      // Distancia mínima de la cámara al centro del planeta.
      cameraClearance: def.radius * def.atmosphere.haloScale * 1.3,
    };
  }

  const planetA = buildPlanet(defA, rockyMaterial, uniformsA);
  const planetB = buildPlanet(defB, gasMaterial, uniformsB);
  uniformsA.uOccluderRadius.value = defB.radius;
  uniformsB.uOccluderRadius.value = defA.radius;

  /**
   * Actualiza posiciones, rotación axial y uniforms. No crea objetos.
   * @param {number} simDt paso de tiempo simulado (0 en pausa)
   * @param {number} simTime tiempo simulado acumulado
   */
  function update(simDt, simTime, positionA, positionB, rotation) {
    planetA.pivot.position.copy(positionA);
    planetB.pivot.position.copy(positionB);
    planetA.body.rotation.y = (planetA.body.rotation.y + rotation.spinA * simDt) % TAU;
    planetB.body.rotation.y = (planetB.body.rotation.y + rotation.spinB * simDt) % TAU;

    uniformsA.uPlanetCenter.value.copy(positionA);
    uniformsB.uPlanetCenter.value.copy(positionB);
    uniformsA.uOccluderPos.value.copy(positionB);
    uniformsB.uOccluderPos.value.copy(positionA);
    uniformsB.uTime.value = simTime * defB.surface.stormDrift;
  }

  function dispose() {
    group.removeFromParent();
    for (const item of disposables) item.dispose();
    disposables.length = 0;
  }

  return { group, planetA, planetB, update, dispose };
}
