import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function SceneLighting({ lighting, animation, palette = {} }) {
  const { ambient, keyLight, rimLight, blushFill } = lighting;
  const ambientRef = useRef(null);
  const hemiLightRef = useRef(null);
  const keyLightRef = useRef(null);
  const rimLightRef = useRef(null);
  const blushFillRef = useRef(null);

  const hemiGroundHex =
    palette.sandMid || palette.groundMoss || '#7A8C50';
  const hemiSkyHex = palette.skyHorizon || '#F5EFEA';

  const targetColors = useMemo(
    () => ({
      ambient: new THREE.Color(ambient.color),
      hemiSky: new THREE.Color(hemiSkyHex),
      hemiGround: new THREE.Color(hemiGroundHex),
      key: new THREE.Color(keyLight.color),
      rim: new THREE.Color(rimLight.color),
      fill: new THREE.Color(blushFill.color),
    }),
    [
      ambient.color,
      hemiSkyHex,
      hemiGroundHex,
      keyLight.color,
      rimLight.color,
      blushFill.color,
    ]
  );

  const swaySpeed = animation?.canopyLightSwaySpeed ?? 0.5;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const lerpFactor = 1.0 - Math.exp(-4.0 * dt);
    const t = state.clock.getElapsedTime() * swaySpeed;

    if (ambientRef.current) {
      ambientRef.current.color.lerp(targetColors.ambient, lerpFactor);
      ambientRef.current.intensity = THREE.MathUtils.damp(
        ambientRef.current.intensity,
        ambient.intensity,
        4.0,
        dt
      );
    }

    if (hemiLightRef.current) {
      hemiLightRef.current.color.lerp(targetColors.hemiSky, lerpFactor);
      hemiLightRef.current.groundColor.lerp(
        targetColors.hemiGround,
        lerpFactor
      );
    }

    if (keyLightRef.current) {
      keyLightRef.current.color.lerp(targetColors.key, lerpFactor);
      keyLightRef.current.intensity = THREE.MathUtils.damp(
        keyLightRef.current.intensity,
        keyLight.intensity,
        4.0,
        dt
      );
      keyLightRef.current.position.x =
        keyLight.position[0] + Math.sin(t) * 0.65;
      keyLightRef.current.position.y =
        keyLight.position[1] + Math.cos(t * 0.8) * 0.45;
    }

    if (rimLightRef.current) {
      rimLightRef.current.color.lerp(targetColors.rim, lerpFactor);
      rimLightRef.current.intensity = THREE.MathUtils.damp(
        rimLightRef.current.intensity,
        rimLight.intensity,
        4.0,
        dt
      );
    }

    if (blushFillRef.current) {
      blushFillRef.current.color.lerp(targetColors.fill, lerpFactor);
      blushFillRef.current.intensity = THREE.MathUtils.damp(
        blushFillRef.current.intensity,
        blushFill.intensity,
        4.0,
        dt
      );
      blushFillRef.current.position.x =
        blushFill.position[0] + Math.cos(t * 1.1) * 0.85;
      blushFillRef.current.position.y =
        blushFill.position[1] + Math.sin(t * 0.9) * 0.35;
    }
  });

  return (
    <group name="seasonal-lighting-rig">
      <ambientLight
        ref={ambientRef}
        color={ambient.color}
        intensity={ambient.intensity}
      />

      <hemisphereLight
        ref={hemiLightRef}
        args={[hemiSkyHex, hemiGroundHex, 0.82]}
      />

      <directionalLight
        ref={keyLightRef}
        color={keyLight.color}
        intensity={keyLight.intensity}
        position={keyLight.position}
      />

      <directionalLight
        ref={rimLightRef}
        color={rimLight.color}
        intensity={rimLight.intensity}
        position={rimLight.position}
      />

      <pointLight
        ref={blushFillRef}
        color={blushFill.color}
        intensity={blushFill.intensity}
        position={blushFill.position}
        distance={blushFill.distance}
        decay={blushFill.decay}
      />
    </group>
  );
}