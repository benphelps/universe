import { describe, expect, it } from 'vitest';
import type { NebulaVolumeBake } from '../universe/galaxy/nebulaVolume';
import { NebulaShelf } from './nebulaShelf';

function bake(bytes: number): NebulaVolumeBake {
  return { data: new Uint8Array(bytes) } as unknown as NebulaVolumeBake;
}

describe('nebula shelf', () => {
  it('lets go of the least recently wanted loose bake', () => {
    const shelf = new NebulaShelf(25);
    shelf.put('a', bake(10));
    shelf.put('b', bake(10));
    expect(shelf.get('a')).toBeDefined();
    shelf.put('c', bake(10));
    expect(shelf.get('b')).toBeUndefined();
    expect(shelf.get('a')).toBeDefined();
    expect(shelf.get('c')).toBeDefined();
    expect(shelf.loose).toBe(20);
  });

  it('never lets go of a held bake, and does not count it', () => {
    const shelf = new NebulaShelf(15);
    shelf.put('held', bake(10));
    shelf.hold('held');
    expect(shelf.loose).toBe(0);
    shelf.put('x', bake(10));
    shelf.put('y', bake(10));
    expect(shelf.get('held')).toBeDefined();
    expect(shelf.get('x')).toBeUndefined();
    expect(shelf.get('y')).toBeDefined();
    // Released, it is the most recently wanted loose bake: the room
    // it needs comes from the others.
    shelf.release('held');
    expect(shelf.loose).toBe(10);
    expect(shelf.get('y')).toBeUndefined();
    expect(shelf.get('held')).toBeDefined();
    shelf.put('z', bake(10));
    expect(shelf.get('held')).toBeUndefined();
  });

  it('counts holds', () => {
    const shelf = new NebulaShelf(25);
    shelf.put('k', bake(10));
    shelf.hold('k');
    shelf.hold('k');
    shelf.release('k');
    shelf.put('a', bake(10));
    shelf.put('b', bake(10));
    shelf.put('c', bake(10));
    expect(shelf.get('k')).toBeDefined();
    shelf.release('k');
    shelf.put('d', bake(10));
    shelf.put('e', bake(10));
    expect(shelf.get('k')).toBeUndefined();
  });

  it('replaces a bake under its key without double counting', () => {
    const shelf = new NebulaShelf(100);
    shelf.put('k', bake(10));
    shelf.put('k', bake(30));
    expect(shelf.loose).toBe(30);
    expect(shelf.size).toBe(1);
  });
});
