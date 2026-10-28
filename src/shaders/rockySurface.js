import { noiseGLSL, sphereDirectionGLSL } from './common.js';

/**
 * Shader de horneado (bake) del planeta rocoso.
 *
 * Se ejecuta una sola vez en GPU sobre una textura equirectangular y produce,
 * según el define activo:
 *   BAKE_ALBEDO     → color base (lineal)
 *   BAKE_NORMAL     → normal map en espacio de objeto (n·0.5 + 0.5)
 *   BAKE_ROUGHNESS  → rugosidad (canal G, como espera MeshStandardMaterial)
 *
 * Al muestrear el ruido con la dirección 3D de cada texel no hay costuras
 * en el meridiano 0 ni deformación en los polos del relieve.
 */
export const rockyBakeFragmentShader = /* glsl */ `
uniform float uSeed;
uniform float uRelief;
uniform float uTexelAngle;
varying vec2 vUv;

${noiseGLSL}
${sphereDirectionGLSL}

struct Surface {
  float height;      // altura en unidades del radio
  float continents;  // [-1, 1]
  float ridges;      // [0, 1]
  float highland;    // [0, 1]
  float craterFloor; // [0, 1]
  float craterRim;   // [0, 1]
};

// Perfil radial de un cráter (d = distancia / radio): cuenca de fondo plano,
// borde elevado, eyecciones que decaen y pico central.
float craterProfile(float d) {
  float inside = 1.0 - step(1.0, d);
  float bowl = max(d * d - 1.0, -0.72) * inside;
  float rim = 0.3 * exp(-pow((d - 1.0) * 4.5, 2.0));
  float peak = 0.22 * exp(-d * d * 40.0) * inside;
  return bowl + rim + peak;
}

// Una capa de cráteres sobre una rejilla celular 3D.
float craterLayer(vec3 p, float freq, float probability, inout float floorMask, inout float rimMask) {
  vec3 q = p * freq;
  vec3 cell = floor(q);
  vec3 f = q - cell;
  float h = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r1 = hash33(cell + o + uSeed);
    if (r1.x > probability) continue;
    vec3 r2 = hash33(cell + o + uSeed + 71.3);
    float radius = mix(0.14, 0.46, r2.x * r2.x);
    vec3 center = o + 0.15 + 0.7 * vec3(r2.y, r2.z, r1.y);
    float d = length(f - center) / radius;
    if (d > 1.8) continue;
    float fresh = r1.z; // los cráteres jóvenes son más profundos y con bordes más nítidos
    h += craterProfile(d) * radius / freq * 0.35 * mix(0.5, 1.0, fresh);
    floorMask = max(floorMask, (1.0 - smoothstep(0.55, 0.98, d)) * mix(0.4, 1.0, fresh));
    rimMask = max(rimMask, exp(-pow((d - 1.0) * 4.0, 2.0)) * fresh);
  }
  return h;
}

Surface sampleSurface(vec3 dir) {
  Surface s;
  vec3 sp = dir + vec3(uSeed * 0.37, uSeed * 0.11, -uSeed * 0.23);

  // Deformación del dominio para continentes de contorno orgánico.
  vec3 warp = vec3(fbm(sp * 1.6 + 3.1, 4), fbm(sp * 1.6 + 9.7, 4), fbm(sp * 1.6 + 15.3, 4));
  float cont = fbm(sp * 1.25 + warp * 0.6, 6);
  float highland = smoothstep(-0.05, 0.3, cont);
  float ridges = ridgedFbm(sp * 3.4 + warp * 0.35, 5);

  float floorMask = 0.0;
  float rimMask = 0.0;
  float craters = craterLayer(sp, 4.0, 0.45, floorMask, rimMask)
                + craterLayer(sp, 9.0, 0.55, floorMask, rimMask)
                + craterLayer(sp, 21.0, 0.42, floorMask, rimMask)
                + craterLayer(sp, 48.0, 0.38, floorMask, rimMask);

  float detail = fbm(sp * 28.0, 4);

  s.height = cont * 0.022 + ridges * ridges * highland * 0.02 + craters + detail * 0.0014;
  s.continents = cont;
  s.ridges = ridges;
  s.highland = highland;
  s.craterFloor = floorMask;
  s.craterRim = rimMask;
  return s;
}

float iceAmount(vec3 dir) {
  float lat = abs(dir.y) + fbm(dir * 6.0 + 2.0, 4) * 0.06;
  return smoothstep(0.9, 0.95, lat);
}

void main() {
  vec3 dir = dirFromUv(vUv);

#ifdef BAKE_NORMAL
  // Gradiente del relieve por diferencias finitas sobre la esfera.
  vec3 t1 = normalize(cross(abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), dir));
  vec3 t2 = cross(dir, t1);
  float eps = uTexelAngle;
  float h0 = sampleSurface(dir).height;
  float h1 = sampleSurface(normalize(dir + t1 * eps)).height;
  float h2 = sampleSurface(normalize(dir + t2 * eps)).height;
  vec3 grad = ((h1 - h0) * t1 + (h2 - h0) * t2) / eps;
  vec3 n = normalize(dir - grad * uRelief);
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
#endif

#ifdef BAKE_ALBEDO
  Surface s = sampleSurface(dir);
  vec3 basalt = srgbToLinear(vec3(0.16, 0.15, 0.14));
  vec3 plains = srgbToLinear(vec3(0.46, 0.37, 0.29));
  vec3 highlands = srgbToLinear(vec3(0.58, 0.52, 0.45));
  vec3 peaks = srgbToLinear(vec3(0.68, 0.65, 0.6));

  vec3 col = mix(basalt, plains, smoothstep(-0.28, 0.08, s.continents));
  col = mix(col, highlands, smoothstep(0.1, 0.45, s.continents + s.ridges * 0.25));
  col = mix(col, peaks, smoothstep(0.55, 0.85, s.ridges) * s.highland * 0.8);

  // Variaciones minerales de baja frecuencia (óxidos cálidos / grises fríos).
  float tint = fbm(dir * 3.0 + 21.0, 4) * 0.5 + 0.5;
  col *= mix(vec3(0.9, 0.95, 1.04), vec3(1.1, 0.98, 0.88), tint);
  // Grano fino.
  col *= 0.88 + 0.24 * (fbm(dir * 55.0 + 4.0, 3) * 0.5 + 0.5);
  // Cráteres: fondos más oscuros, bordes frescos y eyecciones más claros.
  col *= mix(1.0, 0.8, s.craterFloor);
  col *= 1.0 + s.craterRim * 0.22;
  // Casquetes polares tenues.
  col = mix(col, srgbToLinear(vec3(0.78, 0.8, 0.83)), iceAmount(dir) * 0.85);

  gl_FragColor = vec4(col, 1.0);
#endif

#ifdef BAKE_ROUGHNESS
  Surface s = sampleSurface(dir);
  float r = 0.94 - iceAmount(dir) * 0.32 - s.craterFloor * 0.04 + s.ridges * 0.03;
  gl_FragColor = vec4(r, r, r, 1.0);
#endif
}
`;
