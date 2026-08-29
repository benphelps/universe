import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Points,
  Quaternion,
  ShaderMaterial,
} from 'three';
import { nuclearClusterStars, type ClusterStars } from '../../universe/galaxy/clusterStars';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { createStarPointsMaterial } from '../starfield/neighborStars';

/**
 * The nuclear star cluster, drawn with the same photometric point
 * material every other star in the sky uses — brightness from
 * luminosity over distance squared, so it reads as one bright knot
 * from across the galaxy and resolves into a swarm of individual
 * suns when the camera stands inside it. Placed in the sky's pc frame
 * at the galactic centre, wherever that falls from here.
 */
/** The zero point every other star layer in the sky is drawn on. */
const SKY_ZERO_POINT = 17;

export class NuclearCluster {
  readonly group = new Group();
  private readonly points: Points;
  /** Zero point that spreads the cluster across the material's range
   *  when the camera is inside it. */
  private readonly insideZeroPoint: number;
  /** The band, pc, across which the cluster stops being the sky the
   *  camera stands in and becomes a knot within it. */
  private readonly nearPc: number;
  private readonly farPc: number;

  constructor(viewpointPc: GalacticPosition, sceneFromGalaxy: Float32Array, pcKm: number) {
    const stars = nuclearClusterStars();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(stars.positionsPc, 3));
    geometry.setAttribute('starColor', new BufferAttribute(stars.colors, 3));
    geometry.setAttribute('luminosity', new BufferAttribute(stars.luminosities, 1));
    this.insideZeroPoint = zeroPoint(stars);
    // The crossing belongs where the cluster stops being the sky and
    // becomes an object in it: from a few half-light radii out, where
    // its members are still all around the camera, to twenty, by which
    // point it subtends a few degrees and has to be lit like anything
    // else in the sky or it goes dark while the galaxy does not.
    this.nearPc = 3 * radiusHolding(stars, 0.5);
    this.farPc = 20 * radiusHolding(stars, 0.5);
    this.points = new Points(geometry, createStarPointsMaterial(pcKm, SKY_ZERO_POINT));
    this.points.frustumCulled = false;
    this.points.renderOrder = -7;
    this.group.add(this.points);

    const m = sceneFromGalaxy;
    const quat = new Quaternion().setFromRotationMatrix(
      new Matrix4().set(
        m[0], m[1], m[2], 0,
        m[3], m[4], m[5], 0,
        m[6], m[7], m[8], 0,
        0, 0, 0, 1,
      ),
    );
    this.group.quaternion.copy(quat);
    this.group.position
      .set(-viewpointPc.xPc, -viewpointPc.yPc, -viewpointPc.zPc)
      .applyQuaternion(quat);
  }

  /**
   * Per-frame, from the camera's distance to the cluster's middle.
   *
   * Standing inside, every member is within a parsec or two and all of
   * them run past the ceilings the sky's own zero point sets, so they
   * come out one size and one brightness — a field of identical blobs.
   * Standing outside, the cluster is one object among the rest of the
   * sky and has to be drawn on the same photometry as everything else
   * in it, or it goes dark while the galaxy around it does not. So the
   * zero point travels between the two, over the distance across which
   * the cluster stops being a sky and becomes a knot. Returns how far
   * along that crossing the camera is, 0 inside and 1 out, since the
   * exposure has to make the same journey.
   */
  update(distancePc: number): number {
    const out = Math.min(
      1,
      Math.max(0, (distancePc - this.nearPc) / (this.farPc - this.nearPc)),
    );
    const eased = out * out * (3 - 2 * out);
    (this.points.material as ShaderMaterial).uniforms.uZeroPoint.value =
      this.insideZeroPoint + (SKY_ZERO_POINT - this.insideZeroPoint) * eased;
    return eased;
  }

  /** Daylight washout, the same dial the neighborhood points take. */
  set intensity(value: number) {
    (this.points.material as ShaderMaterial).uniforms.uIntensity.value = value;
  }

  /** Pixels per radian of the buffer being drawn into, over the
   *  screen's — so a star captured for the lensed sky comes back the
   *  size it would have been drawn directly. */
  set sizeScale(value: number) {
    (this.points.material as ShaderMaterial).uniforms.uSizeScale.value = value;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}

/**
 * Where this cluster sits against the material's ceilings, seen from
 * its own middle — which is the only place it is a sky rather than a
 * knot. A star's flux there is its luminosity over its distance from
 * the centre, and the zero point is set so the bright end of that
 * distribution lands just under the largest dot the material draws.
 * On the night-sky zero point the whole cluster is over the ceiling
 * and every star comes out the same size, which is not a star field.
 */
function zeroPoint(stars: ClusterStars): number {
  const fluxes: number[] = [];
  for (let i = 0; i < stars.luminosities.length; i++) {
    const x = stars.positionsPc[i * 3];
    const y = stars.positionsPc[i * 3 + 1];
    const z = stars.positionsPc[i * 3 + 2];
    fluxes.push(stars.luminosities[i] / Math.max(x * x + y * y + z * z, 1e-6));
  }
  fluxes.sort((a, b) => a - b);
  const bright = fluxes[Math.floor(fluxes.length * 0.9)] || 1;
  // 10 leaves the ninetieth percentile a shade under the size ceiling
  // at 11.1, so the brightest tenth saturates and the rest spreads out.
  return 10 - Math.log2(bright);
}

/** Radius holding the given share of the drawn stars, pc. */
function radiusHolding(stars: ClusterStars, share: number): number {
  const radii: number[] = [];
  for (let i = 0; i < stars.luminosities.length; i++) {
    radii.push(Math.hypot(stars.positionsPc[i * 3], stars.positionsPc[i * 3 + 1], stars.positionsPc[i * 3 + 2]));
  }
  radii.sort((a, b) => a - b);
  return radii[Math.floor(radii.length * share)] || 1;
}
