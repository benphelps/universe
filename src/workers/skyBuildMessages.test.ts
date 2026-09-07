import { expect, it, vi } from 'vitest';
import { skyBuildProgress } from './skyBuildMessages';

it('replaces the finished star row with live background progress at the 84% boundary', () => {
  const post = vi.fn(), progress = skyBuildProgress('seed', post);
  progress.survey(1, 'giants & rarities', 1);
  expect(post).toHaveBeenLastCalledWith({ seedHex: 'seed', progress: 0.84, stage: 'waiting for sky background', stageFraction: -1 });
  progress.background(0.05, 'nebulae 12/24', 0.5);
  expect(post.mock.lastCall![0]).toMatchObject({ stage: 'nebulae 12/24', stageFraction: 0.5 });
  progress.background(1, 'milky way glow', 1);
  expect(post.mock.lastCall![0]).toMatchObject({ stage: 'assembling sky' });
});

it('keeps progress monotonic as parallel producers finish and a background retries', () => {
  const post = vi.fn(), progress = skyBuildProgress('seed', post);
  progress.survey(0.1, 'dwarfs', 0.1);
  progress.background(0.3, 'charting', 0.5);
  progress.survey(0.8, 'giants & rarities', 0.8);
  expect(post.mock.lastCall![0].stage).toBe('giants & rarities');
  progress.survey(1, 'giants & rarities', 1);
  expect(post.mock.lastCall![0].stage).toBe('charting');
  progress.assembly(0.84, 'nebulae 0/24', 0);
  progress.assembly(0.9, 'charting', -1);
  const fractions = post.mock.calls.map(([m]) => m.progress);
  expect(fractions).toEqual([...fractions].sort((a,b) => a-b));
});
