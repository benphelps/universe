import { expect, it, vi } from 'vitest';
import { Group, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { PlanetObject } from './planetObject';
import { createSolidPlanetMaterial } from './solidPlanetMaterial';
import { prepareGroundMaterials } from '../terrain/materialPreparation';
import { generateStar } from '../../universe/star/generate';
import { characterizePlanet } from '../../universe/planet/characterize';
import { computeZones } from '../../universe/system/zones';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import { mu } from '../../core/physics/units';

vi.mock('./surfaceBakeQueue', () => ({ requestSurfaceBake: () => new Promise(() => {}) }));
vi.mock('./surfaceCube', () => ({ uploadSurfaceCube: () => ({ texture: {}, dispose: vi.fn() }) }));
const star = generateStar(1n, { massInitial: 1, ageGyr: 4.6, feH: 0, withCompanions: false });
const physical = characterizePlanet(19n, 'rocky', 1, {
  semiMajorAxis: AU, eccentricity: 0, inclination: 0, longitudeOfAscendingNode: 0,
  argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0,
}, { star, centralLuminosity: star.luminosity, mu: mu(G * SOLAR_MASS), zones: computeZones(star.luminosity, star.tEff, star.ageGyr, 1) });

it('does not publish a body before shader readiness, and handles departure during compilation', async () => {
  const body = new PlanetObject(physical);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const compile = vi.fn(() => pending);
  const mesh = body.group.children[0] as Mesh;
  const materialDispose = vi.spyOn(mesh.material as ShaderMaterial, 'dispose');
  body.prepare(compile); body.prepare(compile);
  await Promise.resolve();
  expect(compile).toHaveBeenCalledTimes(1);
  expect(mesh.visible).toBe(false);
  body.dispose(); body.dispose();
  expect(materialDispose).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(materialDispose).toHaveBeenCalledTimes(1));
  expect(mesh.visible).toBe(false);
});

it('publishes on readiness, and still releases resources after a preparation failure', async () => {
  for (const reject of [false, true]) {
    const body = new PlanetObject(physical);
    const compile = reject ? () => Promise.reject(new Error('test failure')) : () => Promise.resolve();
    body.prepare(compile);
    await vi.waitFor(() => expect(body.group.children.every(object => object.visible)).toBe(true));
    const mesh = body.group.children[0] as Mesh;
    const disposal = vi.spyOn(mesh.material as ShaderMaterial, 'dispose');
    body.dispose(); expect(disposal).toHaveBeenCalledTimes(1);
  }
});

it('switches a completed surface map without changing the shader program version', () => {
  const material = createSolidPlanetMaterial(physical), mesh = new Mesh(new SphereGeometry(), material);
  const body = { body: mesh, spinRadPerDay: 1, surfaceFaces: Array.from({length:6},()=>new Uint8Array(4)), surfaceSize: 1,
    materials: [material], circulation: null, rings: null } as unknown as PlanetObject;
  const version = material.version;
  expect(material.uniforms.uHasSurface.value).toBe(false);
  PlanetObject.prototype.update.call(body, 0, new Vector3(0,0,1), [1,1,1], null, {} as never);
  expect(material.uniforms.uHasSurface.value).toBe(true);
  expect(material.version).toBe(version);
  expect(material.defines.HAS_SURFACE).toBeUndefined();
  material.dispose(); mesh.geometry.dispose();
});

it('prepares the colored instance variant and releases only its temporary probe resources', async () => {
  const terrain = new ShaderMaterial(), scatter = new ShaderMaterial();
  const disposeTerrain = vi.spyOn(terrain, 'dispose'), disposeScatter = vi.spyOn(scatter, 'dispose');
  let geometryDispose!: ReturnType<typeof vi.spyOn>;
  await prepareGroundMaterials(terrain, scatter, async object => {
    const group = object as Group;
    const mesh = group.children[1] as import('three').InstancedMesh;
    expect(mesh.isInstancedMesh).toBe(true); expect(mesh.instanceColor).not.toBeNull();
    expect(mesh.geometry.hasAttribute('position')).toBe(true);
    expect(mesh.geometry.hasAttribute('normal')).toBe(true);
    expect(mesh.material).toBe(scatter);
    geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
  });
  expect(geometryDispose).toHaveBeenCalledTimes(1);
  expect(disposeTerrain).not.toHaveBeenCalled(); expect(disposeScatter).not.toHaveBeenCalled();
  terrain.dispose(); scatter.dispose();
});
