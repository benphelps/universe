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
 * A comet in the system map: a faint orbit ellipse for context, and a
 * head group carrying the activity-scaled coma plus two physically
 * distinct tails — the straight blue ion tail pinned anti-solar, and
 * the broader dust tail lagging toward the reversed orbital motion.
 */
export class CometObject {
  readonly group = new Group();
  private readonly head = new Group();
  private readonly trail: Line;
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

    // Motion trail: recent path behind the nucleus, fading with age.
    this.trail = makeTail(new Color(0.6, 0.66, 0.75), 0.5);
    this.group.add(this.trail);
    this.group.add(this.head);

    this.coma = new Mesh(
      new SphereGeometry(1, 16, 8),
      new MeshBasicMaterial({
        color: new Color(0.75, 0.82, 0.9),
        transparent: true,
        opacity: 0.7,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.head.add(this.coma);

    this.ionTail = makeTail(new Color(0.45, 0.6, 1.0), 0.8);
    this.dustTail = makeTail(new Color(0.85, 0.8, 0.68), 0.55);
    this.head.add(this.ionTail, this.dustTail);
  }

  update(tSeconds: number): void {
    const { position, velocity } = elementsToState(this.comet.elements, this.mu, tSeconds);
    const posAu = new Vector3(position.x / AU, position.y / AU, position.z / AU);
    this.head.position.copy(posAu);

    // Trail samples the recent past along the actual orbit.
    const period = 2 * Math.PI * Math.sqrt(this.comet.elements.semiMajorAxis ** 3 / this.mu);
    const step = period / 2400;
    writeTail(this.trail, (t) => {
      const past = elementsToState(this.comet.elements, this.mu, tSeconds - t * step * TAIL_POINTS);
      return new Vector3(past.position.x / AU, past.position.y / AU, past.position.z / AU);
    });

    const rAu = posAu.length();
    // Sublimation ramps steeply inside the onset distance.
    const activity = Math.max(0, (this.comet.activityOnsetAu / rAu) ** 2 - 1);
    const visible = activity > 0.05;
    this.head.visible = visible;
    if (!visible) return;

    // Coma stays well below the star glyph (extent × 0.012).
    this.coma.scale.setScalar(
      Math.min(0.007 * this.extentAu, 0.0025 * this.extentAu * Math.sqrt(activity)),
    );

    const antiSolar = posAu.clone().normalize();
    const reverseMotion = new Vector3(-velocity.x, -velocity.y, -velocity.z).normalize();
    const length = Math.min(0.3 * this.extentAu, 0.05 * this.extentAu * activity);

    writeTail(this.ionTail, (t) => antiSolar.clone().multiplyScalar(length * t ** 0.9));
    const dustLength = length * 0.7 * (0.3 + this.comet.dustiness);
    writeTail(this.dustTail, (t) =>
      antiSolar
        .clone()
        .addScaledVector(reverseMotion, 0.3 * t)
        .normalize()
        .multiplyScalar(dustLength * t),
    );
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof Mesh || obj instanceof Line) {
        obj.geometry.dispose();
        if (!Array.isArray(obj.material)) obj.material.dispose();
      }
    });
  }
}

function makeTail(color: Color, opacity: number): Line {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(TAIL_POINTS * 3), 3));
  // Additive blending: vertex colors fading to black vanish smoothly.
  const colors = new Float32Array(TAIL_POINTS * 3);
  for (let i = 0; i < TAIL_POINTS; i++) {
    const fade = (1 - i / (TAIL_POINTS - 1)) ** 2;
    colors[i * 3] = color.r * fade;
    colors[i * 3 + 1] = color.g * fade;
    colors[i * 3 + 2] = color.b * fade;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const line = new Line(
    geometry,
    new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
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
