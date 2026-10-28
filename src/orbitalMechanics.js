import { Euler, MathUtils, Quaternion, Vector3 } from 'three';

const TAU = Math.PI * 2;

/**
 * Resuelve la ecuación de Kepler  M = E − e·sin(E)  para la anomalía excéntrica E
 * con Newton-Raphson. Converge en pocas iteraciones para 0 ≤ e < 1.
 * @param {number} meanAnomaly M en radianes
 * @param {number} eccentricity e
 * @returns {number} E en radianes
 */
export function solveKepler(meanAnomaly, eccentricity) {
  let E = eccentricity < 0.8 ? meanAnomaly : Math.PI;
  for (let i = 0; i < 20; i++) {
    const f = E - eccentricity * Math.sin(E) - meanAnomaly;
    const delta = f / (1 - eccentricity * Math.cos(E));
    E -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return E;
}

/**
 * Sistema binario kepleriano de dos cuerpos.
 *
 * Se integra la órbita *relativa* (B respecto a A) de forma paramétrica:
 *   - semieje mayor a  (= distancia d cuando e = 0)
 *   - excentricidad e, inclinación i, argumento del periapsis ω
 *   - movimiento medio n = k·√(G(M1+M2)/a³)  (3.ª ley de Kepler, k = velocidad orbital)
 *
 * Cada cuerpo se coloca respecto al centro de masa fijo C:
 *   pA = C − r⃗ · M2/(M1+M2)      pB = C + r⃗ · M1/(M1+M2)
 * por lo que M1·pA + M2·pB = (M1+M2)·C en todo instante, y en órbita circular
 * |pA − C| = d·M2/(M1+M2) = r1,  |pB − C| = d·M1/(M1+M2) = r2,  r1 + r2 = d.
 */
export class BinaryOrbit {
  constructor({ gravitationalConstant = 1, center = new Vector3() } = {}) {
    this.G = gravitationalConstant;
    this.center = center.clone();
    this.massA = 1;
    this.massB = 1;
    this.semiMajorAxis = 10;
    this.eccentricity = 0;
    this.orbitalSpeed = 1;
    this.orientation = new Quaternion();
    this.meanAnomaly = 0;
    /** Se incrementa en cada cambio de parámetros (para regenerar trayectorias). */
    this.version = 0;

    this._euler = new Euler(0, 0, 0, 'XYZ');
    this._rel = new Vector3();
    this._tmpA = new Vector3();
    this._tmpB = new Vector3();
  }

  /**
   * Aplica nuevos parámetros manteniendo la fase actual (anomalía media),
   * de modo que la animación continúa sin saltos de tiempo.
   */
  configure({ massA, massB, separation, eccentricity = 0, inclination = 0, periapsisArgument = 0, orbitalSpeed = 1 }) {
    if (!(massA > 0 && massB > 0)) throw new RangeError('Las masas deben ser positivas.');
    if (!(separation > 0)) throw new RangeError('La distancia debe ser positiva.');
    if (!(eccentricity >= 0 && eccentricity < 1)) throw new RangeError('La excentricidad debe estar en [0, 1).');
    if (!(orbitalSpeed > 0)) throw new RangeError('La velocidad orbital debe ser positiva.');

    this.massA = massA;
    this.massB = massB;
    this.semiMajorAxis = separation;
    this.eccentricity = eccentricity;
    this.orbitalSpeed = orbitalSpeed;
    // Primero ω (giro de la elipse en su plano, eje Y), después la inclinación (eje X).
    this._euler.set(MathUtils.degToRad(inclination), MathUtils.degToRad(periapsisArgument), 0, 'XYZ');
    this.orientation.setFromEuler(this._euler);
    this.version++;
    return this;
  }

  get totalMass() {
    return this.massA + this.massB;
  }

  /** Fracción de la separación que recorre A alrededor del centro de masa: M2/(M1+M2). */
  get fractionA() {
    return this.massB / this.totalMass;
  }

  /** Fracción de la separación que recorre B: M1/(M1+M2). */
  get fractionB() {
    return this.massA / this.totalMass;
  }

  /** Movimiento medio n (rad/s de tiempo simulado). */
  get meanMotion() {
    return this.orbitalSpeed * Math.sqrt((this.G * this.totalMass) / this.semiMajorAxis ** 3);
  }

  /** Periodo orbital en segundos de tiempo simulado. */
  get period() {
    return TAU / this.meanMotion;
  }

  /** Fase orbital normalizada en [0, 1). */
  get phase() {
    return this.meanAnomaly / TAU;
  }

  /** Semiejes mayores de cada cuerpo alrededor del centro de masa (r1, r2 si e = 0). */
  bodySemiMajorAxes() {
    return { r1: this.semiMajorAxis * this.fractionA, r2: this.semiMajorAxis * this.fractionB };
  }

  /** Avanza el tiempo simulado. `dt` en segundos; independiente de los FPS. */
  step(dt) {
    if (!(dt > 0)) return;
    this.meanAnomaly = (this.meanAnomaly + this.meanMotion * dt) % TAU;
  }

  /** Vector relativo r⃗ = pB − pA para una anomalía media dada. */
  relativePositionAt(meanAnomaly, out) {
    const a = this.semiMajorAxis;
    const e = this.eccentricity;
    const E = solveKepler(meanAnomaly, e);
    const b = a * Math.sqrt(1 - e * e);
    // Periapsis sobre +X; sentido antihorario visto desde +Y (prógrado con spin positivo).
    return out.set(a * (Math.cos(E) - e), 0, -b * Math.sin(E)).applyQuaternion(this.orientation);
  }

  /** Posiciones de ambos cuerpos para una anomalía media dada. */
  positionsAt(meanAnomaly, outA, outB) {
    const rel = this.relativePositionAt(meanAnomaly, this._rel);
    outA.copy(this.center).addScaledVector(rel, -this.fractionA);
    outB.copy(this.center).addScaledVector(rel, this.fractionB);
  }

  /** Posiciones actuales. */
  getPositions(outA, outB) {
    this.positionsAt(this.meanAnomaly, outA, outB);
  }

  /** Distancia en el periapsis a(1 − e). */
  get periapsisDistance() {
    return this.semiMajorAxis * (1 - this.eccentricity);
  }

  /**
   * Rellena dos arrays (segments + 1 vértices × 3) con las trayectorias completas,
   * muestreadas uniformemente en tiempo (anomalía media). El último vértice repite
   * el primero para cerrar la curva.
   */
  sampleTrajectories(outPositionsA, outPositionsB, segments) {
    for (let i = 0; i <= segments; i++) {
      this.positionsAt((TAU * i) / segments, this._tmpA, this._tmpB);
      this._tmpA.toArray(outPositionsA, i * 3);
      this._tmpB.toArray(outPositionsB, i * 3);
    }
  }
}
