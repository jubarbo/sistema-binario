/**
 * Superficie procedimental del gigante gaseoso, evaluada por fragmento y animada.
 * Requiere `noiseGLSL` y una macro GAS_OCTAVES (calidad).
 *
 * - Bandas zonales a partir de ruido 1D en latitud, perturbadas por turbulencia.
 * - Turbulencia anisótropa (estirada en longitud) que evoluciona con el tiempo.
 * - Vórtices: el dominio se rota alrededor del centro de cada tormenta con una
 *   intensidad que decae con la distancia, generando remolinos en las bandas.
 */
export const gasGiantGLSL = /* glsl */ `
vec3 gg_rotate(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// Vórtice elíptico (alargado en longitud) centrado en "center".
vec3 gg_vortex(vec3 p, vec3 center, float radius, float elongation, float twist, inout float mask) {
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), center));
  vec3 north = cross(center, east);
  vec3 rel = p - center;
  float d = length(vec2(dot(rel, east) / elongation, dot(rel, north))) / radius;
  float f = (1.0 - smoothstep(0.0, 1.0, d)) * step(0.0, dot(p, center));
  mask = max(mask, f);
  return gg_rotate(p, center, twist * f * f);
}

vec3 gasGiantColor(vec3 p, float t, out float detail) {
  float mainStorm = 0.0;
  float ovals = 0.0;
  vec3 q = gg_vortex(p, normalize(vec3(0.55, -0.38, 0.74)), 0.2, 1.7, 3.2, mainStorm);
  q = gg_vortex(q, normalize(vec3(-0.70, 0.46, -0.55)), 0.07, 1.4, -4.0, ovals);
  q = gg_vortex(q, normalize(vec3(-0.15, -0.62, -0.77)), 0.055, 1.3, 4.5, ovals);
  q = gg_vortex(q, normalize(vec3(0.85, 0.30, -0.43)), 0.045, 1.3, -4.5, ovals);

  float e = t;
  vec3 s = vec3(q.x, q.y * 3.2, q.z);
  float turb = fbm(s * 2.2 + vec3(e, 0.0, -e), GAS_OCTAVES);
  float turbFine = fbm(s * 6.5 + vec3(-e * 1.6, e * 0.5, e) + turb * 0.8, GAS_OCTAVES);
  float lat = q.y + turb * 0.05 + turbFine * 0.014;

  float b1 = snoise(vec3(0.0, lat * 5.5, 1.7));
  float b2 = snoise(vec3(3.1, lat * 14.0, 0.4));
  float bands = b1 * 0.7 + b2 * 0.3;

  vec3 zone = srgbToLinear(vec3(0.90, 0.84, 0.72));
  vec3 belt = srgbToLinear(vec3(0.74, 0.60, 0.45));
  vec3 darkBelt = srgbToLinear(vec3(0.52, 0.37, 0.27));
  vec3 brightZone = srgbToLinear(vec3(0.95, 0.92, 0.85));
  vec3 polar = srgbToLinear(vec3(0.56, 0.58, 0.60));

  vec3 col = mix(belt, zone, smoothstep(-0.4, 0.4, bands));
  col = mix(col, darkBelt, smoothstep(0.35, 0.85, -bands + turbFine * 0.3) * 0.75);
  col = mix(col, brightZone, smoothstep(0.55, 0.95, bands + turb * 0.2) * 0.6);
  col = mix(col, polar, smoothstep(0.62, 0.92, abs(p.y)) * 0.7);

  // Gran tormenta: núcleo rojizo con anillos de nubes.
  float rings = 0.5 + 0.5 * sin(mainStorm * 9.0 + turbFine * 2.0);
  vec3 storm = mix(srgbToLinear(vec3(0.62, 0.36, 0.24)), srgbToLinear(vec3(0.82, 0.58, 0.42)), rings);
  col = mix(col, storm, smoothstep(0.05, 0.6, mainStorm) * 0.85);
  // Óvalos blancos menores.
  col = mix(col, srgbToLinear(vec3(0.94, 0.92, 0.88)), smoothstep(0.2, 0.8, ovals) * 0.8);

  // Variación sutil de luminosidad ligada a la turbulencia.
  col *= 0.92 + 0.16 * (turbFine * 0.5 + 0.5);
  detail = turbFine;
  return col;
}
`;
