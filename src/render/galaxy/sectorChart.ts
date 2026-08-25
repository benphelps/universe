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

  constructor(sectorBounds: Float32Array, sectorHomeBounds: Float32Array) {
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
    for (const [positions, material] of [
      [sectorBounds, this.borderMaterial],
      [sectorHomeBounds, this.homeMaterial],
    ] as Array<[Float32Array, LineBasicMaterial]>) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const lines = new LineSegments(geometry, material);
      lines.frustumCulled = false;
      this.group.add(lines);
    }
    this.group.visible = false;
  }

  set opacity(value: number) {
    this.group.visible = value > 0.01;
    this.borderMaterial.opacity = value * 0.3;
    this.homeMaterial.opacity = value * 0.85;
  }

  dispose(): void {
    for (const child of this.group.children) {
      (child as LineSegments).geometry.dispose();
    }
    this.borderMaterial.dispose();
    this.homeMaterial.dispose();
  }
}
