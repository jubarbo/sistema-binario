import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { PLANET_A, PLANET_B, SCENE_CONFIG, cloneDefaults } from './config.js';
import {
  createCamera,
  createCameraControls,
  createPostProcessing,
  createRenderer,
  detectQuality,
  frameInitialView,
  observeResize,
} from './scene.js';
import { createSpaceEnvironment } from './spaceEnvironment.js';
import { createPlanets } from './planets.js';
import { BinaryOrbit } from './orbitalMechanics.js';
import { createTrajectories } from './trajectories.js';
import { createControlPanel } from './controls.js';

/** Paso máximo por fotograma: evita saltos al volver de una pestaña inactiva. */
const MAX_DELTA = 0.1;

/** Lanza un error si algún programa de shader no compiló. */
function assertProgramsCompiled(renderer) {
  for (const program of renderer.info.programs ?? []) {
    if (program.diagnostics && program.diagnostics.runnable === false) {
      throw new Error(`Error al compilar el shader "${program.name}". Revisa la consola para el detalle.`);
    }
  }
}

/**
 * Monta la escena completa dentro de `container`.
 * @param {HTMLElement} container
 * @param {{onFatalError?: (error: Error) => void}} options
 * @returns {{dispose: () => void, state: object}}
 */
export function createBinarySystemApp(container, { onFatalError = () => {} } = {}) {
  const state = cloneDefaults();
  const limits = SCENE_CONFIG.orbitLimits;
  const disposers = [];
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    running = false;
    cancelAnimationFrame(rafId);
    // Orden inverso al de creación.
    for (let i = disposers.length - 1; i >= 0; i--) {
      try {
        disposers[i]();
      } catch (error) {
        console.warn('Error al liberar recursos:', error);
      }
    }
    disposers.length = 0;
  };

  let running = true;
  let rafId = 0;

  try {
    // --- Renderizador, cámara y controles ---
    const renderer = createRenderer(container, SCENE_CONFIG.renderer);
    disposers.push(() => {
      renderer.dispose();
      renderer.domElement.remove();
    });
    const quality = detectQuality(renderer);
    const scene = new THREE.Scene();
    const camera = createCamera(SCENE_CONFIG.camera);
    const controls = createCameraControls(camera, renderer.domElement, SCENE_CONFIG.camera);
    disposers.push(() => controls.dispose());

    // --- Contenido ---
    const environment = createSpaceEnvironment(renderer, quality, SCENE_CONFIG);
    scene.add(environment.group);
    disposers.push(() => environment.dispose());

    const planets = createPlanets(renderer, quality, { planetA: PLANET_A, planetB: PLANET_B, sun: environment.sunUniforms });
    scene.add(planets.group);
    disposers.push(() => planets.dispose());

    const orbit = new BinaryOrbit({ gravitationalConstant: SCENE_CONFIG.gravitationalConstant });
    const trajectories = createTrajectories(orbit, {
      segments: SCENE_CONFIG.trajectories.segments,
      colorA: PLANET_A.trajectoryColor,
      colorB: PLANET_B.trajectoryColor,
      opacity: state.display.trajectoryOpacity,
    });
    scene.add(trajectories.group);
    disposers.push(() => trajectories.dispose());

    const post = createPostProcessing(renderer, scene, camera, quality, SCENE_CONFIG.postprocessing);
    disposers.push(() => post.dispose());

    // --- Coherencia del modelo orbital ---
    // El periapsis nunca debe acercar los planetas tanto que sus atmósferas se toquen.
    const minPeriapsis = (planets.planetA.outerRadius + planets.planetB.outerRadius) * limits.periapsisMargin;
    const info = { r1: '', r2: '', sum: '', period: '', eccentricityMax: '' };
    let panel = null;

    function applyOrbitParameters() {
      const o = state.orbit;
      o.separation = THREE.MathUtils.clamp(o.separation, Math.max(limits.minSeparation, minPeriapsis), limits.maxSeparation);
      const eccentricityMax = THREE.MathUtils.clamp(1 - minPeriapsis / o.separation, 0, limits.maxEccentricity);
      if (o.eccentricity > eccentricityMax) o.eccentricity = Math.floor(eccentricityMax * 1000) / 1000;
      orbit.configure(o);

      const { r1, r2 } = orbit.bodySemiMajorAxes();
      info.r1 = r1.toFixed(3);
      info.r2 = r2.toFixed(3);
      info.sum = `${(r1 + r2).toFixed(3)} (= d)`;
      info.period = `${orbit.period.toFixed(1)} s a 1×`;
      info.eccentricityMax = eccentricityMax.toFixed(3);
      panel?.refresh();
    }

    function applyDisplayOptions() {
      trajectories.setVisible(state.display.trajectories);
      trajectories.setOpacity(state.display.trajectoryOpacity);
      environment.setStarsVisible(state.display.stars);
      post.setBloomEnabled(state.display.bloom);
    }

    function resetParameters() {
      const defaults = cloneDefaults();
      for (const key of Object.keys(defaults)) Object.assign(state[key], defaults[key]);
      orbit.meanAnomaly = 0;
      applyOrbitParameters();
      applyDisplayOptions();
      panel?.refresh();
    }

    applyOrbitParameters();
    applyDisplayOptions();

    panel = createControlPanel({
      state,
      info,
      limits,
      callbacks: {
        onOrbitChange: applyOrbitParameters,
        onDisplayChange: applyDisplayOptions,
        onReset: resetParameters,
        onFrameCamera: () => frameInitialView(camera, controls, SCENE_CONFIG.camera),
      },
    });
    disposers.push(() => panel.dispose());

    // --- Tamaño y calidad adaptativa ---
    const size = { width: 1, height: 1 };
    let pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);

    function applySize() {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(size.width, size.height, false);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      post.setSize(size.width, size.height, pixelRatio);
      environment.setPixelRatio(pixelRatio);
    }

    const rect = container.getBoundingClientRect();
    size.width = Math.max(1, Math.floor(rect.width));
    size.height = Math.max(1, Math.floor(rect.height));
    applySize();
    frameInitialView(camera, controls, SCENE_CONFIG.camera);

    const resizeObserver = observeResize(container, (width, height) => {
      if (width === size.width && height === size.height) return;
      size.width = width;
      size.height = height;
      applySize();
    });
    disposers.push(() => resizeObserver.disconnect());

    // Si el dispositivo no sostiene ~40 fps, reduce la resolución interna.
    const governor = { frames: 0, time: 0, warmup: 3 };
    function governFrameRate(dt) {
      if (governor.warmup > 0) {
        governor.warmup -= dt;
        return;
      }
      governor.frames++;
      governor.time += dt;
      if (governor.time < 2.5) return;
      const fps = governor.frames / governor.time;
      governor.frames = 0;
      governor.time = 0;
      if (fps < 40 && pixelRatio > quality.minPixelRatio) {
        pixelRatio = Math.max(quality.minPixelRatio, pixelRatio - 0.25);
        applySize();
        console.info(`Rendimiento bajo (${fps.toFixed(0)} fps): resolución interna ×${pixelRatio}`);
      }
    }

    // --- Teclado ---
    function onKeyDown(event) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === 'Space') {
        event.preventDefault();
        state.simulation.paused = !state.simulation.paused;
      } else if (event.code === 'KeyH') {
        panel.toggleVisibility();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    disposers.push(() => window.removeEventListener('keydown', onKeyDown));

    // --- Pérdida de contexto WebGL ---
    function onContextLost(event) {
      event.preventDefault();
      running = false;
      cancelAnimationFrame(rafId);
      onFatalError(new Error('Se perdió el contexto WebGL (la GPU se reinició o se quedó sin memoria). Recarga la página.'));
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    disposers.push(() => renderer.domElement.removeEventListener('webglcontextlost', onContextLost));

    // --- Bucle principal ---
    const positionA = new THREE.Vector3();
    const positionB = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const clearanceBodies = [planets.planetA, planets.planetB];
    let lastTime = performance.now();
    let simTime = 0;
    let realTime = 0;
    let firstFrame = true;

    /** Impide que la cámara atraviese un planeta, aunque sea el planeta el que se acerque. */
    function keepCameraClear() {
      let pushed = false;
      for (const body of clearanceBodies) {
        toCamera.subVectors(camera.position, body.pivot.position);
        const distance = toCamera.length();
        if (distance < body.cameraClearance) {
          camera.position.copy(body.pivot.position).addScaledVector(toCamera.divideScalar(distance || 1), body.cameraClearance);
          pushed = true;
        }
      }
      if (pushed) camera.lookAt(controls.target);
    }

    function frame(now) {
      if (!running) return;
      rafId = requestAnimationFrame(frame);
      try {
        const dt = Math.min(Math.max((now - lastTime) / 1000, 0), MAX_DELTA);
        lastTime = now;
        realTime += dt;
        const simDt = state.simulation.paused ? 0 : dt * state.simulation.timeScale;
        simTime += simDt;

        orbit.step(simDt);
        orbit.getPositions(positionA, positionB);
        planets.update(simDt, simTime, positionA, positionB, state.rotation);
        trajectories.update(orbit.phase);

        controls.update(dt);
        keepCameraClear();
        environment.update(realTime, camera);
        post.render(dt, realTime);

        if (firstFrame) {
          firstFrame = false;
          assertProgramsCompiled(renderer);
        }
        governFrameRate(dt);
      } catch (error) {
        running = false;
        cancelAnimationFrame(rafId);
        onFatalError(error);
      }
    }
    rafId = requestAnimationFrame(frame);
  } catch (error) {
    dispose();
    throw error;
  }

  return { dispose, state };
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function showError(message) {
  const element = document.getElementById('error');
  if (!element) return;
  element.querySelector('p').textContent = message;
  element.hidden = false;
}

function setLoading(visible) {
  document.getElementById('loading')?.classList.toggle('is-hidden', !visible);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function bootstrap() {
  const container = document.getElementById('app');
  if (!WebGL.isWebGL2Available()) {
    setLoading(false);
    showError('Tu navegador o tu tarjeta gráfica no admite WebGL 2, necesario para esta escena.');
    return;
  }

  // Deja que se pinte el aviso de carga antes de hornear las texturas en GPU.
  await nextFrame();
  await nextFrame();

  let app = null;
  try {
    app = createBinarySystemApp(container, {
      onFatalError: (error) => {
        console.error(error);
        showError(error.message);
        app?.dispose();
      },
    });
  } catch (error) {
    console.error(error);
    showError(`No se pudo inicializar la escena: ${error.message}`);
  } finally {
    setLoading(false);
  }

  // Limpieza en recarga en caliente (Vite) y al abandonar la página.
  import.meta.hot?.dispose(() => app?.dispose());
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) app?.dispose();
  });
}

bootstrap();
