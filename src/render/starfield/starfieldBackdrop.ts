import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  Group,
  LinearFilter,
  Mesh,
  Points,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector4,
} from 'three';
import type { SkyField } from '../../universe/galaxy/skyfield';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';

const MAX_NEBULAE = 48;

const NEBULA_FRAGMENT = /* glsl */ `
varying vec3 vDir;

uniform vec4 uNebulaA[${MAX_NEBULAE}]; // dir.xyz, angular radius
uniform vec4 uNebulaB[${MAX_NEBULAE}]; // color.rgb, brightness
uniform int uNebulaCount;
uniform float uIntensity;

${SIMPLEX_NOISE_GLSL}

void main() {
  vec3 dir = normalize(vDir);
  // Two shared wisp fields, phase-shifted per nebula: structure without
  // per-patch noise evaluation.
  float broad = fbm(dir * 7.0);
  float fine = fbm(dir * 19.0);

  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_NEBULAE}; i++) {
    if (i >= uNebulaCount) break;
    vec4 a = uNebulaA[i];
    // Small-angle chord metric avoids acos.
    float dSq = 2.0 * (1.0 - dot(dir, a.xyz));
    float radiusSq = a.w * a.w;
    if (dSq > radiusSq * 5.0) continue;
    float core = exp(-dSq / (radiusSq * 0.6));
    float wisp = 0.55 + 0.45 * sin((broad * 3.0 + fine) * 6.2831 + float(i) * 2.39);
    sum += uNebulaB[i].rgb * uNebulaB[i].w * core * wisp;
  }
  gl_FragColor = vec4(sum * uIntensity, 1.0);
}
`;

const POINTS_VERTEX = /* glsl */ `
attribute vec3 starColor;
attribute float brightness;

uniform float uIntensity;

varying vec3 vColor;
varying float vAlpha;

void main() {
  // Photometric mapping: size and energy follow log irradiance,
  // compressed so only the very nearest stars blaze.
  float logE = log2(max(brightness, 1e-12));
  float size = clamp(1.5 + 0.45 * (logE + 17.0), 1.0, 6.5);
  float energy = clamp(0.055 * exp2(0.36 * (logE + 17.0)), 0.012, 1.7) * uIntensity;
  vColor = starColor * energy;
  vAlpha = clamp(energy * 4.0, 0.0, 1.0);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const POINTS_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float falloff = 1.0 - smoothstep(0.25, 1.0, length(c));
  gl_FragColor = vec4(vColor * falloff * vAlpha, 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vDir;

uniform sampler2D uGlow;
uniform float uIntensity;

void main() {
  // Scene frame → galactic frame: scene y is the disk normal.
  float latitude = asin(clamp(vDir.y, -1.0, 1.0));
  float longitude = atan(vDir.z, vDir.x);
  vec2 uv = vec2(longitude / 6.2831853 + 0.5, latitude / 3.14159265 + 0.5);
  gl_FragColor = vec4(texture2D(uGlow, uv).rgb * uIntensity, 1.0);
}
`;

/**
 * The night sky as scene backdrop: the sky field's resolved stars as
 * photometric points plus the Milky Way glow dome, both at a fixed
 * radius around the camera (the viewer re-centers the group each frame).
 * uIntensity lets daylight wash the stars out.
 */
export class StarfieldBackdrop {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];

  /** skipStars omits the first N sky entries (a 3D view of the near field). */
  constructor(sky: SkyField, radius: number, skipStars = 0) {
    const count = sky.starCount - skipStars;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const s = i + skipStars;
      // Galactic (x, y, z-disk) → scene (x, z, y): the band lies on the horizon.
      positions[i * 3] = sky.starDirs[s * 3] * radius;
      positions[i * 3 + 1] = sky.starDirs[s * 3 + 2] * radius;
      positions[i * 3 + 2] = sky.starDirs[s * 3 + 1] * radius;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute(
      'starColor',
      new BufferAttribute(sky.starColors.subarray(skipStars * 3), 3),
    );
    geometry.setAttribute(
      'brightness',
      new BufferAttribute(sky.starBrightness.subarray(skipStars), 1),
    );

    const pointsMaterial = new ShaderMaterial({
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      uniforms: { uIntensity: { value: 1 } },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(pointsMaterial);
    const points = new Points(geometry, pointsMaterial);
    points.frustumCulled = false;
    points.renderOrder = -2;
    this.group.add(points);

    const texture = new DataTexture(
      sky.glowData,
      sky.glowWidth,
      sky.glowHeight,
      RGBAFormat,
      FloatType,
    );
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.needsUpdate = true;
    const glowMaterial = new ShaderMaterial({
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      uniforms: { uGlow: { value: texture }, uIntensity: { value: 1 } },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: BackSide,
    });
    this.materials.push(glowMaterial);
    const dome = new Mesh(new SphereGeometry(radius * 1.01, 48, 24), glowMaterial);
    dome.frustumCulled = false;
    dome.renderOrder = -3;
    this.group.add(dome);

    if (sky.nebulae.length > 0) {
      const patches = [...sky.nebulae]
        .sort((a, b) => b.brightness - a.brightness)
        .slice(0, MAX_NEBULAE);
      const nebulaA = Array.from({ length: MAX_NEBULAE }, (_, i) => {
        const patch = patches[i];
        // Galactic (x, y, z-disk) → scene (x, z, y), like the stars.
        return patch
          ? new Vector4(patch.dir[0], patch.dir[2], patch.dir[1], patch.angularRadius)
          : new Vector4(0, 1, 0, 0);
      });
      const nebulaB = Array.from({ length: MAX_NEBULAE }, (_, i) => {
        const patch = patches[i];
        return patch
          ? new Vector4(patch.color[0], patch.color[1], patch.color[2], patch.brightness)
          : new Vector4(0, 0, 0, 0);
      });
      const nebulaMaterial = new ShaderMaterial({
        vertexShader: GLOW_VERTEX,
        fragmentShader: NEBULA_FRAGMENT,
        uniforms: {
          uNebulaA: { value: nebulaA },
          uNebulaB: { value: nebulaB },
          uNebulaCount: { value: patches.length },
          uIntensity: { value: 1 },
        },
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: BackSide,
      });
      this.materials.push(nebulaMaterial);
      const nebulaDome = new Mesh(new SphereGeometry(radius * 1.02, 48, 24), nebulaMaterial);
      nebulaDome.frustumCulled = false;
      nebulaDome.renderOrder = -3;
      this.group.add(nebulaDome);
    }
  }

  /** 1 = full night sky; approaches 0 under bright daylight. */
  set intensity(value: number) {
    for (const material of this.materials) material.uniforms.uIntensity.value = value;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Points || obj instanceof Mesh) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
  }
}
