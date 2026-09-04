import type { ReactNode } from 'react';
import { captureView } from '../store';
import { SettingsMenu } from './settingsMenu';

const CAMERA = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.2 5.6h2.6l1.2-1.8h4l1.2 1.8h2.6v7H2.2z" />
    <circle cx="8" cy="9" r="2.3" />
  </svg>
);

/** The picture's own instruments, top-right of the view: the shutter
 *  and the cog. */
export function InstrumentsCorner(): ReactNode {
  return (
    <div id="instruments-corner">
      <button
        id="capture"
        className="orb"
        data-tip="save the view as an image"
        aria-label="save the view as an image"
        onClick={() => void captureView()}
      >
        {CAMERA}
      </button>
      <SettingsMenu />
    </div>
  );
}
