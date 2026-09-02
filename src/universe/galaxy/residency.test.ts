import { describe, expect, it } from 'vitest';
import { cloudReachPc, cloudsNear } from './clouds';
import { HOME_POSITION } from './density';
import { displayPedestal, displaySurfaceBrightness, SKY_PEDESTAL_LSUN_PC2_SR } from './displayLaw';
import { nebulaFor, nebulaLightSolar, type Nebula } from './nebula';
import { residencyWeight } from './residency';

describe('residency weight', () => {
  const clouds = cloudsNear(HOME_POSITION, 1500);
  const lit = clouds
    .map((cloud) => ({ cloud, nebula: nebulaFor(cloud) }))
    .filter(
      (c): c is { cloud: (typeof clouds)[number]; nebula: Nebula } =>
        c.nebula !== null && c.nebula.photonRate > 0 && c.nebula.bubbleRadiusPc > 0,
    )
    .sort((a, b) => nebulaLightSolar(b.nebula) - nebulaLightSolar(a.nebula));
  const dark = clouds.filter((cloud) => nebulaFor(cloud) === null).sort((a, b) => b.radiusPc - a.radiusPc);
  const P = SKY_PEDESTAL_LSUN_PC2_SR;

  it('is a dark cloud’s silhouette against the sky, and a lit one’s light on top', () => {
    const distance = 300;
    const rift = dark[0];
    const reach = cloudReachPc(rift) / distance;
    expect(residencyWeight(rift, null, distance, P)).toBeCloseTo(
      Math.PI * reach * reach * displayPedestal(P),
      12,
    );
    const { cloud, nebula } = lit[0];
    const disc = Math.PI * (nebula.bubbleRadiusPc / distance) ** 2;
    const surface = nebulaLightSolar(nebula) / (4 * Math.PI * distance * distance * disc);
    expect(residencyWeight(cloud, nebula, distance, P)).toBeCloseTo(
      residencyWeight(cloud, null, distance, P) + disc * displaySurfaceBrightness(surface, P),
      12,
    );
    expect(residencyWeight(cloud, nebula, distance, P)).toBeGreaterThan(
      residencyWeight(cloud, null, distance, P),
    );
  });

  it('ranks rifts by size, and a lit cloud above a rift of its size', () => {
    const distance = 500;
    // Size decides between rifts.
    expect(residencyWeight(dark[0], null, distance, P)).toBeGreaterThan(
      residencyWeight(dark[dark.length - 1], null, distance, P),
    );
    // The same body lit outranks itself dark, whatever its distance:
    // surface brightness carries no distance, so the light's share of
    // what is at stake is the same from anywhere.
    const { cloud, nebula } = lit[0];
    const nearShare =
      residencyWeight(cloud, nebula, 200, P) / residencyWeight(cloud, null, 200, P);
    const farShare =
      residencyWeight(cloud, nebula, 2000, P) / residencyWeight(cloud, null, 2000, P);
    expect(nearShare).toBeGreaterThan(1);
    expect(nearShare).toBeCloseTo(farShare, 6);
  });
});
