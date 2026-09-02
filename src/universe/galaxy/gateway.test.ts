import { describe, expect, it } from 'vitest';
import { cloudFieldAt, cloudLocalDensity, cloudReachPc, cloudsNear } from './clouds';
import { HOME_POSITION } from './density';
import { cloudGateway, cloudVantage } from './gateway';

describe('a cloud’s gateway', () => {
  const clouds = cloudsNear(HOME_POSITION, 1500)
    .sort((a, b) => b.radiusPc - a.radiusPc)
    .slice(0, 6);

  it('is a real star outside the gas, just past the thinnest side', () => {
    for (const cloud of clouds) {
      const reach = cloudReachPc(cloud);
      const gateway = cloudGateway(cloud);
      expect(gateway.seed).not.toBe(0n);
      expect(cloudFieldAt(gateway.positionPc)).toBe(0);
      const distance = Math.hypot(
        gateway.positionPc.xPc - cloud.positionPc.xPc,
        gateway.positionPc.yPc - cloud.positionPc.yPc,
        gateway.positionPc.zPc - cloud.positionPc.zPc,
      );
      expect(distance).toBeGreaterThan(reach * 0.95);
      expect(distance).toBeLessThan(reach * 1.05 + 60);
      expect(cloudGateway(cloud)).toBe(gateway);
    }
  });

  it('looks in along the direction the cloud is thinnest', () => {
    // The vantage direction's column is the least of the marched set,
    // so a cloud is met where its own body least obscures it.
    for (const cloud of clouds) {
      const reach = cloudReachPc(cloud);
      const { direction } = cloudVantage(cloud);
      const column = (u: [number, number, number]): number => {
        let tau = 0;
        for (let s = 0; s < 48; s++) {
          const r = ((s + 0.5) / 48) * reach;
          tau += cloudLocalDensity(cloud, u[0] * r, u[1] * r, u[2] * r);
        }
        return tau;
      };
      const chosen = column(direction);
      for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]] as const) {
        expect(chosen).toBeLessThanOrEqual(column([...axis]) + 1e-9);
      }
    }
  });
});
