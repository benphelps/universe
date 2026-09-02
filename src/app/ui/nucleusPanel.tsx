import type { ReactNode } from 'react';
import { AU, SOLAR_LUMINOSITY } from '../../core/physics/constants';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import type { FlowRegime } from '../../universe/galaxy/accretionFlow';
import { galacticNucleus, type GalacticNucleus } from '../../universe/galaxy/nucleus';
import { viewCore } from '../store';
import type { BodyRowSpec } from './bodyRow';
import { fmt, fmtSolarMasses } from './format';
import { cssColor, type PlateSpec } from './plate';

const FLOW_LABEL: Record<FlowRegime, string> = {
  'thin-disc': 'thin accretion disc',
  riaf: 'hot radiatively inefficient flow',
};

/** The same flow in two words, for a row that has no space for the
 *  long form. */
export const FLOW_SHORT: Record<FlowRegime, string> = {
  'thin-disc': 'thin disc',
  riaf: 'hot torus',
};

/**
 * The hole as a row. Its mark is the colour its flow actually is: a
 * starving torus at three thousand kelvin comes out red and a fed disc
 * blue-white, off the same blackbody table the stars use.
 */
export function nucleusRowSpec(n: GalacticNucleus, here = false): BodyRowSpec {
  return {
    color: cssColor(blackbodyLinearRgb(n.flow.innerTemperatureK)),
    name: 'Galactic Core',
    kind: FLOW_SHORT[n.flow.regime],
    figures: [
      [fmtSolarMasses(n.massSolar), 'M☉'],
      [fmt(n.flow.innerTemperatureK), 'K'],
    ],
    here,
    onClick: viewCore,
  };
}

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
    row: nucleusRowSpec(n),
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
