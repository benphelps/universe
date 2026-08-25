import { deriveSeed, mix64 } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { nearestArm, type GalacticPosition } from './density';
import { UNIVERSE_SEED } from './sectors';

/**
 * The galactic gazetteer: names for the structure the model already
 * carries, the way human astronomy named the Orion Arm or the Perseus
 * Arm. Nothing here adds objects — the arms are the density model's
 * arms, the chart sectors are a fixed grid over the disk — the names
 * are simply drawn deterministically from the universe seed, so every
 * chart of this universe agrees on them.
 */

/** Chart sectors: the named navigation grid, in the galactic plane. */
export const SECTOR_SPAN_PC = 400;

const ONSETS = [
  'k', 'v', 't', 's', 'th', 'r', 'm', 'n', 'd', 'l', 'z', 'b',
  'br', 'kr', 'dr', 'vel', 'mar', 'tal', 'or', 'ash',
];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ia', 'ya', 'ou'];
const CODAS = ['', '', '', 'n', 'r', 's', 'l', 'th', 'k', 'x', 'm'];

/** Deterministic proper name from a seed (shared by arms and sectors). */
export function generatedName(seed: bigint): string {
  const rng = new Rng(seed);
  const syllables = rng.float() < 0.35 ? 3 : 2;
  let name = '';
  for (let i = 0; i < syllables; i++) {
    name += ONSETS[rng.int(ONSETS.length)] + NUCLEI[rng.int(NUCLEI.length)];
  }
  name += CODAS[rng.int(CODAS.length)];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const ARM_NAMES = [0, 1].map((arm) => generatedName(deriveSeed(UNIVERSE_SEED, 'arm-name', arm)));

/** Name of the chart sector containing a galactic position. */
export function sectorName(positionPc: GalacticPosition): string {
  const ix = Math.floor(positionPc.xPc / SECTOR_SPAN_PC);
  const iy = Math.floor(positionPc.yPc / SECTOR_SPAN_PC);
  const seed = mix64(
    deriveSeed(UNIVERSE_SEED, 'sector-name') ^
      ((BigInt(ix & 0xfffff) << 20n) | BigInt(iy & 0xfffff)),
  );
  return generatedName(seed);
}

export interface GalacticAddress {
  /** Chart sector holding the locale. */
  sector: string;
  /** Broad structural zone the density model defines. */
  zone: 'core' | 'arm' | 'inter-arm' | 'rim' | 'halo';
  /** Proper name of the nearest spiral arm. */
  arm: string;
  radiusPc: number;
  /** Height above (+) or below (−) the midplane. */
  heightPc: number;
  /** One-line address for panels: sector, then the structural region. */
  label: string;
}

/** Where a locale sits in the galaxy, in chartable, nameable terms. */
export function galacticAddress(positionPc: GalacticPosition): GalacticAddress {
  const radiusPc = Math.hypot(positionPc.xPc, positionPc.yPc);
  const heightPc = positionPc.zPc;
  const azimuth = Math.atan2(positionPc.yPc, positionPc.xPc);
  const arm = nearestArm(radiusPc, azimuth);
  const armName = ARM_NAMES[arm.index];

  const zone: GalacticAddress['zone'] =
    Math.abs(heightPc) > 1200
      ? 'halo'
      : radiusPc < 1500
        ? 'core'
        : radiusPc > 13000
          ? 'rim'
          : arm.distancePc < 700
            ? 'arm'
            : 'inter-arm';

  const region =
    zone === 'halo'
      ? `the halo ${heightPc > 0 ? 'above' : 'below'} the disk`
      : zone === 'core'
        ? 'the galactic core'
        : zone === 'rim'
          ? 'the outer rim'
          : zone === 'arm'
            ? `the ${armName} Arm`
            : `the gap between the ${ARM_NAMES[0]} and ${ARM_NAMES[1]} Arms`;

  return {
    sector: sectorName(positionPc),
    zone,
    arm: armName,
    radiusPc,
    heightPc,
    label: `${sectorName(positionPc)} Sector · ${region} · ${(radiusPc / 1000).toFixed(1)} kpc from the core`,
  };
}
