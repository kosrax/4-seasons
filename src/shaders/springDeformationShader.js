import * as THREE from 'three';

export function createSpringShaderUniforms(
  seasonConfig,
  initialDepthProgress = 1
) {
  const { interaction = {}, material = {}, animation = {} } = seasonConfig;

  return {
    uTime: { value: 0 },
    uDepthProgress: { value: initialDepthProgress },
    uPointer: { value: new THREE.Vector3(0, 0, 0) },
    uVelocity: { value: new THREE.Vector2(0, 0) },
    uDeformIntensity: { value: 0 },
    uHoverState: { value: 0 },
    uDeformRadius: { value: interaction.deformRadius ?? 1.15 },
    uRadialSpread: { value: interaction.radialSpread ?? 0.09 },
    uZBulgeDepth: { value: interaction.zBulgeDepth ?? 0.16 },
    uVelocityInfluence: { value: interaction.velocityInfluence ?? 0.055 },
    uLetterBuoyancy: { value: interaction.letterBuoyancy ?? 0.024 },
    uLetterTilt: { value: interaction.letterTiltAmount ?? 0.032 },
    uVelocityShear: { value: interaction.velocityShear ?? 0.045 },
    uRippleSpeed: { value: animation.surfaceRippleSpeed ?? 1.35 },
    uRippleAmplitude: { value: animation.surfaceRippleAmplitude ?? 0.006 },
    uFlatColor: {
      value: new THREE.Color(material.flatColor ?? material.color),
    },
    uBlushColor: {
      value: new THREE.Color(material.blushResponseColor ?? '#8B689C'),
    },
    uSubsurfaceColor: {
      value: new THREE.Color(material.subsurfaceColor ?? '#C2DC7E'),
    },
    uMicroNoiseScale: { value: material.microNoiseScale ?? 3.6 },
    uMicroRoughnessAmp: { value: material.microRoughnessAmplitude ?? 0.06 },
    uSubsurfaceIntensity: { value: material.subsurfaceIntensity ?? 0.28 },
  };
}

export function applySpringDeformationShader(material, uniforms) {
  material.customProgramCacheKey = () => 'spring-botanical-bulge-v8-polish';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uDepthProgress;
      uniform vec3 uPointer;
      uniform vec2 uVelocity;
      uniform float uDeformIntensity;
      uniform float uHoverState;
      uniform float uDeformRadius;
      uniform float uRadialSpread;
      uniform float uZBulgeDepth;
      uniform float uVelocityInfluence;
      uniform float uLetterBuoyancy;
      uniform float uLetterTilt;
      uniform float uVelocityShear;
      uniform float uRippleSpeed;
      uniform float uRippleAmplitude;

      varying float vBulgeInfluence;
      varying vec3 vLocalPosition;
      varying vec3 vCustomNormal;
      varying vec3 vViewPositionCustom;
      ` + shader.vertexShader;

    // 1. Analytical Normal Perturbation + smooth flattening toward 2D planar normals
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      #include <beginnormal_vertex>

      float depthGeoNorm = smoothstep(0.0, 0.85, uDepthProgress);
      float depthShadeNorm = smoothstep(0.1, 0.92, uDepthProgress);

      vec2 toVertexNormal = position.xy - uPointer.xy;
      float distSqNormal = dot(toVertexNormal, toVertexNormal);
      float sigmaSq = max(uDeformRadius * uDeformRadius, 0.001);

      float gaussianFalloff = exp(-distSqNormal / (2.0 * sigmaSq));
      float smoothCut = smoothstep(uDeformRadius * 2.0, 0.0, sqrt(distSqNormal));
      float localInfluence = gaussianFalloff * smoothCut * uDeformIntensity * depthGeoNorm;

      vec2 domeGradient = -(toVertexNormal / sigmaSq) * (localInfluence * uZBulgeDepth * 1.15);
      vec2 velocityNormalShift = uVelocity * localInfluence * 0.12;
      float frontSignNorm = objectNormal.z >= 0.0 ? 1.0 : -1.0;
      vec3 flatNormal = vec3(0.0, 0.0, frontSignNorm);
      vec3 deformedNormal = normalize(objectNormal + vec3(-domeGradient.x - velocityNormalShift.x, -domeGradient.y - velocityNormalShift.y, 0.0));
      objectNormal = normalize(mix(flatNormal, deformedNormal, depthShadeNorm));
      `
    );

    // 2. Vertex Deformation: Planar 2D editorial ripple in 2D mode + full 3D sculptural relief in 3D mode
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>

      vLocalPosition = position;

      float depthGeoVert = smoothstep(0.0, 0.85, uDepthProgress);
      float zCompression = mix(0.0015, 1.0, depthGeoVert);
      transformed.z *= zCompression;

      vec2 toVertex = transformed.xy - uPointer.xy;
      float dist = length(toVertex);
      float safeDist = dist + 0.0001;
      float radiusSq = max(uDeformRadius * uDeformRadius, 0.001);

      float influence = exp(-(dist * dist) / (2.0 * radiusSq)) * smoothstep(uDeformRadius * 2.0, 0.0, dist);
      // Allow 45% planar XY responsiveness in 2D mode so 2D poster mode still feels alive under the cursor
      float planarScale = mix(0.45, 1.0, depthGeoVert);
      float planarInfluence = influence * uDeformIntensity * planarScale;
      float activeInfluence = influence * uDeformIntensity * depthGeoVert;

      // Root anchor factor [0 at bottom of letters -> 1 at top of letters] so bases stay grounded in 3D
      float rootAnchor = smoothstep(-0.55, 0.45, transformed.y);

      // Per-glyph localized buoyancy & subtle axial tilt
      float glyphBand = exp(-pow((transformed.x - uPointer.x) / 0.85, 2.0)) * uHoverState * planarScale;
      float glyphLiftY = glyphBand * uLetterBuoyancy * rootAnchor;
      float glyphTiltZ = glyphBand * (transformed.x - uPointer.x) * uLetterTilt * rootAnchor * depthGeoVert;

      // Synchronized travelling surface breeze
      float primaryWave = sin(transformed.x * 1.6 - uTime * uRippleSpeed)
                        * cos(transformed.y * 2.0 - uTime * (uRippleSpeed * 0.85));
      float idleSurfaceMotion = primaryWave * uRippleAmplitude * (1.0 + uHoverState * 0.35) * depthGeoVert;

      // Controlled radial stroke expansion
      float lensCurve = sin(clamp(dist / uDeformRadius, 0.0, 1.0) * 3.14159);
      vec2 radialDisplacement = (toVertex / safeDist) * (planarInfluence * uRadialSpread * (0.5 + lensCurve * 0.5));

      // Directional gesture velocity drag + vertical ribbon shear
      vec2 velocityDisplacement = uVelocity * planarInfluence * uVelocityInfluence;
      float gestureShearX = uVelocity.x * rootAnchor * glyphBand * uVelocityShear;

      float zDisplacement = activeInfluence * uZBulgeDepth + glyphTiltZ + idleSurfaceMotion;

      transformed.x += radialDisplacement.x + velocityDisplacement.x + gestureShearX;
      transformed.y += (radialDisplacement.y + velocityDisplacement.y) * (0.35 + 0.65 * rootAnchor) + glyphLiftY;
      transformed.z += zDisplacement;

      vBulgeInfluence = clamp(planarInfluence + glyphBand * 0.25, 0.0, 1.0);
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      #include <project_vertex>
      vCustomNormal = normalize(normalMatrix * objectNormal);
      vViewPositionCustom = -mvPosition.xyz;
      `
    );

    shader.fragmentShader =
      `
      uniform float uDepthProgress;
      uniform vec3 uFlatColor;
      uniform vec3 uBlushColor;
      uniform vec3 uSubsurfaceColor;
      uniform float uMicroNoiseScale;
      uniform float uMicroRoughnessAmp;
      uniform float uSubsurfaceIntensity;

      varying float vBulgeInfluence;
      varying vec3 vLocalPosition;
      varying vec3 vCustomNormal;
      varying vec3 vViewPositionCustom;

      float hash31(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float botanicalNoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        return mix(
          mix(
            mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
            mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x),
            f.y
          ),
          mix(
            mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
            mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x),
            f.y
          ),
          f.z
        );
      }
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>

      vec3 veinCoord = vec3(vLocalPosition.x * uMicroNoiseScale, vLocalPosition.y * (uMicroNoiseScale * 1.65), vLocalPosition.z * 2.0);
      float veinPattern = botanicalNoise(veinCoord) * 0.65 + botanicalNoise(veinCoord * 2.3) * 0.35;

      diffuseColor.rgb = mix(diffuseColor.rgb, uSubsurfaceColor, (1.0 - veinPattern) * 0.16);

      // Subtle warm shift on cursor proximity
      float blushMix = clamp(vBulgeInfluence * 0.22, 0.0, 0.18);
      diffuseColor.rgb = mix(diffuseColor.rgb, uBlushColor, blushMix);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `
      #include <roughnessmap_fragment>

      vec3 microCoord = vec3(vLocalPosition.x * (uMicroNoiseScale * 1.4), vLocalPosition.y * (uMicroNoiseScale * 2.2), vLocalPosition.z * 2.0);
      float microGrain = botanicalNoise(microCoord) - 0.5;

      roughnessFactor = clamp(
        roughnessFactor + microGrain * uMicroRoughnessAmp - vBulgeInfluence * 0.05,
        0.08,
        0.42
      );
      `
    );

    // Crossfade cleanly between 2D editorial ink color (with subtle cursor tint) and 3D lit glaze
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float depthShadeMix = smoothstep(0.12, 0.92, uDepthProgress);
      vec3 flatInkWithHover = mix(uFlatColor, uBlushColor, clamp(vBulgeInfluence * 0.16, 0.0, 0.14));
      outgoingLight = mix(flatInkWithHover, outgoingLight, depthShadeMix);
      #include <opaque_fragment>
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      vec3 viewDir = normalize(vViewPositionCustom);
      vec3 norm = normalize(vCustomNormal);
      float fresnelTerm = pow(1.0 - abs(dot(viewDir, norm)), 2.4);

      vec3 sssTint = mix(uSubsurfaceColor, uBlushColor, vBulgeInfluence * 0.45);
      gl_FragColor.rgb += sssTint * fresnelTerm * uSubsurfaceIntensity * (0.65 + vBulgeInfluence * 0.4) * depthShadeMix;

      #include <dithering_fragment>
      `
    );
  };

  material.needsUpdate = true;
}