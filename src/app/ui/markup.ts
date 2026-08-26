import type { LinearRgb } from '../../core/color/srgb';

/** Display color: gamma-encoded swatch from linear RGB. */
export function cssColor(linearRgb: LinearRgb): string {
  const [r, g, b] = linearRgb.map((c) => Math.round(255 * c ** (1 / 2.2)));
  return `rgb(${r},${g},${b})`;
}

export interface PlateSpec {
  title: string;
  subtitle: string;
  badges?: string;
  /** Spectral strip color — the body's own light. Omitted, the strip stays dark. */
  color?: string;
  rows: Array<[string, string]>;
  extra?: string;
  onStep?: (delta: number) => void;
}

/**
 * The catalog plate: a designation, the smear of the body's own light,
 * and its measurements — the fixed card every level renders up top.
 */
export function renderPlate(element: HTMLElement, spec: PlateSpec): void {
  const stepper = spec.onStep
    ? `<span class="stepper">
        <button id="body-prev" title="previous body">‹</button>
        <button id="body-next" title="next body">›</button>
      </span>`
    : '';
  const strip = spec.color
    ? `linear-gradient(90deg, ${spec.color} 0%, transparent 92%)`
    : 'linear-gradient(90deg, rgba(255, 225, 180, 0.22) 0%, transparent 92%)';
  element.innerHTML = `
    <div class="plate-head">
      <h1>${spec.title}</h1>
      ${stepper}
    </div>
    <div class="sub">${spec.subtitle}${spec.badges ? ` ${spec.badges}` : ''}</div>
    <div class="spectrum" style="background:${strip}"></div>
    <table class="props">${spec.rows
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join('')}</table>
    ${spec.extra ?? ''}
  `;
  const onStep = spec.onStep;
  if (onStep) {
    element.querySelector('#body-prev')!.addEventListener('click', () => onStep(-1));
    element.querySelector('#body-next')!.addEventListener('click', () => onStep(1));
  }
}
