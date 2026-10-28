import { eclipseGLSL } from './common.js';

/**
 * Halo atmosférico exterior (cara trasera de una esfera algo mayor que el planeta).
 *
 * La intensidad es de tipo Fresnel: máxima junto al limbo del planeta y nula en
 * el borde de la cáscara (uLimb = √(1 − (R/Rs)²) normaliza ese rango). La
 * iluminación se evalúa en la dirección del limbo correspondiente, de modo que
 * solo brilla el borde iluminado, con un tinte cálido en el terminador y un
 * refuerzo por dispersión frontal a contraluz.
 */
export const atmosphereVertexShader = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const atmosphereFragmentShader = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uPlanetCenter;
uniform vec3 uColor;
uniform vec3 uTwilightColor;
uniform float uIntensity;
uniform float uPower;
uniform float uLimb;
uniform vec3 uOccluderPos;
uniform float uOccluderRadius;
uniform float uSunAngularRadius;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${eclipseGLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  float t = clamp(-dot(N, V) / uLimb, 0.0, 1.0);
  float glow = pow(t, uPower);

  // Dirección del limbo visto desde la cámara (componente perpendicular a la vista).
  vec3 radial = normalize(vWorldPos - uPlanetCenter);
  vec3 limbDir = normalize(radial - V * dot(radial, V) + 1e-5);
  float NdL = dot(limbDir, uSunDir);

  float day = smoothstep(-0.2, 0.45, NdL);
  float twilight = exp(-pow((NdL - 0.04) * 7.0, 2.0));
  float forward = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 8.0);

  vec3 col = uColor * day + uTwilightColor * twilight * 0.22;
  col *= 1.0 + forward * 1.5;

  float eclipse = eclipseFactor(vWorldPos, uSunDir, uOccluderPos, uOccluderRadius, uSunAngularRadius);
  gl_FragColor = vec4(col * glow * uIntensity * eclipse, 1.0);
}
`;
