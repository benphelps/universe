import type { Nebula } from './nebula';
import { nebulaPortraitPhotometry } from './nebulaPortrait';

export interface NebulaLuminosities { lines: number; scattered: number }

/** The same disjoint solved volumes supply distant shape and light. */
export function nebulaSpriteLuminosities(nebula: Nebula): NebulaLuminosities {
  return nebulaPortraitPhotometry(nebula).luminosities;
}
