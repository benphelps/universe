import { describe, expect, it } from 'vitest';
import { GenerationScheduler, type GenerationPriority } from './generationScheduler';

describe('generation scheduler', () => {
  it('hands released capacity to the highest-priority waiting work', () => {
    const scheduler = new GenerationScheduler(2);
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const queue = (name: string, priority: GenerationPriority): void => {
      scheduler.schedule(priority, (release) => {
        started.push(name);
        releases.push(release);
      });
    };

    queue('running-a', 'background');
    queue('running-b', 'background');
    queue('background', 'background');
    queue('sky', 'sky-preview');
    queue('surface', 'visible-surface');
    queue('terrain', 'visible-terrain');
    expect(started).toEqual(['running-a', 'running-b']);
    expect(scheduler.queuedCount).toBe(4);

    releases.shift()!();
    expect(started.at(-1)).toBe('terrain');
    releases.shift()!();
    expect(started.at(-1)).toBe('surface');
    releases.shift()!();
    expect(started.at(-1)).toBe('sky');
    releases.shift()!();
    expect(started.at(-1)).toBe('background');

    while (releases.length > 0) releases.shift()!();
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.queuedCount).toBe(0);
  });

  it('cancels queued work without consuming capacity', () => {
    const scheduler = new GenerationScheduler(1);
    let releaseActive = (): void => {};
    scheduler.schedule('background', (release) => {
      releaseActive = release;
    });
    const canceled = scheduler.schedule('visible-terrain', () => {
      throw new Error('canceled work started');
    });
    canceled();
    releaseActive();
    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.queuedCount).toBe(0);
  });
});
