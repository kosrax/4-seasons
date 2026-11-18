import React, {
  Suspense,
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneEnvironment } from './SceneEnvironment.jsx';
import { SceneLighting } from './SceneLighting.jsx';
import { SeasonalTypography } from '../typography/SeasonalTypography.jsx';
import { ParticleSystem } from '../effects/ParticleSystem.jsx';

/**
 * Drives the 2D <-> 3D transition and smooth background/fog color interpolation
 * inside R3F's useFrame loop at priority -1.
 */
function DimensionAnimator({ dimensionMode, depthProgressRef, palette }) {
  const targetVal = dimensionMode === '3d' ? 1 : 0;
  const targetBgColor = useMemo(
    () => new THREE.Color(palette.background || '#E6E2D1'),
    [palette.background]
  );
  const targetFogColor = useMemo(
    () => new THREE.Color(palette.fogColor || '#EAE2DC'),
    [palette.fogColor]
  );

  const stateRef = useRef({
    from: targetVal,
    to: targetVal,
    elapsed: 1,
    duration: 1,
    initialized: false,
  });

  useEffect(() => {
    const s = stateRef.current;
    if (!s.initialized) {
      s.initialized = true;
      s.from = targetVal;
      s.to = targetVal;
      s.elapsed = 1;
      s.duration = 1;
      depthProgressRef.current = targetVal;
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    s.from = depthProgressRef.current;
    s.to = targetVal;
    s.elapsed = 0;
    s.duration = prefersReducedMotion ? 0.18 : 0.95;
  }, [targetVal, depthProgressRef]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.12);
    const s = stateRef.current;

    if (s.elapsed < s.duration) {
      s.elapsed = Math.min(s.duration, s.elapsed + dt);
      const t = s.duration > 0 ? s.elapsed / s.duration : 1;
      const eased =
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      depthProgressRef.current = THREE.MathUtils.lerp(s.from, s.to, eased);
    } else if (depthProgressRef.current !== s.to) {
      depthProgressRef.current = s.to;
    }

    // Smoothly interpolate scene background and fog color so season switches never flash
    const colorLerp = 1.0 - Math.exp(-3.8 * dt);
    if (state.scene.background && state.scene.background.isColor) {
      state.scene.background.lerp(targetBgColor, colorLerp);
    }
    if (state.scene.fog && state.scene.fog.color) {
      state.scene.fog.color.lerp(targetFogColor, colorLerp);
    }
  }, -1);

  return null;
}

export function SceneCanvas({
  seasonConfig,
  resetSignal,
  dimensionMode = '3d',
  onToggleDimension,
  onInteractionStateChange,
}) {
  const { camera, palette, lighting, animation, particles } = seasonConfig;
  const pointerWorldRef = useRef(new THREE.Vector3(999, 999, 999));
  const depthProgressRef = useRef(dimensionMode === '3d' ? 1 : 0);

  const initialBgRef = useRef(palette.background);
  const initialFogRef = useRef(palette.fogColor);

  const [typographyBounds, setTypographyBounds] = useState({
    width: 5.4,
    height: 1.12,
    depth: 0.22,
    bottomY: -0.44,
    topY: 0.68,
    centerY: 0.12,
    scale: 0.82,
    letterCount: seasonConfig.headline?.length ?? 5,
    headline: seasonConfig.headline ?? 'BLOOM',
  });

  const handleTypographyBoundsChange = useCallback((nextBounds) => {
    setTypographyBounds((prev) => {
      if (
        Math.abs(prev.width - nextBounds.width) < 0.005 &&
        Math.abs(prev.bottomY - nextBounds.bottomY) < 0.005 &&
        Math.abs((prev.hCenterX ?? 0) - (nextBounds.hCenterX ?? 0)) < 0.005 &&
        prev.headline === nextBounds.headline
      ) {
        return prev;
      }
      return nextBounds;
    });
  }, []);

  return (
    <div
      className="canvas-stage"
      aria-label={`Interactive ${dimensionMode.toUpperCase()} typography sculpture displaying ${seasonConfig.headline}`}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{
          position: camera.position,
          fov: camera.fov,
          near: camera.near,
          far: camera.far,
        }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.04,
        }}
      >
        <color attach="background" args={[initialBgRef.current]} />
        <fog attach="fog" args={[initialFogRef.current, 12, 28]} />

        <DimensionAnimator
          dimensionMode={dimensionMode}
          depthProgressRef={depthProgressRef}
          palette={palette}
        />

        <SceneLighting
          lighting={lighting}
          animation={animation}
          palette={palette}
        />

        <Suspense fallback={null}>
          <SceneEnvironment
            seasonConfig={seasonConfig}
            typographyBounds={typographyBounds}
            pointerWorldRef={pointerWorldRef}
            depthProgressRef={depthProgressRef}
          />
        </Suspense>

        <Suspense fallback={null}>
          <SeasonalTypography
            seasonConfig={seasonConfig}
            resetSignal={resetSignal}
            dimensionMode={dimensionMode}
            depthProgressRef={depthProgressRef}
            pointerWorldRef={pointerWorldRef}
            onToggleDimension={onToggleDimension}
            onInteractionStateChange={onInteractionStateChange}
            onTypographyBoundsChange={handleTypographyBoundsChange}
          />
        </Suspense>

        <ParticleSystem
          particleConfig={particles}
          pointerWorldRef={pointerWorldRef}
          depthProgressRef={depthProgressRef}
        />
      </Canvas>
    </div>
  );
}