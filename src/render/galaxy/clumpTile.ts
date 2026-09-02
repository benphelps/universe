import { createPeriodicPerlin3 } from '../../core/noise/periodic3';

/**
 * The clump noise as a tile the march can fetch instead of compute.
 *
 * The volume march reads ISM patchiness twice per step per pixel, and
 * evaluating simplex in the shader was most of the galaxy's frame
 * cost. The field is the statistical limit of the cloud population —
 * unseeded texture, the same for every galaxy, exactly as the fixed
 * shader table was — so one periodic tile serves forever, and the GPU
 * reads it at texture speed.
 */

/** Lattice cells per tile: one cell is one noise wavelength, so the
 *  pattern repeats every CLUMP_TILE_PERIOD wavelengths. The two
 *  octaves and the swirl shear read it at different scales, which
 *  keeps the repeat from ever lining up with itself. */
export const CLUMP_TILE_PERIOD = 16;
/** Texels per axis — eight per lattice cell, so the quintic between
 *  lattice points survives trilinear reconstruction. */
export const CLUMP_TILE_SIZE = 128;
/** Byte 0 and 255 stand for ∓ this: the spread-matched noise peaks
 *  near ±1.42, so ±1 would clip the clump crests flat. */
export const CLUMP_TILE_RANGE = 1.6;

/** The tile's colour channels are the same noise read at three
 *  offsets, in tile turns: the three components of the nebula march's
 *  domain warp in one fetch rather than three. The first is the tile
 *  itself, which the galaxy dome's clump field reads. */
export const CLUMP_TILE_OFFSETS: readonly [number, number, number] = [0, 0.31, 0.67];
/** The alpha channel is the noise at twice the frequency, offset by
 *  this in tile turns: the march's sub-cell octave, which reads the
 *  field at double the warp's frequency, from the warp's own fetch. */
export const CLUMP_TILE_OCTAVE_OFFSET = 0.13;

/** One RGBA texel per noise sample, bytes over ±CLUMP_TILE_RANGE. */
export function bakeClumpTile(): Uint8Array {
  const noise = createPeriodicPerlin3(0x434c554dn, CLUMP_TILE_PERIOD);
  const size = CLUMP_TILE_SIZE;
  const toLattice = CLUMP_TILE_PERIOD / size;
  const shifts = CLUMP_TILE_OFFSETS.map((turns) => turns * CLUMP_TILE_PERIOD);
  const octaveShift = CLUMP_TILE_OCTAVE_OFFSET * CLUMP_TILE_PERIOD;
  const out = new Uint8Array(size * size * size * 4);
  let at = 0;
  for (let z = 0; z < size; z++) {
    const lz = (z + 0.5) * toLattice;
    for (let y = 0; y < size; y++) {
      const ly = (y + 0.5) * toLattice;
      for (let x = 0; x < size; x++) {
        const lx = (x + 0.5) * toLattice;
        for (const shift of shifts) {
          const value = noise(lx + shift, ly + shift, lz + shift);
          const unit = (value + CLUMP_TILE_RANGE) / (2 * CLUMP_TILE_RANGE);
          out[at++] = Math.round(255 * Math.min(1, Math.max(0, unit)));
        }
        const octave = noise(2 * lx + octaveShift, 2 * ly + octaveShift, 2 * lz + octaveShift);
        const octaveUnit = (octave + CLUMP_TILE_RANGE) / (2 * CLUMP_TILE_RANGE);
        out[at++] = Math.round(255 * Math.min(1, Math.max(0, octaveUnit)));
      }
    }
  }
  return out;
}
