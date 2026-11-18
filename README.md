# FOUR SEASONS : Fluid Typography Experiment

An interactive 3D and 2D seasonal typography installation built with React, Three.js, React Three Fiber, custom GLSL shaders, and GSAP. Each season pairs bespoke 3D extruded typography with a procedural grounded environment, dynamic lighting, atmospheric particles, and cursor-driven vertex deformation.

Repository: [github.com/kosrax/4-seasons](https://github.com/kosrax/4-seasons)

## Seasons

| Index | Season | Headline | Supporting Phrase | Visual & Procedural Environment |
| :--- | :--- | :--- | :--- | :--- |
| `01` | **SPRING** | `BLOOM` | `GROW INTO SOMETHING` | Glazed botanical green typography anchored in a sculpted meadow mound with instanced fine grass blades, arching shoots, multi-hue crocus flowers, and sunlit pollen particles. |
| `02` | **SUMMER** | `HEAT` | `RADIATE INTO MOTION` | Glossy coral-orange typography set in coastal sand dunes with instanced sand pebbles, overhead sunbeams, a 6-panel beach ball, and designer sunglasses perched atop `H`. |
| `03` | **AUTUMN** | `FALLING` | `DRIFT THROUGH TIME` | Warm terracotta patina typography nestled in ochre/rust soil mounds with 3D curved fallen leaves, dry amber grass reeds, acorns, twigs, and a hero leaf perched on `F`. |
| `04` | **WINTER** | `FROZEN` | `STILLNESS IN FORM` | Faceted crystalline typography surrounded by wind-carved snowdrifts with crystal sparkle glints, hexagonal ice crystal spires, frosted reeds, and hanging icicles on `F`. |

## Interactions & Controls

- **Click Typography (`2D` <-> `3D`)**: Click directly on the headline word to morph smoothly between full `3D` sculptural relief (with grounded seasonal environments) and flat `2D` editorial typography.
- **Cursor Hover Deformation**: Move your pointer over or near the letters to trigger localized GLSL Gaussian bulge deformation, velocity-reactive shear, subsurface glow, and ground vegetation sway.
- **Drag to Orbit (`3D` mode)**: Click and drag anywhere on the canvas to orbit azimuthally or pull vertically between low ground close-ups and elevated canopy views.
- **Pan (`3D` mode)**: Hold `Shift` + drag or right-click + drag to pan laterally.
- **Keyboard Shortcuts**:
  - `1`, `2`, `3`, `4`: Switch between **Spring**, **Summer**, **Autumn**, and **Winter**.
  - `R`: Smoothly reset camera orientation back to the default front view.
- **Accessibility**: Respects `prefers-reduced-motion: reduce` across dimension transitions, pointer deformation, and idle motion.

## Tech Stack

- **Framework**: React `18.3` + Vite `5.4`
- **3D & Shaders**: Three.js `0.169`, `@react-three/fiber`, `@react-three/drei`, custom GLSL vertex/fragment shaders (`onBeforeCompile` & `ShaderMaterial`)
- **Motion**: GSAP `3.15` + `THREE.MathUtils.damp` physics-smoothed camera and pointer state

## Project Structure

```text
4-seasons/
├── index.html
├── package.json
├── public/
│   └── fonts/
│       └── CormorantGaramond-SemiBold.json
└── src/
    ├── App.jsx
    ├── main.jsx
    ├── components/
    │   ├── effects/
    │   │   └── ParticleSystem.jsx
    │   ├── scene/
    │   │   ├── SceneCanvas.jsx
    │   │   ├── SceneEnvironment.jsx
    │   │   ├── SceneLighting.jsx
    │   │   ├── SeasonalMeadow.jsx
    │   │   ├── SummerBeachEnvironment.jsx
    │   │   ├── AutumnFoliageEnvironment.jsx
    │   │   └── WinterFrostEnvironment.jsx
    │   ├── typography/
    │   │   └── SeasonalTypography.jsx
    │   └── ui/
    │       ├── ResetButton.jsx
    │       └── SeasonSelector.jsx
    ├── hooks/
    │   ├── useEnvironmentReveal.js
    │   └── usePointerInteraction.js
    ├── seasons/
    │   ├── seasonRegistry.js
    │   ├── spring.js
    │   ├── summer.js
    │   ├── autumn.js
    │   └── winter.js
    ├── shaders/
    │   └── springDeformationShader.js
    ├── styles/
    │   └── global.css
    └── utils/
        ├── dimensionReveal.js
        └── proceduralNoise.js
```

## Getting Started

### Prerequisites

- Node.js `18+` and npm

### Installation & Development

```bash
git clone https://github.com/kosrax/4-seasons.git
cd 4-seasons
npm install
npm run dev
```

### Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Build the production bundle into `dist/` |
| `npm run preview` | Preview the production build locally |

## Font Attribution

- **Cormorant Garamond SemiBold** (`public/fonts/CormorantGaramond-SemiBold.json`), licensed under the SIL Open Font License 1.1.
- **Helvetiker Bold** (loaded from `three@0.169.0` examples for Summer with automatic fallback to Cormorant Garamond SemiBold when offline), licensed under the MIT License.
