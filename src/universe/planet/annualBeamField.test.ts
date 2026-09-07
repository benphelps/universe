import { expect, it } from 'vitest';
import { annualBeamField, annualBeamFluxAt } from './annualBeamField';
import type { IncidentBeam } from './illumination';

it('cone shortcuts preserve direct positive-beam sums at horizons and for full-sphere source distributions', () => {
  for (const spread of [0, .1, .8, 2, Math.PI]) {
    const beams: IncidentBeam[] = Array.from({length:97},(_,k)=>{
      const a = spread * Math.cos(k * 2.399963229728653), y = Math.sin(a) * Math.cos(k);
      return { direction:{x:Math.cos(a),y,z:Math.sin(a)*Math.sin(k)},fluxWm2:200+k*13 };
    });
    const field=annualBeamField(beams,1/97);
    const normals=[field.axis,{x:-field.axis.x,y:-field.axis.y,z:-field.axis.z}];
    for(let k=0;k<4096;k++) {
      const y=-1+2*(k+.5)/4096, a=k*2.399963229728653,r=Math.sqrt(1-y*y);
      normals.push({x:r*Math.cos(a),y,z:r*Math.sin(a)});
    }
    for(const n of normals) {
      const direct=beams.reduce((sum,b)=>sum+b.fluxWm2/97*Math.max(0,n.x*b.direction.x+n.y*b.direction.y+n.z*b.direction.z),0);
      expect(Math.abs(annualBeamFluxAt(field,n)-direct)).toBeLessThan(2e-12);
    }
    const copied=structuredClone(field);
    expect(annualBeamFluxAt(copied,{x:0,y:1,z:0})).toBe(annualBeamFluxAt(field,{x:0,y:1,z:0}));
  }
});

it('keeps zero-luminosity sources finite without inventing heat',()=>{
  for(const beams of [[],[{direction:{x:1,y:0,z:0},fluxWm2:0}]]) {
    const field=annualBeamField(beams,1);
    expect(field.meanFluxWm2).toBe(0);
    expect(annualBeamFluxAt(field,{x:1,y:0,z:0})).toBe(0);
    expect(annualBeamFluxAt(field,{x:0,y:1,z:0})).toBe(0);
  }
});

it('integrates each clipped beam over the sphere to its projected cross-section',()=>{
  const beams=[{direction:{x:1,y:0,z:0},fluxWm2:1361},{direction:{x:0,y:-.6,z:.8},fluxWm2:320}];
  const field=annualBeamField(beams,.5);
  let sum=0;
  for(let k=0;k<65536;k++){
    const y=-1+2*(k+.5)/65536,a=k*2.399963229728653,r=Math.sqrt(1-y*y);
    sum+=annualBeamFluxAt(field,{x:r*Math.cos(a),y,z:r*Math.sin(a)})/65536;
  }
  expect(Math.abs(sum-(1361+320)*.5/4)).toBeLessThan(.002);
});
