import * as THREE from 'three';

export function hash2D(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function valueNoise2D(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uz = fz * fz * (3.0 - 2.0 * fz);

  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm2D(x, z) {
  let value = 0.0;
  let amp = 0.5;
  let px = x;
  let pz = z;
  for (let i = 0; i < 4; i++) {
    value += amp * valueNoise2D(px, pz);
    const nx = px * 1.62 - pz * 1.21 + 1.7;
    const nz = px * 1.21 + pz * 1.62 + 9.2;
    px = nx;
    pz = nz;
    amp *= 0.5;
  }
  return value;
}

export function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Shared GLSL 2D hash, value noise, and 4-octave FBM chunk for ground shaders.
 */
export const GLSL_NOISE_2D = `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      value += amp * valueNoise(p);
      p = rot * p * 2.03 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return value;
  }
`;

/**
 * Builds the shared vertex shader for displaced seasonal floor shaders.
 */
export function buildGroundVertexShader(elevationVarying = null) {
  const varyingDecl = elevationVarying
    ? `varying float ${elevationVarying};`
    : '';
  const varyingAssign = elevationVarying
    ? `${elevationVarying} = position.y;`
    : '';

  return `
    varying vec3 vWorldPos;
    varying vec3 vNormalWorld;
    ${varyingDecl}
    void main() {
      ${varyingAssign}
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xyz;
      vNormalWorld = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;
}

/**
 * Builds an undulating terrain PlaneGeometry displaced deterministically on Y.
 */
export function createDisplacedTerrainGeometry({
  width,
  depth,
  segmentsX = 120,
  segmentsZ = 76,
  zOffset = 0.35,
  sampleElevation,
}) {
  const geo = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsZ);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getZ(i) + zOffset;
    pos.setY(i, sampleElevation(vx, vz));
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Shared 2-column curved vegetation strip builder for arching shoots and grass reeds.
 */
export function createGrassStripGeometry({
  segments = 5,
  baseWidth = 0.009,
  curveZ = 0.2,
  curvePower = 1.75,
  taperMode = 'power',
  taperPower = 1.35,
  taperTipReduction = 0.94,
  archDroop = 0,
}) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = archDroop > 0 ? t * (1.0 - t * archDroop) : t;
    const width =
      taperMode === 'sine'
        ? baseWidth * Math.sin((1.0 - t * 0.9) * (Math.PI * 0.5))
        : baseWidth * (1.0 - Math.pow(t, taperPower) * taperTipReduction);
    const z = Math.pow(t, curvePower) * curveZ;

    positions.push(-width, y, z, width, y, z);
    uvs.push(0, t, 1, t);
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = (i + 1) * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Computes damped XZ pointer velocity for interactive grass & foliage shaders.
 */
export function updateSmoothedGroundVelocity({
  pointerWorldRef,
  prevPointerXZ,
  smoothedGroundVel,
  velocityUniform,
  scale = 0.06,
  clampMax = 1.0,
  dt,
}) {
  if (!pointerWorldRef?.current) return;
  const p = pointerWorldRef.current;

  if (p.x < 500 && prevPointerXZ.current.x < 500) {
    const vx = (p.x - prevPointerXZ.current.x) / Math.max(dt, 0.008);
    const vz = (p.z - prevPointerXZ.current.y) / Math.max(dt, 0.008);
    smoothedGroundVel.current.x = THREE.MathUtils.damp(
      smoothedGroundVel.current.x,
      THREE.MathUtils.clamp(vx * scale, -clampMax, clampMax),
      7.0,
      dt
    );
    smoothedGroundVel.current.y = THREE.MathUtils.damp(
      smoothedGroundVel.current.y,
      THREE.MathUtils.clamp(vz * scale, -clampMax, clampMax),
      7.0,
      dt
    );
  } else {
    smoothedGroundVel.current.x = THREE.MathUtils.damp(
      smoothedGroundVel.current.x,
      0,
      6.0,
      dt
    );
    smoothedGroundVel.current.y = THREE.MathUtils.damp(
      smoothedGroundVel.current.y,
      0,
      6.0,
      dt
    );
  }

  prevPointerXZ.current.set(p.x, p.z);
  velocityUniform.value.copy(smoothedGroundVel.current);
}
