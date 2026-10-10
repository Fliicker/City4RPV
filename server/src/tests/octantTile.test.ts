import assert from 'node:assert/strict';
import test from 'node:test';
import { getOctantLatLonBox, normalizeOctantHorizontalPath } from '../octantTile';

test('Munich level-19 octant resolves to its known geographic bounds', () => {
  assert.deepEqual(getOctantLatLonBox('3060416040616157626'), {
    n: 48.043212890625,
    s: 48.04252624511719,
    w: 11.502685546875,
    e: 11.504058837890625,
  });
});

test('vertical octant digits normalize to the same horizontal path', () => {
  assert.equal(normalizeOctantHorizontalPath('306047'), '302003');
});
