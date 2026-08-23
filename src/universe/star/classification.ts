import type { StellarPhysical, StellarStage } from './types';

interface SpectralBand {
  cls: string;
  min: number;
  max: number;
}

/** Temperature bands including substellar L/T/Y classes. */
const BANDS: SpectralBand[] = [
  { cls: 'O', min: 30000, max: 55000 },
  { cls: 'B', min: 10000, max: 30000 },
  { cls: 'A', min: 7500, max: 10000 },
  { cls: 'F', min: 6000, max: 7500 },
  { cls: 'G', min: 5200, max: 6000 },
  { cls: 'K', min: 3700, max: 5200 },
  { cls: 'M', min: 2400, max: 3700 },
  { cls: 'L', min: 1300, max: 2400 },
  { cls: 'T', min: 600, max: 1300 },
  { cls: 'Y', min: 0, max: 600 },
];

const LUMINOSITY_CLASS: Partial<Record<StellarStage, string>> = {
  'main-sequence': 'V',
  subgiant: 'IV',
  giant: 'III',
  'horizontal-branch': 'III',
  agb: 'III',
  supergiant: 'I',
};

export function spectralClassAndSubtype(tEff: number): { cls: string; subtype: number } {
  const clamped = Math.min(54999, Math.max(1, tEff));
  const band = BANDS.find((b) => clamped >= b.min && clamped < b.max) ?? BANDS[0];
  const subtype = Math.min(9, Math.floor((10 * (band.max - clamped)) / (band.max - band.min)));
  return { cls: band.cls, subtype };
}

/** Full spectral type string, e.g. "G2V", "M5III", "DA4", "L3". */
export function spectralType(phys: StellarPhysical): string {
  switch (phys.stage) {
    case 'white-dwarf': {
      // Standard white-dwarf index: 50,400 / T_eff, clamped to one digit.
      const index = Math.min(9, Math.max(0, Math.round(50400 / phys.tEff)));
      return `DA${index}`;
    }
    case 'neutron-star':
      return 'NS';
    case 'black-hole':
      return 'BH';
    case 'brown-dwarf': {
      const { cls, subtype } = spectralClassAndSubtype(phys.tEff);
      return `${cls}${subtype}`;
    }
    default: {
      const { cls, subtype } = spectralClassAndSubtype(phys.tEff);
      return `${cls}${subtype}${LUMINOSITY_CLASS[phys.stage] ?? ''}`;
    }
  }
}
