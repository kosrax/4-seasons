/**
 * SUMMER PRESET: HEAT
 * Theme: Sun-drenched coastal beach installation with overhead golden sunshine,
 * prominent sculpted golden sand dunes banking around A and T (and grounding HEAT),
 * classic 6-panel beach ball, and designer sunglasses dangling on top of H.
 * Zero flowers or meadow grass.
 */
export const summerSeason = {
  id: 'summer',
  index: '02',
  name: 'SUMMER',
  status: 'implemented',
  headline: 'HEAT',
  supportingText: 'RADIATE INTO MOTION',

  typography: {
    fontUrl:
      'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/fonts/helvetiker_bold.typeface.json',
    fallbackFontUrl: '/fonts/CormorantGaramond-SemiBold.json',
    fontFamilyName: 'Helvetiker Bold Geometric',
    fontLicense: 'MIT License',
    size: 1.52,
    height: 0.24,
    curveSegments: 32,
    bevelEnabled: true,
    bevelThickness: 0.065,
    bevelSize: 0.042,
    bevelOffset: 0.0,
    bevelSegments: 8,
    letterSpacing: 0.08,
  },

  palette: {
    background: '#F6EFE2',
    skyTop: '#78C5E2',
    skyHorizon: '#FFF4DC',
    groundBase: '#F6EFE2',
    sandLight: '#FCE0A2',
    sandMid: '#E0AC58',
    sandDeep: '#B37A2E',
    fogColor: '#F8EEDB',
    textPrimary: '#2C1B10',
    textSecondary: '#6B4930',
    accentPrimary: '#E05328',
    accentSecondary: '#1D8FA8',
  },

  material: {
    color: '#E55B34',
    flatColor: '#DC4E27',
    emissive: '#4A1808',
    emissiveIntensity: 0.12,
    roughness: 0.12,
    metalness: 0.04,
    clearcoat: 0.92,
    clearcoatRoughness: 0.08,
    sheen: 0.75,
    sheenRoughness: 0.22,
    sheenColor: '#FFD166',
    blushResponseColor: '#FFB703',
    subsurfaceColor: '#FF9F45',
    reflectivity: 0.88,
    microNoiseScale: 4.8,
    microRoughnessAmplitude: 0.05,
    subsurfaceIntensity: 0.42,
  },

  environment: {
    type: 'summer-beach',
    ground: {
      moundHeight: 0.24,
      widthMultiplier: 4.5,
      minWidth: 26.0,
      depth: 14.0,
    },
    sunshine: {
      enabled: true,
      sunPosition: [0.35, 3.45, -3.2],
      coreColor: '#FFFDF0',
      rayColor: '#FFE89E',
      intensity: 0.54,
    },
    sand: {
      pebbleCount: 480,
    },
    sunglasses: {
      enabled: true,
      frameColor: '#24120A',
      bridgeMetalColor: '#F7C948',
      lensColor: '#0B202C',
      scale: 1.18,
    },
    beachBall: {
      enabled: true,
      radius: 0.27,
      colors: {
        white: '#FFFDF9',
        coralRed: '#E63946',
        sunnyYellow: '#FFB703',
        oceanBlue: '#1D9BF0',
      },
    },
  },

  interaction: {
    deformRadius: 1.25,
    baseDeformIntensity: 0.26,
    hoverDeformBoost: 0.48,
    radialSpread: 0.11,
    zBulgeDepth: 0.18,
    velocityInfluence: 0.07,
    letterBuoyancy: 0.028,
    letterTiltAmount: 0.036,
    velocityShear: 0.055,
    pointerDamping: 7.5,
    rotationDamping: 4.5,
    maxCursorTiltX: 0.045,
    maxCursorTiltY: 0.065,
    orbitSensitivity: 0.0065,
    pullSensitivity: 0.0042,
    panSensitivity: 0.0048,
    maxLateralPan: 2.0,
    meadowZoomRadius: 4.75,
    flowerFocusY: -0.38,
    canopyMaxAngle: 0.82,
  },

  animation: {
    idleBreathingSpeed: 1.35,
    idleElevationAmplitude: 0.015,
    idleRotationAmplitude: 0.012,
    surfaceRippleSpeed: 2.55,
    surfaceRippleAmplitude: 0.011,
    canopyLightSwaySpeed: 0.7,
  },

  lighting: {
    ambient: {
      color: '#FFF4E0',
      intensity: 0.96,
    },
    keyLight: {
      color: '#FFFBE8',
      intensity: 3.1,
      position: [1.6, 8.6, 5.4],
    },
    rimLight: {
      color: '#FFD166',
      intensity: 2.15,
      position: [-5.8, 4.5, -2.6],
    },
    blushFill: {
      color: '#FFA868',
      intensity: 1.65,
      position: [2.8, -2.0, 4.2],
      distance: 16,
      decay: 1.4,
    },
  },

  particles: {
    enabled: true,
    count: 34,
    bounds: [10.5, 5.2, 3.5],
    baseSize: 40.0,
    driftSpeed: 0.22,
    turbulence: 0.28,
    cursorRepulsionRadius: 2.0,
    cursorRepulsionStrength: 0.45,
    colorPrimary: '#FFFBE6',
    colorSecondary: '#FFD166',
    colorAccent: '#F4A261',
    opacity: 0.74,
  },

  camera: {
    position: [0, 0.22, 7.15],
    fov: 38,
    near: 0.1,
    far: 55,
  },
};
