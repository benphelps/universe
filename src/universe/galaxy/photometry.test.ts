import { expect,it } from 'vitest';
import { Rng } from '../../core/rng/rng';
import { blackbodyOpticalRgb,rgbLuminance } from '../../core/color/optical';
import { ageUnitOf,initialMassOf,massBitsAtLeast,seedForIdentity } from '../star/identity';
import { generateCompanionSpecs } from '../star/multiplicity';
import { evolve } from '../star/evolution';
import { populationFromUnit } from './population';
import { starPhotometry,unresolvedStarLight } from './photometry';
import { systemLuminosityCeiling } from './catalog';
const position={xPc:8000,yPc:0,zPc:80};
it('sums separately evolved component spectra, including companions of remnant primaries',()=>{
  let mixed=0,remnants=0;
  const seeds = Array.from({length:700}, (_,i) => BigInt(i)*0x9e3779b97f4a7c15n & ((1n<<64n)-1n));
  // The IMF sample alone need not contain a zero-luminosity primary.
  // Deliberately cover 30-Msun remnants at the youngest field age,
  // where lower-mass companions can still shine.
  for(let entropy=0;entropy<32;entropy++)seeds.push(seedForIdentity(massBitsAtLeast(30),0,entropy));
  for(const seed of seeds) {
    const physical=starPhotometry(seed,position),source=unresolvedStarLight(seed,position);
    const age=populationFromUnit(ageUnitOf(seed),position).ageGyr;
    const specs=generateCompanionSpecs(new Rng(seed).fork('multiplicity'),initialMassOf(seed));
    const stars=[physical,...specs.map(spec=>evolve(spec.massSolar,age))],expected=[0,0,0];let bol=0;
    for(const star of stars) {const rgb=blackbodyOpticalRgb(star.tEff);bol+=Math.max(0,star.luminosity);for(let c=0;c<3;c++)expected[c]+=Math.max(0,star.luminosity)*rgb[c];}
    expect(source.primary).toEqual(physical);
    expect(source.bolometric).toBeCloseTo(bol,9);
    const norm=Math.max(1e-10,rgbLuminance(expected));
    expect(source.rgb.reduce((s,v,c)=>s+Math.abs(v-expected[c]),0)/norm).toBeLessThan(.0005);
    expect(source.bolometric).toBeLessThanOrEqual(systemLuminosityCeiling(initialMassOf(seed)));
    if(specs.length)mixed++;
    if(physical.luminosity<=0&&specs.length&&rgbLuminance(source.rgb)>1)remnants++;
  }
  expect(mixed).toBeGreaterThan(150);expect(remnants).toBeGreaterThan(0);
});
