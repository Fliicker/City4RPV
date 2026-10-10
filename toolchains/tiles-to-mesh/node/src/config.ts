import path from 'node:path';
import type { ExtractionOptions } from './pipeline';

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** Edit these values directly, then run `npm run tiles-to-mesh:run` from the repository root. */
export const CONFIG: ExtractionOptions = {
  osmBuildingsPath: path.join(PROJECT_ROOT, 'tests', 'osm', 'Munich_building2.geojson'),
  level: 19,
  bufferMeters: 2,
  tilesDir: 'E:\\data\\Google3DTile\\Cities\\Munich',
  tempDir: path.join(PROJECT_ROOT, 'artifacts', 'tile-cache'),
  outputDir: path.join(PROJECT_ROOT, 'artifacts', 'meshes', 'Munich_building2'),
  concurrency: 4,
  overwrite: true,
};
