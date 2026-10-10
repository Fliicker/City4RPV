import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EnuTransform, polygonFeatureToEnu } from '../coordinates';
import { ensureTileObjs } from '../conversion';
import {
  combinePolygonFeatures,
  getGeometryBbox,
  loadPolygonFeatureCollection,
  loadPolygonGeoJson,
} from '../geojson';
import { mergeTexturedObjs } from '../objMerge';
import { readRootTransform, selectTiles } from '../tileSelector';

const tilesDir = process.env.MUNICH_TILES_DIR;
const projectRoot = path.resolve(__dirname, '..', '..', '..');

test('Munich level-13 and level-19 samples convert, clip, texture, and reuse their tile caches', {
  skip: !tilesDir,
  timeout: 120_000,
}, async () => {
  const input = loadPolygonGeoJson(path.join(projectRoot, 'tests', 'fixtures', 'munich_level19_sample.geojson'));
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'city4rpv-cache-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'city4rpv-output-'));
  try {
    const bbox = getGeometryBbox(input.geometry);
    const transform = new EnuTransform(readRootTransform(tilesDir!), [
      (bbox.minLon + bbox.maxLon) / 2,
      (bbox.minLat + bbox.maxLat) / 2,
      0,
    ]);
    for (const level of [13, 19]) {
      const tiles = selectTiles(tilesDir!, level, input);
      assert.ok(tiles.length > 0);
      const first = await ensureTileObjs({ tiles, level, tempDir: cacheDir, concurrency: 1, projectRoot });
      assert.equal(first.every(tile => !tile.cacheHit), true);
      const second = await ensureTileObjs({ tiles, level, tempDir: cacheDir, concurrency: 1, projectRoot });
      assert.equal(second.every(tile => tile.cacheHit), true);
      const levelOutputDir = path.join(outputDir, String(level));
      const result = mergeTexturedObjs({
        tiles: second,
        outputDir: levelOutputDir,
        clipFeature: polygonFeatureToEnu(input, transform),
        transform,
      });
      assert.ok(result.faceCount > 0);
      assert.ok(result.textureCount > 0);
      assert.equal(fs.existsSync(path.join(levelOutputDir, 'model.obj')), true);
      assert.equal(fs.existsSync(path.join(levelOutputDir, 'model.mtl')), true);
    }
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Munich OSM building dataset resolves all features and shared level-19 tiles', {
  skip: !tilesDir,
  timeout: 30_000,
}, () => {
  const features = loadPolygonFeatureCollection(
    path.join(projectRoot, 'tests', 'osm', 'Munich_building2.geojson'),
  );
  assert.equal(features.length, 172);
  assert.equal(new Set(features.map(item => item.properties?.full_id)).size, 172);
  const tiles = selectTiles(tilesDir!, 19, combinePolygonFeatures(features));
  assert.equal(tiles.length, 39);
});
