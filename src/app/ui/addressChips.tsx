import { useRef, useState, type ReactNode } from 'react';
import { randomSeed } from '../store';

const COPY = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
    <path d="M10.5 3H4.2A1.2 1.2 0 0 0 3 4.2v6.3" />
  </svg>
);
const DICE = (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" />
    <circle cx="5.4" cy="5.4" r="1" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="5.4" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="5.4" cy="10.6" r="1" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="10.6" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** The system's seed as a click-to-copy chip, and the dice for a
 *  random system of this galaxy. */
export function AddressChips({ seedHex }: { seedHex: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);

  const onCopy = (): void => {
    void navigator.clipboard.writeText(seedHex);
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 900);
  };

  return (
    <>
      <button id="seed-chip" data-tip="copy this system's seed" onClick={onCopy}>
        <span id="seed-text" className={copied ? 'copied' : ''}>
          {copied ? 'copied' : seedHex}
        </span>
        {COPY}
      </button>
      <button
        id="seed-dice"
        data-tip="roll a random system"
        aria-label="roll a random system"
        onClick={randomSeed}
      >
        {DICE}
      </button>
    </>
  );
}
