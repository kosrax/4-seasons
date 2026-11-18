import * as THREE from 'three';

/**
 * Maps master 2D <-> 3D transition progress [0..1] into staggered reveal curves:
 * - worldReveal: ramps up 3D ground terrain, vegetation, and sunlight as text extrudes
 * - propReveal: delays letter-perched 3D props slightly so they land cleanly onto extruded glyphs
 */
export function computeDimensionReveals(depthProgress = 1) {
  const worldReveal = THREE.MathUtils.smoothstep(depthProgress, 0.18, 0.96);
  const propReveal = THREE.MathUtils.smoothstep(depthProgress, 0.42, 1.0);
  return { worldReveal, propReveal };
}

/**
 * Aligns a letter-mounted 3D prop (sunglasses, autumn leaf, icicles) to the live
 * world transform of the animated seasonal typography mesh.
 */
export function syncObjectToTypographyAnchor({
  object,
  scene,
  restPosition,
  baseScale,
  propReveal,
  orientationQuat,
  applyTransitionScale = false,
  tempPoint,
  tempQuat,
}) {
  const typoTarget =
    scene.getObjectByName('seasonal-typography-transition') ||
    scene.getObjectByName('seasonal-typography-root');
  const typoRoot = scene.getObjectByName('seasonal-typography-root');

  if (typoTarget && typoRoot) {
    typoRoot.updateWorldMatrix(true, true);
    const invScale = 1.0 / Math.max(typoRoot.scale.x, 0.001);
    tempPoint.set(
      restPosition[0] * invScale,
      (restPosition[1] - 0.12) * invScale,
      restPosition[2] * invScale
    );
    tempPoint.applyMatrix4(typoTarget.matrixWorld);
    object.position.copy(tempPoint);

    typoTarget.getWorldQuaternion(tempQuat);
    object.quaternion.copy(tempQuat).multiply(orientationQuat);

    if (applyTransitionScale) {
      object.scale.setScalar(
        Math.max(0.0001, baseScale * typoTarget.scale.y * propReveal)
      );
    }
  } else {
    object.position.set(restPosition[0], restPosition[1], restPosition[2]);
    object.quaternion.copy(orientationQuat);
  }
}
