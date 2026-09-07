import { expect,it } from 'vitest';
import { nuclearTile,nuclearPointKernel,NUCLEAR_TARGET_LIMIT } from './nuclearProjection';
it('conserves point flux at every subpixel phase, including negative positions',()=>{
  for(let centre=-3.1;centre<3.2;centre+=.013) {
    let sum=0;for(let i=-7;i<=7;i++)sum+=nuclearPointKernel(i+.5-centre);
    expect(sum).toBeCloseTo(1,13);
  }
});
it('bounds near-plane, inside, distant and off-screen footprints',()=>{
  for(const z of [-1e6,-100,-30,-1,0,1,29]) {
    const tile=nuclearTile([0,0,z],30,3456,2168,1.2,1.9)!;
    expect(tile.targetWidth).toBeLessThanOrEqual(NUCLEAR_TARGET_LIMIT);
    expect(tile.targetHeight).toBeLessThanOrEqual(NUCLEAR_TARGET_LIMIT);
    expect(tile.width).toBeLessThanOrEqual(3456);expect(tile.height).toBeLessThanOrEqual(2168);
  }
  expect(nuclearTile([0,0,31],30,3456,2168,1.2,1.9)).toBeNull();
  expect(nuclearTile([1e6,0,-100],30,3456,2168,1.2,1.9)).toBeNull();
  const far=nuclearTile([0,0,-1e6],30,3456,2168,1.2,1.9)!;
  expect(far.targetWidth*far.targetHeight).toBeLessThan(100);
});
