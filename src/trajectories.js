import * as THREE from 'three';

const trajectoryVertexShader = /* glsl */ `
attribute float aPhase;
varying float vPhase;
void main() {
  vPhase = aPhase;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// La línea se desvanece por delante del planeta y es más visible justo detrás
// (estela), para que no parezca un anillo sólido.
const trajectoryFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPhase;
varying float vPhase;
void main() {
  float behind = fract(uPhase - vPhase);
  float trail = mix(0.22, 1.0, pow(1.0 - behind, 1.6));
  gl_FragColor = vec4(uColor, uOpacity * trail);
}
`;

/**
 * Trayectorias de ambos cuerpos alrededor del centro de masa, más una pequeña
 * cruz que marca el CM. Se regeneran solo cuando cambian los parámetros orbitales
 * (los buffers se reescriben en el sitio, sin reasignar memoria).
 */
export function createTrajectories(orbit, { segments = 512, colorA, colorB, opacity = 0.5 }) {
  const group = new THREE.Group();
  group.name = 'trajectories';
  const count = segments + 1;
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) phases[i] = i / segments;
  const phaseAttribute = new THREE.BufferAttribute(phases, 1);

  function createLine(color) {
    const positions = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aPhase', phaseAttribute);
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uPhase: { value: 0 } },
      vertexShader: trajectoryVertexShader,
      fragmentShader: trajectoryFragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 1;
    group.add(line);
    return { positions, geometry, material };
  }

  const lineA = createLine(colorA);
  const lineB = createLine(colorB);

  const s = 0.35;
  const markerGeometry = new THREE.BufferGeometry();
  markerGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-s, 0, 0, s, 0, 0, 0, 0, -s, 0, 0, s, 0, -s, 0, 0, s, 0], 3),
  );
  const markerMaterial = new THREE.LineBasicMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.35, depthWrite: false });
  const marker = new THREE.LineSegments(markerGeometry, markerMaterial);
  group.add(marker);

  let builtVersion = -1;

  function rebuild() {
    orbit.sampleTrajectories(lineA.positions, lineB.positions, segments);
    lineA.geometry.attributes.position.needsUpdate = true;
    lineB.geometry.attributes.position.needsUpdate = true;
    marker.position.copy(orbit.center);
    marker.quaternion.copy(orbit.orientation);
    builtVersion = orbit.version;
  }

  return {
    group,
    /** @param {number} phase fase orbital actual en [0, 1) */
    update(phase) {
      if (orbit.version !== builtVersion) rebuild();
      lineA.material.uniforms.uPhase.value = phase;
      lineB.material.uniforms.uPhase.value = phase;
    },
    setVisible(visible) {
      group.visible = visible;
    },
    setOpacity(value) {
      lineA.material.uniforms.uOpacity.value = value;
      lineB.material.uniforms.uOpacity.value = value;
      markerMaterial.opacity = 0.7 * value;
    },
    dispose() {
      group.removeFromParent();
      for (const item of [lineA.geometry, lineA.material, lineB.geometry, lineB.material, markerGeometry, markerMaterial]) item.dispose();
    },
  };
}
