import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three';

/**
 * The gazetteer's territory borders drawn into space: organic province
 * boundaries traced from the warped-Voronoi sector field (segments
 * arrive precomputed from the sky worker, in scene-frame parsecs), with
 * the home territory outlined bright as the chart's "you are here". A
 * navigation overlay in the same diagrammatic family as orbit lines —
 * it fades in as the camera leaves the neighborhood and the chart scale
 * starts to mean something.
 */
export class SectorChart {
  readonly group = new Group();
  private readonly borderMaterial: LineBasicMaterial;
  private readonly homeMaterial: LineBasicMaterial;
  private readonly skyMaterial: LineBasicMaterial;
  private chartValue = 0;
  private skyValue = 0;

  constructor(
    sectorBounds: Float32Array,
    sectorHomeBounds: Float32Array,
    sectorSkyBounds: Float32Array,
  ) {
    this.borderMaterial = new LineBasicMaterial({
      color: 0x51607a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.homeMaterial = new LineBasicMaterial({
      color: 0x9db8e8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.skyMaterial = new LineBasicMaterial({
      color: 0x7f93b5,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    for (const [positions, material] of [
      [sectorBounds, this.borderMaterial],
      [sectorHomeBounds, this.homeMaterial],
      [sectorSkyBounds, this.skyMaterial],
    ] as Array<[Float32Array, LineBasicMaterial]>) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const lines = new LineSegments(geometry, material);
      lines.frustumCulled = false;
      this.group.add(lines);
    }
    this.skyLines = this.group.children[2] as LineSegments;
    this.group.visible = false;
  }

  private readonly skyLines: LineSegments;

  /** The border sphere's radius is presentation: shrink it about home
   *  so it always sits inside the camera's current far plane. */
  set skyRadiusLimitPc(limit: number) {
    this.skyLines.scale.setScalar(Math.min(1, Math.max(limit, 1) / 800));
  }

  private apply(): void {
    this.group.visible = this.chartValue > 0.01 || this.skyValue > 0.01;
    this.borderMaterial.opacity = this.chartValue * 0.3;
    this.homeMaterial.opacity = this.chartValue * 0.85;
    this.skyMaterial.opacity = this.skyValue * 0.5;
  }

  /** The flat disk-wide province map (space views). */
  set opacity(value: number) {
    this.chartValue = value;
    this.apply();
  }

  /** The constellation-style borders across the local sky. */
  set skyOpacity(value: number) {
    this.skyValue = value;
    this.apply();
  }

  dispose(): void {
    for (const child of this.group.children) {
      (child as LineSegments).geometry.dispose();
    }
    this.borderMaterial.dispose();
    this.homeMaterial.dispose();
    this.skyMaterial.dispose();
  }
}
