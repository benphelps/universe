import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from 'three';
import { orbitPath } from '../../core/math/kepler';
import type { OrbitalElements } from '../../core/math/orbit';
import { AU } from '../../core/physics/constants';

/** Closed orbit polyline in map units (1 unit = 1 AU, z out of plane). */
export function createOrbitLine(
  elements: OrbitalElements,
  color: number,
  opacity = 0.35,
): Line {
  const points = orbitPath(elements, 192).map(
    (p) => new Vector3(p.x / AU, p.y / AU, p.z / AU),
  );
  const geometry = new BufferGeometry().setFromPoints(points);
  const material = new LineBasicMaterial({ color, transparent: true, opacity });
  return new Line(geometry, material);
}
