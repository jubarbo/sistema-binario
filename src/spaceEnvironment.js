import * as THREE from 'three';
import { bakeEquirect } from './textureBaker.js';
import { nebulaBakeFragmentShader, starFragmentShader, starVertexShader } from './shaders/space.js';

/** Generador pseudoaleatorio con semilla (mulberry32), para un cielo reproducible. */
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Colores estelares por temperatura (sRGB) y su frecuencia relativa.
const STAR_COLORS = [
  { color: [0.66, 0.75, 1.0], weight: 0.18 },
  { color: [0.86, 0.9, 1.0], weight: 0.27 },
  { color: [1.0, 0.98, 0.95], weight: 0.3 },
  { color: [1.0, 0.88, 0.7], weight: 0.17 },
  { color: [1.0, 0.74, 0.55], weight: 0.08 },
];

function pickStarColor(r) {
  let acc = 0;
  for (const entry of STAR_COLORS) {
    acc += entry.weight;
    if (r <= acc) return entry.color;
  }
  return STAR_COLORS[STAR_COLORS.length - 1].color;
}

/**
 * Campo de estrellas 3D: un 60 % uniforme y un 40 % concentrado en la banda
 * galáctica. Brillo con distribución de potencia (pocas estrellas brillantes).
 */
function createStarField(count, bandNormal, [minRadius, maxRadius]) {
  const random = createRandom(1337);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const brightness = new Float32Array(count);
  const twinkle = new Float32Array(count * 2);
  const dir = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const z = random() * 2 - 1;
    const phi = random() * Math.PI * 2;
    const rxy = Math.sqrt(1 - z * z);
    dir.set(rxy * Math.cos(phi), z, rxy * Math.sin(phi));
    if (random() < 0.4) {
      // Proyección al plano galáctico más dispersión gaussiana (Box-Muller).
      const gauss = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-6))) * Math.cos(2 * Math.PI * random());
      dir.addScaledVector(bandNormal, -dir.dot(bandNormal)).normalize().addScaledVector(bandNormal, gauss * 0.12).normalize();
    }
    const radius = minRadius + random() * (maxRadius - minRadius);
    dir.multiplyScalar(radius).toArray(positions, i * 3);

    const r = random();
    brightness[i] = 0.05 + Math.pow(r, 7) * 1.5;
    sizes[i] = 1.3 + Math.pow(r, 5) * 2.0 + random() * 0.4;

    const c = pickStarColor(random());
    colors[i * 3] = Math.pow(c[0], 2.2);
    colors[i * 3 + 1] = Math.pow(c[1], 2.2);
    colors[i * 3 + 2] = Math.pow(c[2], 2.2);
    twinkle[i * 2] = 0.6 + random() * 2.2;
    twinkle[i * 2 + 1] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 2));

  const material = new THREE.ShaderMaterial({
    name: 'stars',
    uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 } },
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -5;
  return points;
}

/**
 * Entorno: estrella direccional fuera de cuadro, luz ambiente mínima,
 * fondo con nebulosas (horneado una vez) y campo de estrellas.
 */
export function createSpaceEnvironment(renderer, quality, config) {
  const group = new THREE.Group();
  group.name = 'space-environment';
  const disposables = [];

  const sunDirection = new THREE.Vector3(...config.sun.direction).normalize();
  const sunUniforms = {
    uSunDir: { value: sunDirection.clone() },
    uSunAngularRadius: { value: config.sun.angularRadius },
  };

  const sunLight = new THREE.DirectionalLight(config.sun.color, config.sun.intensity);
  sunLight.position.copy(sunDirection).multiplyScalar(500);
  sunLight.target.position.set(0, 0, 0);
  const ambient = new THREE.AmbientLight(config.ambient.color, config.ambient.intensity);
  group.add(sunLight, sunLight.target, ambient);

  // Fondo: esfera lejana que sigue a la cámara, con la nebulosa horneada.
  const bandNormal = new THREE.Vector3(...config.space.bandNormal).normalize();
  const skyTarget = bakeEquirect(renderer, {
    width: quality.skyTextureWidth,
    height: quality.skyTextureWidth / 2,
    fragmentShader: nebulaBakeFragmentShader,
    uniforms: { uBandNormal: { value: bandNormal }, uIntensity: { value: config.space.nebulaIntensity } },
  });
  const skyGeometry = new THREE.SphereGeometry(1, 64, 32);
  const skyMaterial = new THREE.MeshBasicMaterial({ map: skyTarget.texture, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(skyGeometry, skyMaterial);
  sky.scale.setScalar(2000);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);
  disposables.push(skyTarget, skyGeometry, skyMaterial);

  const stars = createStarField(quality.starCount, bandNormal, config.space.starRadius);
  group.add(stars);
  disposables.push(stars.geometry, stars.material);

  return {
    group,
    sunUniforms,
    /** @param {number} time tiempo real (el centelleo no se detiene en pausa) */
    update(time, camera) {
      sky.position.copy(camera.position);
      stars.material.uniforms.uTime.value = time;
    },
    setPixelRatio(pixelRatio) {
      stars.material.uniforms.uPixelRatio.value = pixelRatio;
    },
    setStarsVisible(visible) {
      stars.visible = visible;
    },
    dispose() {
      group.removeFromParent();
      sunLight.dispose();
      ambient.dispose();
      for (const item of disposables) item.dispose();
      disposables.length = 0;
    },
  };
}
