import { useEffect, useRef, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function usePointerInteraction({
  groupRef,
  meshRef,
  shaderUniforms,
  seasonConfig,
  resetSignal,
  dimensionMode = '3d',
  depthProgressRef,
  pointerWorldRef,
  onToggleDimension,
  onInteractionStateChange,
}) {
  const { gl } = useThree();
  const { interaction, animation, camera: cameraConfig } = seasonConfig;

  const textPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.34));
  const worldHitPoint = useRef(new THREE.Vector3());
  const groundHitPoint = useRef(new THREE.Vector3());
  const localTargetPoint = useRef(new THREE.Vector3());
  const lookAtTarget = useRef(new THREE.Vector3(0, 0.08, 0));
  const cameraRightVec = useRef(new THREE.Vector3(1, 0, 0));
  const prefersReducedMotion = useRef(false);

  const stateRef = useRef({
    isHoveringMesh: false,
    isHoveringWordBox: false,
    isPointerInCanvas: false,
    isPointerDown: false,
    isDragging: false,
    isPanMode: false,
    pointerDownOrigin: new THREE.Vector2(),
    dragStartPointer: new THREE.Vector2(),
    dragDistance: 0,
    lastToggleTime: 0,
    azimuth: 0,
    targetAzimuth: 0,
    verticalPull: 0,
    targetVerticalPull: 0,
    lateralPan: 0,
    targetLateralPan: 0,
    smoothedPointerLocal: new THREE.Vector3(0, 0, 0),
    previousPointerLocal: new THREE.Vector3(0, 0, 0),
    smoothedVelocity: new THREE.Vector2(0, 0),
    currentDeformIntensity: 0,
    currentHoverLevel: 0,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mediaQuery.matches;
    const listener = (e) => {
      prefersReducedMotion.current = e.matches;
    };
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    const is2DMode = dimensionMode === '2d';
    if (!is2DMode && !resetSignal) return;

    const s = stateRef.current;
    s.azimuth = Math.atan2(Math.sin(s.azimuth), Math.cos(s.azimuth));
    s.targetAzimuth = 0;
    s.targetVerticalPull = 0;
    s.targetLateralPan = 0;
    s.isPointerDown = false;
    s.isDragging = false;

    gl.domElement.style.cursor =
      s.isHoveringMesh || s.isHoveringWordBox
        ? 'pointer'
        : is2DMode
        ? 'default'
        : 'grab';

    if (onInteractionStateChange) {
      onInteractionStateChange({ isRotated: false, isDragging: false });
    }
  }, [resetSignal, dimensionMode, gl, onInteractionStateChange]);

  useEffect(() => {
    const domElement = gl.domElement;
    const s = stateRef.current;
    const is2DMode = dimensionMode === '2d';

    const orbitSensitivity = interaction.orbitSensitivity ?? 0.0065;
    const pullSensitivity = interaction.pullSensitivity ?? 0.0042;
    const panSensitivity = interaction.panSensitivity ?? 0.0048;
    const maxLateralPan = interaction.maxLateralPan ?? 2.0;

    const handleContextMenu = (e) => e.preventDefault();

    const handlePointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0 && e.button !== 2) return;
      s.pointerDownOrigin.set(e.clientX, e.clientY);
      s.dragStartPointer.set(e.clientX, e.clientY);
      s.dragDistance = 0;
      if (is2DMode) return;
      s.isPointerDown = true;
      s.isPanMode = e.button === 2 || e.shiftKey;
    };

    const handlePointerMove = (e) => {
      s.isPointerInCanvas = true;
      if (s.isPointerDown || s.isDragging) {
        const distFromOrigin = Math.hypot(
          e.clientX - s.pointerDownOrigin.x,
          e.clientY - s.pointerDownOrigin.y
        );
        if (distFromOrigin > s.dragDistance) {
          s.dragDistance = distFromOrigin;
        }
      }

      if (is2DMode || !s.isPointerDown) return;

      if (!s.isDragging && s.dragDistance > 4) {
        s.isDragging = true;
        domElement.style.cursor = 'grabbing';

        const hasMoved =
          Math.abs(s.targetAzimuth) > 0.01 ||
          Math.abs(s.targetVerticalPull) > 0.01 ||
          Math.abs(s.targetLateralPan) > 0.01;

        if (onInteractionStateChange) {
          onInteractionStateChange({ isRotated: hasMoved, isDragging: true });
        }
      }

      if (!s.isDragging) {
        s.dragStartPointer.set(e.clientX, e.clientY);
        return;
      }

      const deltaX = e.clientX - s.dragStartPointer.x;
      const deltaY = e.clientY - s.dragStartPointer.y;
      s.dragStartPointer.set(e.clientX, e.clientY);

      if (s.isPanMode || e.shiftKey) {
        s.targetLateralPan = THREE.MathUtils.clamp(
          s.targetLateralPan - deltaX * panSensitivity,
          -maxLateralPan,
          maxLateralPan
        );
      } else {
        s.targetAzimuth -= deltaX * orbitSensitivity;
      }

      s.targetVerticalPull = THREE.MathUtils.clamp(
        s.targetVerticalPull + deltaY * pullSensitivity,
        -1.0,
        1.0
      );
    };

    const handlePointerUp = () => {
      const wasDragging = s.isDragging;
      s.isPointerDown = false;
      s.isDragging = false;
      s.isPanMode = false;

      if (!wasDragging) return;

      domElement.style.cursor =
        s.isHoveringMesh || s.isHoveringWordBox
          ? 'pointer'
          : is2DMode
          ? 'default'
          : 'grab';

      const hasMoved =
        Math.abs(s.targetAzimuth) > 0.015 ||
        Math.abs(s.targetVerticalPull) > 0.015 ||
        Math.abs(s.targetLateralPan) > 0.015;

      if (onInteractionStateChange) {
        onInteractionStateChange({ isRotated: hasMoved, isDragging: false });
      }
    };

    const handlePointerLeave = () => {
      s.isPointerInCanvas = false;
      s.isHoveringMesh = false;
      s.isHoveringWordBox = false;
      s.isPointerDown = false;
      s.isDragging = false;
      domElement.style.cursor = 'default';
      if (pointerWorldRef?.current) {
        pointerWorldRef.current.set(999, 999, 999);
      }
    };

    domElement.style.cursor =
      s.isHoveringMesh || s.isHoveringWordBox
        ? 'pointer'
        : is2DMode
        ? 'default'
        : 'grab';
    domElement.addEventListener('contextmenu', handleContextMenu);
    domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp);
    domElement.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      domElement.removeEventListener('contextmenu', handleContextMenu);
      domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      domElement.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [gl, interaction, dimensionMode, pointerWorldRef, onInteractionStateChange]);

  const handleMeshPointerOver = useCallback(
    (e) => {
      e.stopPropagation();
      stateRef.current.isHoveringMesh = true;
      stateRef.current.isPointerInCanvas = true;
      if (!stateRef.current.isDragging) {
        gl.domElement.style.cursor = 'pointer';
      }
    },
    [gl]
  );

  const handleMeshPointerOut = useCallback(() => {
    stateRef.current.isHoveringMesh = false;
    if (!stateRef.current.isDragging) {
      gl.domElement.style.cursor = stateRef.current.isHoveringWordBox
        ? 'pointer'
        : dimensionMode === '2d'
        ? 'default'
        : 'grab';
    }
  }, [gl, dimensionMode]);

  const handleWordBoxPointerOver = useCallback(
    (e) => {
      e.stopPropagation();
      stateRef.current.isHoveringWordBox = true;
      stateRef.current.isPointerInCanvas = true;
      if (!stateRef.current.isDragging) {
        gl.domElement.style.cursor = 'pointer';
      }
    },
    [gl]
  );

  const handleWordBoxPointerOut = useCallback(() => {
    stateRef.current.isHoveringWordBox = false;
    if (!stateRef.current.isDragging && !stateRef.current.isHoveringMesh) {
      gl.domElement.style.cursor = dimensionMode === '2d' ? 'default' : 'grab';
    }
  }, [gl, dimensionMode]);

  const handleMeshClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (e.button !== undefined && e.button !== 0) return;
      if (stateRef.current.dragDistance > 5) return;
      const now = performance.now();
      if (now - stateRef.current.lastToggleTime < 120) return;
      stateRef.current.lastToggleTime = now;
      if (onToggleDimension) {
        onToggleDimension();
      }
    },
    [onToggleDimension]
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const elapsedTime = state.clock.getElapsedTime();
    const s = stateRef.current;
    const reducedMotionScale = prefersReducedMotion.current ? 0.25 : 1.0;
    const damping = interaction.rotationDamping ?? 4.5;
    const depthProgress = depthProgressRef?.current ?? 1.0;

    s.azimuth = THREE.MathUtils.damp(s.azimuth, s.targetAzimuth, damping, dt);
    s.verticalPull = THREE.MathUtils.damp(
      s.verticalPull,
      s.targetVerticalPull,
      damping,
      dt
    );
    s.lateralPan = THREE.MathUtils.damp(
      s.lateralPan,
      s.targetLateralPan,
      damping,
      dt
    );

    const baseCamY = THREE.MathUtils.lerp(
      0.12,
      cameraConfig?.position?.[1] ?? 0.22,
      depthProgress
    );
    const baseRadius = cameraConfig?.position?.[2] ?? 7.15;
    const meadowRadius = interaction.meadowZoomRadius ?? 4.75;
    const flowerFocusY = interaction.flowerFocusY ?? -0.38;
    const canopyMaxAngle = interaction.canopyMaxAngle ?? 0.82;

    const flowerInspect = THREE.MathUtils.clamp(-s.verticalPull, 0.0, 1.0);
    const canopyOverview = THREE.MathUtils.clamp(s.verticalPull, 0.0, 1.0);

    const currentRadius = THREE.MathUtils.lerp(
      baseRadius,
      meadowRadius,
      flowerInspect
    );
    const elevationAngle = canopyOverview * canopyMaxAngle;
    const horizontalRadius = currentRadius * Math.cos(elevationAngle);

    cameraRightVec.current.set(Math.cos(s.azimuth), 0, -Math.sin(s.azimuth));
    const panWorldX = cameraRightVec.current.x * s.lateralPan;
    const panWorldZ = cameraRightVec.current.z * s.lateralPan;

    const camX = Math.sin(s.azimuth) * horizontalRadius + panWorldX;
    const camZ = Math.cos(s.azimuth) * horizontalRadius + panWorldZ;
    const camY =
      THREE.MathUtils.lerp(baseCamY, -0.04, flowerInspect) +
      Math.sin(elevationAngle) * currentRadius;

    state.camera.position.set(camX, camY, camZ);

    const baseLookY = THREE.MathUtils.lerp(0.12, 0.08, depthProgress);
    const targetLookY =
      THREE.MathUtils.lerp(baseLookY, flowerFocusY, flowerInspect) -
      canopyOverview * 0.16;
    lookAtTarget.current.set(panWorldX, targetLookY, panWorldZ);
    state.camera.lookAt(lookAtTarget.current);

    state.raycaster.setFromCamera(state.pointer, state.camera);

    const hitGround = state.raycaster.ray.intersectPlane(
      groundPlane.current,
      groundHitPoint.current
    );

    if (Math.abs(Math.cos(s.azimuth)) < 0.22) {
      textPlane.current.normal
        .set(Math.sin(s.azimuth), 0, Math.cos(s.azimuth))
        .normalize();
    } else {
      textPlane.current.normal.set(0, 0, 1);
    }

    const hitTextPlane = state.raycaster.ray.intersectPlane(
      textPlane.current,
      worldHitPoint.current
    );

    if (pointerWorldRef?.current && s.isPointerInCanvas) {
      if (flowerInspect > 0.2 && hitGround) {
        pointerWorldRef.current.copy(groundHitPoint.current);
      } else if (
        hitTextPlane &&
        !s.isHoveringMesh &&
        hitGround &&
        worldHitPoint.current.y < -0.15
      ) {
        pointerWorldRef.current.copy(groundHitPoint.current);
      } else if (hitTextPlane) {
        pointerWorldRef.current.copy(worldHitPoint.current);
      } else if (hitGround) {
        pointerWorldRef.current.copy(groundHitPoint.current);
      }
    }

    if (hitTextPlane && meshRef.current) {
      localTargetPoint.current.copy(worldHitPoint.current);
      meshRef.current.worldToLocal(localTargetPoint.current);

      let maxHalfX = 4.6;
      let maxHalfY = 1.35;
      if (meshRef.current.geometry?.boundingBox) {
        const bbox = meshRef.current.geometry.boundingBox;
        maxHalfX = (bbox.max.x - bbox.min.x) * 0.56;
        maxHalfY = (bbox.max.y - bbox.min.y) * 0.72;
      }

      const inProximityBounds =
        Math.abs(localTargetPoint.current.x) < maxHalfX &&
        Math.abs(localTargetPoint.current.y) < maxHalfY;

      const isEngaged =
        s.isPointerInCanvas &&
        !s.isDragging &&
        (s.isHoveringMesh || inProximityBounds);

      s.smoothedPointerLocal.x = THREE.MathUtils.damp(
        s.smoothedPointerLocal.x,
        localTargetPoint.current.x,
        interaction.pointerDamping,
        dt
      );
      s.smoothedPointerLocal.y = THREE.MathUtils.damp(
        s.smoothedPointerLocal.y,
        localTargetPoint.current.y,
        interaction.pointerDamping,
        dt
      );

      const vx =
        (s.smoothedPointerLocal.x - s.previousPointerLocal.x) /
        Math.max(dt, 0.008);
      const vy =
        (s.smoothedPointerLocal.y - s.previousPointerLocal.y) /
        Math.max(dt, 0.008);
      s.previousPointerLocal.copy(s.smoothedPointerLocal);

      s.smoothedVelocity.x = THREE.MathUtils.damp(
        s.smoothedVelocity.x,
        THREE.MathUtils.clamp(vx * 0.08, -1.0, 1.0),
        8.0,
        dt
      );
      s.smoothedVelocity.y = THREE.MathUtils.damp(
        s.smoothedVelocity.y,
        THREE.MathUtils.clamp(vy * 0.08, -1.0, 1.0),
        8.0,
        dt
      );

      const targetIntensity = isEngaged
        ? (s.isHoveringMesh
            ? interaction.hoverDeformBoost
            : interaction.baseDeformIntensity) * reducedMotionScale
        : 0.0;

      const targetHover =
        !s.isDragging && s.isHoveringMesh
          ? 1.0
          : !s.isDragging && inProximityBounds && s.isPointerInCanvas
          ? 0.45
          : 0.0;

      s.currentDeformIntensity = THREE.MathUtils.damp(
        s.currentDeformIntensity,
        targetIntensity,
        interaction.pointerDamping,
        dt
      );
      s.currentHoverLevel = THREE.MathUtils.damp(
        s.currentHoverLevel,
        targetHover,
        5.5,
        dt
      );
    }

    if (shaderUniforms) {
      shaderUniforms.uTime.value = elapsedTime;
      shaderUniforms.uDepthProgress.value = depthProgress;
      shaderUniforms.uPointer.value.copy(s.smoothedPointerLocal);
      shaderUniforms.uVelocity.value.copy(s.smoothedVelocity);
      shaderUniforms.uDeformIntensity.value = s.currentDeformIntensity;
      shaderUniforms.uHoverState.value = s.currentHoverLevel;
    }

    if (groupRef.current) {
      const orbitAttenuation =
        1.0 -
        THREE.MathUtils.clamp(
          Math.abs(s.verticalPull) * 0.8 + Math.abs(Math.sin(s.azimuth)) * 0.5,
          0.0,
          0.85
        );
      const idleFactor =
        (1.0 - s.currentHoverLevel * 0.5) *
        orbitAttenuation *
        reducedMotionScale *
        depthProgress;

      const idleRotX =
        Math.cos(elapsedTime * animation.idleBreathingSpeed * 0.75) *
        animation.idleRotationAmplitude *
        idleFactor;
      const idleRotY =
        Math.sin(elapsedTime * animation.idleBreathingSpeed * 0.6) *
        animation.idleRotationAmplitude *
        idleFactor;
      const idlePosY =
        0.12 +
        Math.sin(elapsedTime * animation.idleBreathingSpeed) *
          animation.idleElevationAmplitude *
          idleFactor;

      const pointerTiltX =
        s.isPointerInCanvas && !s.isDragging
          ? -state.pointer.y *
            interaction.maxCursorTiltX *
            orbitAttenuation *
            reducedMotionScale *
            depthProgress
          : 0;
      const pointerTiltY =
        s.isPointerInCanvas && !s.isDragging
          ? state.pointer.x *
            interaction.maxCursorTiltY *
            orbitAttenuation *
            reducedMotionScale *
            depthProgress
          : 0;

      groupRef.current.rotation.x = THREE.MathUtils.damp(
        groupRef.current.rotation.x,
        pointerTiltX + idleRotX,
        damping,
        dt
      );
      groupRef.current.rotation.y = THREE.MathUtils.damp(
        groupRef.current.rotation.y,
        pointerTiltY + idleRotY,
        damping,
        dt
      );
      groupRef.current.position.y = THREE.MathUtils.damp(
        groupRef.current.position.y,
        idlePosY,
        4.0,
        dt
      );
    }
  });

  return {
    handleMeshPointerOver,
    handleMeshPointerOut,
    handleWordBoxPointerOver,
    handleWordBoxPointerOut,
    handleMeshClick,
  };
}