import { describe, expect, it, vi } from 'vitest';
import { Vector3, type WebGLRenderer } from 'three';
import { generateSystem } from '../../universe/system/generate';
import { deriveCirculation } from '../../universe/planet/circulation';
import { DeckBaker } from './deckBaker';

describe('complete giant cubemap baking', () => {
  for (const throws of [false, true]) it(`restores renderer state${throws ? ' after a failed face' : ' and generates only one mip chain'}`, () => {
    const physical = generateSystem(882300n).planets[0].physical;
    const baker = new DeckBaker(physical, deriveCirculation(physical));
    const target = DeckBaker.createTarget(64), previous = DeckBaker.createTarget(16);
    const mipmaps: boolean[] = [];
    const renderer = {
      getRenderTarget: () => previous,
      getActiveCubeFace: () => 3,
      getActiveMipmapLevel: () => 1,
      setRenderTarget: vi.fn(),
      render: () => {
        mipmaps.push(target.texture.generateMipmaps);
        if (throws && mipmaps.length === 3) throw new Error('interrupted render');
      },
    };
    const bake = () => baker.bake(renderer as unknown as WebGLRenderer, target, 0, new Vector3(1, 0, 0));
    if (throws) expect(bake).toThrow('interrupted render'); else bake();
    expect(mipmaps).toEqual(throws ? [false, false, false] : [false, false, false, false, false, true]);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(previous, 3, 1);
    expect(target.texture.generateMipmaps).toBe(true);
    baker.dispose(); target.dispose(); previous.dispose();
  });
});
