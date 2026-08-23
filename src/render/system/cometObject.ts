import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { elementsToState } from '../../core/math/kepler';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import type { Comet } from '../../universe/smallbody/types';

const TAIL_POINTS = 32;

/**
 * A comet in the system map: nucleus, activity-scaled coma, and two
 * physically distinct tails — the straight blue ion tail pinned
 * anti-solar, and the broad dust tail curving between the anti-solar
 * line and the reversed orbital motion (syndyne-style lag).
 */
export class CometObject {
  readonly group = new Group();
  private readonly coma: Mesh;
  private readonly ionTail: Line;
  private readonly dustTail: Line;
  private readonly mu: number;

  constructor(
    private readonly comet: Comet,
    centralMassSolar: number,
    private readonly extentAu: number,
  ) {
    this.mu = G * centralMassSolar * SOLAR_MASS;

    this.coma = new Mesh(
      new SphereGeometry(1, 16, 8),
      new MeshBasicMaterial({
        color: new Color(0.55, 0.62, 0.7),
        transparent: true,
        opacity: 0.55,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.group.add(this.coma);

    this.ionTail = makeTail(new Color(0.35, 0.5, 1.0));
    this.dustTail = makeTail(new Color(0.85, 0.8, 0.68));
    this.group.add(this.ionTail, this.dustTail);
  }

  update(tSeconds: number): void {
    const { position, velocity } = elementsToState(this.comet.elements, this.mu, tSeconds);
    const posAu = new Vector3(position.x / AU, position.y / AU, position.z / AU);
    this.group.position.copy(posAu);

    const rAu = posAu.length();
    // Sublimation ramps steeply inside the onset distance.
    const activity = Math.max(0, (this.comet.activityOnsetAu / rAu) ** 2 - 1);
    const visible = activity > 0.05;
    this.coma.visible = visible;
    this.ionTail.visible = visible;
    this.dustTail.visible = visible;
    if (!visible) return;

    this.coma.scale.setScalar(Math.min(0.35, 0.006 * this.extentAu * Math.sqrt(activity)));

    const antiSolar = posAu.clone().normalize();
    const reverseMotion = new Vector3(-velocity.x, -velocity.y, -velocity.z).normalize();
    const length = Math.min(0.25 * this.extentAu, 0.035 * this.extentAu * activity);

    writeTail(this.ionTail, (t) => antiSolar.clone().multiplyScalar(length * t ** 0.9));
    const dustLength = length * 0.8 * (0.3 + this.comet.dustiness);
    writeTail(this.dustTail, (t) =>
      antiSolar
        .clone()
        .addScaledVector(reverseMotion, 0.85 * t)
        .normalize()
        .multiplyScalar(dustLength * t),
    );
  }

  dispose(): void {
    this.coma.geometry.dispose();
    (this.coma.material as MeshBasicMaterial).dispose();
    for (const tail of [this.ionTail, this.dustTail]) {
      tail.geometry.dispose();
      (tail.material as LineBasicMaterial).dispose();
    }
  }
}

function makeTail(color: Color): Line {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(TAIL_POINTS * 3), 3));
  const line = new Line(
    geometry,
    new LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  line.frustumCulled = false;
  return line;
}

function writeTail(line: Line, shape: (t: number) => Vector3): void {
  const attribute = line.geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < TAIL_POINTS; i++) {
    const point = shape(i / (TAIL_POINTS - 1));
    attribute.setXYZ(i, point.x, point.y, point.z);
  }
  attribute.needsUpdate = true;
}
