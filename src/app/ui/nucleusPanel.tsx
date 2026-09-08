import { hotFlowModelIfReady } from '../../universe/galaxy/hotFlowEmission';
import { Temperature } from './temperatureReadout';
import type { ReactNode } from 'react';
import { AU, SOLAR_LUMINOSITY } from '../../core/physics/constants';
import { blackbodyLinearRgb } from '../../core/color/blackbody';
import type { FlowRegime } from '../../universe/galaxy/accretionFlow';
import { galacticNucleus, type GalacticNucleus } from '../../universe/galaxy/nucleus';
import { viewCore } from '../store';
import type { BodyRowSpec } from './bodyRow';
import { fmt, fmtSolarMasses } from './format';
import { cssColor, groupPlateRows, type PlateRows, type PlateSpec } from './plate';

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

/** Thermal disks have a temperature-derived marker; the hot plasma uses
 * a neutral marker because electron temperature alone does not set its hue. */
export function nucleusRowSpec(n: GalacticNucleus, here = false): BodyRowSpec {
  const hot = n.flow.regime === 'riaf';
  const temperature = n.flow.innerTemperatureK;
  return {
    color: hot ? '#aeb6bd' : cssColor(blackbodyLinearRgb(temperature)),
    name: 'Galactic Core',
    kind: FLOW_SHORT[n.flow.regime],
    figures: [
      [fmtSolarMasses(n.massSolar), 'M☉'],
      hot ? [fmt(n.flow.eddingtonRatio), 'L/L_Edd'] : [fmt(temperature), 'K'],
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
  const hot = flow.regime === 'riaf';
  const electronT = hotFlowModelIfReady(flow, n.gravitationalRadiusM)?.shells[0].plasma.electronTemperatureK;
  const temperatureLabel = hot ? 'Inner electron T' : 'Inner flow T';
  const luminosityLabel = hot ? 'Radiative budget' : 'Luminosity';
  const rows: PlateRows = [
    ['Mass', `${fmt(n.massSolar)} M☉`],
    ['Spin a★', n.spin.toFixed(3)],
    ['Schwarzschild r', span(2 * n.gravitationalRadiusM)],
    ['Shadow radius', span(n.shadowRadiusM)],
    ['Last stable orbit', `${span(n.iscoRadiusM)} · ${fmt(n.iscoPeriodS / 60)} min`],
    ['Influence radius', `${fmt(n.influenceRadiusPc)} pc`],
    ['L / L_Edd', fmt(flow.eddingtonRatio)],
    [luminosityLabel, `${fmt(flow.luminosityW / SOLAR_LUMINOSITY)} L☉`],
    ['Efficiency', `${(100 * flow.efficiency).toFixed(1)}%`],
    [temperatureLabel, hot && electronT === undefined ? 'not evaluated' : <Temperature
      kelvin={hot ? electronT! : flow.innerTemperatureK}
      note={hot ? 'Reference inner electron temperature after limiting radiative cooling to the available power. Local temperatures vary as plasma moves, heats and cools; color also depends on the magnetic field and energetic electrons.' : undefined} />],
  ];
  const outflows=flow.outflows;
  if(outflows) rows.push(
    ['Supply / horizon inflow', `${fmt(outflows.outerSupplyKgPerS/flow.rateKgPerS)}×`],
    ['Wind mass loss', `${fmt(100*outflows.windMassKgPerS/outflows.outerSupplyKgPerS)}% of supply`],
    ['Jet power', `${fmt(outflows.jetPowerW/SOLAR_LUMINOSITY)} L☉ (mostly kinetic and magnetic)`],
    ['Horizon magnetic flux', `${fmt(outflows.magneticFlux)} (dimensionless)`],
  );
  return {
    title: 'Galactic Core',
    subtitle: `supermassive black hole · ${FLOW_LABEL[flow.regime]}`,
    row: nucleusRowSpec(n),
    // A hole has no light of its own; the strip stays dark.
    rows: [],
    metrics: [
      { label: 'Mass', value: fmtSolarMasses(n.massSolar), unit: 'M☉' },
      { label: 'Spin a★', value: n.spin.toFixed(3), unit: '' },
      { label: 'Shadow radius', value: span(n.shadowRadiusM), unit: '' },
    ],
    sections: groupPlateRows(rows, [
      { id: 'geometry', title: 'Mass & geometry', summary: `${fmt(n.influenceRadiusPc)} pc influence radius`, labels: ['Mass', 'Spin a★', 'Schwarzschild r', 'Shadow radius', 'Last stable orbit', 'Influence radius'] },
      ...(outflows ? [{ id: 'outflows', title: 'Wind & jet', summary: 'Inner outflow model', labels: ['Supply / horizon inflow', 'Wind mass loss', 'Jet power', 'Horizon magnetic flux'] }] : []),
      { id: 'accretion', title: 'Accretion & light', summary: FLOW_LABEL[flow.regime], labels: ['L / L_Edd', luminosityLabel, 'Efficiency', temperatureLabel] },
    ]),
  };
}
