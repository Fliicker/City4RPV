import fs from 'node:fs';
import type {
  Feature,
  FeatureCollection,
  GeoJsonObject,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';
import turfBuffer from '@turf/buffer';
import { feature } from '@turf/helpers';
import type { LatLonBbox } from './octantTile';

export type PolygonGeometry = Polygon | MultiPolygon;
export type PolygonFeature = Feature<PolygonGeometry>;

function validateCrs(root: { crs?: unknown }): void {
  const crsName = readCrsName(root.crs);
  if (crsName && !/(4326|CRS84)/i.test(crsName)) {
    throw new Error(`Only EPSG:4326/CRS84 input is supported; received ${crsName}`);
  }
}

function readCrsName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const crs = value as { properties?: { name?: unknown }; name?: unknown };
  const name = crs.properties?.name ?? crs.name;
  return typeof name === 'string' ? name : null;
}

function normalizeRing(ring: Position[], label: string): Position[] {
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new Error(`${label} must contain at least three coordinates`);
  }
  const normalized = ring.map((position, index) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new Error(`${label}[${index}] is not a valid coordinate`);
    }
    const lon = Number(position[0]);
    const lat = Number(position[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`${label}[${index}] contains a non-finite coordinate`);
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new Error(`${label}[${index}] is outside EPSG:4326 longitude/latitude bounds`);
    }
    return [lon, lat] as Position;
  });
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) normalized.push([...first]);
  if (normalized.length < 4) throw new Error(`${label} is not a valid closed linear ring`);
  return normalized;
}

function normalizeGeometry(geometry: unknown): PolygonGeometry {
  if (!geometry || typeof geometry !== 'object') throw new Error('GeoJSON geometry is missing');
  const candidate = geometry as PolygonGeometry;
  if (candidate.type === 'Polygon') {
    if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) {
      throw new Error('Polygon must contain at least one ring');
    }
    return {
      type: 'Polygon',
      coordinates: candidate.coordinates.map((ring, index) => normalizeRing(ring, `Polygon ring ${index}`)),
    };
  }
  if (candidate.type === 'MultiPolygon') {
    if (!Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) {
      throw new Error('MultiPolygon must contain at least one polygon');
    }
    return {
      type: 'MultiPolygon',
      coordinates: candidate.coordinates.map((polygonCoordinates, polygonIndex) => {
        if (!Array.isArray(polygonCoordinates) || polygonCoordinates.length === 0) {
          throw new Error(`MultiPolygon part ${polygonIndex} must contain at least one ring`);
        }
        return polygonCoordinates.map((ring, ringIndex) => (
          normalizeRing(ring, `MultiPolygon part ${polygonIndex} ring ${ringIndex}`)
        ));
      }),
    };
  }
  throw new Error(`Expected Polygon or MultiPolygon, got ${(geometry as { type?: unknown }).type ?? 'unknown'}`);
}

export function parsePolygonGeoJson(value: unknown): PolygonFeature {
  if (!value || typeof value !== 'object') throw new Error('GeoJSON root must be an object');
  const root = value as GeoJsonObject & { crs?: unknown };
  validateCrs(root);

  if (root.type === 'FeatureCollection') {
    const collection = root as FeatureCollection;
    if (collection.features.length !== 1) {
      throw new Error(`FeatureCollection must contain exactly one feature; received ${collection.features.length}`);
    }
    return feature(normalizeGeometry(collection.features[0].geometry), collection.features[0].properties ?? {});
  }
  if (root.type === 'Feature') {
    const inputFeature = root as Feature;
    return feature(normalizeGeometry(inputFeature.geometry), inputFeature.properties ?? {});
  }
  return feature(normalizeGeometry(root));
}

export function parsePolygonFeatureCollection(value: unknown): PolygonFeature[] {
  if (!value || typeof value !== 'object') throw new Error('GeoJSON root must be an object');
  const root = value as FeatureCollection & { crs?: unknown };
  validateCrs(root);
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features)) {
    throw new Error('OSM building input must be a GeoJSON FeatureCollection');
  }
  if (root.features.length === 0) throw new Error('OSM building FeatureCollection is empty');
  return root.features.map((inputFeature, index) => {
    try {
      return feature(normalizeGeometry(inputFeature.geometry), inputFeature.properties ?? {});
    } catch (error) {
      throw new Error(`Invalid building feature at index ${index}: ${error instanceof Error ? error.message : error}`);
    }
  });
}

export function loadPolygonFeatureCollection(filePath: string): PolygonFeature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read GeoJSON ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
  return parsePolygonFeatureCollection(parsed);
}

export function combinePolygonFeatures(features: PolygonFeature[]): PolygonFeature {
  const coordinates: MultiPolygon['coordinates'] = [];
  for (const item of features) {
    if (item.geometry.type === 'Polygon') coordinates.push(item.geometry.coordinates);
    else coordinates.push(...item.geometry.coordinates);
  }
  return feature({ type: 'MultiPolygon', coordinates });
}

export function bufferPolygonFeatureMeters(input: PolygonFeature, distanceMeters: number): PolygonFeature {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error(`Buffer distance must be a finite non-negative number; received ${distanceMeters}`);
  }
  if (distanceMeters === 0) return input;
  const buffered = turfBuffer(input, distanceMeters, { units: 'meters', steps: 8 });
  if (!buffered || (buffered.geometry.type !== 'Polygon' && buffered.geometry.type !== 'MultiPolygon')) {
    throw new Error('Unable to create a polygonal metric buffer for the building feature');
  }
  return buffered as PolygonFeature;
}

export function loadPolygonGeoJson(filePath: string): PolygonFeature {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read GeoJSON ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
  return parsePolygonGeoJson(parsed);
}

export function visitPositions(geometry: PolygonGeometry, visitor: (position: Position) => void): void {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygonCoordinates of polygons) {
    for (const ring of polygonCoordinates) {
      for (const position of ring) visitor(position);
    }
  }
}

export function getGeometryBbox(geometry: PolygonGeometry): LatLonBbox {
  const bbox: LatLonBbox = {
    minLon: Number.POSITIVE_INFINITY,
    minLat: Number.POSITIVE_INFINITY,
    maxLon: Number.NEGATIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
  };
  visitPositions(geometry, position => {
    bbox.minLon = Math.min(bbox.minLon, position[0]);
    bbox.minLat = Math.min(bbox.minLat, position[1]);
    bbox.maxLon = Math.max(bbox.maxLon, position[0]);
    bbox.maxLat = Math.max(bbox.maxLat, position[1]);
  });
  return bbox;
}
