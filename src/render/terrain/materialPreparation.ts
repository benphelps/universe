import { BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Mesh, type Object3D, type ShaderMaterial } from 'three';

/** Match the plain-terrain and colored-instance program keys before descent.
 * Compilation needs the object/material flags, not uploaded terrain buffers.
 * The caller retains the shared materials until this promise settles. */
export async function prepareGroundMaterials(
  terrain: ShaderMaterial,
  scatter: ShaderMaterial,
  compile: (object: Object3D) => Promise<unknown>,
): Promise<void> {
  const geometry = new BufferGeometry();
  // Three includes position/normal presence in its program key even for
  // custom shaders. Empty attributes match real chunks without GPU data.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(0), 3));
  const instances = new InstancedMesh(geometry, scatter, 1);
  instances.setColorAt(0, new Color(1, 1, 1));
  const variants = new Group();
  variants.add(new Mesh(geometry, terrain), instances);
  try { await compile(variants); }
  finally { instances.dispose(); geometry.dispose(); }
}
