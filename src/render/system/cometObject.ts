import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { elementsToState } from '../../core/math/kepler';
import { mu as muOf, seconds, type Mu, type Seconds } from '../../core/physics/units';
import { AU, G, SOLAR_MASS } from '../../core/physics/constants';
import type { Comet } from '../../universe/smallbody/types';

const TAIL_POINTS = 32;
const KM_PER_AU = 1.495978707e8;

/** Optically thin gas ball: brightness follows the line-of-sight chord
 *  through the sphere, center-bright with a soft limb. */
const COMA_VERTEX = /* glsl */ `
varying float vChord;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vec3 normal = normalize(mat3(modelMatrix) * normal);
  vec3 viewDir = normalize(cameraPosition - worldPos.xyz);
  vChord = abs(dot(normal, viewDir));
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const COMA_FRAGMENT = /* glsl */ `
varying float vChord;

uniform vec3 uColor;
uniform float uIntensity;

void main() {
  gl_FragColor = vec4(uColor * vChord * vChord * uIntensity, 1.0);
}
`;

/**
 * A comet at physical scale: the activity-driven coma is an optically
 * thin gas glow of tens to hundreds of thousands of kilometers, the ion
 * tail pins anti-solar at up to ~1 AU, and the broader dust tail lags
 * toward the reversed orbital motion. A faint motion trail keeps the
 * body discoverable when the head is between apparitions.
 */
export class CometObject {
  readonly group = new Group();
  private readonly head = new Group();
  private readonly trail: Line;
  private readonly coma: Mesh;
  private readonly comaMaterial: ShaderMaterial;
  private readonly ionTail: Line;
  private readonly dustTail: Line;
  private readonly mu: Mu;

  constructor(
    private readonly comet: Comet,
    centralMassSolar: number,
  ) {
    this.mu = muOf(G * centralMassSolar * SOLAR_MASS);

    // Motion trail: recent path behind the nucleus, fading with age.
    this.trail = makeTail(new Color(0.6, 0.66, 0.75), 0.5);
    this.group.add(this.trail);
    this.group.add(this.head);

    this.comaMaterial = new ShaderMaterial({
      vertexShader: COMA_VERTEX,
      fragmentShader: COMA_FRAGMENT,
      uniforms: {
        uColor: { value: new Color(0.7, 0.78, 0.9) },
        uIntensity: { value: 1 },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.coma = new Mesh(new SphereGeometry(1, 24, 12), this.comaMaterial);
    this.head.add(this.coma);

    this.ionTail = makeTail(new Color(0.45, 0.6, 1.0), 0.8);
    this.dustTail = makeTail(new Color(0.85, 0.8, 0.68), 0.55);
    this.head.add(this.ionTail, this.dustTail);
  }

  update(tSeconds: Seconds): void {
    const { position, velocity } = elementsToState(this.comet.elements, this.mu, tSeconds);
    const posAu = new Vector3(position.x / AU, position.y / AU, position.z / AU);
    this.head.position.copy(posAu);

    // Trail samples the recent past along the actual orbit.
    const period = 2 * Math.PI * Math.sqrt(this.comet.elements.semiMajorAxis ** 3 / this.mu);
    const step = period / 2400;
    writeTail(this.trail, (t) => {
      const past = elementsToState(
        this.comet.elements,
        this.mu,
        seconds(tSeconds - t * step * TAIL_POINTS),
      );
      return new Vector3(past.position.x / AU, past.position.y / AU, past.position.z / AU);
    });

    const rAu = posAu.length();
    // Sublimation ramps steeply inside the onset distance.
    const activity = Math.max(0, (this.comet.activityOnsetAu / rAu) ** 2 - 1);
    const visible = activity > 0.05;
    this.head.visible = visible;
    if (!visible) return;

    // Physical coma: gas envelope growing with activity, capped near
    // the great-comet scale (~10⁶ km).
    const comaKm = Math.min(1.2e6, 3e4 + 2.8e5 * Math.sqrt(activity));
    this.coma.scale.setScalar(comaKm / KM_PER_AU);
    this.comaMaterial.uniforms.uIntensity.value = Math.min(1.6, 0.5 + 0.4 * activity);

    const antiSolar = posAu.clone().normalize();
    const reverseMotion = new Vector3(-velocity.x, -velocity.y, -velocity.z).normalize();
    // Ion tails stretch to AU scale on strong apparitions.
    const length = Math.min(1.1, 0.18 * activity);

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

  /** Head world position; false while the comet is inactive/hidden. */
  getHeadWorldPosition(target: Vector3): boolean {
    if (!this.head.visible) return false;
    this.head.getWorldPosition(target);
    return true;
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
