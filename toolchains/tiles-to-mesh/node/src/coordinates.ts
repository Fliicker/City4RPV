import type { MultiPolygon, Polygon, Position } from 'geojson';
import { feature } from '@turf/helpers';
import type { PolygonFeature, PolygonGeometry } from './geojson';

export type Vec3 = [number, number, number];
export type Matrix3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

const WGS84_A = 6378137.0;
const WGS84_E2 = 6.6943799901413165e-3;

function multiplyMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
  const result = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      for (let k = 0; k < 3; k += 1) {
        result[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
      }
    }
  }
  return result as Matrix3;
}

function multiplyMatrixVector(matrix: Matrix3, vector: Vec3): Vec3 {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function inverseTranspose(matrix: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const c00 = e * i - f * h;
  const c01 = -(d * i - f * g);
  const c02 = d * h - e * g;
  const c10 = -(b * i - c * h);
  const c11 = a * i - c * g;
  const c12 = -(a * h - b * g);
  const c20 = b * f - c * e;
  const c21 = -(a * f - c * d);
  const c22 = a * e - b * d;
  const determinant = a * c00 + b * c01 + c * c02;
  if (Math.abs(determinant) < 1e-18) throw new Error('Tileset transform has a singular linear component');
  // The cofactor matrix divided by det is inverse-transpose.
  return [
    c00 / determinant, c01 / determinant, c02 / determinant,
    c10 / determinant, c11 / determinant, c12 / determinant,
    c20 / determinant, c21 / determinant, c22 / determinant,
  ];
}

export function geodeticToEcef(lonDegrees: number, latDegrees: number, height = 0): Vec3 {
  const lon = lonDegrees * Math.PI / 180;
  const lat = latDegrees * Math.PI / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const normalRadius = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (normalRadius + height) * cosLat * Math.cos(lon),
    (normalRadius + height) * cosLat * Math.sin(lon),
    (normalRadius * (1 - WGS84_E2) + height) * sinLat,
  ];
}

export function ecefToEnuRotation(lonDegrees: number, latDegrees: number): Matrix3 {
  const lon = lonDegrees * Math.PI / 180;
  const lat = latDegrees * Math.PI / 180;
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  return [
    -sinLon, cosLon, 0,
    -sinLat * cosLon, -sinLat * sinLon, cosLat,
    cosLat * cosLon, cosLat * sinLon, sinLat,
  ];
}

export class EnuTransform {
  readonly originEcef: Vec3;
  readonly ecefToEnu: Matrix3;
  readonly sourceLocalToEnu: Matrix3;
  readonly normalLocalToEnu: Matrix3;
  readonly translation: Vec3;

  constructor(
    readonly rootTransform: number[],
    readonly originLonLatHeight: Vec3,
  ) {
    if (rootTransform.length !== 16 || rootTransform.some(value => !Number.isFinite(value))) {
      throw new Error('tileset root.transform must contain 16 finite numbers');
    }
    this.originEcef = geodeticToEcef(...originLonLatHeight);
    this.ecefToEnu = ecefToEnuRotation(originLonLatHeight[0], originLonLatHeight[1]);
    const sourceLinear: Matrix3 = [
      rootTransform[0], rootTransform[4], rootTransform[8],
      rootTransform[1], rootTransform[5], rootTransform[9],
      rootTransform[2], rootTransform[6], rootTransform[10],
    ];
    this.sourceLocalToEnu = multiplyMatrix3(this.ecefToEnu, sourceLinear);
    this.normalLocalToEnu = inverseTranspose(this.sourceLocalToEnu);
    const rootTranslation: Vec3 = [rootTransform[12], rootTransform[13], rootTransform[14]];
    this.translation = multiplyMatrixVector(this.ecefToEnu, [
      rootTranslation[0] - this.originEcef[0],
      rootTranslation[1] - this.originEcef[1],
      rootTranslation[2] - this.originEcef[2],
    ]);
  }

  sourcePositionToEnu(position: Vec3): Vec3 {
    const rotated = multiplyMatrixVector(this.sourceLocalToEnu, position);
    return [
      rotated[0] + this.translation[0],
      rotated[1] + this.translation[1],
      rotated[2] + this.translation[2],
    ];
  }

  sourceNormalToEnu(normal: Vec3): Vec3 {
    const transformed = multiplyMatrixVector(this.normalLocalToEnu, normal);
    const length = Math.hypot(...transformed);
    if (length < 1e-18) return [0, 0, 0];
    return [transformed[0] / length, transformed[1] / length, transformed[2] / length];
  }

  wgs84PositionToEnu(lon: number, lat: number, height = 0): Vec3 {
    const ecef = geodeticToEcef(lon, lat, height);
    return multiplyMatrixVector(this.ecefToEnu, [
      ecef[0] - this.originEcef[0],
      ecef[1] - this.originEcef[1],
      ecef[2] - this.originEcef[2],
    ]);
  }

  sourceLocalToEnuMatrix4ColumnMajor(): number[] {
    const a = this.sourceLocalToEnu;
    const t = this.translation;
    return [
      a[0], a[3], a[6], 0,
      a[1], a[4], a[7], 0,
      a[2], a[5], a[8], 0,
      t[0], t[1], t[2], 1,
    ];
  }
}

function transformRing(ring: Position[], transform: EnuTransform): Position[] {
  return ring.map(position => {
    const [east, north] = transform.wgs84PositionToEnu(position[0], position[1], 0);
    return [east, north];
  });
}

export function polygonFeatureToEnu(input: PolygonFeature, transform: EnuTransform): PolygonFeature {
  let geometry: PolygonGeometry;
  if (input.geometry.type === 'Polygon') {
    geometry = {
      type: 'Polygon',
      coordinates: input.geometry.coordinates.map(ring => transformRing(ring, transform)),
    } satisfies Polygon;
  } else {
    geometry = {
      type: 'MultiPolygon',
      coordinates: input.geometry.coordinates.map(polygonCoordinates => (
        polygonCoordinates.map(ring => transformRing(ring, transform))
      )),
    } satisfies MultiPolygon;
  }
  return feature(geometry, input.properties ?? {});
}
