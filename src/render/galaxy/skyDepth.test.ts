import { Mesh, Points, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { SkyField } from '../../universe/galaxy/skyfield';
import { GalaxyVolume } from './galaxyVolume';
import { StarfieldBackdrop } from '../starfield/starfieldBackdrop';

const IDENTITY = new Float32Array([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);

function emptySky(): SkyField {
  return {
    starCount: 0,
    nearStarCount: 0,
    starDirs: new Float32Array(),
    starColors: new Float32Array(),
    starBrightness: new Float32Array(),
    starDistances: new Float32Array(),
    starTeffs: new Float32Array(),
    starSeeds: new BigUint64Array(),
    nebulae: [],
    nebulaAtlas: new Float32Array(),
    glowWidth: 1,
    glowHeight: 1,
    glowData: new Float32Array([0, 0, 0, 0]),
    riftData: new Float32Array([1]),
    darkClouds: [],
    darkAtlas: new Float32Array(),
    sceneFromGalaxy: IDENTITY,
    sectorBounds: new Float32Array(),
    sectorHomeBounds: new Float32Array(),
    constellationBounds: new Float32Array(),
    sectorLabels: [],
    constellationLabels: [],
    bayerNames: new Map(),
  };
}

function expectFarBackground(material: ShaderMaterial): void {
  expect(material.transparent).toBe(false);
  expect(material.depthTest).toBe(true);
  expect(material.depthWrite).toBe(false);
  expect(material.vertexShader).toContain('gl_Position.z = 1e-24 * gl_Position.w');
}

describe('galactic background depth', () => {
  it('pins backdrop stars and glow behind all local geometry', () => {
    const backdrop = new StarfieldBackdrop(emptySky(), 2000);
    const points = backdrop.group.children.find((child) => child instanceof Points) as Points;
    const glow = backdrop.group.children.find((child) => child instanceof Mesh) as Mesh;
    expectFarBackground(points.material as ShaderMaterial);
    expectFarBackground(glow.material as ShaderMaterial);
    backdrop.dispose();
  });

  it('keeps the volumetric galaxy in the depth-tested background queue', () => {
    const volume = new GalaxyVolume({ xPc: 0, yPc: 0, zPc: 0 }, IDENTITY);
    expectFarBackground(volume.mesh.material as ShaderMaterial);
    volume.dispose();
  });
});
