import assert from 'node:assert/strict';
import test from 'node:test';
import { EnuTransform, geodeticToEcef } from '../coordinates';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

test('WGS84 origin converts to ENU zero', () => {
  const transform = new EnuTransform(IDENTITY, [11.5, 48.1, 0]);
  const result = transform.wgs84PositionToEnu(11.5, 48.1, 0);
  assert.ok(result.every(value => Math.abs(value) < 1e-9));
});

test('geodetic ECEF conversion matches WGS84 equator axes', () => {
  assert.deepEqual(geodeticToEcef(0, 0, 0), [6378137, 0, 0]);
  const ninetyEast = geodeticToEcef(90, 0, 0);
  assert.ok(Math.abs(ninetyEast[0]) < 1e-8);
  assert.ok(Math.abs(ninetyEast[1] - 6378137) < 1e-8);
});

test('source normal uses inverse-transpose and stays normalized', () => {
  const transform = new EnuTransform([
    2, 0, 0, 0,
    0, 3, 0, 0,
    0, 0, 4, 0,
    ...geodeticToEcef(0, 0, 0), 1,
  ], [0, 0, 0]);
  const normal = transform.sourceNormalToEnu([1, 2, 3]);
  assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-12);
});
