/**
 * WINTER PRESET: FROZEN
 * Theme: Stillness, crystalline frost, sculpted snowdrifts, hexagonal ice spires,
 * hanging icicles on 'F', and quiet snowfall.
 */
export const winterSeason = {
  id: 'winter',
  index: '04',
  name: 'WINTER',
  status: 'implemented',
  headline: 'FROZEN',
  supportingText: 'STILLNESS IN FORM',

  typography: {
    fontUrl: '/fonts/CormorantGaramond-SemiBold.json',
    fallbackFontUrl:
      'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/fonts/optimer_regular.typeface.json',
    fontFamilyName: 'Cormorant Garamond SemiBold',
    fontLicense: 'SIL Open Font License 1.1',
    size: 1.48,
    height: 0.19,
    curveSegments: 36,
    bevelEnabled: true,
    bevelThickness: 0.058,
    bevelSize: 0.038,
    bevelOffset: 0.0,
    bevelSegments: 4, // Crisp crystalline bevel facets for Winter
    letterSpacing: 0.075,
  },

  palette: {
    background: '#E8F0F7',
    skyTop: '#A8C3DE',
    skyHorizon: '#E4EEF7',
    groundBase: '#EBF2F8',
    groundMoss: '#9CB2C6',
    groundMossDeep: '#7A9AB8',
    groundMossFresh: '#C8DCEF',
    fogColor: '#E6EFF7',
    textPrimary: '#142230',
    textSecondary: '#4A6278',
    accentPrimary: '#3B6E9C',
    accentSecondary: '#6A9EC8',
  },

  material: {
    color: '#C8DFF2',
    flatColor: '#3B6E9C',
    emissive: '#102436',
    emissiveIntensity: 0.09,
    roughness: 0.08,
    metalness: 0.08,
    clearcoat: 0.98,
    clearcoatRoughness: 0.05,
    sheen: 0.9,
    sheenRoughness: 0.16,
    sheenColor: '#FFFFFF',
    blushResponseColor: '#72B2E8',
    subsurfaceColor: '#E6F5FF',
    reflectivity: 0.94,
    microNoiseScale: 5.2,
    microRoughnessAmplitude: 0.07,
    subsurfaceIntensity: 0.48,
  },

  environment: {
    type: 'winter-frost',
    ground: {
      moundHeight: 0.14,
      widthMultiplier: 4.2,
      minWidth: 26.0,
      depth: 14.0,
    },
    grass: {
      enabled: true,
      fineBladeCount: 1650,
      minHeight: 0.05,
      maxHeight: 0.21,
      letterOverlapMax: 0.18,
      windSpeed: 0.75,
      windStrength: 0.022,
      windWaveLength: 0.5,
      cursorBendRadius: 1.35,
      cursorBendStrength: 0.065,
      colors: {
        sage: '#96AFC4',
        freshGreen: '#B8CEE0',
        yellowGreen: '#E2EFFA',
        deepMoss: '#6D869C',
      },
    },
    crystals: {
      enabled: true,
      count: 145,
      palette: {
        white: '#F5FAFF',
        glacier: '#B8DCF7',
        arctic: '#82B9E6',
      },
    },
    icicles: {
      enabled: true,
    },
  },

  interaction: {
    deformRadius: 1.1,
    baseDeformIntensity: 0.18,
    hoverDeformBoost: 0.34,
    radialSpread: 0.075,
    zBulgeDepth: 0.14,
    velocityInfluence: 0.04,
    letterBuoyancy: 0.018,
    letterTiltAmount: 0.026,
    velocityShear: 0.032,
    pointerDamping: 6.5,
    rotationDamping: 4.2,
    maxCursorTiltX: 0.035,
    maxCursorTiltY: 0.055,
    orbitSensitivity: 0.0065,
    pullSensitivity: 0.0042,
    panSensitivity: 0.0048,
    maxLateralPan: 2.0,
    meadowZoomRadius: 4.75,
    flowerFocusY: -0.38,
    canopyMaxAngle: 0.82,
  },

  animation: {
    idleBreathingSpeed: 0.72,
    idleElevationAmplitude: 0.009,
    idleRotationAmplitude: 0.008,
    surfaceRippleSpeed: 0.9,
    surfaceRippleAmplitude: 0.004,
    canopyLightSwaySpeed: 0.3,
  },

  lighting: {
    ambient: {
      color: '#EAF3FA',
      intensity: 0.96,
    },
    keyLight: {
      color: '#FFFFFF',
      intensity: 2.68,
      position: [5.2, 7.0, 6.5],
    },
    rimLight: {
      color: '#B8E0FF',
      intensity: 2.2,
      position: [-6.0, 4.0, -3.0],
    },
    blushFill: {
      color: '#C2DDF2',
      intensity: 1.45,
      position: [2.5, -2.5, 4.0],
      distance: 16,
      decay: 1.5,
    },
  },

  particles: {
    enabled: true,
    count: 52,
    bounds: [11.0, 5.2, 3.8],
    baseSize: 48.0,
    driftSpeed: -0.15, // Gentle downward snowfall
    turbulence: 0.18,
    cursorRepulsionRadius: 1.8,
    cursorRepulsionStrength: 0.25,
    colorPrimary: '#FFFFFF',
    colorSecondary: '#D6ECFF',
    colorAccent: '#A8D0F0',
    opacity: 0.88,
  },

  camera: {
    position: [0, 0.22, 7.15],
    fov: 38,
    near: 0.1,
    far: 55,
  },
};