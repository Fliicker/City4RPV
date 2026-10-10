import fs from 'node:fs';
import path from 'node:path';
import { booleanIntersects } from '@turf/boolean-intersects';
import { lineString, point, polygon } from '@turf/helpers';
import type { PolygonFeature } from './geojson';
import type { EnuTransform, Vec3 } from './coordinates';
import { getGeometryBbox } from './geojson';

type ObjReference = { v: number; vt?: number; vn?: number };
type ObjFace = { refs: [ObjReference, ObjReference, ObjReference]; material: string | null };

export type ParsedObj = {
  vertices: Vec3[];
  textureCoordinates: number[][];
  normals: Vec3[];
  faces: ObjFace[];
  materialLibraries: string[];
};

type MtlBlock = { name: string; lines: string[]; sourceDir: string };

export type MergeResult = {
  vertexCount: number;
  textureCoordinateCount: number;
  normalCount: number;
  faceCount: number;
  materialCount: number;
  textureCount: number;
  retainedTiles: string[];
};

function parseNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number '${value}' in ${label}`);
  return parsed;
}

function resolveObjIndex(raw: string, count: number, label: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed === 0) throw new Error(`Invalid ${label} index '${raw}'`);
  const resolved = parsed > 0 ? parsed - 1 : count + parsed;
  if (resolved < 0 || resolved >= count) {
    throw new Error(`${label} index '${raw}' resolves outside 1..${count}`);
  }
  return resolved;
}

function parseReference(token: string, counts: { v: number; vt: number; vn: number }): ObjReference {
  const parts = token.split('/');
  if (parts.length > 3 || !parts[0]) throw new Error(`Invalid OBJ face reference '${token}'`);
  const reference: ObjReference = { v: resolveObjIndex(parts[0], counts.v, 'vertex') };
  if (parts.length >= 2 && parts[1]) reference.vt = resolveObjIndex(parts[1], counts.vt, 'texture coordinate');
  if (parts.length === 3 && parts[2]) reference.vn = resolveObjIndex(parts[2], counts.vn, 'normal');
  return reference;
}

export function parseObj(content: string): ParsedObj {
  const result: ParsedObj = {
    vertices: [],
    textureCoordinates: [],
    normals: [],
    faces: [],
    materialLibraries: [],
  };
  let currentMaterial: string | null = null;
  for (const [lineIndex, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const keyword = parts.shift();
    const label = `OBJ line ${lineIndex + 1}`;
    if (keyword === 'v') {
      if (parts.length < 3) throw new Error(`${label}: vertex requires three values`);
      result.vertices.push([
        parseNumber(parts[0], label),
        parseNumber(parts[1], label),
        parseNumber(parts[2], label),
      ]);
    } else if (keyword === 'vt') {
      if (parts.length < 2) throw new Error(`${label}: texture coordinate requires at least two values`);
      result.textureCoordinates.push(parts.map(value => parseNumber(value, label)));
    } else if (keyword === 'vn') {
      if (parts.length < 3) throw new Error(`${label}: normal requires three values`);
      result.normals.push([
        parseNumber(parts[0], label),
        parseNumber(parts[1], label),
        parseNumber(parts[2], label),
      ]);
    } else if (keyword === 'usemtl') {
      currentMaterial = parts.join(' ') || null;
    } else if (keyword === 'mtllib') {
      const library = parts.join(' ');
      if (library) result.materialLibraries.push(library);
    } else if (keyword === 'f') {
      if (parts.length < 3) throw new Error(`${label}: face requires at least three references`);
      const counts = {
        v: result.vertices.length,
        vt: result.textureCoordinates.length,
        vn: result.normals.length,
      };
      const refs = parts.map(token => parseReference(token, counts));
      for (let index = 1; index + 1 < refs.length; index += 1) {
        result.faces.push({
          refs: [refs[0], refs[index], refs[index + 1]],
          material: currentMaterial,
        });
      }
    }
  }
  return result;
}

function triangleDoubleArea2d(points: Vec3[]): number {
  return Math.abs(
    (points[1][0] - points[0][0]) * (points[2][1] - points[0][1])
    - (points[2][0] - points[0][0]) * (points[1][1] - points[0][1]),
  );
}

export function projectedTriangleIntersects(
  points: [Vec3, Vec3, Vec3],
  clipFeature: PolygonFeature,
  clipBbox = getGeometryBbox(clipFeature.geometry),
): boolean {
  const minX = Math.min(points[0][0], points[1][0], points[2][0]);
  const minY = Math.min(points[0][1], points[1][1], points[2][1]);
  const maxX = Math.max(points[0][0], points[1][0], points[2][0]);
  const maxY = Math.max(points[0][1], points[1][1], points[2][1]);
  if (maxX < clipBbox.minLon || minX > clipBbox.maxLon || maxY < clipBbox.minLat || minY > clipBbox.maxLat) {
    return false;
  }

  if (triangleDoubleArea2d(points) > 1e-10) {
    const ring = points.map(value => [value[0], value[1]]) as number[][];
    ring.push([...ring[0]]);
    return booleanIntersects(clipFeature, polygon([ring]));
  }

  const pairs: Array<[number, number]> = [[0, 1], [1, 2], [2, 0]];
  let farthest: [number, number] = pairs[0];
  let maxDistanceSquared = -1;
  for (const pair of pairs) {
    const dx = points[pair[0]][0] - points[pair[1]][0];
    const dy = points[pair[0]][1] - points[pair[1]][1];
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > maxDistanceSquared) {
      maxDistanceSquared = distanceSquared;
      farthest = pair;
    }
  }
  if (maxDistanceSquared > 1e-16) {
    return booleanIntersects(clipFeature, lineString([
      [points[farthest[0]][0], points[farthest[0]][1]],
      [points[farthest[1]][0], points[farthest[1]][1]],
    ]));
  }
  return booleanIntersects(clipFeature, point([points[0][0], points[0][1]]));
}

function loadMtlBlocks(objPath: string, libraries: string[]): Map<string, MtlBlock> {
  const blocks = new Map<string, MtlBlock>();
  for (const library of libraries) {
    const mtlPath = path.resolve(path.dirname(objPath), library);
    const relative = path.relative(path.dirname(objPath), mtlPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`MTL path escapes tile cache directory: ${library}`);
    }
    if (!fs.existsSync(mtlPath)) throw new Error(`Referenced MTL file not found: ${mtlPath}`);
    let current: MtlBlock | null = null;
    for (const rawLine of fs.readFileSync(mtlPath, 'utf8').split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('newmtl ')) {
        const name = trimmed.slice('newmtl '.length).trim();
        current = { name, lines: [], sourceDir: path.dirname(mtlPath) };
        blocks.set(name, current);
      } else if (current && trimmed && !trimmed.startsWith('#')) {
        current.lines.push(trimmed);
      }
    }
  }
  return blocks;
}

function safeName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]+/g, '_');
  return sanitized || 'material';
}

const TEXTURE_DIRECTIVES = new Set([
  'map_Ka', 'map_Kd', 'map_Ks', 'map_Ns', 'map_d', 'decal', 'disp', 'bump', 'map_Bump',
]);

function rewriteMaterial(
  block: MtlBlock | undefined,
  uniqueName: string,
  tileId: string,
  texturesDir: string,
  outputDir: string,
  copiedTextures: Set<string>,
): string[] {
  const output = [`newmtl ${uniqueName}`];
  if (!block) {
    output.push('Ka 0.400000 0.400000 0.400000', 'Kd 1.000000 1.000000 1.000000', 'illum 1', '');
    return output;
  }
  for (const line of block.lines) {
    const tokens = line.split(/\s+/);
    if (!TEXTURE_DIRECTIVES.has(tokens[0]) || tokens.length < 2) {
      output.push(line);
      continue;
    }
    const textureReference = tokens[tokens.length - 1];
    const sourcePath = path.resolve(block.sourceDir, textureReference);
    const relativeSource = path.relative(block.sourceDir, sourcePath);
    if (relativeSource.startsWith('..') || path.isAbsolute(relativeSource)) {
      throw new Error(`Texture path escapes its MTL directory: ${textureReference}`);
    }
    if (!fs.existsSync(sourcePath)) throw new Error(`Referenced texture not found: ${sourcePath}`);
    const outputName = `${safeName(tileId)}_${safeName(path.basename(sourcePath))}`;
    const targetPath = path.join(texturesDir, outputName);
    if (!copiedTextures.has(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
      copiedTextures.add(targetPath);
    }
    tokens[tokens.length - 1] = path.relative(outputDir, targetPath).replace(/\\/g, '/');
    output.push(tokens.join(' '));
  }
  output.push('');
  return output;
}

function formatNumber(value: number): string {
  if (Math.abs(value) < 5e-13) return '0';
  return Number(value.toFixed(9)).toString();
}

function formatReference(ref: ObjReference, maps: {
  vertices: Map<number, number>;
  textureCoordinates: Map<number, number>;
  normals: Map<number, number>;
}): string {
  const vertex = maps.vertices.get(ref.v);
  if (!vertex) throw new Error('Internal OBJ merge error: missing vertex mapping');
  const texture = ref.vt === undefined ? undefined : maps.textureCoordinates.get(ref.vt);
  const normal = ref.vn === undefined ? undefined : maps.normals.get(ref.vn);
  if (texture !== undefined && normal !== undefined) return `${vertex}/${texture}/${normal}`;
  if (texture !== undefined) return `${vertex}/${texture}`;
  if (normal !== undefined) return `${vertex}//${normal}`;
  return String(vertex);
}

export function mergeTexturedObjs(options: {
  tiles: Array<{ tileId: string; objPath: string }>;
  outputDir: string;
  clipFeature: PolygonFeature;
  transform: EnuTransform;
}): MergeResult {
  const { tiles, outputDir, clipFeature, transform } = options;
  fs.mkdirSync(outputDir, { recursive: true });
  const texturesDir = path.join(outputDir, 'textures');
  fs.mkdirSync(texturesDir, { recursive: true });
  const objOutputPath = path.join(outputDir, 'model.obj');
  const mtlOutputPath = path.join(outputDir, 'model.mtl');
  fs.writeFileSync(objOutputPath, 'mtllib model.mtl\n', 'utf8');
  fs.writeFileSync(mtlOutputPath, '# City4RPV merged materials\n\n', 'utf8');

  const clipBbox = getGeometryBbox(clipFeature.geometry);
  const copiedTextures = new Set<string>();
  const retainedTiles: string[] = [];
  let nextVertex = 1;
  let nextTextureCoordinate = 1;
  let nextNormal = 1;
  let faceCount = 0;
  let materialCount = 0;

  for (const tile of tiles) {
    const parsed = parseObj(fs.readFileSync(tile.objPath, 'utf8'));
    const transformedVertices = parsed.vertices.map(vertex => transform.sourcePositionToEnu(vertex));
    const selectedFaces = parsed.faces.filter(face => projectedTriangleIntersects([
      transformedVertices[face.refs[0].v],
      transformedVertices[face.refs[1].v],
      transformedVertices[face.refs[2].v],
    ], clipFeature, clipBbox));
    if (selectedFaces.length === 0) continue;
    retainedTiles.push(tile.tileId);

    const vertexMap = new Map<number, number>();
    const textureMap = new Map<number, number>();
    const normalMap = new Map<number, number>();
    const usedMaterials = new Set<string>();
    for (const face of selectedFaces) {
      usedMaterials.add(face.material ?? '__default__');
      for (const ref of face.refs) {
        if (!vertexMap.has(ref.v)) vertexMap.set(ref.v, nextVertex++);
        if (ref.vt !== undefined && !textureMap.has(ref.vt)) textureMap.set(ref.vt, nextTextureCoordinate++);
        if (ref.vn !== undefined && !normalMap.has(ref.vn)) normalMap.set(ref.vn, nextNormal++);
      }
    }

    const mtlBlocks = loadMtlBlocks(tile.objPath, parsed.materialLibraries);
    const materialNames = new Map<string, string>();
    const mtlLines: string[] = [];
    for (const material of usedMaterials) {
      const uniqueName = `${safeName(tile.tileId)}__${safeName(material)}`;
      materialNames.set(material, uniqueName);
      mtlLines.push(...rewriteMaterial(
        material === '__default__' ? undefined : mtlBlocks.get(material),
        uniqueName,
        tile.tileId,
        texturesDir,
        outputDir,
        copiedTextures,
      ));
      materialCount += 1;
    }
    fs.appendFileSync(mtlOutputPath, `${mtlLines.join('\n')}\n`, 'utf8');

    const objLines: string[] = [`o tile_${tile.tileId}`];
    for (const [oldIndex] of vertexMap) {
      const vertex = transformedVertices[oldIndex];
      objLines.push(`v ${vertex.map(formatNumber).join(' ')}`);
    }
    for (const [oldIndex] of textureMap) {
      objLines.push(`vt ${parsed.textureCoordinates[oldIndex].map(formatNumber).join(' ')}`);
    }
    for (const [oldIndex] of normalMap) {
      const normal = transform.sourceNormalToEnu(parsed.normals[oldIndex]);
      objLines.push(`vn ${normal.map(formatNumber).join(' ')}`);
    }
    let activeMaterial: string | null = null;
    const maps = { vertices: vertexMap, textureCoordinates: textureMap, normals: normalMap };
    for (const face of selectedFaces) {
      const materialKey = face.material ?? '__default__';
      const materialName = materialNames.get(materialKey);
      if (!materialName) throw new Error(`Internal material mapping error for ${materialKey}`);
      if (materialName !== activeMaterial) {
        objLines.push(`usemtl ${materialName}`);
        activeMaterial = materialName;
      }
      objLines.push(`f ${face.refs.map(ref => formatReference(ref, maps)).join(' ')}`);
    }
    fs.appendFileSync(objOutputPath, `${objLines.join('\n')}\n`, 'utf8');
    faceCount += selectedFaces.length;
  }

  return {
    vertexCount: nextVertex - 1,
    textureCoordinateCount: nextTextureCoordinate - 1,
    normalCount: nextNormal - 1,
    faceCount,
    materialCount,
    textureCount: copiedTextures.size,
    retainedTiles,
  };
}
