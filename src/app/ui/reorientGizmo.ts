/** The rung the camera stands on, which decides what "up" means and
 *  what a press does: the ground's north, a body's spin axis, the
 *  system's orbital pole, the galactic pole, or the hole's axis. */
export type GizmoScale = 'hidden' | 'ground' | 'world' | 'system' | 'galaxy' | 'core';

export interface GizmoState {
  scale: GizmoScale;
  /** The scale's pole (or, on the ground, north) measured clockwise
   *  from the top of the screen, radians. */
  rollRad: number;
  /** How much of the pole lies in the screen: 1 flat, 0 end-on. */
  extent: number;
  /** The orbit anchor is off the focus. */
  panned: boolean;
  riding: boolean;
  /** Touch chrome stands in the corner too; the gizmo lifts above it. */
  lifted: boolean;
}

export interface GizmoActions {
  up(): void;
  faceOn(): void;
  edgeOn(): void;
  focus(): void;
  ride(): void;
}

/** What the press does on each rung. */
const PRESS_TIPS: Record<Exclude<GizmoScale, 'hidden'>, string> = {
  ground: 'face north, level',
  world: "roll the body's pole up",
  system: "roll the system's pole up",
  galaxy: 'roll the galactic pole up',
  core: "roll the hole's axis up",
};

/** Within this of straight up the needle rests. */
const ALIGNED_RAD = 0.02;
/** Below this much pole in the screen there is nothing to roll to. */
const END_ON_EXTENT = 0.02;

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_ATTRS =
  'viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  focus: `<svg ${ICON_ATTRS}><circle cx="8" cy="8" r="2.2"/><path d="M8 2v2.2M8 11.8V14M2 8h2.2M11.8 8H14"/></svg>`,
  ride: `<svg ${ICON_ATTRS}><path d="M9.5 6.5 13 3M13 3H9.8M13 3v3.2"/><path d="M6.5 9.5 3 13M3 13h3.2M3 13V9.8"/></svg>`,
  faceOn: `<svg ${ICON_ATTRS}><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  edgeOn: `<svg ${ICON_ATTRS}><path d="M2 8h12"/><path d="M4.5 5.5h7M4.5 10.5h7" opacity=".45"/></svg>`,
};

/**
 * The reorient gizmo: a compass dial in the view's corner whose
 * needle points where the scale's pole lies on screen — the body's
 * spin axis near a body, the galactic pole out in the galaxy, north
 * on the ground — with a short needle for a pole leaning toward or
 * away from the eye. Pressing the dial is the one rotation the camera
 * makes because it was asked to: it rolls that rung's pole up the
 * screen, and the rung's name sits under the dial so it is never a
 * guess. Four icons at the dial's corners carry the rest of the
 * camera's moves.
 */
export class ReorientGizmo {
  readonly element: HTMLDivElement;
  private readonly dial: HTMLButtonElement;
  private readonly compass: SVGSVGElement;
  private readonly arm: SVGGElement;
  private readonly letter: SVGTextElement;
  private readonly corners: Record<keyof typeof ICONS, HTMLButtonElement>;
  private readonly label: HTMLSpanElement;
  private scale: GizmoScale = 'hidden';

  constructor(container: HTMLElement, actions: GizmoActions) {
    this.element = document.createElement('div');
    this.element.id = 'reorient';
    this.element.style.display = 'none';

    const corner = (
      key: keyof typeof ICONS,
      place: string,
      tip: string,
      act: () => void,
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.className = `corner ${place}`;
      button.dataset.tip = tip;
      button.setAttribute('aria-label', tip);
      button.innerHTML = ICONS[key];
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        act();
      });
      this.element.appendChild(button);
      return button;
    };
    this.corners = {
      focus: corner('focus', 'tl', 'return to focus', actions.focus),
      ride: corner('ride', 'tr', 'ride out to the galaxy', actions.ride),
      faceOn: corner('faceOn', 'bl', 'look down the pole', actions.faceOn),
      edgeOn: corner('edgeOn', 'br', 'look along the plane, pole up', actions.edgeOn),
    };

    this.dial = document.createElement('button');
    this.dial.className = 'dial';
    this.dial.dataset.tip = 'roll the pole up';
    this.dial.setAttribute('aria-label', 'roll the pole up the screen');
    this.compass = document.createElementNS(SVG_NS, 'svg');
    this.compass.setAttribute('viewBox', '0 0 56 56');
    this.compass.setAttribute('class', 'compass');
    this.compass.innerHTML = `
      <circle class="ring" cx="28" cy="28" r="25"/>
      <line class="tick top" x1="28" y1="3" x2="28" y2="9"/>
      <line class="tick" x1="28" y1="53" x2="28" y2="49"/>
      <line class="tick" x1="3" y1="28" x2="7" y2="28"/>
      <line class="tick" x1="53" y1="28" x2="49" y2="28"/>
      <g class="arm">
        <line class="needle" x1="28" y1="28" x2="28" y2="11"/>
        <circle class="tip" cx="28" cy="11" r="2.4"/>
      </g>
      <circle class="hub" cx="28" cy="28" r="1.6"/>
      <text class="letter" x="28" y="41" text-anchor="middle">N</text>`;
    this.arm = this.compass.querySelector('.arm') as SVGGElement;
    this.letter = this.compass.querySelector('.letter') as SVGTextElement;
    this.dial.appendChild(this.compass);
    this.dial.addEventListener('click', () => {
      if (this.dial.getAttribute('aria-disabled') === 'true') return;
      actions.up();
    });
    this.element.appendChild(this.dial);
    this.label = document.createElement('span');
    this.label.className = 'scale';
    this.element.appendChild(this.label);
    container.appendChild(this.element);
  }

  update(state: GizmoState): void {
    if (state.scale !== this.scale) {
      this.scale = state.scale;
      this.element.style.display = state.scale === 'hidden' ? 'none' : '';
      if (state.scale === 'hidden') return;
      const space = state.scale !== 'ground';
      for (const key of ['focus', 'faceOn', 'edgeOn'] as const) {
        this.corners[key].style.display = space ? '' : 'none';
      }
      const tip = PRESS_TIPS[state.scale];
      this.dial.dataset.tip = tip;
      this.dial.setAttribute('aria-label', tip);
      this.label.textContent = state.scale;
    }
    if (state.scale === 'hidden') return;
    this.element.classList.toggle('lifted', state.lifted);
    const endOn = state.scale !== 'ground' && state.extent < END_ON_EXTENT;
    const aligned = endOn || Math.abs(state.rollRad) < ALIGNED_RAD;
    const reach = Math.max(0.28, Math.min(1, state.extent));
    this.arm.setAttribute(
      'transform',
      `rotate(${(state.rollRad * 180) / Math.PI} 28 28) translate(28 28) scale(1 ${reach}) translate(-28 -28)`,
    );
    this.compass.classList.toggle('aligned', aligned);
    this.letter.textContent = endOn ? '·' : 'N';
    this.dial.setAttribute('aria-disabled', String(endOn));
    this.corners.focus.setAttribute('aria-disabled', String(!state.panned));
    this.corners.ride.classList.toggle('active', state.riding);
  }

  dispose(): void {
    this.element.remove();
  }
}
