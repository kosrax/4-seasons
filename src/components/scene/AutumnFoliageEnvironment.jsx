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
  updateSmoothedGroundVelocity,
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
 * Evaluates asymmetric autumn forest floor elevation:
 * - Prominent leaf-drift mound on the right side (under 'I', 'N', 'G' of FALLING)
 * - Soft banking root bed under the right letters
 * - Small manicured accent drift on the far-left edge beside 'F'
 */
function sampleAutumnElevation(
  x,
  z,
  halfWidth,
  halfDepth,
  moundHeight = 0.14
) {
  const rightDx = (x - halfWidth * 0.52) / (halfWidth * 0.52);
  const rightDz = (z - 0.36) / 0.78;
  const rightKnoll =
    Math.exp(-(rightDx * rightDx + rightDz * rightDz) * 1.3) *
    moundHeight *
    1.05;

  const rightBankDx = (x - halfWidth * 0.48) / (halfWidth * 0.44);
  const rightBankDz = (z - 0.05) / (halfDepth * 2.5);
  const rightBank =
    Math.exp(-(rightBankDx * rightBankDx + rightBankDz * rightBankDz) * 1.5) *
    (moundHeight * 0.58);

  const leftFlankDx = (x + halfWidth * 0.96) / (halfWidth * 0.25);
  const leftFlankDz = (z + 0.06) / 0.42;
  const leftKnoll =
    Math.exp(-(leftFlankDx * leftFlankDx + leftFlankDz * leftFlankDz) * 1.95) *
    (moundHeight * 0.42);

  const envelope = Math.max(rightKnoll, Math.max(rightBank, leftKnoll));
  const microRelief =
    (fbm2D(x * 1.35 + 2.4, z * 1.45 - 1.8) - 0.45) *
    (moundHeight * 0.32) *
    smoothstep(0.005, 0.08, envelope);

  return rightKnoll + rightBank + leftKnoll + microRelief;
}

function sampleAutumnDensity(x, z, halfWidth, halfDepth) {
  const rightCoreX = (x - halfWidth * 0.52) / (halfWidth * 0.48);
  const rightCoreZ = (z - 0.3) / 0.74;
  const rightCore =
    Math.exp(-(rightCoreX * rightCoreX + rightCoreZ * rightCoreZ) * 1.25) *
    1.15;

  const rightBaseX = (x - halfWidth * 0.48) / (halfWidth * 0.4);
  const rightBaseZ = z / (halfDepth * 2.5);
  const rightBase =
    Math.exp(-(rightBaseX * rightBaseX + rightBaseZ * rightBaseZ) * 1.45) *
    0.95;

  const trailX = (x + halfWidth * 0.14) / (halfWidth * 0.46);
  const trailZ = (z - 0.36) / 0.52;
  const softTrail =
    Math.exp(-(trailX * trailX + trailZ * trailZ) * 2.0) * 0.38;

  const leftAccentX = (x + halfWidth * 0.96) / (halfWidth * 0.24);
  const leftAccentZ = (z + 0.06) / 0.38;
  const leftAccent =
    Math.exp(-(leftAccentX * leftAccentX + leftAccentZ * leftAccentZ) * 1.95) *
    0.82;

  const fbmMod = fbm2D(x * 1.4 + 5.2, z * 1.55 + 1.9);
  const combined =
    Math.max(rightCore, rightBase, softTrail, leftAccent) *
    (0.62 + fbmMod * 0.6);

  return THREE.MathUtils.clamp(combined, 0.0, 1.0);
}

/**
 * Builds a 3D curved autumn leaf geometry (lobed maple/oak silhouette with petiole stem
 * and curled edges so fallen leaves have true 3D volume on the ground).
 */
function createAutumnLeafGeometry() {
  const lengthSteps = 7;
  const widthSteps = 6;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let li = 0; li <= lengthSteps; li++) {
    const lt = li / lengthSteps;
    let halfWidth;
    if (lt < 0.15) {
      halfWidth = 0.0045;
    } else {
      const bladeT = (lt - 0.15) / 0.85;
      const baseEnvelope = Math.sin(Math.pow(bladeT, 0.78) * Math.PI);
      const lobes =
        0.78 +
        0.28 * Math.sin(bladeT * Math.PI * 3.0) +
        0.12 * Math.cos(bladeT * Math.PI * 5.0);
      halfWidth = 0.056 * baseEnvelope * lobes;
    }

    const z = (lt - 0.35) * 0.145;
    const archY = Math.sin(lt * Math.PI) * 0.014 - Math.pow(lt, 2.6) * 0.008;

    for (let wi = 0; wi <= widthSteps; wi++) {
      const wt = (wi / widthSteps) * 2.0 - 1.0;
      const x = wt * halfWidth;
      const midribCrease = -Math.abs(wt) * 0.005 + wt * wt * 0.011 * lt;
      const y = archY + midribCrease;

      positions.push(x, y, z);
      uvs.push(wt * 0.5 + 0.5, lt);
    }
  }

  const rowStride = widthSteps + 1;
  for (let li = 0; li < lengthSteps; li++) {
    for (let wi = 0; wi < widthSteps; wi++) {
      const a = li * rowStride + wi;
      const b = a + 1;
      const c = a + rowStride;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds 3D acorn geometries (smooth nut body + cupule cap)
 * and gnarled fallen woody twigs.
 */
function createForestAccentGeometries() {
  const nutGeo = new THREE.SphereGeometry(0.022, 12, 10);
  nutGeo.scale(0.88, 1.22, 0.88);
  nutGeo.translate(0, 0.022, 0);

  const capGeo = new THREE.SphereGeometry(
    0.024,
    12,
    8,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.58
  );
  capGeo.scale(0.96, 0.78, 0.96);
  capGeo.translate(0, 0.032, 0);

  const twigCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.14, 0.0, -0.02),
    new THREE.Vector3(-0.04, 0.012, 0.015),
    new THREE.Vector3(0.06, 0.008, -0.01),
    new THREE.Vector3(0.15, 0.022, 0.02),
  ]);
  const twigGeo = new THREE.TubeGeometry(twigCurve, 10, 0.0075, 6, false);

  return { nutGeo, capGeo, twigGeo };
}

/**
 * Builds the custom shader for the earthy ochre, rust, and umber autumn soil bed.
 */
function buildAutumnFloorShader({
  halfWidth,
  halfDepth,
  letterCount,
  palette,
  initialReveal,
}) {
  return {
    uniforms: {
      uReveal: { value: initialReveal },
      uHalfWidth: { value: halfWidth },
      uHalfDepth: { value: halfDepth },
      uLetterCount: { value: letterCount },
      uGroundBase: {
        value: new THREE.Color(palette.groundBase || '#DFCFC0'),
      },
      uSoilOchre: {
        value: new THREE.Color(palette.groundMossFresh || '#C8853B'),
      },
      uSoilRust: {
        value: new THREE.Color(palette.groundMoss || '#9A5426'),
      },
      uSoilUmber: {
        value: new THREE.Color(palette.groundMossDeep || '#5E3219'),
      },
    },
    vertexShader: buildGroundVertexShader(),
    fragmentShader: `
      uniform float uReveal;
      uniform float uHalfWidth;
      uniform float uHalfDepth;
      uniform float uLetterCount;
      uniform vec3 uGroundBase;
      uniform vec3 uSoilOchre;
      uniform vec3 uSoilRust;
      uniform vec3 uSoilUmber;
      varying vec3 vWorldPos;
      varying vec3 vNormalWorld;

      ${GLSL_NOISE_2D}

      void main() {
        vec2 xz = vWorldPos.xz;
        float n1 = fbm(xz * 0.8 + vec2(0.3, -0.4));
        float n2 = fbm(xz * 2.4 - vec2(1.4, 0.6));
        float fineGrain = valueNoise(xz * 18.0);

        vec2 rightD = vec2((xz.x - uHalfWidth * 0.52) / (uHalfWidth * 0.54), (xz.y - 0.34) / 0.84);
        float rightZone = exp(-dot(rightD, rightD) * 1.15) * 1.15;

        vec2 midTrailD = vec2((xz.x + uHalfWidth * 0.14) / (uHalfWidth * 0.46), (xz.y - 0.36) / 0.5);
        float midTrailZone = exp(-dot(midTrailD, midTrailD) * 1.8) * 0.52;

        vec2 leftFlankD = vec2((xz.x + uHalfWidth * 0.96) / (uHalfWidth * 0.25), (xz.y + 0.06) / 0.38);
        float leftFlankZone = exp(-dot(leftFlankD, leftFlankD) * 1.9) * 0.84;

        float zoneEnvelope = max(rightZone, max(midTrailZone, leftFlankZone));
        float soilMask = smoothstep(0.22, 0.66, zoneEnvelope * (0.55 + n1 * 0.75));

        vec3 soilColor = mix(uSoilOchre, uSoilRust, smoothstep(0.26, 0.72, n2));
        soilColor = mix(soilColor, uSoilUmber, smoothstep(0.48, 0.86, n1 * n2) * 0.58);

        vec3 lightDir = normalize(vec3(0.48, 0.78, 0.4));
        float ndl = clamp(dot(vNormalWorld, lightDir), 0.0, 1.0);
        float terrainShade = 0.9 + ndl * 0.15 + (fineGrain - 0.5) * 0.04;

        float letterSpanX = 1.0 - smoothstep(uHalfWidth * 0.84, uHalfWidth * 1.05, abs(xz.x));
        float letterSpanZ = 1.0 - smoothstep(uHalfDepth * 0.4, uHalfDepth * 2.8, abs(xz.y));
        float letterWave = 0.75 + 0.25 * cos((xz.x / max(uHalfWidth, 1.0)) * uLetterCount * 3.14159);
        float contactShadow = letterSpanX * letterSpanZ * letterWave;

        vec3 shadowTint = mix(uGroundBase * 0.76, uSoilUmber * 0.65, soilMask);
        vec3 surfaceCol = mix(uGroundBase, soilColor * terrainShade, soilMask * 0.94);
        surfaceCol = mix(surfaceCol, shadowTint, contactShadow * 0.42);

        float patchAlpha = clamp(soilMask * 0.95 + contactShadow * 0.6, 0.0, 1.0);
        float radialCutoff = 1.0 - smoothstep(uHalfWidth * 1.28, uHalfWidth * 1.88, length(xz * vec2(0.8, 1.15)));
        float finalAlpha = patchAlpha * radialCutoff;

        surfaceCol = pow(max(surfaceCol, vec3(0.0)), vec3(1.0 / 2.2));
        gl_FragColor = vec4(surfaceCol, finalAlpha * uReveal);
      }
    `,
  };
}

/**
 * GPU shader for fallen 3D autumn leaves:
 * renders botanical midrib & lateral veins and gently rustles leaves in the breeze.
 */
function applyFallenLeafShader(material, sharedUniforms) {
  material.customProgramCacheKey = () => 'autumn-fallen-leaf-v2-no-hover';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWindSpeed;
      uniform float uWindStrength;
      varying vec2 vLeafUv;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vLeafUv = uv;

      vec4 instWorldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float leafSeed = fract(sin(dot(instWorldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float phase = leafSeed * 6.28318;

      float flutter = sin(uTime * (uWindSpeed * 1.4) + phase + uv.y * 2.5) * uWindStrength * 0.14 * uv.y;
      transformed.y += flutter;
      `
    );

    shader.fragmentShader =
      `
      varying vec2 vLeafUv;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>

      float centerDist = abs(vLeafUv.x - 0.5) * 2.0;
      float mainVein = 1.0 - smoothstep(0.0, 0.06, centerDist);
      float sideVeinWave = abs(sin((vLeafUv.y - centerDist * 0.42) * 22.0));
      float sideVeins = (1.0 - smoothstep(0.0, 0.14, sideVeinWave)) * (1.0 - centerDist * 0.65) * smoothstep(0.15, 0.3, vLeafUv.y);
      float veinMask = clamp(mainVein * 0.65 + sideVeins * 0.35, 0.0, 1.0);

      vec3 veinColor = diffuseColor.rgb * 0.62;
      diffuseColor.rgb = mix(diffuseColor.rgb, veinColor, veinMask * 0.45);

      float edgeBurn = smoothstep(0.55, 0.98, centerDist) * 0.18;
      diffuseColor.rgb *= (1.0 - edgeBurn);
      `
    );
  };

  material.needsUpdate = true;
}

/**
 * GPU wind and cursor-bend shader for dry autumn grass reeds.
 */
function applyDryGrassWindShader(material, sharedUniforms) {
  material.customProgramCacheKey = () => 'autumn-dry-grass-v1';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);

    shader.vertexShader =
      `
      uniform float uTime;
      uniform vec3 uPointer;
      uniform vec2 uPointerVelocity;
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
      float gust = sin(uTime * uWindSpeed - waveCoord) + cos(uTime * (uWindSpeed * 1.65) + instWorldPos.x * 2.1) * 0.45;

      float swayX = gust * uWindStrength * bendWeight;
      float swayZ = cos(uTime * (uWindSpeed * 0.8) - waveCoord * 0.8) * (uWindStrength * 0.65) * bendWeight;

      vec2 toBlade = instWorldPos.xz - uPointer.xz;
      float pointerDist = length(toBlade);
      float proximity = smoothstep(uCursorBendRadius, 0.0, pointerDist);
      float pointerPush = proximity * uCursorBendStrength * bendWeight;
      vec2 pushDir = pointerDist > 0.001 ? (toBlade / pointerDist) : vec2(0.0, 1.0);

      transformed.x += swayX + pushDir.x * pointerPush + uPointerVelocity.x * proximity * 0.12 * bendWeight;
      transformed.z += swayZ + pushDir.y * pointerPush + uPointerVelocity.y * proximity * 0.12 * bendWeight;
      transformed.y -= (abs(swayX) + pointerPush) * 0.12 * bendWeight;
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
      float rootShade = mix(0.42, 0.98, smoothstep(0.0, 0.85, vBladeHeight));
      diffuseColor.rgb *= rootShade;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.72, 0.36), smoothstep(0.55, 1.0, vBladeHeight) * 0.24);
      `
    );
  };

  material.needsUpdate = true;
}

/**
 * Populates instanced asymmetric dry amber-wheat grass reeds around the typography.
 */
function populateDryGrassReeds({
  mesh,
  dryBladeCount,
  grassCfg,
  halfWidth,
  halfDepth,
  moundHeight,
  meadowScale,
  dummy,
  tempColor,
}) {
  if (!mesh) return;

  const cAmber = new THREE.Color(grassCfg.colors?.sage || '#A67238');
  const cGolden = new THREE.Color(grassCfg.colors?.freshGreen || '#C98E42');
  const cWheat = new THREE.Color(grassCfg.colors?.yellowGreen || '#E2AE58');
  const cUmber = new THREE.Color(grassCfg.colors?.deepMoss || '#6E421E');

  const minH = (grassCfg.minHeight ?? 0.05) * meadowScale;
  const maxH = (grassCfg.maxHeight ?? 0.23) * meadowScale;
  const maxOverlapH = (grassCfg.letterOverlapMax ?? 0.19) * meadowScale;

  let placed = 0;
  let attempt = 0;

  while (placed < dryBladeCount && attempt < dryBladeCount * 5) {
    attempt++;
    const tuftSeed = Math.floor(placed / 7);
    const bladeInTuft = placed % 7;

    const r1 = hash2D(tuftSeed * 1.13 + attempt * 0.07, 0.5);
    const r2 = hash2D(tuftSeed * 2.39 + 1.7, attempt * 0.11);
    const r3 = hash2D(tuftSeed * 3.73 + 4.2, bladeInTuft * 1.91);

    let tuftX;
    let tuftZ;

    if (r1 < 0.56) {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(hash2D(tuftSeed, 3.9), 0.68);
      tuftX = halfWidth * 0.52 + Math.cos(angle) * radius * (halfWidth * 0.48);
      tuftZ = 0.34 + Math.sin(angle) * radius * 0.68;
    } else if (r1 < 0.86) {
      tuftX = halfWidth * 0.16 + hash2D(tuftSeed, 8.2) * (halfWidth * 0.8);
      const sideSign = hash2D(tuftSeed, 9.1) > 0.28 ? 1.0 : -1.0;
      tuftZ =
        sideSign *
        (halfDepth * 0.38 + Math.pow(hash2D(tuftSeed, 5.3), 1.4) * 0.42);
    } else if (r1 < 0.94) {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(hash2D(tuftSeed, 4.4), 0.72);
      tuftX =
        -halfWidth * 0.96 + Math.cos(angle) * radius * (halfWidth * 0.22);
      tuftZ = -0.05 + Math.sin(angle) * radius * 0.32;
    } else {
      tuftX = -halfWidth * 0.14 + (r2 - 0.5) * (halfWidth * 0.52);
      tuftZ = 0.34 + (hash2D(tuftSeed, 6.7) - 0.5) * 0.32;
    }

    const density = sampleAutumnDensity(tuftX, tuftZ, halfWidth, halfDepth);
    if (density < 0.15 && attempt < dryBladeCount * 4) continue;

    const tuftAngle =
      (bladeInTuft / 7) * Math.PI * 2.0 + hash2D(placed, 2.1) * 0.5;
    const tuftSpread =
      (0.01 + hash2D(placed, 4.8) * 0.036) *
      meadowScale *
      (bladeInTuft > 0 ? 1 : 0);
    const x = tuftX + Math.cos(tuftAngle) * tuftSpread;
    let z = tuftZ + Math.sin(tuftAngle) * tuftSpread;

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.36) {
      z = z >= 0 ? halfDepth * 0.4 : -halfDepth * 0.4;
    }

    const terrainY = sampleAutumnElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );

    let bladeH =
      minH + Math.pow(density, 0.85) * (maxH - minH) * (0.5 + r3 * 0.55);

    if (x < halfWidth * 0.12 && x > -halfWidth * 0.84) {
      bladeH = Math.min(bladeH, minH * 1.12);
    } else if (x >= halfWidth * 0.12 && Math.abs(z) < halfDepth * 1.75) {
      bladeH = Math.min(bladeH, maxOverlapH * (0.65 + r3 * 0.42));
    }

    const widthScale = (0.82 + hash2D(placed, 12.4) * 0.45) * meadowScale;
    dummy.position.set(x, terrainY - 0.005, z);
    dummy.rotation.set(
      0.12 + hash2D(placed, 3.1) * 0.24,
      tuftAngle + (hash2D(placed, 7.7) - 0.5) * 0.45,
      (hash2D(placed, 5.9) - 0.5) * 0.22
    );
    dummy.scale.set(widthScale, bladeH, widthScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);

    const colorNoise = fbm2D(x * 1.8 + 4.0, z * 1.8 - 2.0);
    tempColor
      .copy(cAmber)
      .lerp(cGolden, THREE.MathUtils.clamp(colorNoise * 1.25, 0, 1));
    if (r3 > 0.62) {
      tempColor.lerp(cWheat, (r3 - 0.62) * 1.4);
    } else if (r3 < 0.28) {
      tempColor.lerp(cUmber, (0.28 - r3) * 1.5);
    }
    mesh.setColorAt(placed, tempColor);

    placed++;
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * Populates instanced 3D fallen autumn leaves in layered terrain-hugging drifts.
 */
function populateFallenLeaves({
  mesh,
  fallenLeafCount,
  foliageCfg,
  halfWidth,
  halfDepth,
  moundHeight,
  meadowScale,
  dummy,
  tempColor,
}) {
  if (!mesh) return;

  const leafPalette = foliageCfg.palette || {};
  const cCrimson = new THREE.Color(leafPalette.crimson || '#9E2A1C');
  const cRust = new THREE.Color(leafPalette.rust || '#C85224');
  const cAmber = new THREE.Color(leafPalette.amber || '#E08228');
  const cGold = new THREE.Color(leafPalette.gold || '#EBB43E');
  const cBurgundy = new THREE.Color(leafPalette.burgundy || '#6E1D1B');

  for (let i = 0; i < fallenLeafCount; i++) {
    const r1 = hash2D(i * 2.17 + 0.9, 3.4);
    const r2 = hash2D(i * 4.31 + 2.1, 7.3);
    const r3 = hash2D(i * 6.83 + 4.6, 1.8);

    let x;
    let z;

    if (r1 < 0.64) {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(r3, 0.72);
      x = halfWidth * 0.5 + Math.cos(angle) * radius * (halfWidth * 0.52);
      z = 0.28 + Math.sin(angle) * radius * 0.78;
    } else if (r1 < 0.84) {
      x = -halfWidth * 0.1 + (r2 - 0.5) * (halfWidth * 0.82);
      z = 0.18 + (r3 - 0.3) * 0.65;
    } else if (r1 < 0.94) {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(r3, 0.75);
      x = -halfWidth * 0.95 + Math.cos(angle) * radius * (halfWidth * 0.26);
      z = 0.04 + Math.sin(angle) * radius * 0.38;
    } else {
      x = halfWidth * 0.45 + (r2 - 0.5) * (halfWidth * 0.65);
      z = -halfDepth * 0.85 - r3 * 0.45;
    }

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.36) {
      z = z >= 0 ? halfDepth * 0.42 : -halfDepth * 0.42;
    }

    const terrainY = sampleAutumnElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );

    const eps = 0.06;
    const hX = sampleAutumnElevation(
      x + eps,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );
    const hZ = sampleAutumnElevation(
      x,
      z + eps,
      halfWidth,
      halfDepth,
      moundHeight
    );
    const slopePitch = -Math.atan2(hZ - terrainY, eps);
    const slopeRoll = Math.atan2(hX - terrainY, eps);

    const stackOffset = 0.004 + (i % 5) * 0.0055 * meadowScale;
    const leafScale = (0.75 + r3 * 0.72) * meadowScale;
    const yaw = r1 * Math.PI * 2.0;
    const randomTilt = (r2 - 0.5) * 0.38;

    dummy.position.set(x, terrainY + stackOffset, z);
    dummy.rotation.set(
      slopePitch + randomTilt,
      yaw,
      slopeRoll + (r3 - 0.5) * 0.38
    );
    dummy.scale.set(leafScale, leafScale, leafScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const colorPick = (r1 * 0.6 + r3 * 0.4) % 1.0;
    if (colorPick < 0.24) {
      tempColor.copy(cCrimson).lerp(cRust, r2);
    } else if (colorPick < 0.52) {
      tempColor.copy(cRust).lerp(cAmber, r2);
    } else if (colorPick < 0.78) {
      tempColor.copy(cAmber).lerp(cGold, r2);
    } else if (colorPick < 0.9) {
      tempColor.copy(cGold);
    } else {
      tempColor.copy(cBurgundy).lerp(cCrimson, r2);
    }

    mesh.setColorAt(i, tempColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * Populates instanced 3D acorns nestled among the fallen leaves.
 */
function populateAcorns({
  nutMesh,
  capMesh,
  acornCount,
  halfWidth,
  halfDepth,
  moundHeight,
  meadowScale,
  dummy,
}) {
  if (!nutMesh || !capMesh) return;

  for (let i = 0; i < acornCount; i++) {
    const r1 = hash2D(i * 3.7 + 1.1, 6.2);
    const r2 = hash2D(i * 5.9 + 2.7, 4.1);
    const r3 = hash2D(i * 8.3 + 0.4, 9.5);

    let x;
    let z;
    if (i < acornCount * 0.85) {
      const angle = r1 * Math.PI * 2.0;
      const radius = Math.pow(r2, 0.7) * (halfWidth * 0.45);
      x = halfWidth * 0.5 + Math.cos(angle) * radius;
      z = 0.26 + Math.sin(angle) * (radius * 1.1);
    } else {
      x = -halfWidth * 0.94 + (r1 - 0.5) * 0.28;
      z = 0.08 + (r2 - 0.5) * 0.26;
    }

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.4) {
      z = z >= 0 ? halfDepth * 0.46 : -halfDepth * 0.46;
    }

    const terrainY = sampleAutumnElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );
    const acornScale = (0.85 + r3 * 0.45) * meadowScale;

    dummy.position.set(x, terrainY + 0.004, z);
    dummy.rotation.set(
      Math.PI * 0.38 + (r2 - 0.5) * 0.3,
      r1 * Math.PI * 2.0,
      (r3 - 0.5) * 0.4
    );
    dummy.scale.set(acornScale, acornScale, acornScale);
    dummy.updateMatrix();

    nutMesh.setMatrixAt(i, dummy.matrix);
    capMesh.setMatrixAt(i, dummy.matrix);
  }

  nutMesh.instanceMatrix.needsUpdate = true;
  capMesh.instanceMatrix.needsUpdate = true;
}

/**
 * Populates instanced fallen woody twigs across the forest floor.
 */
function populateTwigs({
  mesh,
  twigCount,
  halfWidth,
  halfDepth,
  moundHeight,
  meadowScale,
  dummy,
}) {
  if (!mesh) return;

  for (let i = 0; i < twigCount; i++) {
    const r1 = hash2D(i * 4.1 + 2.2, 5.1);
    const r2 = hash2D(i * 6.7 + 1.5, 8.4);
    const r3 = hash2D(i * 9.1 + 3.8, 2.7);

    const x =
      i < twigCount * 0.85
        ? halfWidth * 0.48 + (r1 - 0.5) * (halfWidth * 0.72)
        : -halfWidth * 0.94 + (r1 - 0.5) * 0.35;
    const z =
      i < twigCount * 0.85
        ? 0.25 + (r2 - 0.4) * 0.75
        : 0.05 + (r2 - 0.5) * 0.3;

    const safeZ =
      Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.38
        ? z >= 0
          ? halfDepth * 0.45
          : -halfDepth * 0.45
        : z;

    const terrainY = sampleAutumnElevation(
      x,
      safeZ,
      halfWidth,
      halfDepth,
      moundHeight
    );
    const twigScale = (0.75 + r3 * 0.65) * meadowScale;

    dummy.position.set(x, terrainY + 0.005, safeZ);
    dummy.rotation.set(
      (r2 - 0.5) * 0.18,
      r1 * Math.PI * 2.0,
      (r3 - 0.5) * 0.18
    );
    dummy.scale.set(twigScale, twigScale, twigScale);
    dummy.updateMatrix();

    mesh.setMatrixAt(i, dummy.matrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Hero 3D autumn leaf perched on top of the first letter ('F') of FALLING,
 * rocking softly in the autumn breeze.
 */
function PerchedAutumnLeaf({
  restPosition,
  scale = 1.35,
  leafGeometry,
  depthProgressRef,
}) {
  const groupRef = useRef(null);
  const localPoint = useMemo(() => new THREE.Vector3(), []);
  const typoQuat = useMemo(() => new THREE.Quaternion(), []);
  const baseQuat = useMemo(() => new THREE.Quaternion(), []);

  const heroLeafMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#C84B24'),
        emissive: new THREE.Color('#3A1006'),
        emissiveIntensity: 0.08,
        roughness: 0.32,
        metalness: 0.02,
        clearcoat: 0.45,
        clearcoatRoughness: 0.24,
        sheen: 0.65,
        sheenColor: new THREE.Color('#F2A65A'),
        side: THREE.DoubleSide,
      }),
    []
  );

  useEffect(() => {
    return () => {
      heroLeafMaterial.dispose();
    };
  }, [heroLeafMaterial]);

  usePerchedPropRevealSync(groupRef, scale, depthProgressRef);

  useFrame((state) => {
    if (!groupRef.current) return;
    const { propReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    groupRef.current.visible = propReveal > 0.005;
    groupRef.current.scale.setScalar(Math.max(0.0001, scale * propReveal));
    if (propReveal <= 0.005) return;

    const t = state.clock.getElapsedTime();
    const gentleRockX = 0.18 + Math.sin(t * 1.4) * 0.045;
    const gentleYawY = -0.52 + Math.cos(t * 0.95) * 0.06;
    const gentleRollZ = -0.22 + Math.sin(t * 1.15) * 0.04;
    baseQuat.setFromEuler(new THREE.Euler(gentleRockX, gentleYawY, gentleRollZ));

    syncObjectToTypographyAnchor({
      object: groupRef.current,
      scene: state.scene,
      restPosition,
      baseScale: scale,
      propReveal,
      orientationQuat: baseQuat,
      tempPoint: localPoint,
      tempQuat: typoQuat,
    });
  });

  return (
    <group
      ref={groupRef}
      name="autumn-perched-hero-leaf"
      position={restPosition}
      scale={scale}
    >
      <mesh
        geometry={leafGeometry}
        material={heroLeafMaterial}
        castShadow
        receiveShadow
      />
    </group>
  );
}

/**
 * Complete Autumn Foliage Environment for "FALLING":
 * - Sculpted earthy ochre/sienna terrain mound focused asymmetrically on the right side
 * - Instanced 3D curved fallen autumn leaves & dry amber grass reeds
 * - 3D fallen acorns (nut + cupule cap) & woody twigs nestled in the leaf drifts
 * - Hero 3D maple leaf resting on the top bar of the first letter 'F'
 */
export function AutumnFoliageEnvironment({
  seasonConfig,
  typographyBounds,
  pointerWorldRef,
  depthProgressRef,
}) {
  const groundGroupRef = useRef(null);
  const floorMaterialRef = useRef(null);
  const dryGrassRef = useRef(null);
  const fallenLeafRef = useRef(null);
  const acornNutRef = useRef(null);
  const acornCapRef = useRef(null);
  const twigRef = useRef(null);

  const prevPointerXZ = useRef(new THREE.Vector2(999, 999));
  const smoothedGroundVel = useRef(new THREE.Vector2(0, 0));

  const { palette, environment = {} } = seasonConfig;
  const groundCfg = environment.ground || {};
  const grassCfg = environment.grass || {};
  const foliageCfg = environment.foliage || {};
  const accentsCfg = environment.accents || {};

  const typoWidth = typographyBounds?.width ?? 5.6;
  const typoHeight = typographyBounds?.height ?? 1.08;
  const typoDepth = typographyBounds?.depth ?? 0.2;
  const typoBottomY = typographyBounds?.bottomY ?? -0.42;
  const typoTopY = typographyBounds?.topY ?? 0.66;
  const letterCount = typographyBounds?.letterCount ?? 7;

  const meadowScale = THREE.MathUtils.clamp(typoHeight / 0.72, 0.9, 1.85);
  const halfWidth = typoWidth * 0.5;
  const halfDepth = Math.max(typoDepth * 0.5, 0.11);
  const moundHeight =
    (groundCfg.moundHeight ?? 0.13) * (0.65 + meadowScale * 0.35);
  const baseGroundY = typoBottomY - 0.008;

  const groundWidth = Math.max(
    typoWidth * (groundCfg.widthMultiplier ?? 4.2),
    groundCfg.minWidth ?? 26.0
  );
  const groundDepth = groundCfg.depth ?? 14.0;

  const fCenterX = typographyBounds?.hCenterX ?? -halfWidth * 0.82;
  const fTopY = typographyBounds?.hTopY ?? typoTopY;
  const perchedLeafPos = useMemo(
    () => [
      fCenterX + 0.04 * meadowScale,
      fTopY + 0.008 * meadowScale,
      halfDepth * 0.35,
    ],
    [fCenterX, fTopY, halfDepth, meadowScale]
  );

  const sharedUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector3(999, 999, 999) },
      uPointerVelocity: { value: new THREE.Vector2(0, 0) },
      uWindSpeed: { value: grassCfg.windSpeed ?? 1.45 },
      uWindStrength: { value: grassCfg.windStrength ?? 0.048 },
      uWindWaveLength: { value: grassCfg.windWaveLength ?? 0.72 },
      uCursorBendRadius: { value: grassCfg.cursorBendRadius ?? 1.5 },
      uCursorBendStrength: { value: grassCfg.cursorBendStrength ?? 0.1 },
    }),
    [grassCfg]
  );

  const terrainGeometry = useMemo(
    () =>
      createDisplacedTerrainGeometry({
        width: groundWidth,
        depth: groundDepth,
        segmentsX: 120,
        segmentsZ: 76,
        zOffset: 0.35,
        sampleElevation: (vx, vz) =>
          sampleAutumnElevation(vx, vz, halfWidth, halfDepth, moundHeight),
      }),
    [groundWidth, groundDepth, halfWidth, halfDepth, moundHeight]
  );

  useEffect(() => {
    return () => {
      terrainGeometry.dispose();
    };
  }, [terrainGeometry]);

  const floorShader = useMemo(
    () =>
      buildAutumnFloorShader({
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

  const {
    dryBladeGeo,
    leafGeo,
    nutGeo,
    capGeo,
    twigGeo,
    grassMaterial,
    leafMaterial,
    nutMaterial,
    capMaterial,
    twigMaterial,
  } = useMemo(() => {
    const dGeo = createGrassStripGeometry({
      segments: 5,
      baseWidth: 0.0092,
      curveZ: 0.24,
      curvePower: 1.75,
      taperMode: 'power',
      taperPower: 1.3,
      taperTipReduction: 0.92,
      archDroop: 0,
    });
    const lGeo = createAutumnLeafGeometry();
    const { nutGeo: nGeo, capGeo: cGeo, twigGeo: tGeo } =
      createForestAccentGeometries();

    const gMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.72,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });
    applyDryGrassWindShader(gMat, sharedUniforms);

    const lMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.46,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    applyFallenLeafShader(lMat, sharedUniforms);

    const nMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#7A3E18'),
      roughness: 0.24,
      metalness: 0.02,
      clearcoat: 0.68,
      clearcoatRoughness: 0.18,
    });

    const cMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#4A2812'),
      roughness: 0.85,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });

    const tMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#472A18'),
      roughness: 0.88,
      metalness: 0.01,
    });

    return {
      dryBladeGeo: dGeo,
      leafGeo: lGeo,
      nutGeo: nGeo,
      capGeo: cGeo,
      twigGeo: tGeo,
      grassMaterial: gMat,
      leafMaterial: lMat,
      nutMaterial: nMat,
      capMaterial: cMat,
      twigMaterial: tMat,
    };
  }, [sharedUniforms]);

  useEffect(() => {
    return () => {
      dryBladeGeo.dispose();
      leafGeo.dispose();
      nutGeo.dispose();
      capGeo.dispose();
      twigGeo.dispose();
      grassMaterial.dispose();
      leafMaterial.dispose();
      nutMaterial.dispose();
      capMaterial.dispose();
      twigMaterial.dispose();
    };
  }, [
    dryBladeGeo,
    leafGeo,
    nutGeo,
    capGeo,
    twigGeo,
    grassMaterial,
    leafMaterial,
    nutMaterial,
    capMaterial,
    twigMaterial,
  ]);

  const dryBladeCount = grassCfg.fineBladeCount ?? 2600;
  const fallenLeafCount = foliageCfg.leafCount ?? 620;
  const acornCount = accentsCfg.acornCount ?? 28;
  const twigCount = accentsCfg.twigCount ?? 22;

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const tempColor = new THREE.Color();

    populateDryGrassReeds({
      mesh: dryGrassRef.current,
      dryBladeCount,
      grassCfg,
      halfWidth,
      halfDepth,
      moundHeight,
      meadowScale,
      dummy,
      tempColor,
    });

    populateFallenLeaves({
      mesh: fallenLeafRef.current,
      fallenLeafCount,
      foliageCfg,
      halfWidth,
      halfDepth,
      moundHeight,
      meadowScale,
      dummy,
      tempColor,
    });

    populateAcorns({
      nutMesh: acornNutRef.current,
      capMesh: acornCapRef.current,
      acornCount,
      halfWidth,
      halfDepth,
      moundHeight,
      meadowScale,
      dummy,
    });

    populateTwigs({
      mesh: twigRef.current,
      twigCount,
      halfWidth,
      halfDepth,
      moundHeight,
      meadowScale,
      dummy,
    });
  }, [
    typoWidth,
    typoHeight,
    typoDepth,
    meadowScale,
    halfWidth,
    halfDepth,
    moundHeight,
    dryBladeCount,
    fallenLeafCount,
    acornCount,
    twigCount,
    grassCfg,
    foliageCfg,
  ]);

  useGroundRevealSync(groundGroupRef, floorMaterialRef, depthProgressRef);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = state.clock.getElapsedTime();
    applyGroundRevealFrame(groundGroupRef, floorMaterialRef, depthProgressRef, t);
    sharedUniforms.uTime.value = t;

    if (pointerWorldRef?.current) {
      sharedUniforms.uPointer.value.copy(pointerWorldRef.current);
      updateSmoothedGroundVelocity({
        pointerWorldRef,
        prevPointerXZ,
        smoothedGroundVel,
        velocityUniform: sharedUniforms.uPointerVelocity,
        scale: 0.07,
        clampMax: 1.2,
        dt,
      });
    }
  });

  return (
    <group name="autumn-foliage-environment">
      <PerchedAutumnLeaf
        restPosition={perchedLeafPos}
        scale={1.25 * meadowScale}
        leafGeometry={leafGeo}
        depthProgressRef={depthProgressRef}
      />

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

        <instancedMesh
          ref={dryGrassRef}
          args={[dryBladeGeo, grassMaterial, dryBladeCount]}
          frustumCulled={false}
          receiveShadow
        />

        <instancedMesh
          ref={fallenLeafRef}
          args={[leafGeo, leafMaterial, fallenLeafCount]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />

        <instancedMesh
          ref={acornNutRef}
          args={[nutGeo, nutMaterial, acornCount]}
          frustumCulled={false}
          castShadow
        />
        <instancedMesh
          ref={acornCapRef}
          args={[capGeo, capMaterial, acornCount]}
          frustumCulled={false}
          castShadow
        />

        <instancedMesh
          ref={twigRef}
          args={[twigGeo, twigMaterial, twigCount]}
          frustumCulled={false}
          castShadow
        />
      </group>
    </group>
  );
}
