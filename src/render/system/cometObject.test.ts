import { expect, it } from 'vitest';
import { BufferAttribute, Mesh, Vector3 } from 'three';
import { AU } from '../../core/physics/constants';
import { seconds } from '../../core/physics/units';
import type { Comet } from '../../universe/smallbody/types';
import { CometObject } from './cometObject';

const active: Comet = { name: 'test', nucleusKm: 3, activityOnsetAu: 3, dustiness: 0.5,
  elements: { semiMajorAxis: 10 * AU, eccentricity: 0.9, inclination: 0,
    longitudeOfAscendingNode: 0, argumentOfPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 } };

it('keeps a nearby active coma pickable but rejects its unresolved distant or daylight-hidden head', () => {
  const comet = new CometObject(active, 1), position = new Vector3();
  comet.group.scale.setScalar(AU / 1000);
  comet.update(seconds(0), new Vector3(1, 0, 0.5).multiplyScalar(AU / 1000), .001);
  expect(comet.getHeadWorldPosition(position)).toBe(true);
  comet.setVisibility(0, 0);
  expect(comet.getHeadWorldPosition(position)).toBe(false);
  comet.setVisibility(1, 1);
  comet.update(seconds(0), new Vector3(1, 0, 206265).multiplyScalar(AU / 1000), .001);
  expect(comet.getHeadWorldPosition(position)).toBe(false);
  comet.dispose();
});

it('dilutes widened tail footprints with distance instead of amplifying them', () => {
  const comet = new CometObject(active, 1);
  const tails = comet.group.children.filter((child): child is Mesh => child instanceof Mesh);
  const brightness = () => tails.map(tail => Math.max(...(tail.geometry.getAttribute('tint') as BufferAttribute).array));
  comet.update(seconds(0), new Vector3(1, 0, 1000), .001);
  const near = brightness();
  comet.update(seconds(0), new Vector3(1, 0, 2000), .001);
  brightness().forEach((far, i) => expect(far / near[i]).toBeCloseTo(.5, 4));
  comet.dispose();
});
