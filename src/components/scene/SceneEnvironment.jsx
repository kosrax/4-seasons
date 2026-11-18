import React, { useMemo, useRef, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import { SeasonalMeadow } from './SeasonalMeadow.jsx';
import { SummerBeachEnvironment } from './SummerBeachEnvironment.jsx';
import { AutumnFoliageEnvironment } from './AutumnFoliageEnvironment.jsx';
import { WinterFrostEnvironment } from './WinterFrostEnvironment.jsx';

export function SceneEnvironment({
  seasonConfig,
  typographyBounds,
  pointerWorldRef,
  depthProgressRef,
}) {
  const backdropMaterialRef = useRef(null);
  const seasonStageRef = useRef(null);
  const { palette, environment = {} } = seasonConfig;

  const isSummerBeach =
    seasonConfig.id === 'summer' || environment.type === 'summer-beach';
  const isAutumnFoliage =
    seasonConfig.id === 'autumn' || environment.type === 'autumn-foliage';
  const isWinterFrost =
    seasonConfig.id === 'winter' || environment.type === 'winter-frost';

  const targetBackground = useMemo(
    () => new THREE.Color(palette.background || '#E6E2D1'),
    [palette.background]
  );
  const targetSkyTop = useMemo(
    () => new THREE.Color(palette.skyTop || '#D8B4C8'),
    [palette.skyTop]
  );
  const targetSkyHorizon = useMemo(
    () => new THREE.Color(palette.skyHorizon || '#EFE6E2'),
    [palette.skyHorizon]
  );
  const targetGroundBase = useMemo(
    () => new THREE.Color(palette.groundBase || '#E5E1CF'),
    [palette.groundBase]
  );

  // Coordinated seasonal entrance animation when switching between Spring, Summer, Autumn, and Winter
  useLayoutEffect(() => {
    if (!seasonStageRef.current) return;
    const stage = seasonStageRef.current;
    const is3D = (depthProgressRef?.current ?? 1) > 0.25;
    if (!is3D) return;

    gsap.killTweensOf(stage.position);
    gsap.killTweensOf(stage.scale);

    gsap.fromTo(
      stage.position,
      { y: -0.14 },
      { y: 0, duration: 0.85, ease: 'power3.out' }
    );
    gsap.fromTo(
      stage.scale,
      { x: 0.96, y: 0.65, z: 0.96 },
      { x: 1, y: 1, z: 1, duration: 0.9, ease: 'expo.out' }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonConfig.id]);

  const backdropShader = useMemo(() => {
    return {
      uniforms: {
        uTime: { value: 0 },
        uDepthProgress: { value: depthProgressRef?.current ?? 1.0 },
        uSummerSun: { value: isSummerBeach ? 1.0 : 0.0 },
        uAutumnGlow: { value: isAutumnFoliage ? 1.0 : 0.0 },
        uWinterFrost: { value: isWinterFrost ? 1.0 : 0.0 },
        uBackgroundColor: {
          value: new THREE.Color(palette.background || '#E6E2D1'),
        },
        uSkyTop: { value: new THREE.Color(palette.skyTop || '#D8B4C8') },
        uSkyHorizon: {
          value: new THREE.Color(palette.skyHorizon || '#EFE6E2'),
        },
        uGroundBase: {
          value: new THREE.Color(palette.groundBase || '#E5E1CF'),
        },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uDepthProgress;
        uniform float uSummerSun;
        uniform float uAutumnGlow;
        uniform float uWinterFrost;
        uniform vec3 uBackgroundColor;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyHorizon;
        uniform vec3 uGroundBase;
        varying vec3 vWorldPos;

        float dither(vec2 uv) {
          return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        }

        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y * 1.65 + 0.46, 0.0, 1.0);

          float floorToHorizon = smoothstep(0.26, 0.52, h);
          float horizonToSky = smoothstep(0.45, 0.88, h);

          vec3 col = mix(uGroundBase, uSkyHorizon, floorToHorizon);
          col = mix(col, uSkyTop, horizonToSky);

          float horizonBand = exp(-pow((h - 0.48) * 4.5, 2.0));
          col = mix(col, vec3(0.98, 0.96, 0.93), horizonBand * 0.14);

          if (uSummerSun > 0.001) {
            vec3 sunDir = normalize(vec3(0.05, 0.36, -0.93));
            float sunDot = max(dot(dir, sunDir), 0.0);
            float sunHalo = pow(sunDot, 7.0) * 0.48 + pow(sunDot, 28.0) * 0.52;
            float topWarmth = smoothstep(0.52, 0.96, h) * 0.24;
            col = mix(col, vec3(1.0, 0.96, 0.78), clamp((sunHalo + topWarmth) * uSummerSun, 0.0, 0.85));
          }

          if (uAutumnGlow > 0.001) {
            vec3 sunsetDir = normalize(vec3(-0.35, 0.18, -0.92));
            float sunsetDot = max(dot(dir, sunsetDir), 0.0);
            float sunsetBand = exp(-pow((h - 0.44) * 3.8, 2.0)) * 0.28 + pow(sunsetDot, 6.0) * 0.32;
            col = mix(col, vec3(0.96, 0.76, 0.55), clamp(sunsetBand * uAutumnGlow, 0.0, 0.55));
          }

          if (uWinterFrost > 0.001) {
            float frostBand = exp(-pow((h - 0.47) * 4.2, 2.0)) * 0.28;
            col = mix(col, vec3(0.94, 0.98, 1.0), clamp(frostBand * uWinterFrost, 0.0, 0.45));
          }

          float skyReveal = smoothstep(0.05, 0.9, uDepthProgress);
          col = mix(uBackgroundColor, col, skyReveal);

          col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
          col += dither(gl_FragCoord.xy) * (1.2 / 255.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const lerpSpeed = 1.0 - Math.exp(-3.8 * dt);

    if (backdropMaterialRef.current) {
      const uniforms = backdropMaterialRef.current.uniforms;
      uniforms.uTime.value = state.clock.getElapsedTime();
      uniforms.uDepthProgress.value = depthProgressRef?.current ?? 1.0;
      uniforms.uBackgroundColor.value.lerp(targetBackground, lerpSpeed);
      uniforms.uSkyTop.value.lerp(targetSkyTop, lerpSpeed);
      uniforms.uSkyHorizon.value.lerp(targetSkyHorizon, lerpSpeed);
      uniforms.uGroundBase.value.lerp(targetGroundBase, lerpSpeed);
      uniforms.uSummerSun.value = THREE.MathUtils.damp(
        uniforms.uSummerSun.value,
        isSummerBeach ? 1.0 : 0.0,
        4.0,
        dt
      );
      uniforms.uAutumnGlow.value = THREE.MathUtils.damp(
        uniforms.uAutumnGlow.value,
        isAutumnFoliage ? 1.0 : 0.0,
        4.0,
        dt
      );
      uniforms.uWinterFrost.value = THREE.MathUtils.damp(
        uniforms.uWinterFrost.value,
        isWinterFrost ? 1.0 : 0.0,
        4.0,
        dt
      );
    }
  });

  return (
    <group name="seasonal-studio-environment">
      <Environment resolution={256} frames={1}>
        <group rotation={[-0.15, 0, 0]}>
          <Lightformer
            form="rect"
            intensity={2.4}
            color="#FFFFFF"
            scale={[12, 4, 1]}
            position={[0, 6.0, 2.5]}
            rotation={[Math.PI / 2.2, 0, 0]}
          />
          <Lightformer
            form="rect"
            intensity={1.85}
            color={palette.skyHorizon || '#E8F2C8'}
            scale={[7, 3, 1]}
            position={[-6.5, 2.0, 1.5]}
            rotation={[0, Math.PI / 2.3, 0]}
          />
          <Lightformer
            form="ring"
            intensity={1.55}
            color={palette.skyTop || '#F2D5E4'}
            scale={4.2}
            position={[6.0, 1.2, 2.0]}
            rotation={[0, -Math.PI / 2.4, 0]}
          />
          <Lightformer
            form="rect"
            intensity={1.25}
            color={palette.groundBase || '#E5E1CF'}
            scale={[14, 6, 1]}
            position={[0, -4.5, 1.0]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
        </group>
      </Environment>

      <mesh position={[0, 0, 0]} renderOrder={-2}>
        <sphereGeometry args={[26, 64, 32]} />
        <shaderMaterial
          ref={backdropMaterialRef}
          uniforms={backdropShader.uniforms}
          vertexShader={backdropShader.vertexShader}
          fragmentShader={backdropShader.fragmentShader}
          side={THREE.BackSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group ref={seasonStageRef} name="seasonal-diorama-stage">
        {isSummerBeach ? (
          <SummerBeachEnvironment
            seasonConfig={seasonConfig}
            typographyBounds={typographyBounds}
            pointerWorldRef={pointerWorldRef}
            depthProgressRef={depthProgressRef}
          />
        ) : isAutumnFoliage ? (
          <AutumnFoliageEnvironment
            seasonConfig={seasonConfig}
            typographyBounds={typographyBounds}
            pointerWorldRef={pointerWorldRef}
            depthProgressRef={depthProgressRef}
          />
        ) : isWinterFrost ? (
          <WinterFrostEnvironment
            seasonConfig={seasonConfig}
            typographyBounds={typographyBounds}
            pointerWorldRef={pointerWorldRef}
            depthProgressRef={depthProgressRef}
          />
        ) : (
          <SeasonalMeadow
            seasonConfig={seasonConfig}
            typographyBounds={typographyBounds}
            pointerWorldRef={pointerWorldRef}
            depthProgressRef={depthProgressRef}
          />
        )}
      </group>
    </group>
  );
}