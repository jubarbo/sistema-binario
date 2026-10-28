import GUI from 'three/addons/libs/lil-gui.module.min.js';

/**
 * Panel de parámetros (lil-gui, incluido con Three.js: sin dependencias extra).
 * El panel solo modifica el objeto `state` y avisa mediante callbacks; la
 * aplicación decide cómo trasladar los cambios a la escena.
 *
 * @param {object} options
 * @param {object} options.state     estado mutable de la simulación
 * @param {object} options.info      valores de solo lectura mostrados en "Datos del sistema"
 * @param {object} options.limits    límites de los deslizadores orbitales
 * @param {object} options.callbacks onOrbitChange, onDisplayChange, onReset, onFrameCamera
 */
export function createControlPanel({ state, info, limits, callbacks }) {
  const gui = new GUI({ title: 'Sistema binario', width: 290 });
  gui.domElement.classList.add('binary-panel');

  const simulation = gui.addFolder('Simulación');
  simulation.add(state.simulation, 'paused').name('Pausa (espacio)').listen();
  simulation.add(state.simulation, 'timeScale', 0, 5, 0.05).name('Velocidad global');

  const orbit = gui.addFolder('Órbita');
  const onOrbit = () => callbacks.onOrbitChange();
  orbit.add(state.orbit, 'separation', limits.minSeparation, limits.maxSeparation, 0.1).name('Distancia d').onChange(onOrbit);
  orbit.add(state.orbit, 'massA', 0.1, 10, 0.05).name('Masa M₁ (A)').onChange(onOrbit);
  orbit.add(state.orbit, 'massB', 0.1, 10, 0.05).name('Masa M₂ (B)').onChange(onOrbit);
  orbit.add(state.orbit, 'eccentricity', 0, limits.maxEccentricity, 0.005).name('Excentricidad').onChange(onOrbit);
  orbit.add(state.orbit, 'inclination', -80, 80, 0.5).name('Inclinación (°)').onChange(onOrbit);
  orbit.add(state.orbit, 'periapsisArgument', 0, 360, 1).name('Arg. periapsis (°)').onChange(onOrbit);
  orbit.add(state.orbit, 'orbitalSpeed', 0.1, 4, 0.05).name('Velocidad orbital').onChange(onOrbit);

  const rotation = gui.addFolder('Rotación axial');
  rotation.add(state.rotation, 'spinA', -2, 2, 0.01).name('Planeta A (rad/s)');
  rotation.add(state.rotation, 'spinB', -2, 2, 0.01).name('Planeta B (rad/s)');

  const display = gui.addFolder('Visualización');
  const onDisplay = () => callbacks.onDisplayChange();
  display.add(state.display, 'trajectories').name('Trayectorias').onChange(onDisplay);
  display.add(state.display, 'trajectoryOpacity', 0, 1, 0.01).name('Opacidad trayectorias').onChange(onDisplay);
  display.add(state.display, 'stars').name('Campo de estrellas').onChange(onDisplay);
  display.add(state.display, 'bloom').name('Bloom').onChange(onDisplay);

  const data = gui.addFolder('Datos del sistema');
  const labels = {
    r1: 'r₁ = d·M₂/(M₁+M₂)',
    r2: 'r₂ = d·M₁/(M₁+M₂)',
    sum: 'r₁ + r₂',
    period: 'Periodo orbital',
    eccentricityMax: 'Excentricidad máx.',
  };
  for (const [key, label] of Object.entries(labels)) {
    data.add(info, key).name(label).disable().listen();
  }
  data.close();

  const actions = {
    reset: () => callbacks.onReset(),
    frame: () => callbacks.onFrameCamera(),
  };
  gui.add(actions, 'reset').name('↺  Restablecer parámetros');
  gui.add(actions, 'frame').name('⌖  Encuadre inicial');

  // En pantallas pequeñas el panel arranca plegado.
  if (window.matchMedia?.('(max-width: 640px)').matches) gui.close();

  return {
    /** Refresca los controles tras cambios programáticos (p. ej. reset o límites). */
    refresh() {
      for (const controller of gui.controllersRecursive()) controller.updateDisplay();
    },
    toggleVisibility() {
      gui.show(gui._hidden);
    },
    dispose() {
      gui.destroy();
    },
  };
}
