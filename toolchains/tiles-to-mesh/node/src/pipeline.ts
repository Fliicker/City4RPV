import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EnuTransform, polygonFeatureToEnu } from './coordinates';
import { ensureTileObjs } from './conversion';
import {
  bufferPolygonFeatureMeters,
  combinePolygonFeatures,
  getGeometryBbox,
  loadPolygonFeatureCollection,
  type PolygonFeature,
} from './geojson';
import { mergeTexturedObjs, type MergeResult } from './objMerge';
import { filterSelectedTiles, readRootTransform, selectTiles, type SelectedTile } from './tileSelector';

export type ExtractionOptions = {
  osmBuildingsPath: string;
  level: number;
  bufferMeters: number;
  tilesDir: string;
  tempDir: string;
  outputDir: string;
  concurrency: number;
  overwrite: boolean;
};

type BuildingJob = {
  fullId: string;
  sourceFeature: PolygonFeature;
  clipFeature: PolygonFeature;
  tiles: SelectedTile[];
};

function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const childPath = normalizedPath(candidate);
  const parentPath = normalizedPath(parent);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

function pathsOverlap(first: string, second: string): boolean {
  return isSameOrDescendant(first, second) || isSameOrDescendant(second, first);
}

function assertInputs(options: ExtractionOptions, projectRoot: string): void {
  if (!Number.isInteger(options.level) || options.level < 13 || options.level > 19) {
    throw new Error('Configured level must be an integer from 13 through 19');
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32) {
    throw new Error('Configured concurrency must be an integer from 1 through 32');
  }
  if (!Number.isFinite(options.bufferMeters) || options.bufferMeters < 0) {
    throw new Error('Configured bufferMeters must be a finite non-negative number');
  }
  if (!fs.existsSync(options.osmBuildingsPath) || !fs.statSync(options.osmBuildingsPath).isFile()) {
    throw new Error(`OSM building GeoJSON not found: ${options.osmBuildingsPath}`);
  }
  if (!fs.existsSync(options.tilesDir) || !fs.statSync(options.tilesDir).isDirectory()) {
    throw new Error(`3D Tiles directory not found: ${options.tilesDir}`);
  }
  if (fs.existsSync(options.outputDir) && !options.overwrite) {
    throw new Error(`Output directory already exists; set overwrite=true in main.ts to replace it: ${options.outputDir}`);
  }
  if (isSameOrDescendant(projectRoot, options.outputDir)) {
    throw new Error(`Output directory must not be the project root or one of its ancestors: ${options.outputDir}`);
  }
  if (pathsOverlap(options.outputDir, options.tilesDir)) {
    throw new Error('Output directory must not overlap the source 3D Tiles directory');
  }
  if (pathsOverlap(options.outputDir, options.tempDir)) {
    throw new Error('Output directory must not overlap the persistent tile cache directory');
  }
  if (isSameOrDescendant(options.osmBuildingsPath, options.outputDir)) {
    throw new Error('Output directory must not contain the input OSM GeoJSON file');
  }
  if (pathsOverlap(options.tempDir, options.tilesDir)) {
    throw new Error('Persistent tile cache directory must not overlap the source 3D Tiles directory');
  }
}

function formatElapsed(startedAt: number): string {
  return `${((Date.now() - startedAt) / 1000).toFixed(2)}s`;
}

function isAccessError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES');
}

async function replaceOutputDirectory(stagingDir: string, outputDir: string): Promise<void> {
  const backupDir = `${outputDir}.previous-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let previousOutputMoved = false;
  try {
    if (fs.existsSync(outputDir)) {
      try {
        await renameDirectoryWithRetry(outputDir, backupDir);
        previousOutputMoved = true;
      } catch (error) {
        if (!isAccessError(error)) throw error;
        // Some Windows processes keep directory handles open and prevent a directory
        // rename even though its contents remain writable. Keep a recoverable copy,
        // then replace the tree in place only for this access-error fallback.
        fs.cpSync(outputDir, backupDir, { recursive: true, errorOnExist: true });
        previousOutputMoved = true;
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    }
    try {
      await renameDirectoryWithRetry(stagingDir, outputDir);
    } catch (error) {
      if (!isAccessError(error)) throw error;
      fs.cpSync(stagingDir, outputDir, { recursive: true, errorOnExist: true });
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (previousOutputMoved && fs.existsSync(backupDir)) {
      try {
        if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
        try {
          await renameDirectoryWithRetry(backupDir, outputDir);
        } catch (restoreError) {
          if (!isAccessError(restoreError)) throw restoreError;
          fs.cpSync(backupDir, outputDir, { recursive: true, errorOnExist: true });
        }
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], 'Output replacement and backup restoration both failed');
      }
    }
    throw error;
  }
  if (fs.existsSync(backupDir)) {
    try {
      fs.rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Previous output could not be removed and remains at ${backupDir}: ${error}`);
    }
  }
}

async function renameDirectoryWithRetry(source: string, target: string): Promise<void> {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.promises.rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 7 || !code || !retryable.has(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

function readFullId(feature: PolygonFeature, index: number, seen: Set<string>): string {
  const value = feature.properties?.full_id;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Building feature at index ${index} has no non-empty string properties.full_id`);
  }
  const fullId = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(fullId) || fullId === '.' || fullId === '..') {
    throw new Error(`Building full_id cannot be used safely as a directory name: ${fullId}`);
  }
  if (seen.has(fullId)) throw new Error(`Duplicate building full_id: ${fullId}`);
  seen.add(fullId);
  return fullId;
}

function buildJobs(
  sourceFeatures: PolygonFeature[],
  clipFeatures: PolygonFeature[],
  selectedTiles: SelectedTile[],
): BuildingJob[] {
  const seen = new Set<string>();
  return sourceFeatures.map((sourceFeature, index) => {
    const fullId = readFullId(sourceFeature, index, seen);
    const clipFeature = clipFeatures[index];
    const tiles = filterSelectedTiles(selectedTiles, clipFeature);
    if (tiles.length === 0) {
      throw new Error(`Building ${fullId} does not intersect any available tile at the configured level`);
    }
    return { fullId, sourceFeature, clipFeature, tiles };
  });
}

function writeBuildingMetadata(options: {
  outputDir: string;
  sourcePath: string;
  level: number;
  bufferMeters: number;
  tilesDir: string;
  job: BuildingJob;
  rootTransform: number[];
  transform: EnuTransform;
  mergeResult: MergeResult;
  cacheHits: Set<string>;
}): void {
  const {
    outputDir, sourcePath, level, bufferMeters, tilesDir, job, rootTransform, transform, mergeResult, cacheHits,
  } = options;
  const sourceBbox = getGeometryBbox(job.sourceFeature.geometry);
  const clipBbox = getGeometryBbox(job.clipFeature.geometry);
  const metadata = {
    formatVersion: 3,
    createdAt: new Date().toISOString(),
    building: {
      fullId: job.fullId,
      properties: job.sourceFeature.properties ?? {},
      sourceGeojsonPath: sourcePath,
      crs: 'EPSG:4326',
      bbox: [sourceBbox.minLon, sourceBbox.minLat, sourceBbox.maxLon, sourceBbox.maxLat],
    },
    input: { level, tilesDir },
    outputCoordinates: {
      type: 'local_ENU',
      units: 'metres',
      axes: { x: 'east', y: 'north', z: 'up' },
      originWgs84: transform.originLonLatHeight,
      originEcef: transform.originEcef,
      ecefToEnuRotationRowMajor: transform.ecefToEnu,
      tilesetLocalToEcefColumnMajor: rootTransform,
      tilesetLocalToEnuColumnMajor: transform.sourceLocalToEnuMatrix4ColumnMajor(),
    },
    clipping: {
      mode: 'clip_triangles_to_buffered_footprint',
      bufferMeters,
      bufferedBbox: [clipBbox.minLon, clipBbox.minLat, clipBbox.maxLon, clipBbox.maxLat],
      note: 'The source footprint is buffered before clipping. Boundary-crossing triangles are cut with interpolated positions, texture coordinates, and normals.',
      spatialIndexBuilt: false,
    },
    tiles: {
      selected: job.tiles.map(tile => ({
        tileId: tile.tileId,
        scope: tile.scope,
        cacheHit: cacheHits.has(tile.tileId),
      })),
      retained: mergeResult.retainedTiles,
    },
    mesh: {
      obj: 'model.obj',
      mtl: 'model.mtl',
      texturesDirectory: 'textures',
      ...mergeResult,
    },
  };
  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
}

function writeBuildingManifest(options: {
  outputDir: string;
  job: BuildingJob;
}): void {
  const { outputDir, job } = options;
  const manifest = {
    schemaVersion: 1,
    artifactType: 'textured-mesh',
    buildingId: job.fullId,
    obj: 'model.obj',
    mtl: 'model.mtl',
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

export async function runExtraction(options: ExtractionOptions, projectRoot: string): Promise<void> {
  assertInputs(options, projectRoot);
  const totalStartedAt = Date.now();
  const sourceFeatures = loadPolygonFeatureCollection(options.osmBuildingsPath);
  const clipFeatures = sourceFeatures.map((feature, index) => {
    try {
      return bufferPolygonFeatureMeters(feature, options.bufferMeters);
    } catch (error) {
      const id = feature.properties?.full_id ?? `index ${index}`;
      throw new Error(`Unable to buffer building ${id}: ${error instanceof Error ? error.message : error}`);
    }
  });
  const combinedFootprint = combinePolygonFeatures(clipFeatures);

  const selectionStartedAt = Date.now();
  const selectedTiles = selectTiles(options.tilesDir, options.level, combinedFootprint);
  if (selectedTiles.length === 0) {
    throw new Error('The OSM building dataset does not intersect any available tile at the configured level');
  }
  const jobs = buildJobs(sourceFeatures, clipFeatures, selectedTiles);
  console.log(
    `[1/3] loaded ${jobs.length} building(s) and selected ${selectedTiles.length} unique tile(s) `
    + `in ${formatElapsed(selectionStartedAt)}`,
  );

  const conversionStartedAt = Date.now();
  const cachedTiles = await ensureTileObjs({
    tiles: selectedTiles,
    level: options.level,
    tempDir: options.tempDir,
    concurrency: options.concurrency,
    projectRoot,
  });
  const cachedById = new Map(cachedTiles.map(tile => [tile.tileId, tile]));
  const cacheHitIds = new Set(cachedTiles.filter(tile => tile.cacheHit).map(tile => tile.tileId));
  console.log(
    `[2/3] tile OBJ cache ready in ${formatElapsed(conversionStartedAt)} `
    + `(cached=${cacheHitIds.size}, converted=${cachedTiles.length - cacheHitIds.size})`,
  );

  const rootTransform = readRootTransform(options.tilesDir);
  const outputParent = path.dirname(options.outputDir);
  fs.mkdirSync(outputParent, { recursive: true });
  const stagingDir = path.join(
    outputParent,
    `.${path.basename(options.outputDir)}.staging-${process.pid}-${crypto.randomBytes(4).toString('hex')}`,
  );
  if (fs.existsSync(stagingDir)) throw new Error(`Unexpected staging-directory collision: ${stagingDir}`);

  const summaries: Array<{ fullId: string; tileCount: number; faceCount: number }> = [];
  try {
    fs.mkdirSync(stagingDir, { recursive: true });
    const extractionStartedAt = Date.now();
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      const bbox = getGeometryBbox(job.clipFeature.geometry);
      const origin: [number, number, number] = [
        (bbox.minLon + bbox.maxLon) / 2,
        (bbox.minLat + bbox.maxLat) / 2,
        0,
      ];
      const transform = new EnuTransform(rootTransform, origin);
      const outputDir = path.join(stagingDir, job.fullId);
      const tileObjs = job.tiles.map(tile => {
        const cached = cachedById.get(tile.tileId);
        if (!cached) throw new Error(`No converted OBJ available for tile ${tile.tileId}`);
        return cached;
      });
      const mergeResult = mergeTexturedObjs({
        tiles: tileObjs,
        outputDir,
        clipFeature: polygonFeatureToEnu(job.clipFeature, transform),
        transform,
      });
      if (mergeResult.faceCount === 0) {
        throw new Error(`Building ${job.fullId} intersects source tiles but produced no mesh triangles`);
      }
      writeBuildingMetadata({
        outputDir,
        sourcePath: options.osmBuildingsPath,
        level: options.level,
        bufferMeters: options.bufferMeters,
        tilesDir: options.tilesDir,
        job,
        rootTransform,
        transform,
        mergeResult,
        cacheHits: cacheHitIds,
      });
      writeBuildingManifest({
        outputDir,
        job,
      });
      summaries.push({ fullId: job.fullId, tileCount: job.tiles.length, faceCount: mergeResult.faceCount });
      if ((index + 1) % 10 === 0 || index + 1 === jobs.length) {
        console.log(`[3/3] extracted ${index + 1}/${jobs.length} building mesh(es)`);
      }
    }

    fs.writeFileSync(path.join(stagingDir, 'metadata.json'), JSON.stringify({
      formatVersion: 3,
      createdAt: new Date().toISOString(),
      sourceGeojsonPath: options.osmBuildingsPath,
      level: options.level,
      bufferMeters: options.bufferMeters,
      featureCount: jobs.length,
      selectedTileCount: selectedTiles.length,
      cacheHits: cacheHitIds.size,
      convertedTiles: cachedTiles.length - cacheHitIds.size,
      outputs: summaries,
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      artifactType: 'textured-mesh-dataset',
      buildings: summaries.map(item => ({
        buildingId: item.fullId,
        manifest: `${item.fullId}/manifest.json`,
      })),
    }, null, 2), 'utf8');

    await replaceOutputDirectory(stagingDir, options.outputDir);
    console.log(`[3/3] building meshes finished in ${formatElapsed(extractionStartedAt)}`);
    console.log(`Output root: ${options.outputDir}`);
    console.log(`Done in ${formatElapsed(totalStartedAt)}`);
  } catch (error) {
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
