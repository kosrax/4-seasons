import React, { useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  computeDimensionReveals,
  syncObjectToTypographyAnchor,
} from '../../utils/dimensionReveal.js';
import {
  hash2D,
  fbm2D,
  smoothstep,
  GLSL_NOISE_2D,
  buildGroundVertexShader,
  createDisplacedTerrainGeometry,
} from '../../utils/proceduralNoise.js';
import {
  useGroundRevealSync,
  applyGroundRevealFrame,
  usePerchedPropRevealSync,
} from '../../hooks/useEnvironmentReveal.js';

const LENS_SIDES = [
  { key: 'left', sign: -1, glintX: -0.02 },
  { key: 'right', sign: 1, glintX: -0.018 },
];

const RIVET_POSITIONS_X = [-0.242, -0.226, 0.242, 0.226];

const SUN_RAY_CONFIGS = [
  { angle: -0.46, width: 1.55, length: 6.2 },
  { angle: -0.28, width: 1.85, length: 6.8 },
  { angle: -0.11, width: 2.1, length: 7.2 },
  { angle: 0.05, width: 2.25, length: 7.4 },
  { angle: 0.21, width: 1.9, length: 6.9 },
  { angle: 0.37, width: 1.65, length: 6.4 },
  { angle: 0.52, width: 1.4, length: 5.9 },
];

function sampleBeachElevation(
  x,
  z,
  halfWidth,
  halfDepth,
  moundHeight = 0.24
) {
  const rightDuneDx = (x - halfWidth * 0.5) / (halfWidth * 0.65);
  const rightDuneDz = (z - 0.38) / 0.96;
  const rightDune =
    Math.exp(-(rightDuneDx * rightDuneDx + rightDuneDz * rightDuneDz) * 1.15) *
    moundHeight *
    1.18;

  const rightBankDx = (x - halfWidth * 0.46) / (halfWidth * 0.52);
  const rightBankDz = (z - 0.08) / (halfDepth * 2.8);
  const rightLetterBank =
    Math.exp(-(rightBankDx * rightBankDx + rightBankDz * rightBankDz) * 1.35) *
    (moundHeight * 0.88);

  const leftDuneDx = (x + halfWidth * 0.42) / (halfWidth * 0.72);
  const leftDuneDz = (z - 0.26) / 0.78;
  const leftDune =
    Math.exp(-(leftDuneDx * leftDuneDx + leftDuneDz * leftDuneDz) * 1.45) *
    (moundHeight * 0.62);

  const envelope = Math.max(rightDune, Math.max(rightLetterBank, leftDune));
  const duneRidgeWave =
    Math.pow(
      0.5 + 0.5 * Math.sin(x * 4.2 + z * 3.1 + fbm2D(x * 1.4, z * 1.4) * 2.4),
      1.8
    ) *
    (moundHeight * 0.24) *
    smoothstep(0.01, 0.12, envelope);

  const fineRipple =
    Math.sin(x * 11.5 + z * 6.8 + fbm2D(x * 2.2, z * 2.2) * 3.0) *
    0.014 *
    smoothstep(0.01, 0.09, envelope);

  return rightDune + rightLetterBank + leftDune + duneRidgeWave + fineRipple;
}

function createWayfarerRoundedShape(width, height, radius, topFlare = 0.014) {
  const shape = new THREE.Shape();
  const hw = width * 0.5;
  const hh = height * 0.5;
  const r = Math.min(radius, hw * 0.45, hh * 0.45);

  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw + topFlare * 0.4, -hh + r);
  shape.lineTo(hw + topFlare, hh - r);
  shape.quadraticCurveTo(hw + topFlare, hh, hw + topFlare - r, hh);
  shape.lineTo(-hw - topFlare * 0.3 + r, hh);
  shape.quadraticCurveTo(
    -hw - topFlare * 0.3,
    hh,
    -hw - topFlare * 0.3,
    hh - r
  );
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  return shape;
}

function createTempleArmGeometry(sideSign) {
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(sideSign * 0.246, 0.036, -0.01),
    new THREE.Vector3(sideSign * 0.244, 0.022, -0.095),
    new THREE.Vector3(sideSign * 0.236, -0.012, -0.175),
    new THREE.Vector3(sideSign * 0.224, -0.055, -0.235),
    new THREE.Vector3(sideSign * 0.214, -0.092, -0.275),
  ]);
  return new THREE.TubeGeometry(armCurve, 20, 0.0105, 8, false);
}

function createSunglassesGeometries() {
  const outerShape = createWayfarerRoundedShape(0.21, 0.16, 0.038, 0.016);
  const innerHole = createWayfarerRoundedShape(0.16, 0.116, 0.026, 0.011);
  outerShape.holes.push(innerHole);

  const rimGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: 0.024,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.007,
    bevelSegments: 4,
    curveSegments: 20,
  });
  rimGeo.center();

  const lensShape = createWayfarerRoundedShape(0.164, 0.12, 0.027, 0.011);
  const lensGeo = new THREE.ExtrudeGeometry(lensShape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.002,
    bevelSegments: 3,
    curveSegments: 20,
  });
  lensGeo.center();

  const bridgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.072, 0.026, 0.006),
    new THREE.Vector3(-0.034, 0.048, 0.014),
    new THREE.Vector3(0.0, 0.052, 0.016),
    new THREE.Vector3(0.034, 0.048, 0.014),
    new THREE.Vector3(0.072, 0.026, 0.006),
  ]);
  const bridgeGeo = new THREE.TubeGeometry(bridgeCurve, 16, 0.012, 10, false);

  const leftArmGeo = createTempleArmGeometry(-1);
  const rightArmGeo = createTempleArmGeometry(1);

  const rivetGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.042, 10);
  rivetGeo.rotateX(Math.PI / 2);

  return { rimGeo, lensGeo, bridgeGeo, leftArmGeo, rightArmGeo, rivetGeo };
}

function SummerSunshine({ sunshineCfg = {}, depthProgressRef }) {
  const sunGroupRef = useRef(null);

  const coreColor = sunshineCfg.coreColor || '#FFFDF0';
  const rayColor = sunshineCfg.rayColor || '#FFE89E';
  const intensity = sunshineCfg.intensity ?? 0.54;
  const sunPos = sunshineCfg.sunPosition || [0.35, 3.45, -3.2];

  const coronaShader = useMemo(
    () => ({
      uniforms: {
        uTime: { value: 0 },
        uReveal: {
          value: computeDimensionReveals(depthProgressRef?.current ?? 1)
            .worldReveal,
        },
        uCoreColor: { value: new THREE.Color(coreColor) },
        uRayColor: { value: new THREE.Color(rayColor) },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uReveal;
        uniform vec3 uCoreColor;
        uniform vec3 uRayColor;
        uniform float uIntensity;
        varying vec2 vUv;

        void main() {
          vec2 p = (vUv - vec2(0.5)) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          float angle = atan(p.y, p.x);
          float starburst =
            0.5 +
            0.28 * cos(angle * 8.0 + uTime * 0.25) +
            0.22 * sin(angle * 14.0 - uTime * 0.35);

          float core = exp(-r * r * 10.5);
          float halo = exp(-r * r * 3.2) * (0.78 + starburst * 0.22);
          float edgeFade = smoothstep(1.0, 0.15, r);

          vec3 col = mix(uRayColor, uCoreColor, smoothstep(0.0, 0.55, core));
          col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

          float alpha = clamp((core * 0.95 + halo * 0.52) * edgeFade * uIntensity, 0.0, 0.92) * uReveal;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coreColor, rayColor, intensity]
  );

  const beamShader = useMemo(
    () => ({
      uniforms: {
        uTime: { value: 0 },
        uReveal: {
          value: computeDimensionReveals(depthProgressRef?.current ?? 1)
            .worldReveal,
        },
        uCoreColor: { value: new THREE.Color(coreColor) },
        uRayColor: { value: new THREE.Color(rayColor) },
        uIntensity: { value: intensity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uReveal;
        uniform vec3 uCoreColor;
        uniform vec3 uRayColor;
        uniform float uIntensity;
        varying vec2 vUv;

        void main() {
          float longitudinalFade = smoothstep(0.0, 0.65, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
          float centerAxis = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float lateralFade = pow(clamp(centerAxis, 0.0, 1.0), 2.2);

          float shimmer = 0.82 + 0.18 * sin(uTime * 0.9 + vUv.x * 9.0 + vUv.y * 4.0);
          vec3 col = mix(uRayColor, uCoreColor, vUv.y * 0.65);
          col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

          float alpha = longitudinalFade * lateralFade * shimmer * uIntensity * 0.34 * uReveal;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coreColor, rayColor, intensity]
  );

  useLayoutEffect(() => {
    const { worldReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    if (sunGroupRef.current) {
      sunGroupRef.current.visible = worldReveal > 0.005;
    }
    coronaShader.uniforms.uReveal.value = worldReveal;
    beamShader.uniforms.uReveal.value = worldReveal;
  }, [depthProgressRef, coronaShader, beamShader]);

  useFrame((state) => {
    const { worldReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    if (sunGroupRef.current) {
      sunGroupRef.current.visible = worldReveal > 0.005;
    }
    const t = state.clock.getElapsedTime();
    coronaShader.uniforms.uTime.value = t;
    coronaShader.uniforms.uReveal.value = worldReveal;
    beamShader.uniforms.uTime.value = t;
    beamShader.uniforms.uReveal.value = worldReveal;
  });

  if (sunshineCfg.enabled === false) return null;

  return (
    <group
      ref={sunGroupRef}
      name="summer-top-sunshine"
      position={sunPos}
      renderOrder={-1}
    >
      <mesh position={[0, 0.25, 0]}>
        <planeGeometry args={[5.4, 5.4]} />
        <shaderMaterial
          uniforms={coronaShader.uniforms}
          vertexShader={coronaShader.vertexShader}
          fragmentShader={coronaShader.fragmentShader}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {SUN_RAY_CONFIGS.map((ray, idx) => (
        <group key={idx} rotation={[0, 0, ray.angle]}>
          <mesh position={[0, -ray.length * 0.45, -0.05]}>
            <planeGeometry args={[ray.width, ray.length]} />
            <shaderMaterial
              uniforms={beamShader.uniforms}
              vertexShader={beamShader.vertexShader}
              fragmentShader={beamShader.fragmentShader}
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function SummerSunglasses({
  restPosition,
  scale = 1.6,
  sunglassesCfg = {},
  depthProgressRef,
}) {
  const rootGroupRef = useRef(null);
  const localPoint = useMemo(() => new THREE.Vector3(), []);
  const typoQuat = useMemo(() => new THREE.Quaternion(), []);
  const restingQuat = useMemo(
    () =>
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-0.34, 0.045, 0.032)
      ),
    []
  );
  const geometries = useMemo(() => createSunglassesGeometries(), []);

  const { frameMaterial, lensMaterial, metalMaterial, glintMaterial } = useMemo(
    () => ({
      frameMaterial: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(sunglassesCfg.frameColor || '#24120A'),
        roughness: 0.16,
        metalness: 0.05,
        clearcoat: 0.94,
        clearcoatRoughness: 0.08,
        reflectivity: 0.88,
      }),
      lensMaterial: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(sunglassesCfg.lensColor || '#0B202C'),
        emissive: new THREE.Color('#081A24'),
        emissiveIntensity: 0.24,
        roughness: 0.04,
        metalness: 0.42,
        clearcoat: 1.0,
        clearcoatRoughness: 0.03,
        reflectivity: 1.0,
      }),
      metalMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(sunglassesCfg.bridgeMetalColor || '#F7C948'),
        roughness: 0.18,
        metalness: 0.9,
      }),
      glintMaterial: new THREE.MeshBasicMaterial({
        color: new THREE.Color('#FFF8E7'),
        transparent: true,
        opacity: 0.48,
      }),
    }),
    [
      sunglassesCfg.frameColor,
      sunglassesCfg.lensColor,
      sunglassesCfg.bridgeMetalColor,
    ]
  );

  useEffect(() => {
    return () => {
      Object.values(geometries).forEach((g) => g.dispose());
      frameMaterial.dispose();
      lensMaterial.dispose();
      metalMaterial.dispose();
      glintMaterial.dispose();
    };
  }, [geometries, frameMaterial, lensMaterial, metalMaterial, glintMaterial]);

  usePerchedPropRevealSync(rootGroupRef, scale, depthProgressRef);

  useFrame((state) => {
    if (!rootGroupRef.current) return;

    const { propReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    rootGroupRef.current.visible = propReveal > 0.005;
    rootGroupRef.current.scale.setScalar(Math.max(0.0001, scale * propReveal));
    if (propReveal <= 0.005) return;

    syncObjectToTypographyAnchor({
      object: rootGroupRef.current,
      scene: state.scene,
      restPosition,
      baseScale: scale,
      propReveal,
      orientationQuat: restingQuat,
      applyTransitionScale: true,
      tempPoint: localPoint,
      tempQuat: typoQuat,
    });
  });

  if (sunglassesCfg.enabled === false) return null;

  return (
    <group
      ref={rootGroupRef}
      name="summer-sunglasses-resting-on-H"
      position={restPosition}
      scale={scale}
    >
      <group position={[0, -0.012, 0]}>
        {LENS_SIDES.map(({ key, sign, glintX }) => (
          <group
            key={key}
            position={[sign * 0.152, 0.0, 0.0]}
            rotation={[0, -sign * 0.05, 0]}
          >
            <mesh
              geometry={geometries.rimGeo}
              material={frameMaterial}
              castShadow
              receiveShadow
            />
            <mesh
              geometry={geometries.lensGeo}
              material={lensMaterial}
              position={[0, 0, 0.002]}
            />
            <mesh
              material={glintMaterial}
              position={[glintX, 0.01, 0.012]}
              rotation={[0, 0, -0.48]}
            >
              <planeGeometry args={[0.018, 0.092]} />
            </mesh>
          </group>
        ))}

        <mesh
          geometry={geometries.bridgeGeo}
          material={frameMaterial}
          castShadow
        />
        <mesh
          position={[0, 0.062, 0.013]}
          rotation={[0, 0, Math.PI / 2]}
          material={metalMaterial}
        >
          <cylinderGeometry args={[0.005, 0.005, 0.165, 8]} />
        </mesh>

        {RIVET_POSITIONS_X.map((rx) => (
          <mesh
            key={rx}
            geometry={geometries.rivetGeo}
            material={metalMaterial}
            position={[rx, 0.05, 0.002]}
          />
        ))}

        <mesh
          geometry={geometries.leftArmGeo}
          material={frameMaterial}
          castShadow
        />
        <mesh
          geometry={geometries.rightArmGeo}
          material={frameMaterial}
          castShadow
        />
      </group>
    </group>
  );
}

function SummerBeachBall({
  position,
  radius = 0.27,
  beachBallCfg = {},
  pointerWorldRef,
  depthProgressRef,
}) {
  const ballGroupRef = useRef(null);

  const { ballGeometry, ballMaterial, valveMaterial } = useMemo(() => {
    const geo = new THREE.SphereGeometry(1.0, 64, 48);
    const colors = beachBallCfg.colors || {};
    const cWhite = new THREE.Color(colors.white || '#FFFDF9');
    const cRed = new THREE.Color(colors.coralRed || '#E63946');
    const cYellow = new THREE.Color(colors.sunnyYellow || '#FFB703');
    const cBlue = new THREE.Color(colors.oceanBlue || '#1D9BF0');

    const mat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.14,
      metalness: 0.02,
      clearcoat: 0.94,
      clearcoatRoughness: 0.07,
      reflectivity: 0.9,
    });

    mat.customProgramCacheKey = () => 'summer-beach-ball-6panel-v1';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uColWhite = { value: cWhite };
      shader.uniforms.uColRed = { value: cRed };
      shader.uniforms.uColYellow = { value: cYellow };
      shader.uniforms.uColBlue = { value: cBlue };

      shader.vertexShader =
        `varying vec3 vBallObjPos;\n` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vBallObjPos = normalize(position);

        float lonAngle = atan(vBallObjPos.z, vBallObjPos.x);
        float panelWave = abs(sin(lonAngle * 3.0));
        float polarDist = length(vBallObjPos.xz);
        float seamGroove = (1.0 - smoothstep(0.0, 0.075, panelWave)) * smoothstep(0.28, 0.42, polarDist);
        float capSeam = 1.0 - smoothstep(0.0, 0.032, abs(polarDist - 0.34));

        transformed *= 1.0 - (seamGroove * 0.018 + capSeam * 0.012);
        `
      );

      shader.fragmentShader =
        `
        uniform vec3 uColWhite;
        uniform vec3 uColRed;
        uniform vec3 uColYellow;
        uniform vec3 uColBlue;
        varying vec3 vBallObjPos;
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>

        vec3 nPos = normalize(vBallObjPos);
        float angle = atan(nPos.z, nPos.x) + 3.14159265;
        float sector = mod(floor(angle / (3.14159265 / 3.0)), 6.0);

        vec3 panelCol = uColWhite;
        if (sector > 0.5 && sector < 1.5) {
          panelCol = uColRed;
        } else if (sector > 2.5 && sector < 3.5) {
          panelCol = uColYellow;
        } else if (sector > 4.5 && sector < 5.5) {
          panelCol = uColBlue;
        }

        float polarR = length(nPos.xz);
        float capMask = 1.0 - smoothstep(0.32, 0.355, polarR);
        panelCol = mix(panelCol, uColWhite, capMask);

        float seamProximity = abs(sin(angle * 3.0));
        float seamShade = mix(0.82, 1.0, smoothstep(0.0, 0.08, seamProximity));
        float capSeamShade = mix(0.84, 1.0, smoothstep(0.0, 0.035, abs(polarR - 0.338)));

        diffuseColor.rgb = panelCol * mix(seamShade, 1.0, capMask) * capSeamShade;
        `
      );
    };

    const vMat = new THREE.MeshPhysicalMaterial({
      color: '#F8F9FA',
      roughness: 0.25,
      transmission: 0.35,
      transparent: true,
      opacity: 0.88,
    });

    return { ballGeometry: geo, ballMaterial: mat, valveMaterial: vMat };
  }, [beachBallCfg.colors]);

  useEffect(() => {
    return () => {
      ballGeometry.dispose();
      ballMaterial.dispose();
      valveMaterial.dispose();
    };
  }, [ballGeometry, ballMaterial, valveMaterial]);

  useLayoutEffect(() => {
    if (!ballGroupRef.current) return;
    const { worldReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    ballGroupRef.current.visible = worldReveal > 0.005;
    ballGroupRef.current.scale.setScalar(
      Math.max(0.0001, radius * worldReveal)
    );
    ballGroupRef.current.position.set(
      position[0],
      position[1] * worldReveal,
      position[2]
    );
  }, [position, radius, depthProgressRef]);

  useFrame((state, delta) => {
    if (!ballGroupRef.current) return;

    const { worldReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    ballGroupRef.current.visible = worldReveal > 0.005;
    ballGroupRef.current.scale.setScalar(
      Math.max(0.0001, radius * worldReveal)
    );
    ballGroupRef.current.position.set(
      position[0],
      position[1] * worldReveal,
      position[2]
    );
    if (worldReveal <= 0.005) return;

    const dt = Math.min(delta, 0.1);
    const t = state.clock.getElapsedTime();

    let cursorPushX = 0.0;
    let cursorPushZ = 0.0;
    if (pointerWorldRef?.current && pointerWorldRef.current.x < 500) {
      const dx = position[0] - pointerWorldRef.current.x;
      const dz = position[2] - pointerWorldRef.current.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const influence = smoothstep(1.6, 0.0, dist);
      if (dist > 0.001) {
        cursorPushX = (dx / dist) * influence * 0.38;
        cursorPushZ = (dz / dist) * influence * 0.38;
      }
    }

    const targetRotX = 0.36 + Math.sin(t * 1.25) * 0.055 + cursorPushZ;
    const targetRotY = -0.48 + Math.cos(t * 0.85) * 0.07 + cursorPushX * 0.6;
    const targetRotZ = -0.24 + Math.cos(t * 1.1) * 0.06 - cursorPushX;

    ballGroupRef.current.rotation.x = THREE.MathUtils.damp(
      ballGroupRef.current.rotation.x,
      targetRotX,
      4.5,
      dt
    );
    ballGroupRef.current.rotation.y = THREE.MathUtils.damp(
      ballGroupRef.current.rotation.y,
      targetRotY,
      4.5,
      dt
    );
    ballGroupRef.current.rotation.z = THREE.MathUtils.damp(
      ballGroupRef.current.rotation.z,
      targetRotZ,
      4.5,
      dt
    );
  });

  if (beachBallCfg.enabled === false) return null;

  return (
    <group
      ref={ballGroupRef}
      name="summer-beach-ball-around-A-T"
      position={position}
      rotation={[0.36, -0.48, -0.24]}
      scale={radius}
    >
      <mesh
        geometry={ballGeometry}
        material={ballMaterial}
        castShadow
        receiveShadow
      />
      <mesh position={[0, 1.005, 0]} material={valveMaterial}>
        <cylinderGeometry args={[0.045, 0.055, 0.035, 12]} />
      </mesh>
    </group>
  );
}

function buildSandShader({
  halfWidth,
  halfDepth,
  letterCount,
  beachBallPos,
  beachBallRadius,
  palette,
  initialReveal,
}) {
  return {
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: initialReveal },
      uHalfWidth: { value: halfWidth },
      uHalfDepth: { value: halfDepth },
      uLetterCount: { value: letterCount },
      uBeachBallXZ: {
        value: new THREE.Vector2(beachBallPos[0], beachBallPos[2]),
      },
      uBeachBallRadius: { value: beachBallRadius },
      uGroundBase: { value: new THREE.Color(palette.groundBase || '#F6EFE2') },
      uSandLight: { value: new THREE.Color(palette.sandLight || '#FCE0A2') },
      uSandMid: { value: new THREE.Color(palette.sandMid || '#E0AC58') },
      uSandDeep: { value: new THREE.Color(palette.sandDeep || '#B37A2E') },
    },
    vertexShader: buildGroundVertexShader('vLocalElevation'),
    fragmentShader: `
      uniform float uTime;
      uniform float uReveal;
      uniform float uHalfWidth;
      uniform float uHalfDepth;
      uniform float uLetterCount;
      uniform vec2 uBeachBallXZ;
      uniform float uBeachBallRadius;
      uniform vec3 uGroundBase;
      uniform vec3 uSandLight;
      uniform vec3 uSandMid;
      uniform vec3 uSandDeep;
      varying vec3 vWorldPos;
      varying vec3 vNormalWorld;
      varying float vLocalElevation;
      ${GLSL_NOISE_2D}

      void main() {
        vec2 xz = vWorldPos.xz;
        float n1 = fbm(xz * 0.85 + vec2(0.5, -0.3));
        float n2 = fbm(xz * 2.5 - vec2(1.1, 0.7));

        float ripplePhase = xz.x * 15.0 + xz.y * 8.5 + n1 * 4.6;
        float windRipple = 0.5 + 0.5 * sin(ripplePhase);
        float sharpCrest = pow(windRipple, 1.85);

        vec2 rightDuneD = vec2((xz.x - uHalfWidth * 0.48) / (uHalfWidth * 0.68), (xz.y - 0.34) / 0.96);
        float rightSandZone = exp(-dot(rightDuneD, rightDuneD) * 1.05) * 1.28;

        vec2 leftDuneD = vec2((xz.x + uHalfWidth * 0.42) / (uHalfWidth * 0.72), (xz.y - 0.24) / 0.78);
        float leftSandZone = exp(-dot(leftDuneD, leftDuneD) * 1.35) * 0.96;

        float centerStripX = 1.0 - smoothstep(uHalfWidth * 0.92, uHalfWidth * 1.22, abs(xz.x));
        float centerStripZ = 1.0 - smoothstep(uHalfDepth * 0.6, uHalfDepth * 3.8, abs(xz.y - 0.14));
        float baseSandStrip = centerStripX * centerStripZ * 0.92;

        float zoneEnvelope = max(rightSandZone, max(leftSandZone, baseSandStrip));
        float sandMask = smoothstep(0.14, 0.56, zoneEnvelope * (0.64 + n1 * 0.62));

        float heightFactor = clamp(vLocalElevation * 4.5, 0.0, 1.0);
        vec3 sandCol = mix(uSandDeep, uSandMid, smoothstep(0.0, 0.55, sharpCrest * 0.6 + heightFactor * 0.4));
        sandCol = mix(sandCol, uSandLight, pow(sharpCrest, 2.0) * 0.78 + heightFactor * 0.28);

        vec3 sunDir = normalize(vec3(0.28, 0.86, 0.42));
        float ndl = clamp(dot(vNormalWorld, sunDir), 0.0, 1.0);
        float slopeHighlight = smoothstep(0.45, 0.98, ndl);
        float grain = valueNoise(xz * 78.0);
        float coarseGrain = valueNoise(xz * 26.0);

        sandCol = mix(sandCol * 0.82, sandCol * 1.12, slopeHighlight);
        sandCol += (grain - 0.5) * 0.065 + (coarseGrain - 0.5) * 0.045;

        float sparkleCell = hash21(floor(xz * 56.0));
        float sparkleTwinkle = step(0.958, sparkleCell) * (0.5 + 0.5 * sin(uTime * 3.4 + sparkleCell * 62.0));
        sandCol += vec3(1.0, 0.98, 0.88) * sparkleTwinkle * 0.34 * sandMask;

        float letterSpanX = 1.0 - smoothstep(uHalfWidth * 0.84, uHalfWidth * 1.06, abs(xz.x));
        float letterSpanZ = 1.0 - smoothstep(uHalfDepth * 0.42, uHalfDepth * 2.8, abs(xz.y));
        float letterWave = 0.76 + 0.24 * cos((xz.x / max(uHalfWidth, 1.0)) * uLetterCount * 3.14159);
        float letterShadow = letterSpanX * letterSpanZ * letterWave;

        float ballDist = length((xz - uBeachBallXZ) * vec2(1.0, 1.15));
        float ballShadow = (1.0 - smoothstep(uBeachBallRadius * 0.22, uBeachBallRadius * 1.48, ballDist)) * 0.76;

        float totalShadow = clamp(max(letterShadow * 0.48, ballShadow), 0.0, 1.0);
        vec3 shadowColor = mix(uGroundBase * 0.72, uSandDeep * 0.58, sandMask);

        vec3 surfaceCol = mix(uGroundBase, sandCol, sandMask * 0.98);
        surfaceCol = mix(surfaceCol, shadowColor, totalShadow);

        float patchAlpha = clamp(sandMask * 0.98 + totalShadow * 0.74, 0.0, 1.0);
        float radialCutoff = 1.0 - smoothstep(uHalfWidth * 1.4, uHalfWidth * 2.05, length(xz * vec2(0.78, 1.1)));
        float finalAlpha = patchAlpha * radialCutoff;

        surfaceCol = pow(max(surfaceCol, vec3(0.0)), vec3(1.0 / 2.2));
        gl_FragColor = vec4(surfaceCol, finalAlpha * uReveal);
      }
    `,
  };
}

function populateSandPebbles({
  mesh,
  pebbleCount,
  halfWidth,
  halfDepth,
  moundHeight,
  beachBallPos,
  beachBallRadius,
  sceneScale,
  palette,
}) {
  const dummy = new THREE.Object3D();
  const tempColor = new THREE.Color();

  const cSandLight = new THREE.Color(palette.sandLight || '#FCE0A2');
  const cSandMid = new THREE.Color(palette.sandMid || '#E0AC58');
  const cSandDeep = new THREE.Color(palette.sandDeep || '#B37A2E');
  const cShellCoral = new THREE.Color('#F4B393');
  const cShellIvory = new THREE.Color('#FFF6E5');

  for (let i = 0; i < pebbleCount; i++) {
    const r1 = hash2D(i * 1.73 + 0.5, 2.9);
    const r2 = hash2D(i * 3.19 + 1.4, 5.7);
    const r3 = hash2D(i * 4.81 + 2.8, 8.3);

    const angle = r2 * Math.PI * 2.0;
    let x;
    let z;

    if (r1 < 0.76) {
      const radius = Math.pow(r3, 0.68);
      x = halfWidth * 0.48 + Math.cos(angle) * radius * (halfWidth * 0.62);
      z = 0.3 + Math.sin(angle) * radius * 0.82;
    } else {
      const radius = Math.pow(r3, 0.72);
      x = -halfWidth * 0.42 + Math.cos(angle) * radius * (halfWidth * 0.58);
      z = 0.24 + Math.sin(angle) * radius * 0.56;
    }

    const distToBall = Math.hypot(x - beachBallPos[0], z - beachBallPos[2]);
    if (distToBall < beachBallRadius * 0.92) {
      x += (x >= beachBallPos[0] ? 1 : -1) * beachBallRadius * 0.88;
    }
    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.36) {
      z = z >= 0 ? halfDepth * 0.44 : -halfDepth * 0.44;
    }

    const y = sampleBeachElevation(x, z, halfWidth, halfDepth, moundHeight);
    const isClusterMound = i % 7 === 0;
    const scaleXZ =
      (isClusterMound ? 1.45 + r2 * 1.6 : 0.65 + r2 * 1.25) * sceneScale;
    const scaleY =
      (isClusterMound ? 0.75 + r3 * 0.9 : 0.5 + r3 * 0.85) * sceneScale;

    dummy.position.set(x, y + 0.002, z);
    dummy.rotation.set(
      (r1 - 0.5) * 0.35,
      r2 * Math.PI * 2.0,
      (r3 - 0.5) * 0.35
    );
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    if (r3 > 0.9) {
      tempColor.copy(cShellCoral).lerp(cShellIvory, 0.4);
    } else if (r3 > 0.82) {
      tempColor.copy(cShellIvory);
    } else if (r3 > 0.42) {
      tempColor.copy(cSandLight).lerp(cSandMid, r2);
    } else {
      tempColor.copy(cSandMid).lerp(cSandDeep, r1 * 0.75);
    }
    mesh.setColorAt(i, tempColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function SummerBeachEnvironment({
  seasonConfig,
  typographyBounds,
  pointerWorldRef,
  depthProgressRef,
}) {
  const sandGroupRef = useRef(null);
  const sandMaterialRef = useRef(null);
  const sandPebbleRef = useRef(null);

  const { palette, environment = {} } = seasonConfig;
  const groundCfg = environment.ground || {};
  const sunshineCfg = environment.sunshine || {};
  const sandCfg = environment.sand || {};
  const sunglassesCfg = environment.sunglasses || {};
  const beachBallCfg = environment.beachBall || {};

  const typoWidth = typographyBounds?.width ?? 5.2;
  const typoHeight = typographyBounds?.height ?? 1.15;
  const typoDepth = typographyBounds?.depth ?? 0.24;
  const typoBottomY = typographyBounds?.bottomY ?? -0.44;
  const typoTopY = typographyBounds?.topY ?? 0.68;
  const letterCount = typographyBounds?.letterCount ?? 4;

  const sceneScale = THREE.MathUtils.clamp(typoHeight / 1.12, 0.78, 1.25);
  const halfWidth = typoWidth * 0.5;
  const halfDepth = Math.max(typoDepth * 0.5, 0.12);
  const moundHeight = (groundCfg.moundHeight ?? 0.24) * sceneScale;
  const baseGroundY = typoBottomY - 0.012;

  const groundWidth = Math.max(
    typoWidth * (groundCfg.widthMultiplier ?? 4.5),
    groundCfg.minWidth ?? 26.0
  );
  const groundDepth = groundCfg.depth ?? 14.0;

  const hCenterX = typographyBounds?.hCenterX ?? -halfWidth * 0.74;
  const hTopY = typographyBounds?.hTopY ?? typoTopY;
  const hWidth = typographyBounds?.hWidth ?? typoWidth * 0.21;

  const sunglassesRestPos = useMemo(
    () => [
      hCenterX,
      hTopY - 0.088 * sceneScale,
      halfDepth + 0.028 * sceneScale,
    ],
    [hCenterX, hTopY, halfDepth, sceneScale]
  );

  const sunglassesScale = useMemo(
    () => THREE.MathUtils.clamp((hWidth * 1.02) / 0.51, 1.05, 2.35),
    [hWidth]
  );

  const beachBallRadius = (beachBallCfg.radius ?? 0.27) * sceneScale;
  const beachBallPos = useMemo(() => {
    const bx = halfWidth * 0.52;
    const bz = halfDepth * 1.18 + 0.24;
    const by =
      sampleBeachElevation(bx, bz, halfWidth, halfDepth, moundHeight) +
      beachBallRadius * 0.74;
    return [bx, by, bz];
  }, [halfWidth, halfDepth, moundHeight, beachBallRadius]);

  const sandTerrainGeometry = useMemo(
    () =>
      createDisplacedTerrainGeometry({
        width: groundWidth,
        depth: groundDepth,
        segmentsX: 136,
        segmentsZ: 88,
        sampleElevation: (vx, vz) => {
          let wy = sampleBeachElevation(
            vx,
            vz,
            halfWidth,
            halfDepth,
            moundHeight
          );
          const dxBall = vx - beachBallPos[0];
          const dzBall = vz - beachBallPos[2];
          const distBall = Math.sqrt(dxBall * dxBall + dzBall * dzBall);
          if (distBall < beachBallRadius * 1.6) {
            const rimWave = Math.sin(
              (distBall / (beachBallRadius * 1.6)) * Math.PI
            );
            wy +=
              distBall < beachBallRadius * 0.88
                ? -0.025 * sceneScale
                : rimWave * 0.028 * sceneScale;
          }
          return wy;
        },
      }),
    [
      groundWidth,
      groundDepth,
      halfWidth,
      halfDepth,
      moundHeight,
      beachBallPos,
      beachBallRadius,
      sceneScale,
    ]
  );

  const sandShader = useMemo(
    () =>
      buildSandShader({
        halfWidth,
        halfDepth,
        letterCount,
        beachBallPos,
        beachBallRadius,
        palette,
        initialReveal: computeDimensionReveals(depthProgressRef?.current ?? 1)
          .worldReveal,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [halfWidth, halfDepth, letterCount, beachBallPos, beachBallRadius, palette]
  );

  const pebbleCount = sandCfg.pebbleCount ?? 480;
  const { pebbleGeo, pebbleMaterial } = useMemo(() => {
    const geo = new THREE.DodecahedronGeometry(0.016, 1);
    geo.scale(1.35, 0.58, 1.15);

    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.74,
      metalness: 0.02,
    });

    return { pebbleGeo: geo, pebbleMaterial: mat };
  }, []);

  useEffect(() => {
    return () => {
      sandTerrainGeometry.dispose();
      pebbleGeo.dispose();
      pebbleMaterial.dispose();
    };
  }, [sandTerrainGeometry, pebbleGeo, pebbleMaterial]);

  useLayoutEffect(() => {
    if (!sandPebbleRef.current) return;
    populateSandPebbles({
      mesh: sandPebbleRef.current,
      pebbleCount,
      halfWidth,
      halfDepth,
      moundHeight,
      beachBallPos,
      beachBallRadius,
      sceneScale,
      palette,
    });
  }, [
    pebbleCount,
    halfWidth,
    halfDepth,
    moundHeight,
    beachBallPos,
    beachBallRadius,
    sceneScale,
    palette,
  ]);

  useGroundRevealSync(sandGroupRef, sandMaterialRef, depthProgressRef);

  useFrame((state) => {
    applyGroundRevealFrame(
      sandGroupRef,
      sandMaterialRef,
      depthProgressRef,
      state.clock.getElapsedTime()
    );
  });

  return (
    <group name="summer-beach-environment">
      <SummerSunshine
        sunshineCfg={sunshineCfg}
        depthProgressRef={depthProgressRef}
      />

      <SummerSunglasses
        restPosition={sunglassesRestPos}
        scale={sunglassesScale}
        sunglassesCfg={sunglassesCfg}
        depthProgressRef={depthProgressRef}
      />

      <group ref={sandGroupRef} position={[0, baseGroundY, 0]}>
        <mesh
          geometry={sandTerrainGeometry}
          position={[0, 0, -0.35]}
          receiveShadow
          renderOrder={-1}
        >
          <shaderMaterial
            ref={sandMaterialRef}
            uniforms={sandShader.uniforms}
            vertexShader={sandShader.vertexShader}
            fragmentShader={sandShader.fragmentShader}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <instancedMesh
          ref={sandPebbleRef}
          args={[pebbleGeo, pebbleMaterial, pebbleCount]}
          frustumCulled={false}
          receiveShadow
        />
      </group>

      <group position={[0, baseGroundY, 0]}>
        <SummerBeachBall
          position={beachBallPos}
          radius={beachBallRadius}
          beachBallCfg={beachBallCfg}
          pointerWorldRef={pointerWorldRef}
          depthProgressRef={depthProgressRef}
        />
      </group>
    </group>
  );
}
