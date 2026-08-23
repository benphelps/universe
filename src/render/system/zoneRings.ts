import {
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
} from 'three';
import type { SystemZones } from '../../universe/system/types';

function circle(radiusAu: number, color: number, opacity: number): Line {
  const points: Vector3[] = [];
  for (let i = 0; i <= 128; i++) {
    const angle = (2 * Math.PI * i) / 128;
    points.push(new Vector3(radiusAu * Math.cos(angle), radiusAu * Math.sin(angle), 0));
  }
  const material = new LineBasicMaterial({ color, transparent: true, opacity });
  return new Line(new BufferGeometry().setFromPoints(points), material);
}

/**
 * Zone overlay: translucent habitable-zone annulus, frost-line circle,
 * and tidal-lock circle, in the system plane.
 */
export function createZoneRings(zones: SystemZones): Group {
  const group = new Group();

  const hz = new Mesh(
    new RingGeometry(zones.habitableInnerAu, zones.habitableOuterAu, 128),
    new MeshBasicMaterial({
      color: 0x2f9e5f,
      transparent: true,
      opacity: 0.09,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  group.add(hz);

  group.add(circle(zones.frostLineAu, 0x7fc4e8, 0.35));
  group.add(circle(zones.tidalLockAu, 0xcc7766, 0.3));
  return group;
}
