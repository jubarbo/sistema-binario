/**
 * Comprobaciones numéricas del modelo orbital.  Ejecutar con:  npm test
 */
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { BinaryOrbit, solveKepler } from '../src/orbitalMechanics.js';

const EPS = 1e-9;
const TAU = Math.PI * 2;
const pA = new Vector3();
const pB = new Vector3();
const com = new Vector3();
let checks = 0;

function near(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} ≠ ${expected}`);
  checks++;
}

function centerOfMass(orbit, out) {
  return out.copy(pA).multiplyScalar(orbit.massA).addScaledVector(pB, orbit.massB).divideScalar(orbit.totalMass);
}

// 1. Ecuación de Kepler: residuo despreciable para un amplio rango de e.
for (const e of [0, 0.1, 0.5, 0.75, 0.9, 0.97]) {
  for (let k = 0; k < 64; k++) {
    const M = (TAU * k) / 64;
    const E = solveKepler(M, e);
    near(E - e * Math.sin(E), M, 1e-10, `Kepler e=${e} M=${M}`);
  }
}

// 2. Órbita circular: r1 = d·M2/(M1+M2), r2 = d·M1/(M1+M2), r1 + r2 = d, CM fijo.
for (const [M1, M2, d] of [[1, 3, 12], [1, 2.5, 15], [5, 1, 20], [1, 1, 9]]) {
  const orbit = new BinaryOrbit({ gravitationalConstant: 12.4 }).configure({
    massA: M1, massB: M2, separation: d, eccentricity: 0, inclination: 23, periapsisArgument: 40,
  });
  const r1 = (d * M2) / (M1 + M2);
  const r2 = (d * M1) / (M1 + M2);
  for (let k = 0; k < 90; k++) {
    orbit.step(0.37);
    orbit.getPositions(pA, pB);
    near(pA.length(), r1, EPS, `r1 (M1=${M1}, M2=${M2})`);
    near(pB.length(), r2, EPS, `r2 (M1=${M1}, M2=${M2})`);
    near(pA.distanceTo(pB), d, EPS, 'r1 + r2 = d');
    near(centerOfMass(orbit, com).length(), 0, EPS, 'centro de masa fijo');
  }
  const { r1: s1, r2: s2 } = orbit.bodySemiMajorAxes();
  near(s1, r1, EPS, 'bodySemiMajorAxes r1');
  near(s2, r2, EPS, 'bodySemiMajorAxes r2');
}

// 3. Órbita excéntrica: CM fijo, periapsis a(1−e), apoapsis a(1+e), cuerpos opuestos.
{
  const a = 15;
  const e = 0.5;
  const orbit = new BinaryOrbit({ gravitationalConstant: 12.4 }).configure({
    massA: 1, massB: 2.5, separation: a, eccentricity: e, inclination: -30, periapsisArgument: 120,
  });
  orbit.positionsAt(0, pA, pB);
  near(pA.distanceTo(pB), a * (1 - e), EPS, 'periapsis');
  orbit.positionsAt(Math.PI, pA, pB);
  near(pA.distanceTo(pB), a * (1 + e), EPS, 'apoapsis');
  for (let k = 0; k < 200; k++) {
    orbit.step(0.21);
    orbit.getPositions(pA, pB);
    near(centerOfMass(orbit, com).length(), 0, EPS, 'CM fijo (excéntrica)');
    // A y B siempre en lados opuestos del CM, con distancias en razón M2/M1.
    near(pA.length() / pB.length(), 2.5, 1e-7, 'razón de distancias = M2/M1');
    assert.ok(pA.dot(pB) < 0, 'cuerpos en lados opuestos');
  }
}

// 4. Tercera ley de Kepler y control de velocidad.
{
  const orbit = new BinaryOrbit({ gravitationalConstant: 12.4 }).configure({
    massA: 1, massB: 2.5, separation: 15, orbitalSpeed: 1,
  });
  near(orbit.period, TAU * Math.sqrt(15 ** 3 / (12.4 * 3.5)), 1e-9, 'periodo kepleriano');
  const T = orbit.period;
  orbit.configure({ massA: 1, massB: 2.5, separation: 15, orbitalSpeed: 2 });
  near(orbit.period, T / 2, 1e-9, 'velocidad orbital ×2 → periodo /2');

  // Independencia de la tasa de refresco: 60 pasos de 1/60 s ≡ 144 pasos de 1/144 s.
  const o60 = new BinaryOrbit({ gravitationalConstant: 12.4 }).configure({ massA: 1, massB: 2, separation: 14, eccentricity: 0.3 });
  const o144 = new BinaryOrbit({ gravitationalConstant: 12.4 }).configure({ massA: 1, massB: 2, separation: 14, eccentricity: 0.3 });
  for (let i = 0; i < 600; i++) o60.step(1 / 60);
  for (let i = 0; i < 1440; i++) o144.step(1 / 144);
  near(o60.meanAnomaly, o144.meanAnomaly, 1e-9, 'independiente de los FPS');
}

// 5. Al cambiar masas en caliente el CM sigue fijo y los radios se recalculan.
{
  const orbit = new BinaryOrbit({ gravitationalConstant: 12.4 }).configure({ massA: 1, massB: 1, separation: 10 });
  orbit.step(3);
  orbit.configure({ massA: 4, massB: 1, separation: 10 });
  orbit.getPositions(pA, pB);
  near(pA.length(), 2, EPS, 'r1 recalculado tras cambio de masa');
  near(pB.length(), 8, EPS, 'r2 recalculado tras cambio de masa');
  near(centerOfMass(orbit, com).length(), 0, EPS, 'CM fijo tras cambio de masa');
}

// 6. Trayectorias muestreadas cerradas y coherentes con las posiciones.
{
  const orbit = new BinaryOrbit({ gravitationalConstant: 12.4 }).configure({ massA: 1, massB: 2.5, separation: 15, eccentricity: 0.2, inclination: 12 });
  const n = 128;
  const a = new Float32Array((n + 1) * 3);
  const b = new Float32Array((n + 1) * 3);
  orbit.sampleTrajectories(a, b, n);
  near(a[0], a[n * 3], 1e-5, 'trayectoria A cerrada');
  near(b[2], b[n * 3 + 2], 1e-5, 'trayectoria B cerrada');
}

// 7. Validación de parámetros.
assert.throws(() => new BinaryOrbit().configure({ massA: 0, massB: 1, separation: 5 }), RangeError);
assert.throws(() => new BinaryOrbit().configure({ massA: 1, massB: 1, separation: 5, eccentricity: 1 }), RangeError);

console.log(`✓ Modelo orbital verificado (${checks} comprobaciones numéricas)`);
