import { Temperature } from './temperatureReadout';
import { kelvinDescription } from './temperature';
import { useEffect, useState } from 'react';
import { seasonalConditions } from '../store';
import type { SeasonalUnavailable } from '../../universe/planet/seasonalClimate';
import { fmt } from './format';

const UNAVAILABLE: Record<SeasonalUnavailable,string> = {
  'no-surface':'annual model only', 'missing-forcing':'annual model only',
  'multiple-periods':'multiple periods · annual model only',
  'slow-rotation':'slow stellar day · annual model only',
  'extreme-regime':'outside seasonal model range',
  'not-converged':'cycle unresolved · annual model only',
  'worker-failed':'seasonal estimate unavailable',
};

/** Isolated 4-Hz readout: time changes never rerender the whole sidebar,
 * rebuild a terrain field or start another worker. */
export function SeasonalReadout({seedHex,annual=false}:{seedHex:string;annual?:boolean}) {
  const [state,setState] = useState(seasonalConditions);
  useEffect(()=>{
    setState(seasonalConditions());
    const id=window.setInterval(()=>setState(seasonalConditions()),250);
    return ()=>window.clearInterval(id);
  },[seedHex]);
  if (!state || state.seedHex !== seedHex || state.status === 'building') return <>computing cycle…</>;
  if (state.status === 'unavailable') return <>{annual ? 'equilibrium reference' : UNAVAILABLE[state.reason]}</>;
  if (annual) {
    const mean = state.annualMean;
    if (mean?.status !== 'ready') return <span title={mean?.status === 'unavailable' && mean.reason === 'spin-resolved' ? 'Longitude-dependent annual temperature means are not yet available. Terrain uses equilibrium under average heating.' : 'The annual mean did not meet the bounded model’s convergence or resolution limits.'}>equilibrium reference</span>;
    return <Temperature kelvin={state.terrainMeanK} note={`Persistent surface climate at datum: ${kelvinDescription(mean.field.minimumK, mean.field.maximumK)}. Seasonal time mean with fixed albedo, opacity and phases. Surface below the camera: ${kelvinDescription(state.terrainDatumK ?? 0)} at datum. Catalog equilibrium is retained separately.`}>{fmt(state.terrainMeanK,3)} K · seasonal mean</Temperature>;
  }
  const latitude=`${Math.abs(state.latitudeDeg).toFixed(0)}°${state.latitudeDeg<0?'S':'N'}`;
  const phase=((state.timeDays/state.cycleDays)%1+1)%1;
  const details=`Surface below the camera, ${latitude}. Simulation time ${state.timeDays.toFixed(3)} d; cycle ${(phase*100).toFixed(1)}% of ${fmt(state.cycleDays,4)} d. Dry sensible-heat estimate with fixed albedo and phases. ${state.snowOverlay ? 'Seasonal snow cover is shown on land over permanent ice; water phase geometry stays fixed.' : 'Annual surface appearance.'} Coarse cycle map at datum: ${kelvinDescription(state.minimumK, state.maximumK)}; mean ${kelvinDescription(state.cycleMeanK)}. ${state.annualMean?.status === 'ready' ? 'Persistent terrain uses the seasonal temperature mean.' : 'Persistent terrain retains equilibrium under average heating.'}`;
  return <Temperature kelvin={state.temperatureK} note={details}>{fmt(state.temperatureK,3)} K below view{state.mode==='rotation-averaged'?' · daily mean':''}</Temperature>;
}
