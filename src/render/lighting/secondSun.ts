import { Color, type ShaderMaterial, type Vector3 } from 'three';

/**
 * The second sun: a close binary lights its worlds from two directions.
 * uLight2Color arrives premultiplied by the companion's flux ratio
 * against the primary and stays black when the contribution is
 * negligible, so single-star systems pay nothing.
 */
export const SECOND_SUN_GLSL = /* glsl */ `
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
`;

export function secondSunUniforms(): Record<string, { value: unknown }> {
  return {
    uLight2Dir: { value: [0, 0, 1] },
    uLight2Color: { value: new Color(0, 0, 0) },
  };
}

export function applySecondSun(
  material: ShaderMaterial,
  dir: Vector3 | null,
  color: readonly [number, number, number] | null,
): void {
  const uniforms = material.uniforms;
  if (!uniforms.uLight2Dir) return;
  if (dir && color) {
    uniforms.uLight2Dir.value = [dir.x, dir.y, dir.z];
    (uniforms.uLight2Color.value as Color).setRGB(color[0], color[1], color[2]);
  } else {
    (uniforms.uLight2Color.value as Color).setRGB(0, 0, 0);
  }
}
