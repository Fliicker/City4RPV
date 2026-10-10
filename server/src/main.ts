import path from 'node:path';
import { runExtraction, type ExtractionOptions } from './pipeline';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Edit these values directly, then run `npm run extract`.
 * No command-line arguments are required or read.
 */
const CONFIG: ExtractionOptions = {
  // OSM building FeatureCollection in EPSG:4326. Each feature needs a unique full_id.
  osmBuildingsPath: path.join(PROJECT_ROOT, 'tests', 'osm', 'Munich_building2.geojson'),

  // Exact source tile level. Supported values: 13 through 19.
  level: 19,

  // Expand every OSM building footprint by this distance before clipping.
  bufferMeters: 2,

  // Directory containing tileset.json and the 13..19 subdirectories.
  tilesDir: 'E:\\data\\Google3DTile\\Cities\\Munich',

  // Persistent per-tile OBJ cache and dataset output root.
  tempDir: path.join(PROJECT_ROOT, 'temp'),
  outputDir: path.join(PROJECT_ROOT, 'output', 'Munich_building2'),

  // Number of b3dm preparation workers.
  concurrency: 4,

  // true replaces an existing output directory; false fails safely if it exists.
  overwrite: true,
};

runExtraction(CONFIG, PROJECT_ROOT).catch(error => {
  console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
