/**
 * Parámetros editables del sistema binario.
 *
 * Todo lo que define el aspecto de los planetas, la órbita inicial, la luz y la
 * cámara está aquí, para personalizar la escena sin tocar la lógica.
 * Los colores se escriben en sRGB (hex); Three.js los convierte a lineal.
 */

/** Valores iniciales de la simulación (los que restaura "Restablecer"). */
export const DEFAULTS = Object.freeze({
  simulation: {
    paused: false,
    timeScale: 1.0, // multiplicador global del tiempo simulado
  },
  orbit: {
    massA: 1.0, // masa relativa del planeta rocoso (M1)
    massB: 2.5, // masa relativa del gigante gaseoso (M2)
    separation: 15, // semieje mayor de la órbita relativa (= distancia d si e = 0)
    eccentricity: 0.12,
    inclination: 12, // grados, giro del plano orbital sobre el eje X
    periapsisArgument: 30, // grados, orientación de la elipse dentro de su plano
    orbitalSpeed: 1.0, // multiplicador de la velocidad angular kepleriana
  },
  rotation: {
    spinA: 0.3, // rad/s (tiempo simulado)
    spinB: 0.55,
  },
  display: {
    trajectories: true,
    trajectoryOpacity: 0.5,
    stars: true,
    bloom: true,
  },
});

/** Planeta A: rocoso. */
export const PLANET_A = Object.freeze({
  name: 'Planeta A · rocoso',
  radius: 2.0,
  axialTilt: 21, // grados
  surface: {
    seed: 7.0, // cambia el relieve y la distribución de continentes y cráteres
    relief: 1.0, // intensidad del relieve en el normal map
  },
  atmosphere: {
    color: '#6f9dff',
    twilightColor: '#ff9a5c',
    haloScale: 1.06, // radio del halo / radio del planeta
    haloIntensity: 0.9,
    haloPower: 2.6,
    rimIntensity: 0.55, // dispersión sobre el disco, junto al borde
    rimPower: 5.0,
  },
  trajectoryColor: '#86a9d6',
});

/** Planeta B: gigante gaseoso. */
export const PLANET_B = Object.freeze({
  name: 'Planeta B · gaseoso',
  radius: 3.6,
  axialTilt: 7,
  surface: {
    albedo: 0.62, // escala del albedo procedimental
    roughness: 0.9,
    stormDrift: 0.012, // velocidad de evolución de las turbulencias
  },
  atmosphere: {
    color: '#ffd8a8',
    twilightColor: '#ff8a4d',
    haloScale: 1.075,
    haloIntensity: 0.55,
    haloPower: 2.2,
    rimIntensity: 0.35,
    rimPower: 3.5,
  },
  trajectoryColor: '#d8b088',
});

/** Escena: luz, cámara, posprocesado y límites. */
export const SCENE_CONFIG = Object.freeze({
  // Constante gravitatoria en unidades de la escena: con los valores por defecto
  // el periodo orbital ronda el minuto.
  gravitationalConstant: 12.4,
  sun: {
    direction: [-1.0, 0.22, -0.28], // hacia la estrella, fuera del encuadre
    color: '#fff2e2',
    intensity: 5.5,
    angularRadius: 0.02, // tamaño aparente de la estrella: ancho de la penumbra en eclipses
  },
  ambient: { color: '#8ea2c8', intensity: 0.03 },
  camera: {
    fov: 34,
    near: 0.1,
    far: 6000,
    position: [5.5, 9.5, 37],
    target: [0, 0, 0],
    referenceAspect: 1.35, // por debajo de este aspecto la cámara se aleja para que todo quepa
    minDistance: 7,
    maxDistance: 150,
  },
  renderer: { toneMappingExposure: 1.0 },
  postprocessing: {
    bloom: { strength: 0.3, radius: 0.55, threshold: 0.88 },
    grain: 0.008,
    vignette: 0.3,
  },
  space: {
    bandNormal: [0.32, 0.86, -0.4], // orientación de la banda galáctica
    starRadius: [280, 900],
    nebulaIntensity: 1.0,
  },
  trajectories: { segments: 512 },
  orbitLimits: {
    minSeparation: 8,
    maxSeparation: 32,
    maxEccentricity: 0.75,
    periapsisMargin: 1.12, // separación mínima en el periapsis respecto a la suma de halos
  },
});

/** Copia mutable de los valores por defecto. */
export function cloneDefaults() {
  return structuredClone(DEFAULTS);
}
