import React, { useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { computeDimensionReveals } from '../../utils/dimensionReveal.js';
import {
  hash2D,
  fbm2D,
  GLSL_NOISE_2D,
  buildGroundVertexShader,
  createDisplacedTerrainGeometry,
  createGrassStripGeometry,
  updateSmoothedGroundVelocity,
} from '../../utils/proceduralNoise.js';
import {
  useGroundRevealSync,
  applyGroundRevealFrame,
} from '../../hooks/useEnvironmentReveal.js';

const REF_STEM_HEIGHT = 0.18;

/**
 * Asymmetric terrain elevation:
 * Sculpted lush mound on the right side (under the second O and M)
 * and a small accent knoll on the far-left edge, keeping B, L, and first O flat and clean.
 */
function sampleMeadowElevation(
  x,
  z,
  halfWidth,
  halfDepth,
  moundHeight = 0.09
) {
  const rightDx = (x - halfWidth * 0.54) / (halfWidth * 0.48);
  const rightDz = (z - 0.36) / 0.72;
  const rightKnoll =
    Math.exp(-(rightDx * rightDx + rightDz * rightDz) * 1.45) *
    moundHeight *
    0.95;

  const rightRootDx = (x - halfWidth * 0.52) / (halfWidth * 0.42);
  const rightRootDz = z / (halfDepth * 2.2);
  const rightRootLift =
    Math.exp(-(rightRootDx * rightRootDx + rightRootDz * rightRootDz) * 1.6) *
    (moundHeight * 0.38);

  const leftFlankDx = (x + halfWidth * 0.98) / (halfWidth * 0.24);
  const leftFlankDz = (z + 0.08) / 0.38;
  const leftKnoll =
    Math.exp(-(leftFlankDx * leftFlankDx + leftFlankDz * leftFlankDz) * 2.1) *
    moundHeight *
    0.35;

  return rightKnoll + rightRootLift + leftKnoll;
}

function sampleVegetationDensity(x, z, halfWidth, halfDepth) {
  const rightCoreX = (x - halfWidth * 0.54) / (halfWidth * 0.46);
  const rightCoreZ = (z - 0.28) / 0.68;
  const rightCore =
    Math.exp(-(rightCoreX * rightCoreX + rightCoreZ * rightCoreZ) * 1.35) *
    1.15;

  const rightBaseX = (x - halfWidth * 0.5) / (halfWidth * 0.38);
  const rightBaseZ = z / (halfDepth * 2.4);
  const rightBase =
    Math.exp(-(rightBaseX * rightBaseX + rightBaseZ * rightBaseZ) * 1.5) * 0.95;

  const trailX = (x + halfWidth * 0.18) / (halfWidth * 0.42);
  const trailZ = (z - 0.35) / 0.45;
  const softTrail =
    Math.exp(-(trailX * trailX + trailZ * trailZ) * 2.2) * 0.34;

  const leftAccentX = (x + halfWidth * 0.98) / (halfWidth * 0.22);
  const leftAccentZ = (z + 0.08) / 0.34;
  const leftAccent =
    Math.exp(-(leftAccentX * leftAccentX + leftAccentZ * leftAccentZ) * 2.1) *
    0.78;

  const fbmMod = fbm2D(x * 1.5 + 7.4, z * 1.65 + 2.1);
  return THREE.MathUtils.clamp(
    Math.max(rightCore, rightBase, softTrail, leftAccent) *
      (0.64 + fbmMod * 0.58),
    0.0,
    1.0
  );
}

function createFineGrassBladeGeometry() {
  const segments = 5;
  const baseWidth = 0.009;
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t;
    const width = baseWidth * (1.0 - Math.pow(t, 1.35) * 0.94);
    const curveZ = Math.pow(t, 1.85) * 0.17;
    const centerRidgeZ = curveZ + (1.0 - t) * 0.0025;

    if (i < segments) {
      positions.push(-width, y, curveZ, 0, y, centerRidgeZ, width, y, curveZ);
      uvs.push(0, t, 0.5, t, 1, t);
      const ny = -0.2 * t;
      normals.push(-0.35, ny, 0.9, 0.0, ny, 1.0, 0.35, ny, 0.9);
    } else {
      positions.push(0, y, curveZ);
      uvs.push(0.5, 1.0);
      normals.push(0, 0.15, 1.0);
    }
  }

  for (let i = 0; i < segments - 1; i++) {
    const row = i * 3;
    const nextRow = (i + 1) * 3;
    indices.push(
      row,
      nextRow,
      row + 1,
      row + 1,
      nextRow,
      nextRow + 1,
      row + 1,
      nextRow + 1,
      row + 2,
      row + 2,
      nextRow + 1,
      nextRow + 2
    );
  }

  const lastRow = (segments - 1) * 3;
  const tipIndex = segments * 3;
  indices.push(lastRow, tipIndex, lastRow + 1, lastRow + 1, tipIndex, lastRow + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createFlowerGeometries() {
  const stemHeight = REF_STEM_HEIGHT;
  const stemCurveZ = 0.018;

  const stemSegsY = 7;
  const radialSegs = 6;
  const stemPositions = [];
  const stemUvs = [];
  const stemIndices = [];

  for (let yi = 0; yi <= stemSegsY; yi++) {
    const t = yi / stemSegsY;
    const y = t * stemHeight;
    const bendZ = t * t * stemCurveZ;

    let radius = THREE.MathUtils.lerp(0.0055, 0.0042, t);
    if (t > 0.82) {
      const calyxT = (t - 0.82) / 0.18;
      radius = THREE.MathUtils.lerp(0.0042, 0.017, calyxT * calyxT);
    }

    for (let ri = 0; ri <= radialSegs; ri++) {
      const angle = (ri / radialSegs) * Math.PI * 2.0;
      stemPositions.push(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius + bendZ
      );
      stemUvs.push(ri / radialSegs, t);
    }
  }

  const ringStride = radialSegs + 1;
  for (let yi = 0; yi < stemSegsY; yi++) {
    for (let ri = 0; ri < radialSegs; ri++) {
      const a = yi * ringStride + ri;
      const b = a + 1;
      const c = a + ringStride;
      const d = c + 1;
      stemIndices.push(a, c, b, b, c, d);
    }
  }

  const stemGeo = new THREE.BufferGeometry();
  stemGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(stemPositions, 3)
  );
  stemGeo.setAttribute('uv', new THREE.Float32BufferAttribute(stemUvs, 2));
  stemGeo.setIndex(stemIndices);
  stemGeo.computeVertexNormals();

  const petalCount = 6;
  const positions = [];
  const uvs = [];
  const petalData = [];
  const indices = [];
  let vertexOffset = 0;

  const lengthSteps = 6;
  const widthSteps = 4;
  const tipX = 0.0;
  const tipY = stemHeight - 0.003;
  const tipZ = stemCurveZ;

  const forwardTilt = 0.24;
  const cosTilt = Math.cos(forwardTilt);
  const sinTilt = Math.sin(forwardTilt);

  for (let p = 0; p < petalCount; p++) {
    const isInnerWhorl = p % 2 === 0;
    const angle =
      (p / petalCount) * Math.PI * 2.0 + (isInnerWhorl ? 0.0 : 0.05);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const maxRadius = isInnerWhorl ? 0.05 : 0.058;
    const maxCupHeight = isInnerWhorl ? 0.092 : 0.086;
    const maxPetalWidth = isInnerWhorl ? 0.034 : 0.038;

    for (let li = 0; li <= lengthSteps; li++) {
      const lt = li / lengthSteps;
      const bellyCurve =
        Math.sin(lt * Math.PI * 0.72) * 0.78 + Math.pow(lt, 2.4) * 0.34;
      const radialBase = 0.008 + bellyCurve * maxRadius;
      const cupHeight =
        Math.pow(lt, 0.78) * maxCupHeight - Math.pow(lt, 3.2) * 0.012;
      const widthEnvelope = Math.sin(Math.pow(lt, 0.85) * Math.PI * 0.92);
      const petalHalfWidth = (0.005 + widthEnvelope * maxPetalWidth) * 0.5;

      for (let wi = 0; wi <= widthSteps; wi++) {
        const wt = (wi / widthSteps) * 2.0 - 1.0;
        const localW = wt * petalHalfWidth;
        const cupConcavity =
          (1.0 - wt * wt) * 0.015 * Math.sin(lt * Math.PI * 0.9);
        const radialReach = radialBase + cupConcavity;
        const edgeRollLift = wt * wt * 0.005 * lt;

        const lx = cosA * radialReach - sinA * localW;
        const lz = sinA * radialReach + cosA * localW;
        const ly = cupHeight + edgeRollLift;

        positions.push(
          lx + tipX,
          ly * cosTilt - lz * sinTilt + tipY,
          ly * sinTilt + lz * cosTilt + tipZ
        );
        uvs.push(lt, 1.0);
        petalData.push(lt, wt, cosA, sinA);
      }
    }

    const rowStride = widthSteps + 1;
    for (let li = 0; li < lengthSteps; li++) {
      for (let wi = 0; wi < widthSteps; wi++) {
        const a = vertexOffset + li * rowStride + wi;
        const b = a + 1;
        const c = a + rowStride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    vertexOffset += (lengthSteps + 1) * rowStride;
  }

  const blossomGeo = new THREE.BufferGeometry();
  blossomGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  blossomGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  blossomGeo.setAttribute(
    'aPetalData',
    new THREE.Float32BufferAttribute(petalData, 4)
  );
  blossomGeo.setIndex(indices);
  blossomGeo.computeVertexNormals();

  const centerPositions = [];
  const centerUvs = [];
  const centerIndices = [];
  let cVertexOffset = 0;

  const stamenCount = 7;
  for (let s = 0; s < stamenCount; s++) {
    const isCenterPistil = s === 0;
    const sAngle = ((s - 1) / (stamenCount - 1)) * Math.PI * 2.0;
    const sRad = isCenterPistil ? 0.0 : 0.013;
    const stalkHeight = isCenterPistil ? 0.058 : 0.05;
    const stalkRadiusBottom = isCenterPistil ? 0.0045 : 0.003;
    const stalkRadiusTop = isCenterPistil ? 0.0065 : 0.0052;
    const segsY = 3;
    const segsR = 5;

    for (let yi = 0; yi <= segsY; yi++) {
      const vt = yi / segsY;
      const antherSwelling = vt > 0.55 ? 1.35 : 0.85;
      const r =
        THREE.MathUtils.lerp(stalkRadiusBottom, stalkRadiusTop, vt) *
        antherSwelling;
      const spread = sRad * (0.45 + vt * 0.85);
      const sy = vt * stalkHeight;

      for (let ri = 0; ri <= segsR; ri++) {
        const rAngle = (ri / segsR) * Math.PI * 2.0;
        const lx = Math.cos(sAngle) * spread + Math.cos(rAngle) * r;
        const lz = Math.sin(sAngle) * spread + Math.sin(rAngle) * r;
        const ly = sy + (vt === 1.0 ? 0.003 : 0.0);

        centerPositions.push(
          lx + tipX,
          ly * cosTilt - lz * sinTilt + tipY + 0.004,
          ly * sinTilt + lz * cosTilt + tipZ
        );
        centerUvs.push(vt, 1.0);
      }
    }

    const sStride = segsR + 1;
    for (let yi = 0; yi < segsY; yi++) {
      for (let ri = 0; ri < segsR; ri++) {
        const a = cVertexOffset + yi * sStride + ri;
        const b = a + 1;
        const c = a + sStride;
        const d = c + 1;
        centerIndices.push(a, c, b, b, c, d);
      }
    }
    cVertexOffset += (segsY + 1) * sStride;
  }

  const centerGeo = new THREE.BufferGeometry();
  centerGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(centerPositions, 3)
  );
  centerGeo.setAttribute('uv', new THREE.Float32BufferAttribute(centerUvs, 2));
  centerGeo.setIndex(centerIndices);
  centerGeo.computeVertexNormals();

  return { stemGeo, blossomGeo, centerGeo };
}

function applyVegetationWindShader(material, sharedUniforms, options = {}) {
  const {
    isFlower = false,
    isBlossomPetals = false,
    cacheKey = 'spring-veg-v10',
  } = options;
  material.customProgramCacheKey = () => cacheKey;

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
      uniform float uCursorWakeStrength;
      uniform float uPetalUnfurl;
      uniform float uInspectFactor;
      varying float vBladeHeight;
      ` +
      (isBlossomPetals
        ? `
      attribute vec4 aPetalData;
      varying vec2 vPetalUv;
      varying vec3 vViewPosPetal;
      varying vec3 vNormalPetal;
      `
        : '') +
      shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>

      float hFactor = clamp(uv.y, 0.0, 1.0);
      float bendWeight = hFactor * hFactor;
      vBladeHeight = hFactor;

      vec4 instWorldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

      float waveCoord = (instWorldPos.x * 0.75 + instWorldPos.z * 0.45) * uWindWaveLength;
      float rollingGust = sin(uTime * uWindSpeed - waveCoord);
      float secondaryFlutter = cos(uTime * (uWindSpeed * 1.6) + instWorldPos.x * 1.9 - instWorldPos.z * 1.4) * 0.42;

      float swayX = (rollingGust + secondaryFlutter) * uWindStrength * bendWeight;
      float swayZ = cos(uTime * (uWindSpeed * 0.85) - waveCoord * 0.8) * (uWindStrength * 0.65) * bendWeight;

      vec2 toBlade = instWorldPos.xz - uPointer.xz;
      float pointerDist = length(toBlade);
      float proximity = smoothstep(uCursorBendRadius, 0.0, pointerDist);
      float pointerPush = proximity * uCursorBendStrength * bendWeight;
      vec2 pushDir = pointerDist > 0.001 ? (toBlade / pointerDist) : vec2(0.0, 1.0);
      vec2 wakePush = uPointerVelocity * proximity * uCursorWakeStrength * bendWeight;
      ` +
        (isBlossomPetals
          ? `
      float radialT = aPetalData.x;
      float lateralW = aPetalData.y;
      vec2 petalDir = aPetalData.zw;
      vPetalUv = vec2(radialT, lateralW);

      float instancePhase = fract(sin(dot(instWorldPos.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.28318;
      float idleBreath = 0.5 + 0.5 * sin(uTime * 1.15 + instancePhase);
      float openAmount = uPetalUnfurl * (0.35 + idleBreath * 0.25 + proximity * 0.5 + uInspectFactor * 0.45);
      float petalCurve = pow(radialT, 1.75) * openAmount;

      transformed.x += petalDir.x * petalCurve * 0.022;
      transformed.z += petalDir.y * petalCurve * 0.022;
      transformed.y -= petalCurve * 0.01;
      `
          : '') +
        `
      transformed.x += swayX + pushDir.x * pointerPush + wakePush.x;
      transformed.z += swayZ + pushDir.y * pointerPush + wakePush.y;
      transformed.y -= (abs(swayX) + pointerPush) * 0.12 * bendWeight;
      `
    );

    if (isBlossomPetals) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        #include <project_vertex>
        vViewPosPetal = -mvPosition.xyz;
        vNormalPetal = normalize(normalMatrix * objectNormal);
        `
      );
    }

    if (!isFlower) {
      shader.fragmentShader =
        `varying float vBladeHeight;\n` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float rootShade = mix(0.44, 0.96, smoothstep(0.0, 0.88, vBladeHeight));
        diffuseColor.rgb *= rootShade;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.74, 0.32), smoothstep(0.6, 1.0, vBladeHeight) * 0.18);
        `
      );
    } else if (isBlossomPetals) {
      shader.fragmentShader =
        `
        uniform vec3 uThroatColor;
        varying vec2 vPetalUv;
        varying vec3 vViewPosPetal;
        varying vec3 vNormalPetal;
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float radialT = clamp(vPetalUv.x, 0.0, 1.0);
        float lateralW = abs(vPetalUv.y);

        float cupDepthAO = mix(0.48, 1.04, smoothstep(0.0, 0.72, radialT));
        float concaveFold = mix(0.88, 1.08, smoothstep(0.0, 0.85, lateralW));

        float throatMix = (1.0 - smoothstep(0.0, 0.42, radialT)) * (1.0 - lateralW * 0.5);
        vec3 basePetalColor = mix(diffuseColor.rgb * 0.9, uThroatColor, throatMix * 0.55);

        float veinStriation = sin(lateralW * 16.0) * 0.03 * radialT;
        vec3 viewDirP = normalize(vViewPosPetal);
        vec3 normP = normalize(vNormalPetal);
        float rimLight = pow(1.0 - abs(dot(viewDirP, normP)), 2.0) * smoothstep(0.3, 1.0, radialT) * 0.24;

        diffuseColor.rgb = basePetalColor * cupDepthAO * concaveFold + vec3(veinStriation + rimLight);
        `
      );
    } else {
      shader.fragmentShader =
        `varying float vBladeHeight;\n` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>
        float stamenGrad = mix(0.55, 1.15, smoothstep(0.0, 0.85, vBladeHeight));
        diffuseColor.rgb *= stamenGrad;
        `
      );
    }
  };

  material.needsUpdate = true;
}

function buildMeadowFloorShader({
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
        value: new THREE.Color(palette.groundBase || '#E5E1CF'),
      },
      uMossPrimary: {
        value: new THREE.Color(palette.groundMoss || '#6D883B'),
      },
      uMossSecondary: {
        value: new THREE.Color(palette.groundMossFresh || '#88A44E'),
      },
      uMossDeep: {
        value: new THREE.Color(palette.groundMossDeep || '#4B6324'),
      },
    },
    vertexShader: buildGroundVertexShader(),
    fragmentShader: `
      uniform float uReveal;
      uniform float uHalfWidth;
      uniform float uHalfDepth;
      uniform float uLetterCount;
      uniform vec3 uGroundBase;
      uniform vec3 uMossPrimary;
      uniform vec3 uMossSecondary;
      uniform vec3 uMossDeep;
      varying vec3 vWorldPos;
      varying vec3 vNormalWorld;
      ${GLSL_NOISE_2D}

      void main() {
        vec2 xz = vWorldPos.xz;
        float n1 = fbm(xz * 0.75 + vec2(0.4, -0.2));
        float n2 = fbm(xz * 2.1 - vec2(1.2, 0.8));
        float fineGrain = valueNoise(xz * 12.0);

        vec2 rightD = vec2((xz.x - uHalfWidth * 0.54) / (uHalfWidth * 0.52), (xz.y - 0.34) / 0.82);
        float rightZone = exp(-dot(rightD, rightD) * 1.15) * 1.12;

        vec2 midTrailD = vec2((xz.x + uHalfWidth * 0.15) / (uHalfWidth * 0.45), (xz.y - 0.38) / 0.48);
        float midTrailZone = exp(-dot(midTrailD, midTrailD) * 1.85) * 0.48;

        vec2 leftFlankD = vec2((xz.x + uHalfWidth * 0.98) / (uHalfWidth * 0.24), (xz.y + 0.08) / 0.36);
        float leftFlankZone = exp(-dot(leftFlankD, leftFlankD) * 1.95) * 0.82;

        float zoneEnvelope = max(rightZone, max(midTrailZone, leftFlankZone));
        float mossMask = smoothstep(0.24, 0.68, zoneEnvelope * (0.54 + n1 * 0.74));

        vec3 mossColor = mix(uMossSecondary, uMossPrimary, smoothstep(0.28, 0.75, n2));
        mossColor = mix(mossColor, uMossDeep, smoothstep(0.5, 0.88, n1 * n2) * 0.52);

        vec3 lightDir = normalize(vec3(0.45, 0.85, 0.38));
        float ndl = clamp(dot(vNormalWorld, lightDir), 0.0, 1.0);
        float terrainShade = 0.92 + ndl * 0.12 + (fineGrain - 0.5) * 0.03;

        float letterSpanX = 1.0 - smoothstep(uHalfWidth * 0.82, uHalfWidth * 1.05, abs(xz.x));
        float letterSpanZ = 1.0 - smoothstep(uHalfDepth * 0.4, uHalfDepth * 2.8, abs(xz.y));
        float letterWave = 0.75 + 0.25 * cos((xz.x / max(uHalfWidth, 1.0)) * uLetterCount * 3.14159);
        float contactShadow = letterSpanX * letterSpanZ * letterWave;

        vec3 shadowTint = mix(uGroundBase * 0.78, uMossDeep * 0.68, mossMask);
        vec3 surfaceCol = mix(uGroundBase, mossColor * terrainShade, mossMask * 0.92);
        surfaceCol = mix(surfaceCol, shadowTint, contactShadow * 0.38);

        float patchAlpha = clamp(mossMask * 0.95 + contactShadow * 0.58, 0.0, 1.0);
        float radialCutoff = 1.0 - smoothstep(uHalfWidth * 1.25, uHalfWidth * 1.85, length(xz * vec2(0.82, 1.15)));
        float finalAlpha = patchAlpha * radialCutoff;

        surfaceCol = pow(max(surfaceCol, vec3(0.0)), vec3(1.0 / 2.2));
        gl_FragColor = vec4(surfaceCol, finalAlpha * uReveal);
      }
    `,
  };
}

function buildSpringBouquetClusters(typoWidth, halfWidth, halfDepth) {
  const clusterSpanScale = Math.max(typoWidth / 4.5, 0.85);
  return [
    {
      x: halfWidth * 0.26,
      z: halfDepth * 0.92,
      radius: 0.19 * clusterSpanScale,
      theme: 'crocus-purple',
      tall: true,
    },
    {
      x: halfWidth * 0.52,
      z: halfDepth * 0.96,
      radius: 0.22 * clusterSpanScale,
      theme: 'crocus-purple',
      tall: true,
    },
    {
      x: halfWidth * 0.78,
      z: halfDepth * 0.82,
      radius: 0.22 * clusterSpanScale,
      theme: 'crocus-purple',
      tall: true,
    },
    {
      x: halfWidth * 0.62,
      z: 0.48,
      radius: 0.24 * clusterSpanScale,
      theme: 'meadow-mix',
      tall: false,
    },
    {
      x: halfWidth * 0.5,
      z: -halfDepth * 0.95,
      radius: 0.22 * clusterSpanScale,
      theme: 'pink-lavender',
      tall: true,
    },
    {
      x: -halfWidth * 0.98,
      z: -0.06,
      radius: 0.16 * clusterSpanScale,
      theme: 'snowdrop-white',
      tall: false,
    },
  ];
}

function populateFineGrassTufts({
  mesh,
  fineBladeCount,
  halfWidth,
  halfDepth,
  moundHeight,
  meadowScale,
  grassCfg,
  colors,
  dummy,
  tempColor,
}) {
  const { cSage, cFresh, cYellowGreen, cDeepMoss } = colors;
  const minH = (grassCfg.minHeight ?? 0.05) * meadowScale;
  const maxH = (grassCfg.maxHeight ?? 0.24) * meadowScale;
  const maxOverlapH = (grassCfg.letterOverlapMax ?? 0.21) * meadowScale;

  let placed = 0;
  let attempt = 0;

  while (placed < fineBladeCount && attempt < fineBladeCount * 5) {
    attempt++;
    const tuftSeed = Math.floor(placed / 8);
    const bladeInTuft = placed % 8;

    const r1 = hash2D(tuftSeed * 1.13 + attempt * 0.07, 0.5);
    const r2 = hash2D(tuftSeed * 2.39 + 1.7, attempt * 0.11);
    const r3 = hash2D(tuftSeed * 3.73 + 4.2, bladeInTuft * 1.91);

    let tuftX;
    let tuftZ;

    if (r1 < 0.52) {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(hash2D(tuftSeed, 3.9), 0.68);
      tuftX = halfWidth * 0.54 + Math.cos(angle) * radius * (halfWidth * 0.48);
      tuftZ = 0.34 + Math.sin(angle) * radius * 0.68;
    } else if (r1 < 0.84) {
      tuftX = halfWidth * 0.18 + hash2D(tuftSeed, 8.2) * (halfWidth * 0.78);
      const sideSign = hash2D(tuftSeed, 9.1) > 0.28 ? 1.0 : -1.0;
      tuftZ =
        sideSign *
        (halfDepth * 0.38 + Math.pow(hash2D(tuftSeed, 5.3), 1.4) * 0.42);
    } else if (r1 < 0.93) {
      const angle = r2 * Math.PI * 2.0;
      const radius = Math.pow(hash2D(tuftSeed, 4.4), 0.72);
      tuftX =
        -halfWidth * 0.98 + Math.cos(angle) * radius * (halfWidth * 0.22);
      tuftZ = -0.06 + Math.sin(angle) * radius * 0.32;
    } else {
      tuftX = -halfWidth * 0.15 + (r2 - 0.5) * (halfWidth * 0.55);
      tuftZ = 0.34 + (hash2D(tuftSeed, 6.7) - 0.5) * 0.32;
    }

    const density = sampleVegetationDensity(tuftX, tuftZ, halfWidth, halfDepth);
    if (density < 0.14 && attempt < fineBladeCount * 4) continue;

    const tuftAngle =
      (bladeInTuft / 8) * Math.PI * 2.0 + hash2D(placed, 2.1) * 0.5;
    const tuftSpread =
      (0.01 + hash2D(placed, 4.8) * 0.036) *
      meadowScale *
      (bladeInTuft > 0 ? 1 : 0);
    let x = tuftX + Math.cos(tuftAngle) * tuftSpread;
    let z = tuftZ + Math.sin(tuftAngle) * tuftSpread;

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.36) {
      z = z >= 0 ? halfDepth * 0.4 : -halfDepth * 0.4;
    }

    const terrainY = sampleMeadowElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );

    let bladeH =
      minH + Math.pow(density, 0.85) * (maxH - minH) * (0.5 + r3 * 0.55);

    if (x < halfWidth * 0.14 && x > -halfWidth * 0.85) {
      bladeH = Math.min(bladeH, minH * 1.15);
    } else if (x >= halfWidth * 0.14 && Math.abs(z) < halfDepth * 1.75) {
      bladeH = Math.min(bladeH, maxOverlapH * (0.68 + r3 * 0.42));
    }

    const widthScale = (0.82 + hash2D(placed, 12.4) * 0.42) * meadowScale;
    dummy.position.set(x, terrainY - 0.005, z);
    dummy.rotation.set(
      0.06 + hash2D(placed, 3.1) * 0.18,
      tuftAngle + (hash2D(placed, 7.7) - 0.5) * 0.4,
      (hash2D(placed, 5.9) - 0.5) * 0.18
    );
    dummy.scale.set(widthScale, bladeH, widthScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);

    const colorNoise = fbm2D(x * 1.8 + 4.0, z * 1.8 - 2.0);
    tempColor
      .copy(cSage)
      .lerp(cFresh, THREE.MathUtils.clamp(colorNoise * 1.25, 0, 1));
    if (r3 > 0.65) {
      tempColor.lerp(cYellowGreen, (r3 - 0.65) * 1.35);
    } else if (r3 < 0.28) {
      tempColor.lerp(cDeepMoss, (0.28 - r3) * 1.45);
    }
    mesh.setColorAt(placed, tempColor);

    placed++;
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function populateArchingShoots({
  mesh,
  archingShootCount,
  clusterDefinitions,
  halfWidth,
  halfDepth,
  moundHeight,
  meadowScale,
  colors,
  dummy,
  tempColor,
}) {
  const { cSage, cFresh, cDeepMoss } = colors;
  for (let i = 0; i < archingShootCount; i++) {
    const clusterIndex =
      i % 8 === 0 ? 5 : i % (clusterDefinitions.length - 1);
    const cluster = clusterDefinitions[clusterIndex];

    const r1 = hash2D(i * 1.71, 2.3);
    const r2 = hash2D(i * 2.93, 6.1);
    const r3 = hash2D(i * 4.17, 9.8);

    const angle = r1 * Math.PI * 2.0;
    const dist = Math.pow(r2, 0.75) * cluster.radius * 0.85;
    let x = cluster.x + Math.cos(angle) * dist;
    let z = cluster.z + Math.sin(angle) * dist;

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.36) {
      z = z >= 0 ? halfDepth * 0.42 : -halfDepth * 0.42;
    }

    const terrainY = sampleMeadowElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );

    const maxShootH = (cluster.tall ? 0.26 : 0.18) * meadowScale;
    const minShootH = 0.08 * meadowScale;
    const shootH = minShootH + r3 * (maxShootH - minShootH);

    dummy.position.set(x, terrainY - 0.005, z);
    const outwardYaw =
      Math.atan2(x - cluster.x, z - cluster.z) + (r1 - 0.5) * 0.5;
    dummy.rotation.set(0.08 + r2 * 0.2, outwardYaw, (r3 - 0.5) * 0.16);
    dummy.scale.set(
      (0.84 + r1 * 0.32) * meadowScale,
      shootH,
      (0.84 + r2 * 0.32) * meadowScale
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    tempColor
      .copy(cDeepMoss)
      .lerp(cSage, 0.4 + r2 * 0.5)
      .lerp(cFresh, r3 * 0.25);
    mesh.setColorAt(i, tempColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function populateSpringFlowers({
  stemMesh,
  blossomMesh,
  centerMesh,
  flowerCount,
  clusterDefinitions,
  halfWidth,
  halfDepth,
  moundHeight,
  meadowScale,
  flowerCfg,
  dummy,
  tempColor,
}) {
  const fWhite = new THREE.Color(flowerCfg.palette?.white || '#FFFFFF');
  const fPurple = new THREE.Color(flowerCfg.palette?.purple || '#6B469E');
  const fLavender = new THREE.Color(flowerCfg.palette?.lavender || '#9876D8');
  const fPink = new THREE.Color(flowerCfg.palette?.pink || '#EE8CA7');
  const fYellow = new THREE.Color(flowerCfg.palette?.yellow || '#F5C636');

  const minStemH = (flowerCfg.minStemHeight ?? 0.12) * meadowScale;
  const maxStemH = (flowerCfg.maxStemHeight ?? 0.27) * meadowScale;

  for (let i = 0; i < flowerCount; i++) {
    const r1 = hash2D(i * 3.11 + 1.2, 4.7);
    const r2 = hash2D(i * 5.29 + 3.4, 8.1);
    const r3 = hash2D(i * 7.43 + 2.9, 1.9);

    const clusterIndex =
      i % 10 === 0 ? 5 : i % (clusterDefinitions.length - 1);
    const cluster = clusterDefinitions[clusterIndex];

    const angle = r1 * Math.PI * 2.0;
    const spread = Math.pow(r2, 0.75) * cluster.radius * 0.85;

    let x = cluster.x + Math.cos(angle) * spread;
    let z = cluster.z + Math.sin(angle) * spread;

    if (Math.abs(x) < halfWidth * 0.94 && Math.abs(z) < halfDepth * 0.38) {
      z = z >= 0 ? halfDepth * 0.44 : -halfDepth * 0.44;
    }

    const terrainY = sampleMeadowElevation(
      x,
      z,
      halfWidth,
      halfDepth,
      moundHeight
    );

    const stemCap = cluster.tall ? maxStemH : maxStemH * 0.76;
    const stemH = minStemH + Math.pow(r3, 0.9) * (stemCap - minStemH);
    const heightScale = stemH / REF_STEM_HEIGHT;
    const blossomScale = (0.78 + r2 * 0.42) * meadowScale;

    const baseFacingYaw = z < -halfDepth * 0.5 ? Math.PI : 0.0;
    const yaw = baseFacingYaw + (r1 - 0.5) * 1.75;
    const clusterSplayZ = THREE.MathUtils.clamp(
      (x - cluster.x) * -0.45,
      -0.2,
      0.2
    );
    const tiltX = (r2 - 0.42) * 0.2;

    dummy.position.set(x, terrainY - 0.005, z);
    dummy.rotation.set(tiltX, yaw, clusterSplayZ);
    dummy.scale.set(blossomScale, heightScale, blossomScale);
    dummy.updateMatrix();

    stemMesh.setMatrixAt(i, dummy.matrix);
    blossomMesh.setMatrixAt(i, dummy.matrix);
    centerMesh.setMatrixAt(i, dummy.matrix);

    if (cluster.theme === 'crocus-purple') {
      tempColor.copy(r3 > 0.35 ? fPurple : fLavender);
      if (r1 > 0.86) tempColor.copy(fYellow);
    } else if (cluster.theme === 'snowdrop-white') {
      tempColor.copy(r3 > 0.22 ? fWhite : fLavender);
    } else if (cluster.theme === 'pink-lavender') {
      tempColor.copy(r3 > 0.45 ? fPink : fLavender);
      if (r2 > 0.82) tempColor.copy(fWhite);
    } else {
      if (r3 < 0.3) tempColor.copy(fPurple);
      else if (r3 < 0.58) tempColor.copy(fLavender);
      else if (r3 < 0.82) tempColor.copy(fYellow);
      else tempColor.copy(fPink);
    }

    blossomMesh.setColorAt(i, tempColor);
  }

  stemMesh.instanceMatrix.needsUpdate = true;
  blossomMesh.instanceMatrix.needsUpdate = true;
  centerMesh.instanceMatrix.needsUpdate = true;
  if (blossomMesh.instanceColor) blossomMesh.instanceColor.needsUpdate = true;
}

export function SeasonalMeadow({
  seasonConfig,
  typographyBounds,
  pointerWorldRef,
  depthProgressRef,
}) {
  const groundGroupRef = useRef(null);
  const floorMaterialRef = useRef(null);
  const fineGrassRef = useRef(null);
  const archingShootRef = useRef(null);
  const flowerStemRef = useRef(null);
  const flowerBlossomRef = useRef(null);
  const flowerCenterRef = useRef(null);

  const prevPointerXZ = useRef(new THREE.Vector2(999, 999));
  const smoothedGroundVel = useRef(new THREE.Vector2(0, 0));

  const { palette, environment = {} } = seasonConfig;
  const groundCfg = environment.ground || {};
  const grassCfg = environment.grass || {};
  const flowerCfg = environment.flowers || {};

  const typoWidth = typographyBounds?.width ?? 5.4;
  const typoHeight = typographyBounds?.height ?? 1.12;
  const typoDepth = typographyBounds?.depth ?? 0.22;
  const typoBottomY = typographyBounds?.bottomY ?? -0.44;
  const letterCount = typographyBounds?.letterCount ?? 5;

  const meadowScale = THREE.MathUtils.clamp(typoHeight / 0.72, 0.9, 1.85);
  const halfWidth = typoWidth * 0.5;
  const halfDepth = Math.max(typoDepth * 0.5, 0.11);
  const moundHeight =
    (groundCfg.moundHeight ?? 0.09) * (0.65 + meadowScale * 0.35);
  const baseGroundY = typoBottomY - 0.008;

  const groundWidth = Math.max(
    typoWidth * (groundCfg.widthMultiplier ?? 4.2),
    groundCfg.minWidth ?? 26.0
  );
  const groundDepth = groundCfg.depth ?? 14.0;

  const vegetationUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector3(999, 999, 999) },
      uPointerVelocity: { value: new THREE.Vector2(0, 0) },
      uWindSpeed: { value: grassCfg.windSpeed ?? 1.2 },
      uWindStrength: { value: grassCfg.windStrength ?? 0.038 },
      uWindWaveLength: { value: grassCfg.windWaveLength ?? 0.65 },
      uCursorBendRadius: { value: grassCfg.cursorBendRadius ?? 1.45 },
      uCursorBendStrength: { value: grassCfg.cursorBendStrength ?? 0.09 },
      uCursorWakeStrength: { value: grassCfg.cursorWakeStrength ?? 0.12 },
      uPetalUnfurl: { value: flowerCfg.petalUnfurlAmount ?? 0.34 },
      uInspectFactor: { value: 0 },
      uThroatColor: {
        value: new THREE.Color(flowerCfg.throatColor || '#FFF6D6'),
      },
    }),
    [grassCfg, flowerCfg]
  );

  const terrainGeometry = useMemo(
    () =>
      createDisplacedTerrainGeometry({
        width: groundWidth,
        depth: groundDepth,
        segmentsX: 112,
        segmentsZ: 72,
        sampleElevation: (vx, vz) =>
          sampleMeadowElevation(vx, vz, halfWidth, halfDepth, moundHeight),
      }),
    [groundWidth, groundDepth, halfWidth, halfDepth, moundHeight]
  );

  const floorShader = useMemo(
    () =>
      buildMeadowFloorShader({
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
    fineBladeGeo,
    archingShootGeo,
    stemGeo,
    blossomGeo,
    centerGeo,
    grassMaterial,
    stemMaterial,
    blossomMaterial,
    centerMaterial,
  } = useMemo(() => {
    const fGeo = createFineGrassBladeGeometry();
    const aGeo = createGrassStripGeometry({
      segments: 6,
      baseWidth: 0.0135,
      curveZ: 0.35,
      curvePower: 1.65,
      taperMode: 'sine',
      archDroop: 0.14,
    });
    const {
      stemGeo: sGeo,
      blossomGeo: bGeo,
      centerGeo: cGeo,
    } = createFlowerGeometries();

    const gMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.68,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });
    applyVegetationWindShader(gMat, vegetationUniforms, {
      isFlower: false,
      cacheKey: 'spring-grass-blade-v10',
    });

    const sMat = new THREE.MeshStandardMaterial({
      color: flowerCfg.stemColor || '#486323',
      roughness: 0.58,
      metalness: 0.01,
    });
    applyVegetationWindShader(sMat, vegetationUniforms, {
      isFlower: false,
      cacheKey: 'spring-flower-stem-v10',
    });

    const bMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.34,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });
    applyVegetationWindShader(bMat, vegetationUniforms, {
      isFlower: true,
      isBlossomPetals: true,
      cacheKey: 'spring-flower-blossom-v10',
    });

    const cMat = new THREE.MeshStandardMaterial({
      color: flowerCfg.centerColor || '#F2A30F',
      roughness: 0.4,
      metalness: 0.02,
    });
    applyVegetationWindShader(cMat, vegetationUniforms, {
      isFlower: true,
      isBlossomPetals: false,
      cacheKey: 'spring-flower-center-v10',
    });

    return {
      fineBladeGeo: fGeo,
      archingShootGeo: aGeo,
      stemGeo: sGeo,
      blossomGeo: bGeo,
      centerGeo: cGeo,
      grassMaterial: gMat,
      stemMaterial: sMat,
      blossomMaterial: bMat,
      centerMaterial: cMat,
    };
  }, [vegetationUniforms, flowerCfg.stemColor, flowerCfg.centerColor]);

  useEffect(() => {
    return () => {
      terrainGeometry.dispose();
      fineBladeGeo.dispose();
      archingShootGeo.dispose();
      stemGeo.dispose();
      blossomGeo.dispose();
      centerGeo.dispose();
      grassMaterial.dispose();
      stemMaterial.dispose();
      blossomMaterial.dispose();
      centerMaterial.dispose();
    };
  }, [
    terrainGeometry,
    fineBladeGeo,
    archingShootGeo,
    stemGeo,
    blossomGeo,
    centerGeo,
    grassMaterial,
    stemMaterial,
    blossomMaterial,
    centerMaterial,
  ]);

  const fineBladeCount = grassCfg.fineBladeCount ?? 3800;
  const archingShootCount = grassCfg.archingShootCount ?? 680;
  const flowerCount = flowerCfg.count ?? 110;

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const tempColor = new THREE.Color();
    const colors = {
      cSage: new THREE.Color(grassCfg.colors?.sage || '#5E7A32'),
      cFresh: new THREE.Color(grassCfg.colors?.freshGreen || '#759440'),
      cYellowGreen: new THREE.Color(grassCfg.colors?.yellowGreen || '#93AF52'),
      cDeepMoss: new THREE.Color(grassCfg.colors?.deepMoss || '#41581E'),
    };
    const clusterDefinitions = buildSpringBouquetClusters(
      typoWidth,
      halfWidth,
      halfDepth
    );

    if (fineGrassRef.current) {
      populateFineGrassTufts({
        mesh: fineGrassRef.current,
        fineBladeCount,
        halfWidth,
        halfDepth,
        moundHeight,
        meadowScale,
        grassCfg,
        colors,
        dummy,
        tempColor,
      });
    }

    if (archingShootRef.current) {
      populateArchingShoots({
        mesh: archingShootRef.current,
        archingShootCount,
        clusterDefinitions,
        halfWidth,
        halfDepth,
        moundHeight,
        meadowScale,
        colors,
        dummy,
        tempColor,
      });
    }

    if (
      flowerStemRef.current &&
      flowerBlossomRef.current &&
      flowerCenterRef.current
    ) {
      populateSpringFlowers({
        stemMesh: flowerStemRef.current,
        blossomMesh: flowerBlossomRef.current,
        centerMesh: flowerCenterRef.current,
        flowerCount,
        clusterDefinitions,
        halfWidth,
        halfDepth,
        moundHeight,
        meadowScale,
        flowerCfg,
        dummy,
        tempColor,
      });
    }
  }, [
    typoWidth,
    typoHeight,
    typoDepth,
    meadowScale,
    halfWidth,
    halfDepth,
    letterCount,
    moundHeight,
    fineBladeCount,
    archingShootCount,
    flowerCount,
    grassCfg,
    flowerCfg,
  ]);

  useGroundRevealSync(groundGroupRef, floorMaterialRef, depthProgressRef);

  useFrame((state, delta) => {
    applyGroundRevealFrame(groundGroupRef, floorMaterialRef, depthProgressRef);

    const dt = Math.min(delta, 0.1);
    vegetationUniforms.uTime.value = state.clock.getElapsedTime();

    if (pointerWorldRef?.current) {
      vegetationUniforms.uPointer.value.copy(pointerWorldRef.current);
      updateSmoothedGroundVelocity({
        pointerWorldRef,
        prevPointerXZ,
        smoothedGroundVel,
        velocityUniform: vegetationUniforms.uPointerVelocity,
        scale: 0.06,
        clampMax: 1.0,
        dt,
      });
    }

    const camDist = state.camera.position.length();
    const targetInspect = THREE.MathUtils.clamp((7.15 - camDist) / 2.4, 0, 1);
    vegetationUniforms.uInspectFactor.value = THREE.MathUtils.damp(
      vegetationUniforms.uInspectFactor.value,
      targetInspect,
      4.5,
      dt
    );
  });

  return (
    <group
      ref={groundGroupRef}
      name="dynamic-spring-meadow"
      position={[0, baseGroundY, 0]}
    >
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

      {grassCfg.enabled !== false && (
        <instancedMesh
          ref={fineGrassRef}
          args={[fineBladeGeo, grassMaterial, fineBladeCount]}
          frustumCulled={false}
          receiveShadow
        />
      )}

      {grassCfg.enabled !== false && (
        <instancedMesh
          ref={archingShootRef}
          args={[archingShootGeo, grassMaterial, archingShootCount]}
          frustumCulled={false}
          receiveShadow
        />
      )}

      {flowerCfg.enabled !== false && (
        <group name="instanced-spring-flowers">
          <instancedMesh
            ref={flowerStemRef}
            args={[stemGeo, stemMaterial, flowerCount]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={flowerBlossomRef}
            args={[blossomGeo, blossomMaterial, flowerCount]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={flowerCenterRef}
            args={[centerGeo, centerMaterial, flowerCount]}
            frustumCulled={false}
          />
        </group>
      )}
    </group>
  );
}
