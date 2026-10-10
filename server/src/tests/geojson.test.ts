import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePolygonFeatureCollection, parsePolygonGeoJson } from '../geojson';

test('GeoJSON parser closes an open polygon ring', () => {
  const parsed = parsePolygonGeoJson({
    type: 'Feature',
    properties: null,
    geometry: {
      type: 'Polygon',
      coordinates: [[[11, 48], [12, 48], [12, 49], [11, 49]]],
    },
  });
  assert.deepEqual(parsed.geometry.coordinates[0][0], parsed.geometry.coordinates[0].at(-1));
});

test('GeoJSON parser rejects multiple features and non-polygon geometry', () => {
  assert.throws(() => parsePolygonGeoJson({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
    ],
  }), /exactly one feature/);
  assert.throws(() => parsePolygonGeoJson({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [[11, 48], [12, 49]] },
  }), /Expected Polygon or MultiPolygon/);
});

test('GeoJSON parser rejects an explicitly incompatible CRS', () => {
  assert.throws(() => parsePolygonGeoJson({
    type: 'Feature',
    crs: { type: 'name', properties: { name: 'EPSG:3857' } },
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[11, 48], [12, 48], [12, 49], [11, 48]]],
    },
  }), /Only EPSG:4326/);
});

test('OSM collection parser preserves multiple polygon features and properties', () => {
  const features = parsePolygonFeatureCollection({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { full_id: 'w1' },
        geometry: { type: 'Polygon', coordinates: [[[11, 48], [12, 48], [12, 49], [11, 48]]] },
      },
      {
        type: 'Feature',
        properties: { full_id: 'r2' },
        geometry: { type: 'MultiPolygon', coordinates: [[[[13, 48], [14, 48], [14, 49], [13, 48]]]] },
      },
    ],
  });
  assert.equal(features.length, 2);
  assert.deepEqual(features.map(item => item.properties?.full_id), ['w1', 'r2']);
  assert.deepEqual(features.map(item => item.geometry.type), ['Polygon', 'MultiPolygon']);
});
