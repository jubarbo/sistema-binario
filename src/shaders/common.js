/**
 * Funciones GLSL compartidas.
 *
 * Ruido simplex 3D: Ian McEwan, Ashima Arts / Stefan Gustavson
 * (https://github.com/ashima/webgl-noise), licencia MIT.
 */
export const noiseGLSL = /* glsl */ `
vec3 pn_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pn_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pn_permute(vec4 x) { return pn_mod289(((x * 34.0) + 1.0) * x); }
vec4 pn_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = pn_mod289(i);
  vec4 p = pn_permute(pn_permute(pn_permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = pn_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Ruido fractal (fBm), aproximadamente en [-1, 1].
float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    norm += amp;
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    amp *= 0.5;
  }
  return sum / norm;
}

// Ruido "ridged": crestas afiladas para cordilleras, en [0, 1].
float ridgedFbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float prev = 1.0;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p));
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    p = p * 2.07 + vec3(5.3, 1.1, 7.7);
    amp *= 0.5;
  }
  return sum / norm;
}

// Hash 3D → 3D sin funciones trigonométricas (Dave Hoskins, MIT).
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }
`;

/**
 * Dirección sobre la esfera unidad para unas UV equirectangulares.
 * Coincide exactamente con el mapeado UV de THREE.SphereGeometry.
 */
export const sphereDirectionGLSL = /* glsl */ `
vec3 dirFromUv(vec2 uv) {
  float phi = uv.x * 6.28318530718;
  float theta = (1.0 - uv.y) * 3.14159265359;
  return vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
}
`;

/**
 * Sombra analítica de eclipse: un planeta (esfera de radio R en C) tapando una
 * estrella lejana de radio angular sunAng. Devuelve 1 iluminado, 0 umbra, con
 * penumbra suave que crece con la distancia al ocultador.
 */
export const eclipseGLSL = /* glsl */ `
float eclipseFactor(vec3 P, vec3 L, vec3 C, float R, float sunAng) {
  vec3 toC = C - P;
  float t = dot(toC, L);
  if (t <= 0.0 || R <= 0.0) return 1.0;
  float d = length(toC - t * L);
  float pen = max(t * sunAng, 0.02);
  return smoothstep(R - pen, R + pen, d);
}
`;
