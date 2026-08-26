/**
 * The survey's cover page: a first-visit dialog naming what this is —
 * one deterministic universe built from real physics — before handing
 * over the controls. Dismissed once, it stays dismissed (per browser);
 * the title in the sidebar eyebrow is not a link back to it, so keep
 * the essentials in the tooltips it points at.
 */
const SEEN_KEY = 'universe-welcomed';

export function showWelcome(): void {
  try {
    if (localStorage.getItem(SEEN_KEY)) return;
  } catch {
    // Storage unavailable (private window): show every time.
  }

  const overlay = document.createElement('div');
  overlay.id = 'welcome';
  overlay.innerHTML = `
    <div id="welcome-card">
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
      <div class="controls-hint">
        scroll to ride between scales · drag to orbit · click any glint
        to travel · chart toggles the borders
      </div>
      <button id="welcome-explore">Explore</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const dismiss = (): void => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Fine: the dialog will greet this browser again next time.
    }
    overlay.classList.add('leaving');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    setTimeout(() => overlay.remove(), 600);
  };
  overlay.querySelector('#welcome-explore')!.addEventListener('click', dismiss);
}
