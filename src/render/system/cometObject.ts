import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { elementsToState } from '../../core/math/kepler';
import { mu as muOf, seconds, type Mu, type Seconds } from '../../core/physics/units';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import type { Comet } from '../../universe/smallbody/types';

const SPINE_POINTS = 40;
const DAY_S = 86400;
const KM_PER_AU = AU / 1000;

/**
 * Expanding-gas coma: column density of a 1/r² outflow falls as 1/ρ
 * across the disc — a tiny bright condensation inside a wide faint
 * halo, nothing like a shaded ball. The quad clamps to a minimum
 * pixel size so a subpixel coma stays a findable glint at system
 * zoom, and integrated flux is conserved either way: resolved comas
 * are as faint as real ones.
 */
const COMA_VERTEX = /* glsl */ `
attribute vec2 corner;
uniform float uSizeAu;
uniform float uMinRad;
varying vec2 vUv;
varying float vDim;

void main() {
  vec4 center = modelViewMatrix * vec4(position, 1.0);
  float distance = max(length(center.xyz), 1e-9);
  float size = max(uSizeAu, uMinRad * distance);
  vDim = min(1.0, (uMinRad * distance) / max(size, 1e-12));
  vDim *= vDim;
  vUv = corner;
  gl_Position = projectionMatrix * vec4(center.xyz + vec3(corner * size, 0.0), 1.0);
}
`;

const COMA_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vDim;
uniform vec3 uColor;
uniform float uIntensity;

void main() {
  float rho = length(vUv);
  if (rho > 1.0) discard;
  // 1/ρ column density, softly truncated at the edge; a condensed core.
  float halo = (1.0 / max(rho, 0.035) - 1.0) * 0.045;
  float core = exp(-rho * rho * 90.0) * 1.6;
  gl_FragColor = vec4(uColor * (halo + core) * uIntensity * vDim, 1.0);
}
`;

/** Tail ribbons: camera-facing strips with a soft cross profile. */
const TAIL_VERTEX = /* glsl */ `
attribute float across;
attribute vec3 tint;
varying float vAcross;
varying vec3 vTint;

void main() {
  vAcross = across;
  vTint = tint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TAIL_FRAGMENT = /* glsl */ `
varying float vAcross;
varying vec3 vTint;

void main() {
  float profile = 1.0 - vAcross * vAcross;
  gl_FragColor = vec4(vTint * profile * profile, 1.0);
}
`;

interface Ribbon {
  mesh: Mesh;
  positions: BufferAttribute;
  tints: BufferAttribute;
}

/**
 * A comet the way the sky shows one: an activity-gated coma glint, a
 * straight rippling ion tail pinned anti-solar, and a dust tail whose
 * curve is real — each sample is grit released along the true orbit
 * days to weeks ago and pushed outward by radiation pressure ever
 * since, so the syndyne arc between anti-solar and the reversed path
 * emerges from the orbit itself.
 */
export class CometObject {
  readonly group = new Group();
  private readonly head = new Group();
  private readonly coma: Mesh;
  private readonly comaMaterial: ShaderMaterial;
  private readonly ion: Ribbon;
  private readonly dust: Ribbon;
  private readonly mu: Mu;
  private readonly cameraLocal = new Vector3();
  private minWidthRad = 0;

  constructor(
    private readonly comet: Comet,
    centralMassSolar: number,
  ) {
    this.mu = muOf(G * centralMassSolar * SOLAR_MASS);
    this.group.add(this.head);

    this.comaMaterial = new ShaderMaterial({
      vertexShader: COMA_VERTEX,
      fragmentShader: COMA_FRAGMENT,
      uniforms: {
        // Diatomic-carbon green in the inner coma reads through the dust.
        uColor: { value: new Color(0.62, 0.85, 0.78) },
        uIntensity: { value: 1 },
        uSizeAu: { value: 1e-4 },
        uMinRad: { value: 0.004 },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const quad = new BufferGeometry();
    quad.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    quad.setAttribute(
      'corner',
      new BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2),
    );
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    this.coma = new Mesh(quad, this.comaMaterial);
    this.coma.frustumCulled = false;
    this.head.add(this.coma);

    this.ion = makeRibbon();
    this.dust = makeRibbon();
    this.group.add(this.ion.mesh, this.dust.mesh);
  }

  /** cameraWorld: the camera's world position, for ribbon facing.
   *  radPerPixel: view scale, so a subpixel coma can hold marker size. */
  update(tSeconds: Seconds, cameraWorld: Vector3, radPerPixel: number): void {
    const { position, velocity } = elementsToState(this.comet.elements, this.mu, tSeconds);
    const posAu = new Vector3(position.x / AU, position.y / AU, position.z / AU);
    this.head.position.copy(posAu);

    const rAu = posAu.length();
    // Sublimation ramps steeply inside the onset distance.
    const activity = Math.max(0, (this.comet.activityOnsetAu / rAu) ** 2 - 1);
    const visible = activity > 0.05;
    this.head.visible = visible;
    this.ion.mesh.visible = visible;
    this.dust.mesh.visible = visible;
    if (!visible) return;

    this.group.updateWorldMatrix(true, false);
    this.cameraLocal.copy(cameraWorld);
    this.group.worldToLocal(this.cameraLocal);
    this.minWidthRad = radPerPixel;

    // Physical coma, held near the great-comet scale; the marker
    // clamp in the shader carries it at system zoom.
    const comaAu = Math.min(3e5, 2.5e4 + 9e4 * Math.sqrt(activity)) / KM_PER_AU;
    this.comaMaterial.uniforms.uSizeAu.value = comaAu;
    this.comaMaterial.uniforms.uMinRad.value = 7 * radPerPixel;
    this.comaMaterial.uniforms.uIntensity.value = Math.min(1.4, 0.5 + 0.4 * activity);

    const antiSolar = posAu.clone().normalize();

    // Ion tail: entrained by the outflowing wind within hours, so it
    // pins anti-solar; slow kinks ride down it as the wind gusts.
    const ionLength = Math.min(1.2, 0.22 * activity);
    const tDays = (tSeconds as number) / DAY_S;
    const ripple = new Vector3(antiSolar.z, 0.4, -antiSolar.x).normalize();
    this.writeRibbon(this.ion, (u, out) => {
      out.copy(posAu).addScaledVector(antiSolar, ionLength * u ** 0.92);
      const kink = Math.sin(u * 9.0 - tDays * 1.7 + posAu.x * 3.0) * 0.006 * u * ionLength;
      out.addScaledVector(ripple, kink);
    }, (u) => comaAu * (0.5 + 2.2 * u), (u) => {
      const fade = (1 - u) ** 1.4 * Math.min(1, activity * 0.8);
      return [0.3 * fade, 0.45 * fade, 0.95 * fade];
    });

    // Dust tail: each sample is grit emitted τ days back, pushed
    // sunward-out by β·g ever since (β ≈ 0.3, sub-micron grains) —
    // the push is the leading term, so the whole tail stays broadly
    // anti-solar like the ion tail. The curve comes from the sun
    // bearing rotating across emission times, plus the second-order
    // along-track lag of push-slowed grit — same order as the push,
    // never the orbit-arc scale that would swing the tail anti-motion.
    const beta = 0.3;
    const tailDays = 55 * (0.4 + 0.6 * Math.min(activity, 2));
    const emitted = new Vector3();
    const vHat = new Vector3();
    this.writeRibbon(this.dust, (u, out) => {
      const tauDays = u ** 1.5 * tailDays;
      const tauS = tauDays * DAY_S;
      const past = elementsToState(this.comet.elements, this.mu, seconds((tSeconds as number) - tauS));
      emitted.set(past.position.x, past.position.y, past.position.z);
      const rM = Math.max(emitted.length(), 1e7);
      const pushAu = (beta * ((this.mu as number) / (rM * rM)) * tauS * tauS) / 2 / AU;
      vHat.set(past.velocity.x, past.velocity.y, past.velocity.z).normalize();
      out.copy(posAu)
        .addScaledVector(emitted.normalize(), pushAu)
        .addScaledVector(vHat, -pushAu * 0.6);
    }, (u) => comaAu * (1 + 14 * u ** 1.3), (u) => {
      const fade = (1 - u) ** 1.7 * Math.min(1, activity * 0.7) * (0.35 + 0.65 * this.comet.dustiness);
      return [0.95 * fade, 0.86 * fade, 0.7 * fade];
    });
  }

  /** Build a camera-facing strip along a spine. */
  private writeRibbon(
    ribbon: Ribbon,
    spineAt: (u: number, out: Vector3) => void,
    widthAt: (u: number) => number,
    tintAt: (u: number) => [number, number, number],
  ): void {
    const spine = new Vector3();
    const next = new Vector3();
    const tangent = new Vector3();
    const toCamera = new Vector3();
    const side = new Vector3();
    for (let i = 0; i < SPINE_POINTS; i++) {
      const u = i / (SPINE_POINTS - 1);
      spineAt(u, spine);
      spineAt(Math.min(1, u + 1 / SPINE_POINTS), next);
      tangent.copy(next).sub(spine);
      if (tangent.lengthSq() < 1e-18) tangent.set(1, 0, 0);
      toCamera.copy(this.cameraLocal).sub(spine);
      side.crossVectors(tangent, toCamera).normalize();
      // A tail thinner than a few pixels vanishes at system zoom: the
      // width floors at ~3 px and the squeezed light concentrates into
      // it, so the streak stays findable from anywhere without
      // brightening the resolved close-up at all.
      const physicalW = widthAt(u);
      const floorW = 3 * this.minWidthRad * toCamera.length();
      const half = Math.max(physicalW, floorW) / 2;
      const gain = Math.min(3, Math.sqrt(Math.max(1, floorW / Math.max(physicalW, 1e-12))));
      let [r, g, b] = tintAt(u);
      r *= gain;
      g *= gain;
      b *= gain;
      ribbon.positions.setXYZ(
        i * 2,
        spine.x - side.x * half,
        spine.y - side.y * half,
        spine.z - side.z * half,
      );
      ribbon.positions.setXYZ(
        i * 2 + 1,
        spine.x + side.x * half,
        spine.y + side.y * half,
        spine.z + side.z * half,
      );
      ribbon.tints.setXYZ(i * 2, r, g, b);
      ribbon.tints.setXYZ(i * 2 + 1, r, g, b);
    }
    ribbon.positions.needsUpdate = true;
    ribbon.tints.needsUpdate = true;
  }

  /** Head world position; false while the comet is inactive/hidden. */
  getHeadWorldPosition(target: Vector3): boolean {
    if (!this.head.visible) return false;
    this.head.getWorldPosition(target);
    return true;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
  }
}

function makeRibbon(): Ribbon {
  const geometry = new BufferGeometry();
  const positions = new BufferAttribute(new Float32Array(SPINE_POINTS * 2 * 3), 3);
  const tints = new BufferAttribute(new Float32Array(SPINE_POINTS * 2 * 3), 3);
  const across = new Float32Array(SPINE_POINTS * 2);
  const index: number[] = [];
  for (let i = 0; i < SPINE_POINTS; i++) {
    across[i * 2] = -1;
    across[i * 2 + 1] = 1;
    if (i < SPINE_POINTS - 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  geometry.setAttribute('position', positions);
  geometry.setAttribute('tint', tints);
  geometry.setAttribute('across', new BufferAttribute(across, 1));
  geometry.setIndex(index);
  const mesh = new Mesh(
    geometry,
    new ShaderMaterial({
      vertexShader: TAIL_VERTEX,
      fragmentShader: TAIL_FRAGMENT,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  return { mesh, positions, tints };
}
