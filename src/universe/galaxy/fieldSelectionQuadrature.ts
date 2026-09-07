import { stellarBandRgb } from '../../core/color/stellarLight';
import { evolve, evolutionAgeBreaksGyr } from '../star/evolution';
import { initialMassFromUnit, massUnitForMass } from '../star/imf';
import { multiplicityFraction } from '../star/multiplicity';
import { componentAgeForUnit, componentUnitForAge, type StellarComponent } from './populationAge';
import { populationMassBounds, POPULATION_NODES as NODES, POPULATION_WEIGHTS as WEIGHTS } from './populationQuadrature';
import { FIELD_OBJECTS_PER_SYSTEM, FIELD_MASS_BREAKS } from './fieldMultiplicity';
import { FIELD_ROW_BOUNDS, SELECTION_AGE_BINS, SELECTION_POWER_BINS, selectionAgeAt, selectionPowerIndex } from './fieldSelectionGrid';

function radicalInverse(n: number): number {
  let v=0, p=.5;
  while(n>0) { v+=(n&1)*p; n>>=1; p*=.5; }
  return v;
}
/** Phase-resolved quadrature of complete systems. Companion ratios use
 * a deterministic two-dimensional stratified rule; every component's
 * phase boundaries split the coeval age integral, retaining rare giants. */
export function integrateFieldSelection(component: StellarComponent, bins=256, ratios=16): {data:Float64Array; nodes:number} {
  const ageBounds = Array.from({length:SELECTION_AGE_BINS+1},(_,i)=>selectionAgeAt(i));
  const masses = [...new Set([...populationMassBounds(component,bins),...FIELD_MASS_BREAKS.map(massUnitForMass),...FIELD_ROW_BOUNDS.map(massUnitForMass)])].sort((a,b)=>a-b);
  const width=SELECTION_POWER_BINS+1,height=SELECTION_AGE_BINS+1;
  const data=new Float64Array(4*width*height*3);
  let nodes=0;
  const visitSystem=(initials:number[],weight:number,row:number) => {
    const phases=initials.flatMap(m=>evolutionAgeBreaksGyr(m).map(t=>componentUnitForAge(component,t)));
    const ages=[...new Set([...ageBounds,...phases])].sort((a,b)=>a-b);
    for(let a=1;a<ages.length;a++) {
      const half=(ages[a]-ages[a-1])/2,mid=(ages[a]+ages[a-1])/2;
      if(!(half>0))continue;
      let ageBin=1;while(ageBin<SELECTION_AGE_BINS && mid>ageBounds[ageBin])ageBin++;
      for(let n=0;n<4;n++)for(const sign of [-1,1]) {
        const age=componentAgeForUnit(component,mid+sign*half*NODES[n]);
        const rgb=[0,0,0];
        for(const mass of initials) {
          const star=evolve(mass,age),color=stellarBandRgb(star.luminosity,star.tEff);
          for(let c=0;c<3;c++)rgb[c]+=color[c];
        }
        const power=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
        const powerBin=Math.min(SELECTION_POWER_BINS,Math.max(1,Math.ceil(selectionPowerIndex(power))));
        const at=((row*height+ageBin)*width+powerBin)*3;
        const w=weight*half*WEIGHTS[n]/FIELD_OBJECTS_PER_SYSTEM;
        for(let c=0;c<3;c++)data[at+c]+=w*rgb[c];
        nodes++;
      }
    }
  };
  for(let m=1;m<masses.length;m++) {
    const half=(masses[m]-masses[m-1])/2,mid=(masses[m]+masses[m-1])/2;
    // Four-point mass rule; phase-entry mass boundaries are explicit.
    for(const [node,w] of [[.3399810435848563,.6521451548625461],[.8611363115940526,.3478548451374538]])for(const sign of [-1,1]) {
      const mass=initialMassFromUnit(mid+sign*half*node),weight=half*w;
      const f=multiplicityFraction(mass);
      let row=0;while(row<3&&mass>=FIELD_ROW_BOUNDS[row+1])row++;
      visitSystem([mass],weight*(1-f),row);
      for(let q=0;q<ratios;q++) {
        const one=Math.max(.013,mass*(.15+.8*(q+.5)/ratios));
        const two=Math.max(.013,mass*(.15+.8*((radicalInverse(q)+.5/ratios)%1)));
        visitSystem([mass,one],weight*f*.75/ratios,row);
        visitSystem([mass,one,two],weight*f*.25/ratios,row);
      }
    }
  }
  // 2D inclusive prefix: light with age<=boundary and power<=boundary.
  for(let row=0;row<4;row++)for(let a=1;a<height;a++)for(let p=1;p<width;p++)for(let c=0;c<3;c++) {
    const at=((row*height+a)*width+p)*3+c;
    data[at]+=data[at-3]+data[at-width*3]-data[at-width*3-3];
  }
  return {data,nodes};
}

export {fieldPopulationMoments} from './fieldPopulation';
