import { afterEach, expect, it, vi } from 'vitest';
import { Sprite, SpriteMaterial } from 'three';
import type { SkyField } from '../../universe/galaxy/skyfield';
import { SectorChart } from './sectorChart';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('keeps hidden charts cheap and budgets labels when opened, preserving scale and disposal', () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock++);
  const createElement = vi.fn(() => ({ width: 0, height: 0, getContext: () => ({
    measureText: () => ({ width: 100 }), fillText: vi.fn(),
  }) }));
  vi.stubGlobal('document', { createElement });
  const sky = { sectorBounds: new Float32Array(), sectorHomeBounds: new Float32Array(),
    constellationBounds: new Float32Array(), sectorLabels: [{ name: 'Home', x: 1, y: 2, z: 3, home: true }],
    constellationLabels: [{ name: 'Cloud', x: 0, y: 0, z: 800, home: false }],
  } as unknown as SkyField;
  const chart = new SectorChart(sky);
  chart.updateLabels();
  expect(createElement).not.toHaveBeenCalled();
  chart.skyOpacity = 1;
  chart.skyRadiusLimitPc = 400;
  chart.updateLabels(1);
  expect(createElement).toHaveBeenCalledTimes(1);
  chart.updateLabels(1);
  expect(createElement).toHaveBeenCalledTimes(2);
  const sprites = chart.group.children.filter(child => child instanceof Sprite) as Sprite[];
  expect(sprites[1].position.z).toBe(400);
  expect(sprites[1].visible).toBe(true);
  expect((sprites[1].material as SpriteMaterial).opacity).toBe(0.85);
  const dispose = vi.fn();
  (sprites[1].material as SpriteMaterial).map!.addEventListener('dispose', dispose);
  chart.dispose(); chart.dispose(); chart.updateLabels();
  expect(dispose).toHaveBeenCalledOnce();
  expect(createElement).toHaveBeenCalledTimes(2);
});

it('abandons unfinished font work when travelling away', () => {
  const createElement = vi.fn();
  vi.stubGlobal('document', { createElement });
  const chart = new SectorChart({ sectorBounds: new Float32Array(), sectorHomeBounds: new Float32Array(),
    constellationBounds: new Float32Array(), sectorLabels: [{ name: 'Unseen' }], constellationLabels: [],
  } as unknown as SkyField);
  chart.opacity = 1;
  chart.dispose(); chart.updateLabels();
  expect(createElement).not.toHaveBeenCalled();
});

it('keeps compiling materials alive across travel and releases them after completion', async () => {
  const createElement = vi.fn();
  vi.stubGlobal('document', { createElement });
  const chart = new SectorChart({ sectorBounds: new Float32Array(), sectorHomeBounds: new Float32Array(),
    constellationBounds: new Float32Array(), sectorLabels: [], constellationLabels: [],
  } as unknown as SkyField);
  let finish!: () => void;
  chart.prepare(() => new Promise<void>(resolve => { finish = resolve; }));
  chart.skyOpacity = 1;
  expect(chart.group.visible).toBe(false);
  chart.updateLabels();
  expect(createElement).not.toHaveBeenCalled();
  const prototype = chart.group.children.find(child => child instanceof Sprite) as Sprite;
  const disposed = vi.fn();
  prototype.material.addEventListener('dispose', disposed);
  chart.dispose();
  expect(disposed).not.toHaveBeenCalled();
  finish(); await Promise.resolve();
  expect(disposed).toHaveBeenCalledOnce();
  expect(chart.group.children).toHaveLength(0);
});

it('reveals requested layers after preparation and does not warm them twice', async () => {
  const chart = new SectorChart({ sectorBounds: new Float32Array(), sectorHomeBounds: new Float32Array(),
    constellationBounds: new Float32Array(), sectorLabels: [], constellationLabels: [],
  } as unknown as SkyField);
  let finish!: () => void;
  const compile = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  chart.prepare(compile);
  chart.opacity = 1;
  chart.prepare(compile);
  expect(chart.group.visible).toBe(false);
  finish(); await Promise.resolve();
  expect(chart.group.visible).toBe(true);
  chart.prepare(compile);
  expect(compile).toHaveBeenCalledOnce();
  expect(chart.group.children.filter(child => child instanceof Sprite)).toHaveLength(1);
  chart.dispose();
});
