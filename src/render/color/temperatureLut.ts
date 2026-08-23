import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
} from 'three';
import { buildTemperatureLut } from '../../core/color/blackbody';

/**
 * 1D blackbody-color lookup as a 256×1 float texture, mired-indexed
 * (u=0 hottest → u=1 coolest). Values are linear sRGB.
 */
export function createTemperatureLutTexture(): DataTexture {
  const size = 256;
  const texture = new DataTexture(buildTemperatureLut(size), size, 1, RGBAFormat, FloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
