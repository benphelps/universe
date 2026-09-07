import { describe, expect, it } from 'vitest';
import { depositGas, inverseShellMap, remapGas, shellMapRadius, type GasGrid, type MaterialMap } from './gasRemap';

const grid = (size: number, half = 4): GasGrid => ({ size, cellPc: 2 * half / size, originPc: [0, 0, 0], hydrogen: new Float32Array(size ** 3).fill(10) });

describe('conservative material remapping', () => {
  it('hands displaced inner mass to disjoint coarse cells without counting it twice', () => {
    const outer = grid(16), inner = grid(16, 2);
    outer.exclusion = { minimum: [4, 4, 4], span: 8 };
    const incoming = new Float64Array(16 ** 3);
    const map: MaterialMap = { subdivisions: () => 2, move(x, y, z, out) {
      const r = Math.hypot(x, y, z), scale = r > 0 ? shellMapRadius(r, 2.2, 2.8, 0.125) / r : 1;
      out.set([x * scale, y * scale, z * scale]);
    } };
    const a = remapGas(inner, map, { onOutgoing(x, y, z, mass) {
      expect(depositGas(incoming, outer, x, y, z, mass)).toBe(true);
    } });
    const b = remapGas(outer, map, { incoming });
    expect(a.outgoing).toBeGreaterThan(0);
    expect(b.incoming / a.outgoing).toBeCloseTo(1, 12);
    expect(a.natal + b.natal).toBeCloseTo(8 ** 3 * 10, 9);
    expect((a.retained + b.retained) / (a.natal + b.natal)).toBeCloseTo(1, 7);
    expect(b.outgoing).toBe(0);
  });

  it('preserves an unchanged nonuniform cloud exactly', () => {
    const g = grid(12);
    for (let i = 0; i < g.hydrogen.length; i++) g.hydrogen[i] = Math.sin(i) ** 2 * 400;
    const before = g.hydrogen.slice();
    const ledger = remapGas(g, { subdivisions: () => 0, move() {} });
    expect(g.hydrogen).toEqual(before);
    expect(ledger.relativeResidual).toBeCloseTo(0, 12);
    expect(ledger.outgoing).toBe(0);
  });

  it('measures material crossing the boundary instead of deleting it', () => {
    const g = grid(16);
    const map: MaterialMap = { subdivisions: () => 4, move(x, y, z, out) { out.set([x + 0.125, y, z]); } };
    const ledger = remapGas(g, map);
    expect(ledger.outgoing / ledger.natal).toBeCloseTo(0.125 / 8, 12);
    expect(Math.abs(ledger.relativeResidual)).toBeLessThan(1e-7);
  });

  it('is monotone and has the analytic interior and shell mass Jacobians', () => {
    for (const f of [0.001, 0.125, 0.7, 1]) {
      let last = 0;
      for (let i = 0; i <= 400; i++) {
        const r = i / 100, moved = shellMapRadius(r, 2, 2.4, f);
        expect(moved).toBeGreaterThanOrEqual(last);
        expect(moved).toBeGreaterThanOrEqual(r - 1e-12);
        expect(inverseShellMap(moved, 2, 2.4, f).radius).toBeCloseTo(r, 9);
        last = moved;
      }
      expect(inverseShellMap(1, 2, 2.4, f).densityScale).toBe(f);
      expect(inverseShellMap(2.1, 2, 2.4, f).densityScale).toBeCloseTo((2.4 ** 3 - 8 * f) / (2.4 ** 3 - 8), 12);
    }
  });

  it('recovers the depleted interior and shell mass under refinement', () => {
    const errors: number[] = [];
    for (const size of [24, 48, 72]) {
      const g = grid(size);
      const ledger = remapGas(g, { subdivisions(x, y, z, cell) { return Math.hypot(x, y, z) - cell > 2.4 ? 0 : 3; },
        move(x, y, z, out) { const r = Math.hypot(x, y, z), scale = r > 0 ? shellMapRadius(r, 2, 2.4, 0.125) / r : 1; out.set([x * scale, y * scale, z * scale]); } });
      expect(Math.abs(ledger.relativeResidual)).toBeLessThan(1e-7);
      expect(ledger.outgoing).toBe(0);
      let interior = 0, count = 0, shellMass = 0;
      for (let k = 0; k < size; k++) for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const r = Math.hypot(i + 0.5 - size / 2, j + 0.5 - size / 2, k + 0.5 - size / 2) * g.cellPc;
        const n = g.hydrogen[(k * size + j) * size + i];
        if (r < 1.5) { interior += n; count++; }
        if (r >= 2 && r < 2.4) shellMass += n * g.cellPc ** 3;
      }
      expect(interior / count).toBeCloseTo(1.25, 1);
      const analyticShell = 10 * 4 * Math.PI / 3 * (2.4 ** 3 - 2 ** 3 * 0.125);
      errors.push(Math.abs(shellMass / analyticShell - 1));
    }
    expect(errors[2]).toBeLessThan(errors[0]);
    expect(errors[2]).toBeLessThan(0.15);
  });
});
