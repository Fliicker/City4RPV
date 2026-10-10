import assert from 'node:assert/strict';
import test from 'node:test';
import { feature, multiPolygon, polygon } from '@turf/helpers';
import type { MultiPolygon, Polygon } from 'geojson';
import { parseObj, projectedTriangleIntersects } from '../objMerge';

test('OBJ parser supports all index forms, negative indices, and triangulates polygons', () => {
  const parsed = parseObj([
    'mtllib source.mtl',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'vt 0 0',
    'vt 1 0',
    'vt 1 1',
    'vt 0 1',
    'vn 0 0 1',
    'usemtl roof',
    'f -4/1/1 -3/2/1 -2/3/1 -1/4/1',
  ].join('\n'));
  assert.equal(parsed.faces.length, 2);
  assert.equal(parsed.faces[0].material, 'roof');
  assert.deepEqual(parsed.faces[1].refs.map(ref => ref.v), [0, 2, 3]);
});

test('triangle intersection covers inside, crossing, outside, and vertical projections', () => {
  const clip = polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);
  assert.equal(projectedTriangleIntersects([[1, 1, 0], [2, 1, 0], [1, 2, 0]], clip), true);
  assert.equal(projectedTriangleIntersects([[-1, 5, 0], [5, 5, 0], [5, 6, 0]], clip), true);
  assert.equal(projectedTriangleIntersects([[-3, -3, 0], [-2, -3, 0], [-3, -2, 0]], clip), false);
  assert.equal(projectedTriangleIntersects([[5, 5, 0], [5, 5, 4], [5, 8, 9]], clip), true);
});

test('holes and MultiPolygon components are respected', () => {
  const withHole = feature<Polygon>({
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  });
  assert.equal(projectedTriangleIntersects([[4.5, 4.5, 0], [5.5, 4.5, 0], [5, 5.5, 0]], withHole), false);

  const components = multiPolygon([
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    [[[8, 8], [10, 8], [10, 10], [8, 10], [8, 8]]],
  ]) as ReturnType<typeof feature<MultiPolygon>>;
  assert.equal(projectedTriangleIntersects([[8.5, 8.5, 0], [9, 8.5, 0], [8.5, 9, 0]], components), true);
});
