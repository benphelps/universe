import { useState, type ReactNode } from 'react';
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

function remember(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Fine: the dialog will greet this browser again next time.
  }
}

export function Welcome(): ReactNode {
  const [step, setStep] = useState<'intro' | 'choice' | 'gone'>(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return 'gone';
    } catch {
      // Storage unavailable (private window): show every time.
    }
    return 'intro';
  });
  const [leaving, setLeaving] = useState(false);

  if (step === 'gone') return null;

  const dismiss = (): void => {
    remember();
    setLeaving(true);
    window.setTimeout(() => setStep('gone'), 600);
  };

  const onContinue = (): void => {
    // A ?galaxy= link (or a persisted personal galaxy) already chose.
    const linked = new URLSearchParams(location.search).has('galaxy');
    if (linked || galaxySeed() !== PRIME_GALAXY_SEED) dismiss();
    else setStep('choice');
  };

  const choosePrime = (): void => {
    try {
      localStorage.removeItem(GALAXY_KEY);
    } catch {
      // Fine.
    }
    dismiss();
  };

  const choosePersonal = (): void => {
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
  };

  return (
    <div
      id="welcome"
      className={leaving ? 'leaving' : ''}
      onTransitionEnd={(event) => {
        if (leaving && event.target === event.currentTarget) setStep('gone');
      }}
    >
      <div id="welcome-card">
        {step === 'choice' ? (
          <>
            <div className="eyebrow">One more thing</div>
            <h1>Choose your galaxy.</h1>
            <p>
              The universe holds 2<sup>64</sup> galaxies. You can chart the one everyone else is
              charting, or roll a seed and take one of your own.
            </p>
            <button className="galaxy-choice" onClick={choosePrime}>
              <b>The shared galaxy</b>
              <span>
                The prime galaxy every traveler knows — the same arms, the same named complexes,
                the same landmarks as everyone else. Links and addresses match across the world.
              </span>
            </button>
            <button className="galaxy-choice" onClick={choosePersonal}>
              <b>A personal galaxy</b>
              <span>
                Roll a fresh 64-bit galaxy seed: new arms, new complexes, new names — yours alone,
                and eternal for its seed. Links you share carry it.
              </span>
            </button>
          </>
        ) : (
          <>
            <div className="eyebrow">Procedural universe survey</div>
            <h1>One seed. A whole universe.</h1>
            <p>
              Everything here — every star, world, cloud, and name — derives deterministically
              from a single 64-bit seed. Nothing is stored; revisit any address and the same
              universe is waiting.
            </p>
            <ul>
              <li>
                <b>The physics is real.</b> Stars draw from a Kroupa IMF and evolve with age;
                orbits are Kepler solutions propagated to any moment; colors come from blackbody
                spectra through CIE; eclipses, phases, and seasons emerge from geometry, not
                animation.
              </li>
              <li>
                <b>The sky is the model.</b> Every glint is a real star with its own seed — hover
                it, click it, travel there. Nebulae are molecular clouds lit by the stars forming
                inside them; the dark rifts are the same clouds unlit; the galaxy's glow is the
                whole stellar population integrated through its dust.
              </li>
              <li>
                <b>Charted like a survey.</b> Sectors anchor on the great cloud complexes, each
                sky cuts its own constellations around the landmarks it actually sees, bright
                stars carry proper names, and the bulk file into sector catalogs.
              </li>
              <li>
                <b>Worlds all the way down.</b> Planets get interiors, atmospheres, and climates;
                terrain streams continuously from orbit to the ground under your feet.
              </li>
            </ul>
            <div className="perf-note">
              Fair warning: all of this is computed live on your machine — expect 1{' '}GB+
              of GPU memory in use and sustained CPU/GPU load. A reasonably capable computer makes
              for a better visit.
            </div>
            <div className="controls-hint">
              scroll to ride between scales · drag to orbit · right-drag to pan · click any glint
              to travel
            </div>
            <button id="welcome-continue" onClick={onContinue}>
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
