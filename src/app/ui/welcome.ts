import { galaxySeed, PRIME_GALAXY_SEED } from '../../universe/galaxy/galaxySeed';

/**
 * The survey's cover page: a first-visit dialog naming what this is —
 * one deterministic universe built from real physics — then a second
 * step choosing which galaxy to chart: the shared prime everyone
 * knows, or a personal one rolled from a fresh 64-bit seed (which
 * reboots the session into it; the galaxy locks at first use).
 * Dismissed once, it stays dismissed (per browser). Arriving through a
 * ?galaxy= link skips the choice — the link already chose.
 */
const SEEN_KEY = 'universe-welcomed';

/** The persisted galaxy choice; absent means the prime galaxy. */
export const GALAXY_KEY = 'universe-galaxy';

function randomGalaxyHex(): string {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return words[0].toString(16).padStart(8, '0') + words[1].toString(16).padStart(8, '0');
}

const INTRO = `
  <div class="eyebrow">Procedural universe survey</div>
  <h1>One seed. A whole universe.</h1>
  <p>
    Everything here — every star, world, cloud, and name — derives
    deterministically from a single 64-bit seed. Nothing is stored;
    revisit any address and the same universe is waiting.
  </p>
  <ul>
    <li><b>The physics is real.</b> Stars draw from a Kroupa IMF and
    evolve with age; orbits are Kepler solutions propagated to any
    moment; colors come from blackbody spectra through CIE; eclipses,
    phases, and seasons emerge from geometry, not animation.</li>
    <li><b>The sky is the model.</b> Every glint is a real star with
    its own seed — hover it, click it, travel there. Nebulae are
    molecular clouds lit by the stars forming inside them; the dark
    rifts are the same clouds unlit; the galaxy's glow is the whole
    stellar population integrated through its dust.</li>
    <li><b>Charted like a survey.</b> Sectors anchor on the great
    cloud complexes, each sky cuts its own constellations around the
    landmarks it actually sees, bright stars carry proper names, and
    the bulk file into sector catalogs.</li>
    <li><b>Worlds all the way down.</b> Planets get interiors,
    atmospheres, and climates; terrain streams continuously from
    orbit to the ground under your feet.</li>
  </ul>
  <div class="perf-note">
    Fair warning: all of this is computed live on your machine —
    expect 1&thinsp;GB+ of GPU memory in use and sustained CPU/GPU
    load. A reasonably capable computer makes for a better visit.
  </div>
  <div class="controls-hint">
    scroll to ride between scales · drag to orbit · right-drag to pan ·
    click any glint to travel
  </div>
  <button id="welcome-continue">Continue</button>
`;

const CHOICE = `
  <div class="eyebrow">One more thing</div>
  <h1>Choose your galaxy.</h1>
  <p>
    The universe holds 2<sup>64</sup> galaxies. You can chart the one
    everyone else is charting, or roll a seed and take one of your own.
  </p>
  <button class="galaxy-choice" id="welcome-prime">
    <b>The shared galaxy</b>
    <span>The prime galaxy every traveler knows — the same arms, the
    same named complexes, the same landmarks as everyone else. Links
    and addresses match across the world.</span>
  </button>
  <button class="galaxy-choice" id="welcome-personal">
    <b>A personal galaxy</b>
    <span>Roll a fresh 64-bit galaxy seed: new arms, new complexes,
    new names — yours alone, and eternal for its seed. Links you share
    carry it.</span>
  </button>
`;

export function showWelcome(): void {
  try {
    if (localStorage.getItem(SEEN_KEY)) return;
  } catch {
    // Storage unavailable (private window): show every time.
  }
  // A ?galaxy= link (or a persisted personal galaxy) already chose.
  const linked = new URLSearchParams(location.search).has('galaxy');
  const alreadyPersonal = galaxySeed() !== PRIME_GALAXY_SEED;

  const overlay = document.createElement('div');
  overlay.id = 'welcome';
  const card = document.createElement('div');
  card.id = 'welcome-card';
  card.innerHTML = INTRO;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const remember = (): void => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Fine: the dialog will greet this browser again next time.
    }
  };
  const dismiss = (): void => {
    remember();
    overlay.classList.add('leaving');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 600);
  };

  const offerChoice = (): void => {
    card.innerHTML = CHOICE;
    card.querySelector('#welcome-prime')!.addEventListener('click', () => {
      try {
        localStorage.removeItem(GALAXY_KEY);
      } catch {
        // Fine.
      }
      dismiss();
    });
    card.querySelector('#welcome-personal')!.addEventListener('click', () => {
      const hex = randomGalaxyHex();
      try {
        localStorage.setItem(GALAXY_KEY, hex);
      } catch {
        // Fine: the URL below still carries it for this visit.
      }
      remember();
      // The galaxy locks at first use, so a personal one needs a
      // clean boot: reload into it.
      const url = new URL(location.href);
      url.searchParams.set('galaxy', hex);
      location.href = url.toString();
    });
  };

  card.querySelector('#welcome-continue')!.addEventListener('click', () => {
    if (linked || alreadyPersonal) dismiss();
    else offerChoice();
  });
}
