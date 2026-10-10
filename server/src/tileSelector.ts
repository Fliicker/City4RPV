import fs from 'node:fs';
import path from 'node:path';
import { booleanIntersects } from '@turf/boolean-intersects';
import { polygon } from '@turf/helpers';
import type { PolygonFeature } from './geojson';
import { getGeometryBbox } from './geojson';
import {
  getIntersectingHorizontalOctantPaths,
  getOctantLatLonBox,
  normalizeOctantHorizontalPath,
  octantBoxToRing,
} from './octantTile';

export type SelectedTile = {
  tileId: string;
  b3dmPath: string;
  scope: number[][];
};

function buildAvailableHorizontalTileMap(levelDir: string, level: number): {
  map: Map<string, string[]>;
  prefixes: Set<string>;
} {
  const map = new Map<string, string[]>();
  const prefixes = new Set<string>();
  for (const file of fs.readdirSync(levelDir, { withFileTypes: true })) {
    if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.b3dm') continue;
    const tileId = path.basename(file.name, path.extname(file.name));
    if (tileId.length !== level || !/^[0-7]+$/.test(tileId)) continue;
    const horizontalPath = normalizeOctantHorizontalPath(tileId);
    for (let index = 2; index <= horizontalPath.length; index += 1) {
      prefixes.add(horizontalPath.slice(0, index));
    }
    const existing = map.get(horizontalPath);
    if (existing) existing.push(tileId);
    else map.set(horizontalPath, [tileId]);
  }
  for (const tileIds of map.values()) tileIds.sort();
  return { map, prefixes };
}

export function selectTiles(tilesDir: string, level: number, bound: PolygonFeature): SelectedTile[] {
  const levelDir = path.join(tilesDir, String(level));
  if (!fs.existsSync(levelDir) || !fs.statSync(levelDir).isDirectory()) {
    throw new Error(`3D Tiles level directory not found: ${levelDir}`);
  }
  const { map: available, prefixes } = buildAvailableHorizontalTileMap(levelDir, level);
  if (available.size === 0) throw new Error(`No .b3dm files found in ${levelDir}`);

  const horizontalPaths = getIntersectingHorizontalOctantPaths(getGeometryBbox(bound.geometry), level, {
    hasPrefix: prefix => prefixes.has(prefix),
  }).filter(horizontalPath => available.has(horizontalPath));

  const selected: SelectedTile[] = [];
  for (const horizontalPath of horizontalPaths) {
    for (const tileId of available.get(horizontalPath) ?? []) {
      const box = getOctantLatLonBox(tileId);
      const ring = octantBoxToRing(box);
      if (booleanIntersects(bound, polygon([ring]))) {
        selected.push({
          tileId,
          b3dmPath: path.join(levelDir, `${tileId}.b3dm`),
          scope: ring.slice(0, -1),
        });
      }
    }
  }
  return selected.sort((a, b) => a.tileId.localeCompare(b.tileId));
}

export function filterSelectedTiles(tiles: SelectedTile[], bound: PolygonFeature): SelectedTile[] {
  return tiles.filter(tile => {
    const closedRing = [...tile.scope, tile.scope[0]];
    return booleanIntersects(bound, polygon([closedRing]));
  });
}

export function readRootTransform(tilesDir: string): number[] {
  const tilesetPath = path.join(tilesDir, 'tileset.json');
  if (!fs.existsSync(tilesetPath)) throw new Error(`tileset.json not found: ${tilesetPath}`);
  const parsed = JSON.parse(fs.readFileSync(tilesetPath, 'utf8')) as {
    root?: { transform?: unknown };
  };
  const transform = parsed.root?.transform;
  if (!Array.isArray(transform) || transform.length !== 16 || transform.some(value => !Number.isFinite(value))) {
    throw new Error(`Expected a 16-number root.transform in ${tilesetPath}`);
  }
  return transform as number[];
}
