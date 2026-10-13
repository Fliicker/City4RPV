import earcut from 'earcut';
import type { Vec3 } from './coordinates';
import type { PolygonFeature } from './geojson';

export type ClipVertex = {
  position: Vec3;
  textureCoordinate?: number[];
  normal?: Vec3;
};

export type ClippedTriangle = [ClipVertex, ClipVertex, ClipVertex];

type Vec2 = [number, number];
type ClipTriangle2d = {
  points: [Vec2, Vec2, Vec2];
  orientation: number;
  bbox: [number, number, number, number];
};

const EPSILON = 1e-9;

function same2d(first: number[], second: number[]): boolean {
  return Math.abs(first[0] - second[0]) <= EPSILON && Math.abs(first[1] - second[1]) <= EPSILON;
}

function cleanRing(ring: number[][]): number[][] {
  const result = ring.map(position => [Number(position[0]), Number(position[1])]);
  if (result.length > 1 && same2d(result[0], result[result.length - 1])) result.pop();
  return result;
}

function triangulateFeature(feature: PolygonFeature): ClipTriangle2d[] {
  const polygons = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
  const triangles: ClipTriangle2d[] = [];
  for (const polygonCoordinates of polygons) {
    const flat: number[] = [];
    const holes: number[] = [];
    for (const [ringIndex, rawRing] of polygonCoordinates.entries()) {
      const ring = cleanRing(rawRing as number[][]);
      if (ring.length < 3) continue;
      if (ringIndex > 0) holes.push(flat.length / 2);
      for (const point of ring) flat.push(point[0], point[1]);
    }
    const indices = earcut(flat, holes, 2);
    for (let index = 0; index < indices.length; index += 3) {
      const points = [indices[index], indices[index + 1], indices[index + 2]].map(vertexIndex => (
        [flat[vertexIndex * 2], flat[vertexIndex * 2 + 1]] as Vec2
      )) as [Vec2, Vec2, Vec2];
      const orientation = (
        (points[1][0] - points[0][0]) * (points[2][1] - points[0][1])
        - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0])
      );
      if (Math.abs(orientation) <= EPSILON) continue;
      triangles.push({
        points,
        orientation,
        bbox: [
          Math.min(...points.map(point => point[0])),
          Math.min(...points.map(point => point[1])),
          Math.max(...points.map(point => point[0])),
          Math.max(...points.map(point => point[1])),
        ],
      });
    }
  }
  return triangles;
}

function interpolateArray(first: number[], second: number[], amount: number): number[] {
  if (first.length !== second.length) throw new Error('Cannot interpolate OBJ attributes with different dimensions');
  return first.map((value, index) => value + (second[index] - value) * amount);
}

function interpolateVertex(first: ClipVertex, second: ClipVertex, amount: number): ClipVertex {
  const result: ClipVertex = {
    position: interpolateArray(first.position, second.position, amount) as Vec3,
  };
  if (first.textureCoordinate && second.textureCoordinate) {
    result.textureCoordinate = interpolateArray(first.textureCoordinate, second.textureCoordinate, amount);
  }
  if (first.normal && second.normal) {
    result.normal = interpolateArray(first.normal, second.normal, amount) as Vec3;
  }
  return result;
}

function signedEdgeDistance(point: ClipVertex, edgeStart: Vec2, edgeEnd: Vec2, orientation: number): number {
  const cross = (
    (edgeEnd[0] - edgeStart[0]) * (point.position[1] - edgeStart[1])
    - (edgeEnd[1] - edgeStart[1]) * (point.position[0] - edgeStart[0])
  );
  return cross * Math.sign(orientation);
}

function samePosition(first: ClipVertex, second: ClipVertex): boolean {
  return first.position.every((value, index) => Math.abs(value - second.position[index]) <= EPSILON);
}

function removeDuplicateVertices(vertices: ClipVertex[]): ClipVertex[] {
  const result: ClipVertex[] = [];
  for (const vertex of vertices) {
    if (result.length === 0 || !samePosition(result[result.length - 1], vertex)) result.push(vertex);
  }
  if (result.length > 1 && samePosition(result[0], result[result.length - 1])) result.pop();
  return result;
}

function clipToConvexTriangle(subject: ClipVertex[], clip: ClipTriangle2d): ClipVertex[] {
  let output = subject;
  for (let edgeIndex = 0; edgeIndex < 3 && output.length > 0; edgeIndex += 1) {
    const edgeStart = clip.points[edgeIndex];
    const edgeEnd = clip.points[(edgeIndex + 1) % 3];
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    let previousDistance = signedEdgeDistance(previous, edgeStart, edgeEnd, clip.orientation);
    for (const current of input) {
      const currentDistance = signedEdgeDistance(current, edgeStart, edgeEnd, clip.orientation);
      const previousInside = previousDistance >= -EPSILON;
      const currentInside = currentDistance >= -EPSILON;
      if (currentInside !== previousInside) {
        const denominator = previousDistance - currentDistance;
        const amount = Math.abs(denominator) <= EPSILON ? 0 : previousDistance / denominator;
        output.push(interpolateVertex(previous, current, Math.max(0, Math.min(1, amount))));
      }
      if (currentInside) output.push(current);
      previous = current;
      previousDistance = currentDistance;
    }
    output = removeDuplicateVertices(output);
  }
  return output;
}

function triangleArea3d(triangle: ClippedTriangle): number {
  const [first, second, third] = triangle.map(vertex => vertex.position);
  const a = second.map((value, index) => value - first[index]);
  const b = third.map((value, index) => value - first[index]);
  const cross = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  return Math.hypot(...cross) / 2;
}

export class PolygonTriangleClipper {
  private readonly triangles: ClipTriangle2d[];

  constructor(feature: PolygonFeature) {
    this.triangles = triangulateFeature(feature);
    if (this.triangles.length === 0) throw new Error('Clip feature could not be triangulated');
  }

  clip(source: ClippedTriangle): ClippedTriangle[] {
    const sourceBbox: [number, number, number, number] = [
      Math.min(...source.map(vertex => vertex.position[0])),
      Math.min(...source.map(vertex => vertex.position[1])),
      Math.max(...source.map(vertex => vertex.position[0])),
      Math.max(...source.map(vertex => vertex.position[1])),
    ];
    const result: ClippedTriangle[] = [];
    const resultKeys = new Set<string>();
    for (const clip of this.triangles) {
      if (
        sourceBbox[2] < clip.bbox[0] - EPSILON || sourceBbox[0] > clip.bbox[2] + EPSILON
        || sourceBbox[3] < clip.bbox[1] - EPSILON || sourceBbox[1] > clip.bbox[3] + EPSILON
      ) continue;
      const polygon = clipToConvexTriangle(source, clip);
      for (let index = 1; index + 1 < polygon.length; index += 1) {
        const triangle: ClippedTriangle = [polygon[0], polygon[index], polygon[index + 1]];
        if (triangleArea3d(triangle) <= 1e-12) continue;
        const key = triangle
          .map(vertex => vertex.position.map(value => value.toFixed(9)).join(','))
          .sort()
          .join('|');
        if (!resultKeys.has(key)) {
          resultKeys.add(key);
          result.push(triangle);
        }
      }
    }
    return result;
  }
}
