import { useState, type ReactNode } from 'react';
import { homeChosen, PRIME_GALAXY_HEX, randomHex, setHomeGalaxy } from '../home';

/**
 * The survey's cover page: a first-visit card saying what this is —
 * one deterministic universe built from real physics — and, for a
 * visitor whose galaxy nothing has chosen yet, the choice of which to
 * chart: the shared prime everyone knows, or a personal one rolled
 * from a fresh 64-bit seed (which reboots the session into it; the
 * galaxy locks at first use). Dismissed once, it stays dismissed (per
 * browser). Arriving through a ?galaxy= link skips the choice — the
 * link already chose.
 */
const SEEN_KEY = 'universe-welcomed';

/** The same four moves, in whichever hand the visitor arrived with. */
const CONTROLS_HINT =
  typeof matchMedia === 'function' && matchMedia('(hover: none)').matches
    ? 'pinch to ride between scales · drag to orbit or pan · tap any glint twice to travel'
    : 'scroll to ride between scales · drag to orbit · right-drag to pan · click any glint to travel';

function remember(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Fine: the dialog will greet this browser again next time.
  }
}

export function Welcome(): ReactNode {
  const [shown, setShown] = useState(() => {
    try {
      return !localStorage.getItem(SEEN_KEY);
    } catch {
      // Storage unavailable (private window): show every time.
      return true;
    }
  });
  const [leaving, setLeaving] = useState(false);
  // Whether a galaxy was already chosen — a ?galaxy= link, or a
  // personal galaxy persisted from an earlier visit. Decided once, on
  // mount: the address bar carries the galaxy from the moment the
  // first system loads, so read later it would always say yes.
  const [chosen] = useState(
    () => new URLSearchParams(location.search).has('galaxy') || homeChosen(),
  );

  if (!shown) return null;

  const dismiss = (): void => {
    remember();
    setLeaving(true);
    window.setTimeout(() => setShown(false), 600);
  };

  const choosePrime = (): void => {
    setHomeGalaxy(PRIME_GALAXY_HEX);
    dismiss();
  };

  const choosePersonal = (): void => {
    const hex = randomHex();
    setHomeGalaxy(hex);
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
        if (leaving && event.target === event.currentTarget) setShown(false);
      }}
    >
      <div id="welcome-card">
        <div className="eyebrow">Procedural universe survey</div>
        <h1>One seed. A whole universe.</h1>
        <p>
          Every star, world and cloud here is computed from a single 64-bit seed with real
          physics. Nothing is stored: any address leads back to the same place.
        </p>
        <ul>
          <li>
            <b>The sky is the model.</b> Every glint is a star with its own seed. Click one to
            travel there.
          </li>
          <li>
            <b>Nebulae are clouds lit from inside</b> by the stars forming in them; the dark
            rifts are the same clouds unlit.
          </li>
          <li>
            <b>Worlds go all the way down:</b> interiors, atmospheres, climates, and terrain
            streaming from orbit to the ground under your feet.
          </li>
        </ul>
        <div className="perf-note">
          All of it is computed live on your machine: expect sustained CPU and GPU load and more
          than a gigabyte of GPU memory.
        </div>
        <div className="controls-hint">{CONTROLS_HINT}</div>
        {chosen ? (
          <button id="welcome-continue" onClick={dismiss}>
            Continue
          </button>
        ) : (
          <div className="galaxy-choices">
            <button className="galaxy-choice" onClick={choosePrime}>
              <b>The shared galaxy</b>
              <span>The one everyone charts. Links and addresses match across the world.</span>
            </button>
            <button className="galaxy-choice" onClick={choosePersonal}>
              <b>A personal galaxy</b>
              <span>A fresh 64-bit seed of your own: new arms, complexes and names.</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
