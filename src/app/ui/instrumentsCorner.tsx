import { useEffect, useRef, useState, type ReactNode } from 'react';
import { captureView, copyViewLink } from '../store';
import { SettingsMenu } from './settingsMenu';

const CAMERA = (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.2 5.6h2.6l1.2-1.8h4l1.2 1.8h2.6v7H2.2z" />
    <circle cx="8" cy="9" r="2.3" />
  </svg>
);

const LINK = (
  <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.7 9.3a2.7 2.7 0 0 0 3.8 0l2.1-2.1a2.7 2.7 0 0 0-3.8-3.8l-1 1" />
    <path d="M9.3 6.7a2.7 2.7 0 0 0-3.8 0L3.4 8.8a2.7 2.7 0 0 0 3.8 3.8l1-1" />
  </svg>
);

/** How long the link orb reports what it did before its tip returns. */
const REPORT_MS = 1800;

/** The picture's own instruments, top-right of the view: the shutter,
 *  the link to this exact view, and the cog. */
export function InstrumentsCorner(): ReactNode {
  const [report, setReport] = useState<string | null>(null);
  const reset = useRef(0);
  useEffect(() => () => window.clearTimeout(reset.current), []);

  const share = async (): Promise<void> => {
    const copied = await copyViewLink();
    setReport(copied ? 'link copied' : 'link is in the address bar');
    window.clearTimeout(reset.current);
    reset.current = window.setTimeout(() => setReport(null), REPORT_MS);
  };
  const linkTip = report ?? 'copy a link to this view';

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
      <button
        id="share-view"
        className={report ? 'orb active' : 'orb'}
        data-tip={linkTip}
        aria-label={linkTip}
        onClick={() => void share()}
      >
        {LINK}
      </button>
      <SettingsMenu />
    </div>
  );
}
