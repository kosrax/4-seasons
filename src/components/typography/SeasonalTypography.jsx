import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { useThree } from '@react-three/fiber';
import { Text3D, useFont } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';
import { seasonRegistry } from '../../seasons/seasonRegistry.js';
import {
  createSpringShaderUniforms,
  applySpringDeformationShader,
} from '../../shaders/springDeformationShader.js';
import { usePointerInteraction } from '../../hooks/usePointerInteraction.js';

const LOCAL_DEFAULT_FONT = '/fonts/CormorantGaramond-SemiBold.json';

// Pre-seeded cache so local fonts resolve synchronously on the very first render frame
const resolvedFontCache = new Map([[LOCAL_DEFAULT_FONT, LOCAL_DEFAULT_FONT]]);
const pendingFontChecks = new Map();

function verifyAndPreloadFont(primaryUrl, fallbackUrl) {
  if (!primaryUrl) return Promise.resolve(null);

  if (primaryUrl.startsWith('/')) {
    resolvedFontCache.set(primaryUrl, primaryUrl);
    useFont.preload(primaryUrl);
    return Promise.resolve(primaryUrl);
  }

  if (resolvedFontCache.has(primaryUrl)) {
    const cached = resolvedFontCache.get(primaryUrl);
    useFont.preload(cached);
    return Promise.resolve(cached);
  }

  if (pendingFontChecks.has(primaryUrl)) {
    return pendingFontChecks.get(primaryUrl);
  }

  const checkPromise = (async () => {
    let targetUrl = fallbackUrl || primaryUrl;
    try {
      const response = await fetch(primaryUrl, { method: 'HEAD' });
      const contentType = response.headers.get('content-type') || '';
      if (response.ok && !contentType.includes('text/html')) {
        targetUrl = primaryUrl;
      }
    } catch {
      // Fallback retained when offline or primary URL fails
    }

    resolvedFontCache.set(primaryUrl, targetUrl);
    useFont.preload(targetUrl);
    pendingFontChecks.delete(primaryUrl);
    return targetUrl;
  })();

  pendingFontChecks.set(primaryUrl, checkPromise);
  return checkPromise;
}

function useResolvedFont(primaryUrl, fallbackUrl) {
  const cached = primaryUrl
    ? resolvedFontCache.get(primaryUrl) ??
      (primaryUrl.startsWith('/') ? primaryUrl : null)
    : null;
  const [, forceRender] = useState(0);

  useEffect(() => {
    // Pre-verify and preload all seasonal fonts on mount so season switches never flash or lag
    Object.values(seasonRegistry).forEach((season) => {
      if (season?.typography?.fontUrl) {
        verifyAndPreloadFont(
          season.typography.fontUrl,
          season.typography.fallbackFontUrl
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!primaryUrl || resolvedFontCache.has(primaryUrl)) return;

    let isMounted = true;
    verifyAndPreloadFont(primaryUrl, fallbackUrl).then(() => {
      if (isMounted) {
        forceRender((n) => n + 1);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [primaryUrl, fallbackUrl]);

  return cached;
}

export function SeasonalTypography({
  seasonConfig,
  resetSignal,
  dimensionMode = '3d',
  depthProgressRef,
  pointerWorldRef,
  onToggleDimension,
  onInteractionStateChange,
  onTypographyBoundsChange,
}) {
  const groupRef = useRef(null);
  const transitionGroupRef = useRef(null);
  const meshRef = useRef(null);
  const [wordBoxSize, setWordBoxSize] = useState([6.5, 1.4]);
  const { viewport } = useThree();
  const { typography, material: matConfig, headline } = seasonConfig;

  const resolvedUrl = useResolvedFont(
    typography.fontUrl,
    typography.fallbackFontUrl
  );

  // Adaptive framing across mobile portrait, tablet, and widescreen monitors
  const responsiveScale = useMemo(() => {
    const isCompactViewport = viewport.width < 5.2;
    const widthCoverage = isCompactViewport ? 0.8 : 0.68;
    const estimatedBaseWidth = headline.length * typography.size * 0.92;
    const targetWidth = viewport.width * widthCoverage;
    const rawScale = targetWidth / estimatedBaseWidth;
    return THREE.MathUtils.clamp(rawScale, 0.32, 1.05);
  }, [viewport.width, headline.length, typography.size]);

  useLayoutEffect(() => {
    if (meshRef.current && meshRef.current.geometry) {
      const geo = meshRef.current.geometry;
      geo.center();
      geo.computeBoundingBox();
      geo.computeVertexNormals();

      if (geo.boundingBox && onTypographyBoundsChange) {
        const bbox = geo.boundingBox;
        const localWidth = bbox.max.x - bbox.min.x;
        const localHeight = bbox.max.y - bbox.min.y;
        const localDepth = bbox.max.z - bbox.min.z;
        setWordBoxSize((prev) =>
          Math.abs(prev[0] - localWidth) < 0.01 &&
          Math.abs(prev[1] - localHeight) < 0.01
            ? prev
            : [localWidth, localHeight]
        );
        const centerY = 0.12;
        const worldWidth = localWidth * responsiveScale;
        const worldHeight = localHeight * responsiveScale;
        const worldDepth = localDepth * responsiveScale;
        const bottomY = centerY + bbox.min.y * responsiveScale;
        const topY = centerY + bbox.max.y * responsiveScale;

        // Measure the exact top surface of the first letter ('B', 'H', 'F') so props rest directly on it
        const posAttr = geo.attributes.position;
        const firstLetterSpan = 1.05 / Math.max(headline.length, 1);
        const firstLetterMaxX = bbox.min.x + localWidth * firstLetterSpan;
        const topSurfaceMinY = bbox.max.y - localHeight * 0.08;
        let hMinX = Infinity;
        let hMaxX = -Infinity;
        let hMaxY = -Infinity;

        if (posAttr) {
          for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i);
            const vy = posAttr.getY(i);
            if (vx <= firstLetterMaxX && vy >= topSurfaceMinY) {
              if (vx < hMinX) hMinX = vx;
              if (vx > hMaxX) hMaxX = vx;
              if (vy > hMaxY) hMaxY = vy;
            }
          }
        }

        const hasValidHBounds =
          hMinX < hMaxX && Number.isFinite(hMinX) && Number.isFinite(hMaxY);
        const hCenterX = hasValidHBounds
          ? (hMinX + hMaxX) * 0.5 * responsiveScale
          : -worldWidth * 0.375;
        const hWidth = hasValidHBounds
          ? (hMaxX - hMinX) * responsiveScale
          : worldWidth * 0.21;
        const hTopY = centerY + hMaxY * responsiveScale;

        onTypographyBoundsChange({
          width: worldWidth,
          height: worldHeight,
          depth: worldDepth,
          bottomY,
          topY,
          centerY,
          hCenterX,
          hWidth,
          hTopY,
          scale: responsiveScale,
          letterCount: headline.length,
          headline,
        });
      }
    }
  }, [
    resolvedUrl,
    headline,
    typography,
    responsiveScale,
    onTypographyBoundsChange,
  ]);

  // GSAP seasonal transition choreography when switching between Spring, Summer, Autumn, and Winter
  useLayoutEffect(() => {
    if (!transitionGroupRef.current) return;
    const tg = transitionGroupRef.current;
    const isFlat2D = (depthProgressRef?.current ?? 1) < 0.25;

    gsap.killTweensOf(tg.position);
    gsap.killTweensOf(tg.scale);
    gsap.killTweensOf(tg.rotation);

    gsap.fromTo(
      tg.position,
      { y: isFlat2D ? -0.12 : -0.22, z: isFlat2D ? 0 : -0.16 },
      { y: 0, z: 0, duration: 0.82, ease: 'power3.out' }
    );
    gsap.fromTo(
      tg.scale,
      { x: 0.95, y: isFlat2D ? 0.93 : 0.8, z: isFlat2D ? 1 : 0.9 },
      { x: 1, y: 1, z: 1, duration: 0.88, ease: 'expo.out' }
    );
    gsap.fromTo(
      tg.rotation,
      { x: isFlat2D ? 0 : 0.14 },
      { x: 0, duration: 0.82, ease: 'power3.out' }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonConfig.id, resolvedUrl]);

  const shaderUniforms = useMemo(
    () =>
      createSpringShaderUniforms(
        seasonConfig,
        depthProgressRef?.current ?? 1
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seasonConfig]
  );

  const physicalMaterial = useMemo(() => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(matConfig.color),
      emissive: new THREE.Color(matConfig.emissive),
      emissiveIntensity: matConfig.emissiveIntensity,
      roughness: matConfig.roughness,
      metalness: matConfig.metalness,
      clearcoat: matConfig.clearcoat,
      clearcoatRoughness: matConfig.clearcoatRoughness,
      sheen: matConfig.sheen,
      sheenRoughness: matConfig.sheenRoughness,
      sheenColor: new THREE.Color(matConfig.sheenColor),
      reflectivity: matConfig.reflectivity,
      envMapIntensity: 1.05,
    });

    applySpringDeformationShader(mat, shaderUniforms);
    return mat;
  }, [matConfig, shaderUniforms]);

  useEffect(() => {
    return () => {
      physicalMaterial.dispose();
    };
  }, [physicalMaterial]);

  const {
    handleMeshPointerOver,
    handleMeshPointerOut,
    handleWordBoxPointerOver,
    handleWordBoxPointerOut,
    handleMeshClick,
  } = usePointerInteraction({
    groupRef,
    meshRef,
    shaderUniforms,
    seasonConfig,
    resetSignal,
    dimensionMode,
    depthProgressRef,
    pointerWorldRef,
    onToggleDimension,
    onInteractionStateChange,
  });

  if (!resolvedUrl) {
    return null;
  }

  return (
    <group
      ref={groupRef}
      name="seasonal-typography-root"
      scale={responsiveScale}
      position={[0, 0.12, 0]}
    >
      <group ref={transitionGroupRef} name="seasonal-typography-transition">
        <Text3D
          ref={meshRef}
          font={resolvedUrl}
          size={typography.size}
          height={typography.height}
          curveSegments={typography.curveSegments}
          bevelEnabled={typography.bevelEnabled}
          bevelThickness={typography.bevelThickness}
          bevelSize={typography.bevelSize}
          bevelOffset={typography.bevelOffset}
          bevelSegments={typography.bevelSegments}
          letterSpacing={typography.letterSpacing}
          material={physicalMaterial}
          castShadow
          receiveShadow
          onPointerOver={handleMeshPointerOver}
          onPointerOut={handleMeshPointerOut}
          onClick={handleMeshClick}
        >
          {headline}
        </Text3D>

        {/* Tight invisible hit-plane over the word bounds so clicking inside letter counters (e.g. 'O') also toggles 2D/3D */}
        <mesh
          onPointerOver={handleWordBoxPointerOver}
          onPointerOut={handleWordBoxPointerOut}
          onClick={handleMeshClick}
        >
          <planeGeometry args={wordBoxSize} />
          <meshBasicMaterial
            transparent
            opacity={0}
            depthWrite={false}
            colorWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </group>
  );
}