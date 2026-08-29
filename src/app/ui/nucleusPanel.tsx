import type { ReactNode } from 'react';
import { AU, SOLAR_LUMINOSITY } from '../../core/physics/constants';
import { galacticNucleus } from '../../universe/galaxy/nucleus';
import { centralSpheroid } from '../../universe/galaxy/spheroid';
import { viewCore } from '../store';
import { fmt } from './format';
import type { PlateSpec } from './plate';

const FLOW_LABEL: Record<string, string> = {
  'thin-disc': 'thin accretion disc',
  riaf: 'hot radiatively inefficient flow',
};

/** Distance in whatever unit reads plainly at that size. */
function span(metres: number): string {
  const au = metres / AU;
  return au < 0.02 ? `${fmt(metres / 1e9)} Gm` : `${fmt(au)} AU`;
}

/** The nucleus's own plate: the hole, measured. */
export function nucleusPlateSpec(): PlateSpec {
  const n = galacticNucleus();
  const flow = n.flow;
  return {
    title: 'Galactic Core',
    subtitle: `supermassive black hole · ${FLOW_LABEL[flow.regime]}`,
    // A hole has no light of its own; the strip stays dark.
    rows: [
      ['Mass', `${fmt(n.massSolar)} M☉`],
      ['Spin a★', n.spin.toFixed(3)],
      ['Schwarzschild r', span(2 * n.gravitationalRadiusM)],
      ['Shadow radius', span(n.shadowRadiusM)],
      ['Last stable orbit', `${span(n.iscoRadiusM)} · ${fmt(n.iscoPeriodS / 60)} min`],
      ['Influence radius', `${fmt(n.influenceRadiusPc)} pc`],
      ['L / L_Edd', fmt(flow.eddingtonRatio)],
      ['Luminosity', `${fmt(flow.luminosityW / SOLAR_LUMINOSITY)} L☉`],
      ['Efficiency', `${(100 * flow.efficiency).toFixed(1)}%`],
      ['Inner flow T', `${fmt(flow.innerTemperatureK)} K`],
    ],
  };
}

/**
 * The centre as a destination. The row states plainly what a traveller
 * is going to: how much mass, how it is feeding, and how wide the
 * shadow will look — because from anywhere else in the galaxy it is a
 * few micro-arcseconds and there is nothing to see.
 */
export function CoreDestination({ active }: { active: boolean }): ReactNode {
  const n = galacticNucleus();
  const spheroid = centralSpheroid();
  return (
    <>
      <h2>The centre</h2>
      <table className="list">
        <tbody>
          <tr>
            <th>object</th>
            <th>mass</th>
            <th className="n">state</th>
          </tr>
          <tr className={`pick poi${active ? ' here' : ''}`} onClick={viewCore}>
            <td>Galactic Core</td>
            <td>{fmt(n.massSolar)} M☉</td>
            <td className="n">{n.flow.regime === 'riaf' ? 'quiescent' : 'accreting'}</td>
          </tr>
          <tr className={`pick poi${active ? ' here' : ''}`} onClick={viewCore}>
            <td>Nuclear cluster</td>
            <td>{fmt(n.cluster.massSolar)} M☉</td>
            <td className="n">{fmt(n.cluster.effectiveRadiusPc)} pc</td>
          </tr>
        </tbody>
      </table>
      <div className="empty">
        {spheroid.kind === 'pseudo' ? 'A pseudobulge' : 'A classical bulge'} of{' '}
        {fmt(spheroid.massSolar)} M☉, σ {fmt(spheroid.dispersionKmS)} km/s — and the hole it grew.
      </div>
    </>
  );
}
