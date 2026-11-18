import { useLayoutEffect } from 'react';
import { computeDimensionReveals } from '../utils/dimensionReveal.js';

/**
 * Synchronizes initial visibility, vertical scale, and shader alpha for any seasonal
 * ground/foliage group before the first paint to prevent 1-frame flickers in 2D mode.
 */
export function useGroundRevealSync(
  groundGroupRef,
  floorMaterialRef,
  depthProgressRef
) {
  useLayoutEffect(() => {
    const { worldReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    if (groundGroupRef.current) {
      groundGroupRef.current.visible = worldReveal > 0.005;
      groundGroupRef.current.scale.y = Math.max(0.0001, worldReveal);
    }
    if (floorMaterialRef?.current?.uniforms?.uReveal) {
      floorMaterialRef.current.uniforms.uReveal.value = worldReveal;
    }
  }, [groundGroupRef, floorMaterialRef, depthProgressRef]);
}

/**
 * Applies per-frame world reveal scaling and optional floor uniform updates.
 */
export function applyGroundRevealFrame(
  groundGroupRef,
  floorMaterialRef,
  depthProgressRef,
  elapsedTime
) {
  const { worldReveal } = computeDimensionReveals(
    depthProgressRef?.current ?? 1
  );
  if (groundGroupRef.current) {
    groundGroupRef.current.visible = worldReveal > 0.005;
    groundGroupRef.current.scale.y = Math.max(0.0001, worldReveal);
  }
  if (floorMaterialRef?.current?.uniforms) {
    if (floorMaterialRef.current.uniforms.uReveal) {
      floorMaterialRef.current.uniforms.uReveal.value = worldReveal;
    }
    if (
      elapsedTime !== undefined &&
      floorMaterialRef.current.uniforms.uTime
    ) {
      floorMaterialRef.current.uniforms.uTime.value = elapsedTime;
    }
  }
  return worldReveal;
}

/**
 * Synchronizes initial visibility and scale for letter-perched 3D props before first paint.
 */
export function usePerchedPropRevealSync(groupRef, scale, depthProgressRef) {
  useLayoutEffect(() => {
    if (!groupRef.current) return;
    const { propReveal } = computeDimensionReveals(
      depthProgressRef?.current ?? 1
    );
    groupRef.current.visible = propReveal > 0.005;
    groupRef.current.scale.setScalar(Math.max(0.0001, scale * propReveal));
  }, [groupRef, scale, depthProgressRef]);
}
