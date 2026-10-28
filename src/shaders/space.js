import { noiseGLSL, sphereDirectionGLSL } from './common.js';

/** Fondo espacial horneado: negro azulado con nebulosas tenues y banda galáctica. */
export const nebulaBakeFragmentShader = /* glsl */ `
uniform vec3 uBandNormal;
uniform float uIntensity;
varying vec2 vUv;

${noiseGLSL}
${sphereDirectionGLSL}

void main() {
  vec3 d = dirFromUv(vUv);
  float bandDist = dot(d, uBandNormal);
  float band = exp(-bandDist * bandDist / 0.05);

  vec3 w = vec3(fbm(d * 2.2 + 1.3, 4), fbm(d * 2.2 + 7.9, 4), fbm(d * 2.2 + 4.4, 4));
  float n = fbm(d * 2.6 + w * 0.9, 6) * 0.5 + 0.5;
  float n2 = fbm(d * 5.5 + w * 1.4 + 11.0, 5) * 0.5 + 0.5;
  float clouds = smoothstep(0.5, 0.9, n) * (0.12 + 0.88 * band);
  float wisps = smoothstep(0.55, 0.95, n2) * band;
  float dust = smoothstep(0.52, 0.78, fbm(d * 7.0 + w * 0.6 + 3.0, 5) * 0.5 + 0.5) * band;

  vec3 base = vec3(0.0012, 0.0015, 0.0026);
  vec3 violet = vec3(0.016, 0.008, 0.026);
  vec3 teal = vec3(0.005, 0.013, 0.021);
  vec3 glow = vec3(0.009, 0.0085, 0.008);

  float hue = smoothstep(0.3, 0.7, fbm(d * 1.4 + 20.0, 3) * 0.5 + 0.5);
  vec3 col = base + mix(violet, teal, hue) * (clouds + wisps * 0.6);
  col += glow * band * (0.4 + 0.6 * n2);
  col *= 1.0 - dust * 0.6;

  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

/** Estrellas como puntos con tamaño, brillo, color y centelleo individuales. */
export const starVertexShader = /* glsl */ `
attribute float aSize;
attribute float aBrightness;
attribute vec3 aColor;
attribute vec2 aTwinkle;
uniform float uPixelRatio;
uniform float uTime;
varying vec3 vColor;
varying float vBrightness;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float twinkle = 1.0 + 0.12 * sin(uTime * aTwinkle.x + aTwinkle.y);
  vBrightness = aBrightness * twinkle;
  vColor = aColor;
  gl_PointSize = max(aSize * uPixelRatio, 1.0);
}
`;

export const starFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vBrightness;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 5.0);
  gl_FragColor = vec4(vColor * vBrightness * core, 1.0);
}
`;
