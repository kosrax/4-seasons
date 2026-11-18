import React, { useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  hash2D,
  fbm2D,
  smoothstep,
  GLSL_NOISE_2D,
  buildGroundVertexShader,
  createDisplacedTerrainGeometry,
  createGrassStripGeometry,
} from '../../utils/proceduralNoise.js';
import {
  computeDimensionReveals,
  syncObjectToTypographyAnchor,
} from '../../utils/dimensionReveal.js';
import {
  useGroundRevealSync,
  applyGroundRevealFrame,
  usePerchedPropRevealSync,
} from '../../hooks/useEnvironmentReveal.js';

/**
 * Computes sculpted asymmetric snowdrift elevation:
 * - Smooth wind-swept snow bank on the right side (under 'Z', 'E', 'N')
 * - Soft snow drift hugging the base of the right-side letters
 * - Compact snow mound on the far-left edge beside 'F'
 */
function sampleWinterElevation(
  x,
  z,
  halfWidth,
  halfDepth,
  moundHeight = 0.14
) {
  // 1. Primary right-side snowdrift (under 'Z', 'E', 'N' and right foreground)
  const rightDx = (x - halfWidth * 0.52) / (halfWidth * 0.54);
  const rightDz = (z - 0.34) / 0.8;
  const rightDrift =
    Math.exp(-(rightDx * rightDx + rightDz * rightDz) * 1.25) *
    moundHeight *
    1.12;

  // 2. Snow bank drifting directly against the base of 'Z', 'E', 'N'
  const rightBankDx = (x - halfWidth * 0.48) / (halfWidth * 0.45);
  const rightBankDz = (z - 0.05) / (halfDepth * 2.6);
  const rightLetterBank =
    Math.exp(-(rightBankDx * rightBankDx + rightBankDz * rightBankDz) * 1.45) *
    (moundHeight * 0.65);

  // 3. Soft snow pillow on the far-left flank beside 'F'
  const leftFlankDx = (x + halfWidth * 0.96) / (halfWidth * 0.26);
  const leftFlankDz = (z + 0.06) / 0.44;
  const leftDrift =
    Math.exp(-(leftFlankDx * leftFlankDx + leftFlankDz * leftFlankDz) * 1.85) *
    (moundHeight * 0.48);

  // 4. Smooth wind-carved sastrugi snow waves
  const envelope = Math.max(rightDrift, Math.max(rightLetterBank, leftDrift));
  const snowWave =
    Math.sin(x * 3.4 + z * 2.6 + fbm2D(x * 1.1, z * 1.1) * 2.0) *
    (moundHeight * 0.14) *
    smoothstep(0.01, 0.1, envelope);

  return rightDrift + rightLetterBank + leftDrift + snowWave;
}

function sampleWinterDensity(x, z, halfWidth, halfDepth) {
  const rightCoreX = (x - halfWidth * 0.52) / (halfWidth * 0.48);
  const rightCoreZ = (z - 0.3) / 0.72;
  const rightCore =
    Math.exp(-(rightCoreX * rightCoreX + rightCoreZ * rightCoreZ) * 1.3) *
    1.12;

  const rightBaseX = (x - halfWidth * 0.48) / (halfWidth * 0.4);
  const rightBaseZ = z / (halfDepth * 2.4);
  const rightBase =
    Math.exp(-(rightBaseX * rightBaseX + rightBaseZ * rightBaseZ) * 1.5) * 0.92;

  const leftAccentX = (x + halfWidth * 0.96) / (halfWidth * 0.24);
  const leftAccentZ = (z + 0.06) / 0.38;
  const leftAccent =
    Math.exp(-(leftAccentX * leftAccentX + leftAccentZ * leftAccentZ) * 1.95) *
    0.8;

  const fbmMod = fbm2D(x * 1.4 + 4.1, z * 1.55 + 2.3);
  return THREE.MathUtils.clamp(
    Math.max(rightCore, rightBase, leftAccent) * (0.62 + fbmMod * 0.58),
    0.0,
    1.0
  );
}

/**
 * Builds a sharp 6-sided hexagonal glacial ice crystal spire with a faceted pyramidal point.
 * Origin is at y = 0 so crystals sprout cleanly from the snowdrift.
 */
function createHexIceCrystalGeometry() {
  const sides = 6;
  const baseRadius = 0.018;
  const midRadius = 0.0155;
  const shoulderY = 0.135;
  const tipY = 0.185;

  const positions = [];
  const uvs = [];
  const indices = [];

  // Ring 0: Base at y = 0
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2.0;
    positions.push(
      Math.cos(angle) * baseRadius,
      0.0,
      Math.sin(angle) * baseRadius
    );
    uvs.push(i / sides, 0.0);
  }

  // Ring 1: Crystal prism shoulder at y = shoulderY
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * Math.PI * 2.0;
    positions.push(
      Math.cos(angle) * midRadius,
      shoulderY,
      Math.sin(angle) * midRadius
    );
    uvs.push(i / sides, 0.72);
  }

  // Ring 2: Apex pyramid tip at y = tipY
  for (let i = 0; i <= sides; i++) {
    positions.push(0.0, tipY, 0.0);
    uvs.push(i / sides, 1.0);
  }

  const stride = sides + 1;
  // Prism shaft faces
  for (let i = 0; i < sides; i++) {
    const a = i;
    const b = i + 1;
    const c = stride + i;
    const d = stride + i + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  // Pyramidal termination facets
  for (let i = 0; i < sides; i++) {
    const a = stride + i;
    const b = stride + i + 1;
    const c = stride * 2 + i;
    indices.push(a, c, b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Custom shader for glacial ice crystals:
 * Adds deep arctic blue internal core shading and bright crystalline Fresnel rim facets.
 */
function applyIceCrystalShader(material) {
  material.customProgramCacheKey = () => 'winter-ice-crystal-v1';

  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `
      varying float vCrystalHeight;
      varying vec3 vViewPosIce;
      varying vec3 vNormalIce;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vCrystalHeight = clamp(uv.y, 0.0, 1.0);
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      #include <project_vertex>
      vViewPosIce = -mvPosition.xyz;
      vNormalIce = normalize(normalMatrix * objectNormal);
      `
    );

    shader.fragmentShader =
      `
      varying float vCrystalHeight;
      varying vec3 vViewPosIce;
      varying vec3 vNormalIce;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // Deep glacial blue base transitioning to frosted white crystalline tips
      vec3 deepGlacier = vec3(0.46, 0.68, 0.88);
      vec3 frostTip = vec3(0.96, 0.99, 1.0);
      diffuseColor.rgb = mix(deepGlacier, diffuseColor.rgb, smoothstep(0.0, 0.65, vCrystalHeight));
      diffuseColor.rgb = mix(diffuseColor.rgb, frostTip, smoothstep(0.68, 1.0, vCrystalHeight) * 0.65);

      // Sharp crystalline facet rim glow
      vec3 viewDirI = normalize(vViewPosIce);
      vec3 normI = normalize(vNormalIce);
      float facetRim = pow(1.0 - abs(dot(viewDirI, normI)), 2.1);
      diffuseColor.rgb += vec3(0.85, 0.95, 1.0) * facetRim * 0.35;
      `
    );
  };

  material.needsUpdate = true;
}

/**
 * Subtle winter breeze shader for frosted dormant reeds.
 */
function applyFrostedReedShader(material, sharedUniforms) {
  material.customProgramCacheKey = () => 'winter-frosted-reed-v1';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);

    shader.vertexShader =
      `
      uniform float uTime;
      uniform vec3 uPointer;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      uniform float uWindWaveLength;
      uniform float uCursorBendRadius;
      uniform float uCursorBendStrength;
      varying float vBladeHeight;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float hFactor = clamp(uv.y, 0.0, 1.0);
      float bendWeight = hFactor * hFactor;
      vBladeHeight = hFactor;

      vec4 instWorldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float waveCoord = (instWorldPos.x * 0.75 + instWorldPos.z * 0.45) * uWindWaveLength;
      float gust = sin(uTime * uWindSpeed - waveCoord);

      float swayX = gust * uWindStrength * bendWeight;
      float swayZ = cos(uTime * (uWindSpeed * 0.8) - waveCoord * 0.8) * (uWindStrength * 0.6) * bendWeight;

      vec2 toBlade = instWorldPos.xz - uPointer.xz;
      float pointerDist = length(toBlade);
      float proximity = smoothstep(uCursorBendRadius, 0.0, pointerDist);
      float pointerPush = proximity * uCursorBendStrength * bendWeight;
      vec2 pushDir = pointerDist > 0.001 ? (toBlade / pointerDist) : vec2(0.0, 1.0);

      transformed.x += swayX + pushDir.x * pointerPush;
      transformed.z += swayZ + pushDir.y * pointerPush;
      `
    );

    shader.fragmentShader =
      `
      varying float vBladeHeight;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float rootShade = mix(0.55, 1.0, smoothstep(0.0, 0.85, vBladeHeight));
      diffuseColor.rgb *= rootShade;
      // Rime frost accumulation on upper reed tips
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 1.0), smoothstep(0.55, 1.0, vBladeHeight) * 0.45);
      `
    );
  };

  material.needsUpdate = true;
}

/**
 * 3D Frosted Snow Cap & Hanging Icicle Cluster perched on top of the first letter ('F') of FROZEN.
 */
function PerchedFrostIcicles({
  restPosition,
  scale = 1.0,
  width = 0.5,
  depthProgressRef,
}) {
  const rootGroupRef = useRef(null);
  const localPoint = useMemo(() => new THREE.Vector3(), []);
  const typoQuat = useMemo(() => new THREE.Quaternion(), []);
  const identityQuat = useMemo(() => new THREE.Quaternion(), []);

  const { snowCapGeo, icicleGeos, snowMaterial, iceMaterial } = useMemo(() => {
    // Soft sculpted snow pillow resting along the top horizontal bar of 'F'
    const cap = new THREE.BoxGeometry(width, 0.045, 0.22, 12, 4, 6);
    const pos = cap.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const nx = vx / (width * 0.5);
      const nz = vz / 0.11;
      const dome = Math.max(0, 1.0 - (nx * nx * 0.72 + nz * nz * 0.75));
      if (vy > 0) {
        pos.setY(i, vy * (0.35 + dome * 1.15));
      } else {
        // Slight overhanging snow lip along the front edge
        const overhang = nz > 0.4 ? Math.sin((nx + 1.0) * 4.5) * 0.012 : 0.0;
        pos.setY(i, vy - Math.max(0, overhang));
      }
    }
    cap.computeVertexNormals();

    // 5 tapered hanging icicle cones of varied lengths
    const icicles = [
      { x: -width * 0.36, len: 0.13, rad: 0.014, z: 0.088 },
      { x: -width * 0.16, len: 0.085, rad: 0.011, z: 0.092 },
      { x: width * 0.06, len: 0.155, rad: 0.015, z: 0.086 },
      { x: width * 0.25, len: 0.095, rad: 0.012, z: 0.09 },
      { x: width * 0.4, len: 0.125, rad: 0.013, z: 0.085 },
    ].map((spec) => {
      const cone = new THREE.ConeGeometry(spec.rad, spec.len, 6, 1);
      // Flip cone so point hangs downward from y = 0
      cone.rotateX(Math.PI);
      cone.translate(spec.x, -spec.len * 0.5 - 0.01, spec.z);
      return cone;
    });

    const sMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#F7FBFF'),
      roughness: 0.45,
      metalness: 0.01,
      sheen: 0.85,
      sheenColor: new THREE.Color('#CBE4FA'),
    });

    const iMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#CBE6FA'),
      emissive: new THREE.Color('#183652'),
      emissiveIntensity: 0.14,
      roughness: 0.06,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      reflectivity: 0.96,
      transparent: true,
      opacity: 0.9,
    });

    return {
      snowCapGeo: cap,
      icicleGeos: icicles,
      snowMaterial: sMat,
      iceMaterial: iMat,
    };
  }, [width]);

  useEffect(() => {
    return () => {
      snowCapGeo.dispose();
      icicleGeos.forEach((g) => g.dispose());
      snowMaterial.dispose();
      iceMaterial.dispose();
    };
  }, [snowCapGeo, icicleGeos, snowMaterial, iceMaterial]);

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
      orientationQuat: identityQuat,
      tempPoint: localPoint,
      tempQuat: typoQuat,
    });
  });

  return (
    <group
      ref={rootGroupRef}
      name="winter-perched-frost-icicles"
      position={restPosition}
      scale={scale}
    >
      <mesh
        geometry={snowCapGeo}
        material={snowMaterial}
        castShadow
        receiveShadow
      />
      {icicleGeos.map((geo, idx) => (
        <mesh key={idx} geometry={geo} material={iceMaterial} castShadow />
      ))}
    </group>
  );
}

/**
 * Builds the custom shader for glacial snowdrifts and ice crystal micro-glints.
 */
function buildWinterFloorShader({
  halfWidth,
  halfDepth,
  letterCount,
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
      uGroundBase: {
        value: new THREE.Color(palette.groundBase || '#EBF2F8'),
      },
      uSnowCrest: {
        value: new THREE.Color('#FFFFFF'),
      },
      uSnowMid: {
        value: new THREE.Color(palette.groundMossFresh || '#C8DCEF'),
      },
      uSnowShadow: {
        value: new THREE.Color(palette.groundMossDeep || '#7A9AB8'),
      },
    },
    vertexShader: buildGroundVertexShader('vSnowElevation'),
    fragmentShader: `
      uniform float uTime;
      uniform float uReveal;
      uniform float uHalfWidth;
      uniform float uHalfDepth;
      uniform float uLetterCount;
      uniform vec3 uGroundBase;
      uniform vec3 uSnowCrest;
      uniform vec3 uSnowMid;
      uniform vec3 uSnowShadow;
      varying vec3 vWorldPos;
      varying vec3 vNormalWorld;
      varying float vSnowElevation;

      ${GLSL_NOISE_2D}

      void main() {
        vec2 xz = vWorldPos.xz;
        float n1 = fbm(xz * 0.85 + vec2(0.2, -0.3));
        float n2 = fbm(xz * 2.3 - vec2(1.1, 0.7));

        vec2 rightD = vec2((xz.x - uHalfWidth * 0.52) / (uHalfWidth * 0.55), (xz.y - 0.34) / 0.84);
        float rightZone = exp(-dot(rightD, rightD) * 1.15) * 1.15;

        vec2 midTrailD = vec2((xz.x + uHalfWidth * 0.14) / (uHalfWidth * 0.46), (xz.y - 0.36) / 0.5);
        float midTrailZone = exp(-dot(midTrailD, midTrailD) * 1.8) * 0.46;

        vec2 leftFlankD = vec2((xz.x + uHalfWidth * 0.96) / (uHalfWidth * 0.26), (xz.y + 0.06) / 0.4);
        float leftFlankZone = exp(-dot(leftFlankD, leftFlankD) * 1.85) * 0.86;

        float zoneEnvelope = max(rightZone, max(midTrailZone, leftFlankZone));
        float snowMask = smoothstep(0.2, 0.64, zoneEnvelope * (0.56 + n1 * 0.72));

        float heightMix = clamp(vSnowElevation * 5.2 + n2 * 0.35, 0.0, 1.0);
        vec3 snowCol = mix(uSnowMid, uSnowCrest, smoothstep(0.22, 0.82, heightMix));

        vec3 lightDir = normalize(vec3(0.45, 0.85, 0.4));
        float ndl = clamp(dot(vNormalWorld, lightDir), 0.0, 1.0);
        snowCol = mix(snowCol * 0.88, uSnowCrest, smoothstep(0.45, 0.98, ndl) * 0.75);

        float sparkleCell = hash21(floor(xz * 62.0));
        float sparkle = step(0.955, sparkleCell) * (0.5 + 0.5 * sin(uTime * 2.8 + sparkleCell * 58.0));
        snowCol += vec3(0.85, 0.96, 1.0) * sparkle * 0.36 * snowMask;

        float letterSpanX = 1.0 - smoothstep(uHalfWidth * 0.84, uHalfWidth * 1.05, abs(xz.x));
        float letterSpanZ = 1.0 - smoothstep(uHalfDepth * 0.4, uHalfDepth * 2.8, abs(xz.y));
        float letterWave = 0.75 + 0.25 * cos((xz.x / max(uHalfWidth, 1.0)) * uLetterCount * 3.14159);
        float contactShadow = letterSpanX * letterSpanZ * letterWave;

        vec3 surfaceCol = mix(uGroundBase, snowCol, snowMask * 0.96);
        surfaceCol = mix(surfaceCol, uSnowShadow, contactShadow * 0.36);

        float patchAlpha = clamp(snowMask * 0.96 + contactShadow * 0.55, 0.0, 1.0);
        float radialCutoff = 1.0 - smoothstep(uHalfWidth * 1.28, uHalfWidth * 1.88, length(xz * vec2(0.8, 1.15)));
        float finalAlpha = patchAlpha * radialCutoff;

        surfaceCol = pow(max(surfaceCol, vec3(0.0)), vec3(1.0 / 2.2));
        gl_FragColor = vec4(surfaceCol, finalAlpha * uReveal);
      }
    `,
  };
}

/**
 * Populates instanced frosted silver-blue dormant reeds across the snowdrifts.
 */
function populateFrostedReeds({
  mesh,
  reedCount,
  grassCfg,
  halfWidth,
  halfDepth,
  moundHeight,
  sceneScale,
  dummy,
  tempColor,
}) {
  if (!mesh) return;

  const cSilver = new THREE.Color(grassCfg.colors?.sage || '#96AFC4');
  const cIceBlue = new THREE.Color(grassCfg.colors?.freshGreen || '#B8CEE0');
  const cFrostWhite = new THREE.Color(grassCfg.colors?.yellowGreen || '#E2EFFA');
  const cSlate = new THREE.Color(grassCfg.colors?.deepMoss || '#6D869C');

  const minH = (grassCfg.minHeight ?? 0.05) * sceneScale;
  const maxH = (grassCfg.maxHeight ?? 0.21) * sceneScale;
  const maxOverlapH = (grassCfg.letterOverlapMax ?? 0.18) * sceneScale;

  let placed = 0;
  let attempt = 0;

  while (placed < reedCount && attempt < reedCount * 5) {
    attempt++;
    const tuftSeed = Math.floor(placed / 6);
    const bladeInTuft = placed % 6;

    const r1 = hash2D(tuftSeed * 1.13 + attempt * 0.07, 0.5);
    const r2 = hash2D(tuftSeed * 2.39 + 1.7, attempt * 0.11);
    const r3 = hash2D(tuftSeed * 3.73 + 4.2, bladeInTuft * 1.91);

    let tuftX;
    let tuftZ;

    if (r1 < 0.62) {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(hash2D(tuftSeed, 3.9), 0.68);
      tuftX = halfWidth * 0.52 + Math.cos(angle) * radius * (halfWidth * 0.48);
      tuftZ = 0.32 + Math.sin(angle) * radius * 0.68;
    } else if (r1 < 0.9) {
      tuftX = halfWidth * 0.16 + hash2D(tuftSeed, 8.2) * (halfWidth * 0.8);
      const sideSign = hash2D(tuftSeed, 9.1) > 0.28 ? 1.0 : -1.0;
      tuftZ =
        sideSign *
        (halfDepth * 0.38 + Math.pow(hash2D(tuftSeed, 5.3), 1.4) * 0.42);
    } else {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(hash2D(tuftSeed, 4.4), 0.72);
      tuftX =
        -halfWidth * 0.96 + Math.cos(angle) * radius * (halfWidth * 0.22);
      tuftZ = -0.05 + Math.sin(angle) * radius * 0.32;
    }

    const density = sampleWinterDensity(tuftX, tuftZ, halfWidth, halfDepth);
    if (density < 0.16 && attempt < reedCount * 4) continue;

    const tuftAngle =
      (bladeInTuft / 6) * Math.PI * 2.0 + hash2D(placed, 2.1) * 0.5;
    const tuftSpread =
      (0.01 + hash2D(placed, 4.8) * 0.032) *
      sceneScale *
      (bladeInTuft > 0 ? 1 : 0);
    const x = tuftX + Math.cos(tuftAngle) * tuftSpread;
    let z = tuftZ + Math.sin(tuftAngle) * tuftSpread;

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.36) {
      z = z >= 0 ? halfDepth * 0.4 : -halfDepth * 0.4;
    }

    const terrainY = sampleWinterElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );

    let bladeH =
      minH + Math.pow(density, 0.85) * (maxH - minH) * (0.5 + r3 * 0.55);

    if (x < halfWidth * 0.12 && x > -halfWidth * 0.84) {
      bladeH = Math.min(bladeH, minH * 1.1);
    } else if (x >= halfWidth * 0.12 && Math.abs(z) < halfDepth * 1.75) {
      bladeH = Math.min(bladeH, maxOverlapH * (0.65 + r3 * 0.4));
    }

    const widthScale = (0.8 + hash2D(placed, 12.4) * 0.4) * sceneScale;
    dummy.position.set(x, terrainY - 0.004, z);
    dummy.rotation.set(
      0.08 + hash2D(placed, 3.1) * 0.18,
      tuftAngle + (hash2D(placed, 7.7) - 0.5) * 0.4,
      (hash2D(placed, 5.9) - 0.5) * 0.18
    );
    dummy.scale.set(widthScale, bladeH, widthScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);

    tempColor.copy(cSilver).lerp(cIceBlue, r2);
    if (r3 > 0.65) tempColor.lerp(cFrostWhite, (r3 - 0.65) * 1.5);
    else if (r3 < 0.25) tempColor.lerp(cSlate, (0.25 - r3) * 1.4);
    mesh.setColorAt(placed, tempColor);

    placed++;
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * Populates clustered 3D hexagonal ice crystals around the right-side letters and left flank.
 */
function populateIceCrystals({
  mesh,
  crystalCount,
  crystalsCfg,
  typoWidth,
  halfWidth,
  halfDepth,
  moundHeight,
  sceneScale,
  dummy,
  tempColor,
}) {
  if (!mesh) return;

  const crystalPalette = crystalsCfg.palette || {};
  const cIceWhite = new THREE.Color(crystalPalette.white || '#F5FAFF');
  const cGlacier = new THREE.Color(crystalPalette.glacier || '#B8DCF7');
  const cArctic = new THREE.Color(crystalPalette.arctic || '#82B9E6');

  const clusterSpan = Math.max(typoWidth / 4.5, 0.85);
  const crystalClusters = [
    { x: halfWidth * 0.24, z: halfDepth * 0.9, radius: 0.2 * clusterSpan },
    { x: halfWidth * 0.52, z: halfDepth * 0.95, radius: 0.24 * clusterSpan },
    { x: halfWidth * 0.8, z: halfDepth * 0.8, radius: 0.22 * clusterSpan },
    { x: halfWidth * 0.6, z: 0.46, radius: 0.24 * clusterSpan },
    { x: halfWidth * 0.48, z: -halfDepth * 0.95, radius: 0.22 * clusterSpan },
    { x: -halfWidth * 0.96, z: -0.05, radius: 0.16 * clusterSpan },
  ];

  for (let i = 0; i < crystalCount; i++) {
    const clusterIndex = i % 9 === 0 ? 5 : i % (crystalClusters.length - 1);
    const cluster = crystalClusters[clusterIndex];

    const r1 = hash2D(i * 2.71 + 1.4, 3.8);
    const r2 = hash2D(i * 4.53 + 2.9, 7.1);
    const r3 = hash2D(i * 6.91 + 0.8, 5.4);

    const angle = r1 * Math.PI * 2.0;
    const dist = Math.pow(r2, 0.78) * cluster.radius;
    const x = cluster.x + Math.cos(angle) * dist;
    let z = cluster.z + Math.sin(angle) * dist;

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.38) {
      z = z >= 0 ? halfDepth * 0.44 : -halfDepth * 0.44;
    }

    const terrainY = sampleWinterElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );

    const centrality = 1.0 - dist / Math.max(cluster.radius, 0.01);
    const heightScale = (0.45 + centrality * 0.85 + r3 * 0.45) * sceneScale;
    const thicknessScale = (0.65 + centrality * 0.65 + r1 * 0.4) * sceneScale;

    const outwardYaw = Math.atan2(x - cluster.x, z - cluster.z);
    const splayTilt = (0.12 + (1.0 - centrality) * 0.48) * (0.8 + r2 * 0.4);

    dummy.position.set(x, terrainY - 0.008, z);
    dummy.rotation.set(0, outwardYaw + (r1 - 0.5) * 0.5, 0);
    dummy.rotateX(splayTilt);
    dummy.scale.set(thicknessScale, heightScale, thicknessScale);
    dummy.updateMatrix();

    mesh.setMatrixAt(i, dummy.matrix);

    if (r3 < 0.35) tempColor.copy(cIceWhite);
    else if (r3 < 0.75) tempColor.copy(cGlacier);
    else tempColor.copy(cArctic);
    mesh.setColorAt(i, tempColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * Complete Winter Frost Environment for "FROZEN":
 * - Asymmetric wind-carved snowdrifts focused on the right side ('Z', 'E', 'N')
 * - Sparkling snow shader with glacial blue shadow troughs & micro-crystal glints
 * - 145 instanced 3D hexagonal ice crystal spires sprouting around the letter bases
 * - 1,650 frosted silver-blue dormant grass reeds
 * - Sculpted snow pillow & hanging 3D icicles resting on top of the first letter 'F'
 */
export function WinterFrostEnvironment({
  seasonConfig,
  typographyBounds,
  pointerWorldRef,
  depthProgressRef,
}) {
  const groundGroupRef = useRef(null);
  const floorMaterialRef = useRef(null);
  const frostedReedRef = useRef(null);
  const iceCrystalRef = useRef(null);

  const { palette, environment = {} } = seasonConfig;
  const groundCfg = environment.ground || {};
  const grassCfg = environment.grass || {};
  const crystalsCfg = environment.crystals || {};
  const iciclesCfg = environment.icicles || {};

  const typoWidth = typographyBounds?.width ?? 5.4;
  const typoHeight = typographyBounds?.height ?? 1.1;
  const typoDepth = typographyBounds?.depth ?? 0.22;
  const typoBottomY = typographyBounds?.bottomY ?? -0.43;
  const typoTopY = typographyBounds?.topY ?? 0.67;
  const letterCount = typographyBounds?.letterCount ?? 6;

  const sceneScale = THREE.MathUtils.clamp(typoHeight / 0.72, 0.9, 1.85);
  const halfWidth = typoWidth * 0.5;
  const halfDepth = Math.max(typoDepth * 0.5, 0.11);
  const moundHeight =
    (groundCfg.moundHeight ?? 0.14) * (0.65 + sceneScale * 0.35);
  const baseGroundY = typoBottomY - 0.008;

  const groundWidth = Math.max(
    typoWidth * (groundCfg.widthMultiplier ?? 4.2),
    groundCfg.minWidth ?? 26.0
  );
  const groundDepth = groundCfg.depth ?? 14.0;

  // Position for the snow cap & icicles on top of the first letter ('F')
  const fCenterX = typographyBounds?.hCenterX ?? -halfWidth * 0.82;
  const fTopY = typographyBounds?.hTopY ?? typoTopY;
  const fWidth = typographyBounds?.hWidth ?? typoWidth * 0.16;

  const iciclesRestPos = useMemo(
    () => [fCenterX, fTopY + 0.012 * sceneScale, 0.0],
    [fCenterX, fTopY, sceneScale]
  );

  const sharedUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector3(999, 999, 999) },
      uWindSpeed: { value: grassCfg.windSpeed ?? 0.75 },
      uWindStrength: { value: grassCfg.windStrength ?? 0.022 },
      uWindWaveLength: { value: grassCfg.windWaveLength ?? 0.5 },
      uCursorBendRadius: { value: grassCfg.cursorBendRadius ?? 1.35 },
      uCursorBendStrength: { value: grassCfg.cursorBendStrength ?? 0.065 },
    }),
    [grassCfg]
  );

  // 1. Displaced Snowdrift Terrain Geometry
  const terrainGeometry = useMemo(
    () =>
      createDisplacedTerrainGeometry({
        width: groundWidth,
        depth: groundDepth,
        segmentsX: 120,
        segmentsZ: 76,
        zOffset: 0.35,
        sampleElevation: (vx, vz) =>
          sampleWinterElevation(vx, vz, halfWidth, halfDepth, moundHeight),
      }),
    [groundWidth, groundDepth, halfWidth, halfDepth, moundHeight]
  );

  useEffect(() => {
    return () => {
      terrainGeometry.dispose();
    };
  }, [terrainGeometry]);

  // 2. Glacial Snow & Crystal Sparkle Shader
  const floorShader = useMemo(
    () =>
      buildWinterFloorShader({
        halfWidth,
        halfDepth,
        letterCount,
        palette,
        initialReveal: computeDimensionReveals(depthProgressRef?.current ?? 1)
          .worldReveal,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [halfWidth, halfDepth, letterCount, palette]
  );

  // 3. Geometries & Materials for Hexagonal Ice Crystals and Frosted Reeds
  const { reedGeo, crystalGeo, reedMaterial, crystalMaterial } = useMemo(() => {
    const rGeo = createGrassStripGeometry({
      segments: 5,
      baseWidth: 0.0085,
      curveZ: 0.18,
      curvePower: 1.85,
      taperMode: 'power',
      taperPower: 1.35,
      taperTipReduction: 0.94,
      archDroop: 0,
    });
    const cGeo = createHexIceCrystalGeometry();

    const rMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    applyFrostedReedShader(rMat, sharedUniforms);

    const cMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#D6EEFF'),
      emissive: new THREE.Color('#14304A'),
      emissiveIntensity: 0.14,
      roughness: 0.08,
      metalness: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      sheen: 0.85,
      sheenColor: new THREE.Color('#FFFFFF'),
      reflectivity: 0.95,
    });
    applyIceCrystalShader(cMat);

    return {
      reedGeo: rGeo,
      crystalGeo: cGeo,
      reedMaterial: rMat,
      crystalMaterial: cMat,
    };
  }, [sharedUniforms]);

  useEffect(() => {
    return () => {
      reedGeo.dispose();
      crystalGeo.dispose();
      reedMaterial.dispose();
      crystalMaterial.dispose();
    };
  }, [reedGeo, crystalGeo, reedMaterial, crystalMaterial]);

  const reedCount = grassCfg.fineBladeCount ?? 1650;
  const crystalCount = crystalsCfg.count ?? 145;

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const tempColor = new THREE.Color();

    populateFrostedReeds({
      mesh: frostedReedRef.current,
      reedCount,
      grassCfg,
      halfWidth,
      halfDepth,
      moundHeight,
      sceneScale,
      dummy,
      tempColor,
    });

    populateIceCrystals({
      mesh: iceCrystalRef.current,
      crystalCount,
      crystalsCfg,
      typoWidth,
      halfWidth,
      halfDepth,
      moundHeight,
      sceneScale,
      dummy,
      tempColor,
    });
  }, [
    typoWidth,
    typoHeight,
    typoDepth,
    sceneScale,
    halfWidth,
    halfDepth,
    moundHeight,
    reedCount,
    crystalCount,
    grassCfg,
    crystalsCfg,
  ]);

  useGroundRevealSync(groundGroupRef, floorMaterialRef, depthProgressRef);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    applyGroundRevealFrame(groundGroupRef, floorMaterialRef, depthProgressRef, t);
    sharedUniforms.uTime.value = t;

    if (pointerWorldRef?.current) {
      sharedUniforms.uPointer.value.copy(pointerWorldRef.current);
    }
  });

  return (
    <group name="winter-frost-environment">
      {/* Frosted Snow Cap & Hanging 3D Icicles resting on top of the first letter 'F' */}
      {iciclesCfg.enabled !== false && (
        <PerchedFrostIcicles
          restPosition={iciclesRestPos}
          scale={1.0}
          width={fWidth}
          depthProgressRef={depthProgressRef}
        />
      )}

      {/* Snowdrift Floor & Crystal Spires Group anchored at the bottom bevel of FROZEN */}
      <group ref={groundGroupRef} position={[0, baseGroundY, 0]}>
        <mesh
          geometry={terrainGeometry}
          position={[0, 0, -0.35]}
          receiveShadow
          renderOrder={-1}
        >
          <shaderMaterial
            ref={floorMaterialRef}
            uniforms={floorShader.uniforms}
            vertexShader={floorShader.vertexShader}
            fragmentShader={floorShader.fragmentShader}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* Instanced Frosted Silver-Blue Reeds */}
        {grassCfg.enabled !== false && (
          <instancedMesh
            ref={frostedReedRef}
            args={[reedGeo, reedMaterial, reedCount]}
            frustumCulled={false}
            receiveShadow
          />
        )}

        {/* Instanced 3D Hexagonal Glacial Ice Crystals */}
        {crystalsCfg.enabled !== false && (
          <instancedMesh
            ref={iceCrystalRef}
            args={[crystalGeo, crystalMaterial, crystalCount]}
            frustumCulled={false}
            castShadow
            receiveShadow
          />
        )}
      </group>
    </group>
  );
}