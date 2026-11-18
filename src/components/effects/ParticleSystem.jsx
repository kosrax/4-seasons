import React, { useMemo, useRef, useLayoutEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { computeDimensionReveals } from '../../utils/dimensionReveal.js';

const DEFAULT_PARTICLES = {
  enabled: true,
  count: 36,
  bounds: [10.5, 5.0, 3.5],
  baseSize: 48.0,
  driftSpeed: 0.16,
  turbulence: 0.22,
  cursorRepulsionRadius: 1.9,
  cursorRepulsionStrength: 0.38,
  colorPrimary: '#FFFDF7',
  colorSecondary: '#F4C2D7',
  colorAccent: '#C5DE82',
  opacity: 0.78,
};

export function ParticleSystem({
  particleConfig,
  pointerWorldRef,
  depthProgressRef,
}) {
  const pointsRef = useRef(null);
  const materialRef = useRef(null);
  const { gl } = useThree();

  const config = particleConfig || DEFAULT_PARTICLES;
  const count = config.count ?? 36;
  const [boundX, boundY, boundZ] = config.bounds ?? [10.5, 5.0, 3.5];

  const driftSpeedVal = config.driftSpeed ?? 0.16;
  const turbulenceVal = config.turbulence ?? 0.22;
  const isFallingLeafMode = driftSpeedVal < 0 && turbulenceVal > 0.3;
  const isSnowfallMode = driftSpeedVal < 0 && turbulenceVal <= 0.3;

  const { positions, basePositions, phases, scales, colors } = useMemo(() => {
    const posArray = new Float32Array(count * 3);
    const basePosArray = new Float32Array(count * 3);
    const phaseArray = new Float32Array(count);
    const scaleArray = new Float32Array(count);
    const colorArray = new Float32Array(count * 3);

    const cPrimary = new THREE.Color(config.colorPrimary || '#FFFDF7');
    const cSecondary = new THREE.Color(config.colorSecondary || '#F4C2D7');
    const cAccent = new THREE.Color(config.colorAccent || '#C5DE82');
    const tempColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      const x = (Math.random() - 0.5) * boundX;
      const y = -0.3 + (Math.random() - 0.45) * boundY;
      let z = (Math.random() - 0.5) * boundZ;
      if (Math.abs(z) < 0.5 && Math.abs(x) < 3.5 && Math.abs(y) < 1.2) {
        z = z >= 0 ? 0.75 : -0.9;
      }

      posArray[i3] = x;
      posArray[i3 + 1] = y;
      posArray[i3 + 2] = z;

      basePosArray[i3] = x;
      basePosArray[i3 + 1] = y;
      basePosArray[i3 + 2] = z;

      phaseArray[i] = Math.random() * Math.PI * 2;
      scaleArray[i] = 0.52 + Math.random() * 0.84;

      const paletteRoll = Math.random();
      if (paletteRoll < 0.45) {
        tempColor.copy(cPrimary);
      } else if (paletteRoll < 0.78) {
        tempColor.copy(cSecondary);
      } else {
        tempColor.copy(cAccent);
      }

      colorArray[i3] = tempColor.r;
      colorArray[i3 + 1] = tempColor.g;
      colorArray[i3 + 2] = tempColor.b;
    }

    return {
      positions: posArray,
      basePositions: basePosArray,
      phases: phaseArray,
      scales: scaleArray,
      colors: colorArray,
    };
  }, [
    count,
    boundX,
    boundY,
    boundZ,
    config.colorPrimary,
    config.colorSecondary,
    config.colorAccent,
  ]);

  const shaderArgs = useMemo(() => {
    return {
      uniforms: {
        uTime: { value: 0 },
        uBaseSize: { value: config.baseSize ?? 48.0 },
        uOpacity: { value: config.opacity ?? 0.78 },
        uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
        uIsLeaf: { value: isFallingLeafMode ? 1.0 : 0.0 },
        uIsSnow: { value: isSnowfallMode ? 1.0 : 0.0 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uBaseSize;
        uniform float uPixelRatio;
        attribute float aPhase;
        attribute float aScale;
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPhase;

        void main() {
          vColor = aColor;
          vPhase = aPhase;
          float pulse = 0.75 + 0.25 * sin(uTime * 1.25 + aPhase);
          vAlpha = pulse;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;

          gl_PointSize = uBaseSize * uPixelRatio * aScale * (1.0 / max(-mvPosition.z, 1.0));
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform float uIsLeaf;
        uniform float uIsSnow;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vPhase;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float angle = uTime * (0.42 + uIsLeaf * 0.55) + vPhase;
          float c = cos(angle);
          float s = sin(angle);
          vec2 rotUv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);

          if (uIsLeaf > 0.5) {
            float tumbleSquash = 0.55 + 0.45 * abs(sin(uTime * 1.4 + vPhase));
            rotUv.x *= 1.55 / max(tumbleSquash, 0.35);
            float leafShape = length(vec2(rotUv.x, rotUv.y * (1.0 + abs(rotUv.x) * 0.9)));
            if (leafShape > 0.46) discard;
            float edge = smoothstep(0.46, 0.16, leafShape);
            float midrib = 1.0 - smoothstep(0.0, 0.04, abs(rotUv.x));
            vec3 leafCol = mix(vColor, vColor * 0.72, midrib * 0.45);
            gl_FragColor = vec4(leafCol, edge * vAlpha * uOpacity);
          } else if (uIsSnow > 0.5) {
            // Delicate 6-point crystalline snowflake + soft frost halo
            float r = length(rotUv);
            if (r > 0.48) discard;
            float theta = atan(rotUv.y, rotUv.x);
            float hexStar = abs(cos(theta * 3.0));
            float crystalCore = smoothstep(0.42, 0.05, r / (0.68 + hexStar * 0.32));
            float softHalo = smoothstep(0.48, 0.1, r) * 0.45;
            gl_FragColor = vec4(vColor, clamp(crystalCore + softHalo, 0.0, 1.0) * vAlpha * uOpacity);
          } else {
            rotUv.x *= 1.22;
            float dist = length(rotUv);
            if (dist > 0.48) discard;
            float softPetal = smoothstep(0.48, 0.08, dist);
            gl_FragColor = vec4(vColor, softPetal * vAlpha * uOpacity);
          }
        }
      `,
    };
  }, [
    config.baseSize,
    config.opacity,
    isFallingLeafMode,
    isSnowfallMode,
    gl,
  ]);

  useLayoutEffect(() => {
    if (!pointsRef.current) return;
    const { worldReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    pointsRef.current.visible = worldReveal > 0.005;
    if (materialRef.current) {
      materialRef.current.uniforms.uOpacity.value =
        (config.opacity ?? 0.78) * worldReveal;
    }
  }, [config.opacity, depthProgressRef]);

  useFrame((state, delta) => {
    if (!pointsRef.current || !config.enabled) return;

    const { worldReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    pointsRef.current.visible = worldReveal > 0.005;

    const dt = Math.min(delta, 0.1);
    const t = state.clock.getElapsedTime();

    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = t;
      materialRef.current.uniforms.uBaseSize.value = THREE.MathUtils.damp(
        materialRef.current.uniforms.uBaseSize.value,
        config.baseSize ?? 48.0,
        4.0,
        dt
      );
      materialRef.current.uniforms.uOpacity.value =
        (config.opacity ?? 0.78) * worldReveal;
      materialRef.current.uniforms.uIsLeaf.value = isFallingLeafMode
        ? 1.0
        : 0.0;
      materialRef.current.uniforms.uIsSnow.value = isSnowfallMode ? 1.0 : 0.0;
    }

    if (worldReveal <= 0.005) return;

    const posAttr = pointsRef.current.geometry.attributes.position;
    const posArr = posAttr.array;
    const halfY = boundY * 0.5;
    const halfX = boundX * 0.5;

    const pointer = pointerWorldRef?.current;
    const repulseRadius = config.cursorRepulsionRadius ?? 1.9;
    const repulseStrength = config.cursorRepulsionStrength ?? 0.38;
    const driftSpeed = config.driftSpeed ?? 0.16;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const phase = phases[i];

      basePositions[i3 + 1] += driftSpeed * (0.65 + scales[i] * 0.35) * dt;
      if (driftSpeed >= 0 && basePositions[i3 + 1] > halfY) {
        basePositions[i3 + 1] = -halfY;
      } else if (driftSpeed < 0 && basePositions[i3 + 1] < -halfY) {
        basePositions[i3 + 1] = halfY;
      }

      const swayMult = isFallingLeafMode ? 1.1 : 0.85;
      const swayX =
        Math.sin(t * 0.58 + phase) * (config.turbulence ?? 0.24) * swayMult;
      const swayZ =
        Math.cos(t * 0.42 + phase) * (config.turbulence ?? 0.24) * 0.65;

      let targetX = basePositions[i3] + swayX;
      let targetY = basePositions[i3 + 1];
      let targetZ = basePositions[i3 + 2] + swayZ;

      if (pointer && repulseStrength > 0.001) {
        const dx = targetX - pointer.x;
        const dy = targetY - pointer.y;
        const distSq = dx * dx + dy * dy;
        const radiusSq = repulseRadius * repulseRadius;

        if (distSq < radiusSq && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const falloff = (1.0 - dist / repulseRadius) * repulseStrength;
          targetX += (dx / dist) * falloff;
          targetY += (dy / dist) * falloff;
        }
      }

      if (targetX > halfX) basePositions[i3] -= boundX;
      if (targetX < -halfX) basePositions[i3] += boundX;

      posArr[i3] = THREE.MathUtils.damp(posArr[i3], targetX, 3.5, dt);
      posArr[i3 + 1] = THREE.MathUtils.damp(posArr[i3 + 1], targetY, 3.5, dt);
      posArr[i3 + 2] = THREE.MathUtils.damp(posArr[i3 + 2], targetZ, 3.5, dt);
    }

    posAttr.needsUpdate = true;
  });

  if (!config.enabled) return null;

  return (
    <points
      key={
        config.colorPrimary + config.colorSecondary + String(count)
      }
      ref={pointsRef}
      name="seasonal-atmosphere-particles"
    >
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-aPhase"
          count={count}
          array={phases}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-aScale"
          count={count}
          array={scales}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-aColor"
          count={count}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        uniforms={shaderArgs.uniforms}
        vertexShader={shaderArgs.vertexShader}
        fragmentShader={shaderArgs.fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}