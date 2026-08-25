import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LineSegments,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { PARSEC } from '../../core/physics/constants';
import type { SectorLabel, SkyField } from '../../universe/galaxy/skyfield';

/** The chart group lives under the parsec-scaled frame; no-attenuation
 *  sprites inherit that scale into their screen size, so labels divide
 *  it back out. */
const PARENT_SCALE = PARSEC / 1000;

const LINE_VERTEX = /* glsl */ `
varying float vDistPc;
void main() {
  vDistPc = length(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The chart maps where the discrete, clickable star catalog reaches:
// full within the survey, gone past its 2.5 kpc horizon.
const LINE_FRAGMENT = /* glsl */ `
varying float vDistPc;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  float reach = 1.0 - smoothstep(1400.0, 2500.0, vDistPc);
  gl_FragColor = vec4(uColor, uOpacity * reach);
}
`;

function createLineMaterial(color: [number, number, number]): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    uniforms: {
      uColor: { value: new Vector3(...color) },
      uOpacity: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  });
}

function createLabelSprite(label: SectorLabel): Sprite {
  const emphasized = label.home;
  const font = `${emphasized ? 600 : 500} ${emphasized ? 34 : 26}px ui-monospace, Menlo, monospace`;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(label.name).width) + 16;
  const height = emphasized ? 44 : 36;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = emphasized ? 'rgba(205, 220, 246, 0.95)' : 'rgba(156, 173, 203, 0.8)';
  ctx.fillText(label.name, 8, height / 2);
  const texture = new CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: false,
  });
  const sprite = new Sprite(material);
  const scale = (emphasized ? 0.05 : 0.037) / PARENT_SCALE;
  sprite.scale.set((scale * width) / height, scale, 1);
  sprite.position.set(label.x, label.y, label.z);
  sprite.renderOrder = 5;
  return sprite;
}

/**
 * The gazetteer drawn into space. Two layers share the group: the flat
 * province map around home — organic borders traced from the 3D
 * territory field's midplane slice, faded out where the discrete star
 * catalog's reach ends, provinces lettered, home outlined and named
 * bright — and the constellation-style borders across the local sky
 * with each neighboring territory's patch of sky named. The layers
 * crossfade: star map inside the neighborhood, province map from above.
 */
export class SectorChart {
  readonly group = new Group();
  private readonly borderMaterial: ShaderMaterial;
  private readonly homeMaterial: ShaderMaterial;
  private readonly skyMaterial: ShaderMaterial;
  private readonly skyLines: LineSegments;
  private readonly chartLabels: Sprite[] = [];
  private readonly skyLabels: Array<{ sprite: Sprite; base: Vector3 }> = [];
  private chartValue = 0;
  private skyValue = 0;
  private labelValue = 1;

  constructor(sky: SkyField) {
    this.borderMaterial = createLineMaterial([0.32, 0.38, 0.48]);
    this.homeMaterial = createLineMaterial([0.62, 0.72, 0.91]);
    this.skyMaterial = createLineMaterial([0.5, 0.58, 0.71]);
    const lines: LineSegments[] = [];
    for (const [positions, material] of [
      [sky.sectorBounds, this.borderMaterial],
      [sky.sectorHomeBounds, this.homeMaterial],
      [sky.sectorSkyBounds, this.skyMaterial],
    ] as Array<[Float32Array, ShaderMaterial]>) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const segments = new LineSegments(geometry, material);
      segments.frustumCulled = false;
      lines.push(segments);
      this.group.add(segments);
    }
    this.skyLines = lines[2];

    for (const label of sky.sectorLabels) {
      const sprite = createLabelSprite(label);
      this.chartLabels.push(sprite);
      this.group.add(sprite);
    }
    for (const label of sky.sectorSkyLabels) {
      const sprite = createLabelSprite(label);
      this.skyLabels.push({ sprite, base: new Vector3(label.x, label.y, label.z) });
      this.group.add(sprite);
    }
    this.group.visible = false;
  }

  private apply(): void {
    this.group.visible = this.chartValue > 0.01 || this.skyValue > 0.01;
    this.borderMaterial.uniforms.uOpacity.value = this.chartValue * 0.3;
    this.homeMaterial.uniforms.uOpacity.value = this.chartValue * 0.85;
    this.skyMaterial.uniforms.uOpacity.value = this.skyValue * 0.5;
    const chartLabelOpacity = this.chartValue * this.labelValue * 0.9;
    for (const sprite of this.chartLabels) {
      (sprite.material as SpriteMaterial).opacity = chartLabelOpacity;
      sprite.visible = chartLabelOpacity > 0.01;
    }
    for (const { sprite } of this.skyLabels) {
      (sprite.material as SpriteMaterial).opacity = this.skyValue * 0.85;
      sprite.visible = this.skyValue > 0.01;
    }
  }

  /** The flat province map around home (space views). */
  set opacity(value: number) {
    this.chartValue = value;
    this.apply();
  }

  /** The constellation-style borders across the local sky. */
  set skyOpacity(value: number) {
    this.skyValue = value;
    this.apply();
  }

  /** Lettering legibility: names withdraw once the patch shrinks small
   *  in frame — the far view keeps the borders, not the clutter. */
  set labelFade(value: number) {
    this.labelValue = value;
    this.apply();
  }

  /** The border sphere's radius is presentation: shrink it about home
   *  so it always sits inside the camera's current far plane. */
  set skyRadiusLimitPc(limit: number) {
    const scale = Math.min(1, Math.max(limit, 1) / 800);
    this.skyLines.scale.setScalar(scale);
    for (const { sprite, base } of this.skyLabels) {
      sprite.position.copy(base).multiplyScalar(scale);
    }
  }

  dispose(): void {
    for (const child of this.group.children) {
      if (child instanceof LineSegments) child.geometry.dispose();
      if (child instanceof Sprite) {
        (child.material as SpriteMaterial).map?.dispose();
        (child.material as SpriteMaterial).dispose();
      }
    }
    this.borderMaterial.dispose();
    this.homeMaterial.dispose();
    this.skyMaterial.dispose();
  }
}
