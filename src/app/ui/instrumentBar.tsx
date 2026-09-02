import type { ReactNode } from 'react';
import { captureView, type AppSnapshot } from '../store';
import { AddressChips } from './addressChips';
import { DecalToggles } from './decalToggles';
import { SettingsMenu } from './settingsMenu';
import { TimeControls } from './timeControls';

const CAMERA = (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.2 5.6h2.6l1.2-1.8h4l1.2 1.8h2.6v7H2.2z" />
    <circle cx="8" cy="9" r="2.3" />
  </svg>
);

/**
 * The instrument bar along the bottom of the view: every dial in one
 * panel, captioned the way the console captions its sections — the
 * clock, the address, and the instruments the picture is taken with.
 */
export function InstrumentBar({ snap }: { snap: AppSnapshot | null }): ReactNode {
  return (
    <div id="instrument-bar">
      <section className="group">
        <TimeControls snap={snap} />
      </section>
      <section className="group">
        <span className="eyebrow">address</span>
        <div className="row">
          <AddressChips seedHex={snap?.seedHex ?? ''} />
        </div>
      </section>
      <section className="group instruments">
        <span className="eyebrow">instruments</span>
        <div className="row">
          <DecalToggles />
          <span className="gap" />
          <button
            id="capture"
            data-tip="save the view as an image"
            aria-label="save the view as an image"
            onClick={() => void captureView()}
          >
            {CAMERA}
          </button>
          <SettingsMenu />
        </div>
      </section>
    </div>
  );
}
