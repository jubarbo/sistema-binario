# Sistema binario · Three.js

Escena WebGL interactiva con dos planetas —uno rocoso y un gigante gaseoso— que orbitan alrededor de su centro de masa común. Todo el contenido visual es procedimental (shaders GLSL): no hay texturas ni recursos externos.

## Instalación y ejecución

Requisitos: Node.js 18 o superior y un navegador con WebGL 2.

```bash
npm install
npm run dev       # servidor de desarrollo en http://localhost:5173
npm run build     # build de producción en dist/
npm run preview   # sirve el build
npm test          # verificación numérica del modelo orbital
```

Calidad gráfica: se elige automáticamente según el dispositivo. Se puede forzar con `?quality=high` o `?quality=low` en la URL.

Controles: arrastrar para rotar, rueda para zoom, **Espacio** pausa, **H** oculta el panel.

## Dependencias

| Paquete | Uso | Licencia |
|---|---|---|
| `three` ^0.186 | Motor 3D, OrbitControls, posprocesado y lil-gui (incluido en `three/addons`) | MIT |
| `vite` ^7 (dev) | Servidor de desarrollo y build | MIT |

Código de terceros incrustado en los shaders: ruido simplex 3D de Ashima Arts / Stefan Gustavson (MIT) y hash de Dave Hoskins (MIT), en `src/shaders/common.js`.

## Estructura

```
sistema-binario/
├── index.html                 Contenedor, avisos de carga/error y rótulo
├── package.json
├── src/
│   ├── main.js                Arranque, coordinación de módulos, bucle de animación, limpieza
│   ├── config.js              ★ Parámetros editables (planetas, órbita, luz, cámara)
│   ├── orbitalMechanics.js    Modelo kepleriano de dos cuerpos y centro de masa
│   ├── planets.js             Geometría, materiales PBR, atmósferas, rotación axial
│   ├── spaceEnvironment.js    Luz de la estrella, fondo con nebulosas, campo de estrellas
│   ├── trajectories.js        Líneas de órbita y marcador del centro de masa
│   ├── scene.js               Renderizador, calidad, cámara, OrbitControls, posprocesado
│   ├── controls.js            Panel de parámetros (lil-gui)
│   ├── textureBaker.js        Horneado de shaders procedimentales a texturas en GPU
│   ├── style.css
│   └── shaders/
│       ├── common.js          Ruido, hash, mapeado esférico, sombra de eclipse
│       ├── rockySurface.js    Relieve, cráteres, color y rugosidad del planeta rocoso
│       ├── gasGiant.js        Bandas, turbulencia y tormentas del gigante gaseoso
│       ├── atmosphere.js      Halo atmosférico tipo Fresnel
│       └── space.js           Nebulosa y estrellas
└── tests/
    └── orbitalMechanics.test.js
```

## Modelo orbital

Se usa un modelo **kepleriano paramétrico**: es analítico, así que es estable indefinidamente y no acumula error como una integración numérica.

1. Se describe la órbita *relativa* de B respecto a A con semieje mayor `a` (la distancia `d` cuando `e = 0`), excentricidad `e`, inclinación `i` y argumento del periapsis `ω`.
2. El tiempo avanza la anomalía media: `M += n·Δt`, con `n = k·√(G(M₁+M₂)/a³)` (tercera ley de Kepler; `k` es el control de velocidad orbital). `Δt` sale de `requestAnimationFrame`, así que la velocidad no depende de los FPS.
3. Se resuelve la ecuación de Kepler `M = E − e·sin E` con Newton-Raphson y se obtiene el vector relativo `r⃗ = (a(cos E − e), 0, −b·sin E)`, rotado por `ω` e `i`.
4. Cada cuerpo se sitúa respecto al centro de masa fijo `C`:
   - `pA = C − r⃗ · M₂/(M₁+M₂)`
   - `pB = C + r⃗ · M₁/(M₁+M₂)`

   Por tanto `M₁·pA + M₂·pB = (M₁+M₂)·C` en todo instante y, en órbita circular, `r₁ = d·M₂/(M₁+M₂)`, `r₂ = d·M₁/(M₁+M₂)` y `r₁ + r₂ = d`.

Al cambiar masas, distancia o inclinación se conserva la fase y se recalculan radios, periodo y trayectorias. La excentricidad se limita automáticamente para que en el periapsis las atmósferas no lleguen a tocarse (el límite actual se ve en *Datos del sistema*).

`npm test` comprueba más de 2 000 casos: residuo de Kepler, `r₁`, `r₂`, `r₁ + r₂ = d`, centro de masa fijo (circular, excéntrica, inclinada y tras cambiar masas), periapsis/apoapsis, periodo y equivalencia entre 60 y 144 fps.

## Técnicas visuales

- **Planeta rocoso**: al iniciar se hornean en GPU tres texturas equirectangulares (albedo, *normal map* en espacio de objeto y rugosidad) a partir de ruido 3D: continentes con deformación de dominio, cordilleras, cuatro escalas de cráteres con borde y pico central, llanuras basálticas y casquetes polares. Muestrear en 3D evita costuras y deformación en los polos.
- **Gigante gaseoso**: shader por fragmento sobre `MeshStandardMaterial`, con bandas zonales, turbulencia que evoluciona en el tiempo, una gran tormenta y óvalos menores (vórtices por rotación del dominio) y variación de rugosidad y luminosidad.
- **Atmósferas**: dispersión de tipo Fresnel sobre el disco iluminado más un halo exterior que solo brilla en el limbo iluminado, con tinte cálido en el terminador y refuerzo a contraluz.
- **Sombras y eclipses**: sombra analítica de esfera con penumbra proporcional al tamaño aparente de la estrella. Se aplica a la luz directa de cada planeta y a su halo, así que es nítida, suave y sin el coste ni los artefactos de un *shadow map*.
- **Render**: HDR en half float con MSAA ×4 → bloom moderado → tone mapping ACES y sRGB → viñeta y grano mínimo (evita el *banding* en los fondos oscuros).
- **Espacio**: nebulosa y banda galáctica horneadas en un fondo que sigue a la cámara; estrellas 3D (280–900 unidades) con brillo, tamaño, color por temperatura y centelleo individuales.

## Personalización

Todo está en `src/config.js`:

- `PLANET_A` / `PLANET_B`: radio, oblicuidad, semilla y relieve del rocoso, albedo y velocidad de turbulencia del gaseoso, colores e intensidades de atmósfera, color de trayectoria.
- `DEFAULTS`: masas, distancia, excentricidad, inclinación, velocidades de rotación y opciones de visualización iniciales.
- `SCENE_CONFIG`: dirección, color e intensidad de la estrella, constante gravitatoria (escala de tiempo), cámara, bloom, viñeta, límites orbitales.

Para otro planeta rocoso basta con cambiar `PLANET_A.surface.seed`.

## Rendimiento y robustez

- Sin asignaciones en el bucle de animación: vectores reutilizados; las trayectorias reescriben sus buffers solo cuando cambian los parámetros.
- Una sola geometría de esfera compartida por planetas y halos.
- Perfiles de calidad `high`/`low` (segmentos, resolución de texturas, estrellas, octavas de ruido, MSAA) y reducción automática de la resolución interna si el dispositivo no sostiene unos 40 fps.
- `ResizeObserver` sobre el contenedor; encuadre inicial adaptado a pantallas verticales.
- La cámara no puede atravesar los planetas, aunque sea el planeta el que se acerque.
- Errores controlados: comprobación de WebGL 2, validación de los parámetros orbitales, detección de shaders que no compilan, pérdida de contexto WebGL y aviso visible en pantalla.
- `dispose()` libera geometrías, materiales, render targets, composer, controles, panel y listeners. Se invoca en la recarga en caliente de Vite y al abandonar la página.
