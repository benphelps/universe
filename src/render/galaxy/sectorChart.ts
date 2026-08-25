import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import type { GalacticPosition } from '../../universe/galaxy/density';
import { rotateToScene } from '../../universe/galaxy/orientation';
import { SECTOR_SPAN_PC } from '../../universe/galaxy/regions';

/** The chart reaches the disk's edge; lines are chords of this circle. */
const CHART_RADIUS_PC = 15200;

/**
 * The gazetteer's chart-sector grid drawn into space: 400 pc cells in
 * the galactic midplane, clipped to the disk, with the home locale's
 * own sector outlined. A navigation overlay in the same diagrammatic
 * family as orbit lines and zone rings — it fades in as the camera
 * leaves the neighborhood and the chart scale starts to mean something.
 * Geometry is in scene-frame parsecs (parent under the pc-scaled group).
 */
export class SectorChart {
  readonly group = new Group();
  private readonly gridMaterial: LineBasicMaterial;
  private readonly homeMaterial: LineBasicMaterial;

  constructor(viewpointPc: GalacticPosition, sceneFromGalaxy: Float32Array) {
    const toScene = (xPc: number, yPc: number): [number, number, number] =>
      rotateToScene(
        sceneFromGalaxy,
        xPc - viewpointPc.xPc,
        yPc - viewpointPc.yPc,
        -viewpointPc.zPc,
      );

    const positions: number[] = [];
    const span = SECTOR_SPAN_PC;
    const cells = Math.floor(CHART_RADIUS_PC / span);
    for (let k = -cells; k <= cells; k++) {
      const v = k * span;
      const half = Math.sqrt(CHART_RADIUS_PC ** 2 - v * v);
      positions.push(...toScene(v, -half), ...toScene(v, half));
      positions.push(...toScene(-half, v), ...toScene(half, v));
    }
    const grid = new BufferGeometry();
    grid.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.gridMaterial = new LineBasicMaterial({
      color: 0x51607a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const gridLines = new LineSegments(grid, this.gridMaterial);
    gridLines.frustumCulled = false;
    this.group.add(gridLines);

    // The home sector, outlined: the "you are here" of the gazetteer.
    const ix = Math.floor(viewpointPc.xPc / span);
    const iy = Math.floor(viewpointPc.yPc / span);
    const x0 = ix * span;
    const y0 = iy * span;
    const outline = new BufferGeometry();
    outline.setAttribute(
      'position',
      new Float32BufferAttribute(
        [
          ...toScene(x0, y0), ...toScene(x0 + span, y0),
          ...toScene(x0 + span, y0), ...toScene(x0 + span, y0 + span),
          ...toScene(x0 + span, y0 + span), ...toScene(x0, y0 + span),
          ...toScene(x0, y0 + span), ...toScene(x0, y0),
        ],
        3,
      ),
    );
    this.homeMaterial = new LineBasicMaterial({
      color: 0x9db8e8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const homeLines = new LineSegments(outline, this.homeMaterial);
    homeLines.frustumCulled = false;
    this.group.add(homeLines);
    this.group.visible = false;
  }

  set opacity(value: number) {
    this.group.visible = value > 0.01;
    this.gridMaterial.opacity = value * 0.28;
    this.homeMaterial.opacity = value * 0.8;
  }

  dispose(): void {
    for (const child of this.group.children) {
      (child as LineSegments).geometry.dispose();
    }
    this.gridMaterial.dispose();
    this.homeMaterial.dispose();
  }
}
