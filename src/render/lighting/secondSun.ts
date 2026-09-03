import { Color, type ShaderMaterial, type Vector3 } from 'three';

/**
 * The second light on a body: a close binary's other sun, or the
 * brightest sunlit companion body hanging over a surface. Its color
 * arrives premultiplied against the shader's own host light, and its
 * angular radius shapes the penumbra of any shadow it casts.
 */
export interface SecondSun {
  /** World direction toward the light. */
  dir: Vector3;
  color: readonly [number, number, number];
  angularRadius: number;
  /** Distance to the source's near surface, or infinite for a star. */
  reach: number;
}

/**
 * The second light's uniforms and the gate every lit shader keeps its
 * second-sun work behind: the color stays black when nothing
 * contributes, and a single-star system skips that light's shadows,
 * lighting and scatter outright.
 */
export const SECOND_SUN_GLSL = /* glsl */ `
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;

bool secondSunLit() {
  return any(greaterThan(uLight2Color, vec3(0.0)));
}
`;

export function secondSunUniforms(): Record<string, { value: unknown }> {
  return {
    uLight2Dir: { value: [0, 0, 1] },
    uLight2Color: { value: new Color(0, 0, 0) },
  };
}

export function applySecondSun(material: ShaderMaterial, second: SecondSun | null): void {
  const uniforms = material.uniforms;
  if (!uniforms.uLight2Dir) return;
  if (second) {
    uniforms.uLight2Dir.value = [second.dir.x, second.dir.y, second.dir.z];
    (uniforms.uLight2Color.value as Color).setRGB(...second.color);
    if (uniforms.uStar2AngularRadius) uniforms.uStar2AngularRadius.value = second.angularRadius;
    if (uniforms.uLight2Reach) uniforms.uLight2Reach.value = second.reach;
  } else {
    (uniforms.uLight2Color.value as Color).setRGB(0, 0, 0);
  }
}
