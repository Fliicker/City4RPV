import assert from 'node:assert/strict';
import test from 'node:test';
import { feature, multiPolygon, polygon } from '@turf/helpers';
import type { MultiPolygon, Polygon } from 'geojson';
import { PolygonTriangleClipper, type ClippedTriangle } from '../meshClip';

function projectedArea(triangle: ClippedTriangle): number {
  const points = triangle.map(vertex => vertex.position);
  return Math.abs(
    (points[1][0] - points[0][0]) * (points[2][1] - points[0][1])
    - (points[2][0] - points[0][0]) * (points[1][1] - points[0][1]),
  ) / 2;
}

function area3d(triangle: ClippedTriangle): number {
  const points = triangle.map(vertex => vertex.position);
  const first = points[1].map((value, index) => value - points[0][index]);
  const second = points[2].map((value, index) => value - points[0][index]);
  return Math.hypot(
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ) / 2;
}

test('boundary-crossing triangle is cut and interpolates Z, UV, and normals', () => {
  const clipper = new PolygonTriangleClipper(polygon([[
    [0, -10], [10, -10], [10, 10], [0, 10], [0, -10],
  ]]));
  const result = clipper.clip([
    { position: [-1, 0, 0], textureCoordinate: [0, 0], normal: [0, 0, 1] },
    { position: [1, 0, 2], textureCoordinate: [1, 0], normal: [0, 0, 1] },
    { position: [1, 2, 4], textureCoordinate: [1, 1], normal: [0, 0, 1] },
  ]);
  assert.equal(result.length, 2);
  assert.ok(result.flat().every(vertex => vertex.position[0] >= -1e-9));
  const interpolated = result.flat().find(vertex => (
    Math.abs(vertex.position[0]) < 1e-9 && Math.abs(vertex.position[1]) < 1e-9
  ));
  assert.ok(interpolated);
  assert.ok(Math.abs(interpolated.position[2] - 1) < 1e-9);
  assert.deepEqual(interpolated.textureCoordinate, [0.5, 0]);
  assert.deepEqual(interpolated.normal, [0, 0, 1]);
});

test('polygon holes are removed from clipped triangle area', () => {
  const withHole = feature<Polygon>({
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  });
  const result = new PolygonTriangleClipper(withHole).clip([
    { position: [-10, -10, 0] },
    { position: [30, -10, 0] },
    { position: [-10, 30, 0] },
  ]);
  const area = result.reduce((sum, triangle) => sum + projectedArea(triangle), 0);
  assert.ok(Math.abs(area - 96) < 1e-8);
  assert.ok(result.every(triangle => {
    const centre = triangle.reduce((sum, vertex) => (
      [sum[0] + vertex.position[0] / 3, sum[1] + vertex.position[1] / 3]
    ), [0, 0]);
    return !(centre[0] > 4 && centre[0] < 6 && centre[1] > 4 && centre[1] < 6);
  }));
});

test('MultiPolygon components are both retained without filling the gap', () => {
  const components = multiPolygon([
    [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    [[[8, 8], [10, 8], [10, 10], [8, 10], [8, 8]]],
  ]) as ReturnType<typeof feature<MultiPolygon>>;
  const result = new PolygonTriangleClipper(components).clip([
    { position: [-10, -10, 0] },
    { position: [30, -10, 0] },
    { position: [-10, 30, 0] },
  ]);
  assert.ok(Math.abs(result.reduce((sum, triangle) => sum + projectedArea(triangle), 0) - 8) < 1e-8);
});

test('vertical triangles are clipped in XY while retaining nonzero 3D faces', () => {
  const clipper = new PolygonTriangleClipper(polygon([[
    [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
  ]]));
  const result = clipper.clip([
    { position: [-1, 5, 0] },
    { position: [5, 5, 0] },
    { position: [5, 5, 10] },
  ]);
  assert.ok(result.length > 0);
  assert.ok(result.flat().every(vertex => vertex.position[0] >= -1e-9));
  assert.ok(result.every(triangle => area3d(triangle) > 1e-12));
});
