import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from 'three';
import { seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Belt } from '../../universe/system/types';

const VERTEX = /* glsl */ `
attribute float aAu;
attribute float theta0;
attribute float yAmp;
attribute float phase;

uniform float uTimeYears;
uniform float uSqrtCentralMass;
uniform float uPointScale;

void main() {
  // Keplerian mean motion per body: n = 2π√(M★)/a^1.5 (years, AU).
  float theta = theta0 + uTimeYears * 6.2831853 * uSqrtCentralMass / pow(aAu, 1.5);
  vec3 pos = vec3(aAu * cos(theta), aAu * sin(theta), yAmp * sin(theta + phase));
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = clamp(uPointScale / -mvPosition.z, 0.5, 3.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float alpha = 1.0 - smoothstep(0.4, 1.0, length(c));
  gl_FragColor = vec4(uColor * alpha * 0.55, 1.0);
}
`;

const MAIN_BELT_COLOR = 0x9a8f82;
const OUTER_BELT_COLOR = 0x8fa3b5;

/**
 * A belt as an orbiting point cloud: every particle carries its own
 * semi-major axis and phase and moves at its own Keplerian rate in the
 * vertex shader, so belts shear differentially with time. Kirkwood gaps
 * are enforced at sampling time.
 */
export function createBeltPoints(belt: Belt, beltSeed: bigint, count: number): Points {
  const rng = new Rng(beltSeed);
  const aAu = new Float32Array(count);
  const theta0 = new Float32Array(count);
  const yAmp = new Float32Array(count);
  const phase = new Float32Array(count);

  let placed = 0;
  while (placed < count) {
    // Area-uniform radius, thinned inside resonance gaps.
    const r = Math.sqrt(
      belt.innerAu ** 2 + rng.float() * (belt.outerAu ** 2 - belt.innerAu ** 2),
    );
    const inGap = belt.gaps.some((gap) => Math.abs(r - gap.semiMajorAxisAu) < gap.widthAu / 2);
    if (inGap && rng.float() < 0.92) continue;

    aAu[placed] = r * rng.range(0.995, 1.005);
    theta0[placed] = rng.range(0, 2 * Math.PI);
    yAmp[placed] = r * Math.tan(belt.inclinationDispersionRad) * rng.normal(0, 0.35);
    phase[placed] = rng.range(0, 2 * Math.PI);
    placed++;
  }

  // Resonant populations (plutino-style) cluster at their commensurability.
  const resonantCount = belt.resonantPopulations.length > 0 ? Math.floor(count * 0.08) : 0;
  const geometry = new BufferGeometry();
  if (resonantCount > 0) {
    const extra = extendResonant(belt, rng, resonantCount);
    geometry.setAttribute('aAu', new BufferAttribute(concat(aAu, extra.aAu), 1));
    geometry.setAttribute('theta0', new BufferAttribute(concat(theta0, extra.theta0), 1));
    geometry.setAttribute('yAmp', new BufferAttribute(concat(yAmp, extra.yAmp), 1));
    geometry.setAttribute('phase', new BufferAttribute(concat(phase, extra.phase), 1));
  } else {
    geometry.setAttribute('aAu', new BufferAttribute(aAu, 1));
    geometry.setAttribute('theta0', new BufferAttribute(theta0, 1));
    geometry.setAttribute('yAmp', new BufferAttribute(yAmp, 1));
    geometry.setAttribute('phase', new BufferAttribute(phase, 1));
  }
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(geometry.getAttribute('aAu').count * 3), 3),
  );
  geometry.boundingSphere = null;

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTimeYears: { value: 0 },
      uSqrtCentralMass: { value: 1 },
      uPointScale: { value: 40 },
      uColor: {
        value: new Color(belt.kind === 'main' ? MAIN_BELT_COLOR : OUTER_BELT_COLOR),
      },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export function createBeltPointsForSystem(
  belts: Belt[],
  systemSeedHex: string,
): Points[] {
  return belts.map((belt, i) =>
    createBeltPoints(
      belt,
      seedFromHex(systemSeedHex) ^ BigInt(0x5b + i),
      belt.kind === 'main' ? 3500 : 4500,
    ),
  );
}

interface ResonantArrays {
  aAu: Float32Array;
  theta0: Float32Array;
  yAmp: Float32Array;
  phase: Float32Array;
}

function extendResonant(belt: Belt, rng: Rng, count: number): ResonantArrays {
  const arrays: ResonantArrays = {
    aAu: new Float32Array(count),
    theta0: new Float32Array(count),
    yAmp: new Float32Array(count),
    phase: new Float32Array(count),
  };
  for (let i = 0; i < count; i++) {
    const population = belt.resonantPopulations[i % belt.resonantPopulations.length];
    const r = population.semiMajorAxisAu * rng.range(0.99, 1.01);
    arrays.aAu[i] = r;
    arrays.theta0[i] = rng.range(0, 2 * Math.PI);
    arrays.yAmp[i] = r * Math.tan(belt.inclinationDispersionRad * 1.3) * rng.normal(0, 0.5);
    arrays.phase[i] = rng.range(0, 2 * Math.PI);
  }
  return arrays;
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
