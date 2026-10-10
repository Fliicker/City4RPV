import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { SelectedTile } from './tileSelector';

type GltfPipelineResult = {
  gltf: unknown;
  separateResources?: Record<string, Buffer>;
};

type GltfPipelineModule = {
  glbToGltf: (glb: Buffer, options?: Record<string, unknown>) => Promise<GltfPipelineResult>;
};

type ContentOpsModule = {
  ContentOps: {
    b3dmToGlbBuffer: (inputBuffer: Buffer) => Buffer;
  };
};

// gltf-pipeline does not publish complete TypeScript declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { glbToGltf } = require('gltf-pipeline') as GltfPipelineModule;
// Loading the package root eagerly imports optional image-processing binaries.
// The conversion only needs ContentOps, so resolve that implementation directly.
const tilesToolsMain = require.resolve('3d-tiles-tools');
const { ContentOps } = require(path.join(
  path.dirname(tilesToolsMain),
  'tools',
  'contentProcessing',
  'ContentOps.js',
)) as ContentOpsModule;

const CACHE_VERSION = 1;

export type CachedTileObj = {
  tileId: string;
  objPath: string;
  cacheHit: boolean;
};

type CacheMarker = {
  version: number;
  source: { path: string; size: number; mtimeMs: number };
  assets: string[];
};

type PreparedTile = {
  tile: SelectedTile;
  outputDir: string;
  objPath: string;
  gltfPath: string;
  gltf: unknown;
  resources: string[];
};

type PythonBatchResult = {
  success?: boolean;
  failed_items?: Array<{ error?: string }>;
};

function ensureWithin(baseDir: string, targetPath: string): string {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Path escapes its expected directory: ${target}`);
  }
  return target;
}

function safeResourcePath(outputDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`Absolute glTF resource path is not allowed: ${relativePath}`);
  return ensureWithin(outputDir, path.resolve(outputDir, relativePath));
}

function cacheMarkerPath(outputDir: string): string {
  return path.join(outputDir, 'cache.json');
}

function sourceFingerprint(filePath: string): CacheMarker['source'] {
  const stat = fs.statSync(filePath);
  return { path: path.resolve(filePath), size: stat.size, mtimeMs: stat.mtimeMs };
}

function readValidCache(tile: SelectedTile, outputDir: string): string | null {
  const markerPath = cacheMarkerPath(outputDir);
  if (!fs.existsSync(markerPath)) return null;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as CacheMarker;
    const source = sourceFingerprint(tile.b3dmPath);
    if (
      marker.version !== CACHE_VERSION
      || marker.source.path !== source.path
      || marker.source.size !== source.size
      || marker.source.mtimeMs !== source.mtimeMs
      || !Array.isArray(marker.assets)
      || marker.assets.length === 0
    ) return null;
    for (const relativePath of marker.assets) {
      if (!fs.existsSync(safeResourcePath(outputDir, relativePath))) return null;
    }
    const objPath = path.join(outputDir, `${tile.tileId}.obj`);
    return fs.existsSync(objPath) ? objPath : null;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  const count = Math.max(1, Math.min(concurrency, values.length));
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

async function prepareTile(tile: SelectedTile, outputDir: string): Promise<PreparedTile> {
  if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const b3dm = fs.readFileSync(tile.b3dmPath);
  const glb = ContentOps.b3dmToGlbBuffer(b3dm);
  const gltfResult = await glbToGltf(glb, {
    separate: true,
    name: `${tile.tileId}.gltf`,
  });
  const gltfPath = path.join(outputDir, `${tile.tileId}.gltf`);
  fs.writeFileSync(gltfPath, JSON.stringify(gltfResult.gltf), 'utf8');
  const resources: string[] = [];
  for (const [relativePath, bytes] of Object.entries(gltfResult.separateResources ?? {})) {
    const resourcePath = safeResourcePath(outputDir, relativePath);
    fs.mkdirSync(path.dirname(resourcePath), { recursive: true });
    fs.writeFileSync(resourcePath, bytes);
    resources.push(resourcePath);
  }
  return {
    tile,
    outputDir,
    objPath: path.join(outputDir, `${tile.tileId}.obj`),
    gltfPath,
    gltf: gltfResult.gltf,
    resources,
  };
}

function findPython(projectRoot: string): string {
  if (process.env.CITY4RPV_PYTHON) return process.env.CITY4RPV_PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(projectRoot, 'geometry', '.venv', 'Scripts', 'python.exe')]
    : [path.join(projectRoot, 'geometry', '.venv', 'bin', 'python')];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? (process.platform === 'win32' ? 'python' : 'python3');
}

async function runPythonBatch(projectRoot: string, manifestPath: string): Promise<void> {
  const python = findPython(projectRoot);
  const script = path.join(projectRoot, 'geometry', 'convert_batch.py');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, [script, manifestPath], {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (stderr.trim()) process.stderr.write(stderr);
      let result: PythonBatchResult | null = null;
      try {
        result = JSON.parse(stdout.trim()) as PythonBatchResult;
      } catch {
        // The detailed process output is included in the error below.
      }
      if (code === 0 && result?.success) resolve();
      else {
        const details = result?.failed_items?.map(item => item.error).filter(Boolean).join('; ')
          || stdout.trim()
          || `exit code ${code}`;
        reject(new Error(`Python glTF-to-OBJ conversion failed: ${details}`));
      }
    });
  });
}

function findObjMaterialLibraries(objPath: string): string[] {
  const outputDir = path.dirname(objPath);
  const libraries: string[] = [];
  for (const line of fs.readFileSync(objPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('mtllib ')) {
      const name = trimmed.slice('mtllib '.length).trim();
      if (name) libraries.push(safeResourcePath(outputDir, name));
    }
  }
  return libraries;
}

function patchObjMaterialTextures(prepared: PreparedTile): void {
  const parsed = prepared.gltf as {
    images?: Array<{ uri?: unknown }>;
    textures?: Array<{ source?: unknown }>;
    materials?: Array<{ name?: unknown; pbrMetallicRoughness?: { baseColorTexture?: { index?: unknown } } }>;
    meshes?: Array<{ name?: unknown; primitives?: Array<{ material?: unknown }> }>;
  };
  const materials = Array.isArray(parsed.materials) ? parsed.materials : [];
  const textures = Array.isArray(parsed.textures) ? parsed.textures : [];
  const images = Array.isArray(parsed.images) ? parsed.images : [];
  const meshes = Array.isArray(parsed.meshes) ? parsed.meshes : [];
  const materialTextures = new Map<string, string>();
  const meshMaterials = new Map<string, string>();

  for (let index = 0; index < materials.length; index += 1) {
    const material = materials[index];
    const materialName = typeof material.name === 'string' && material.name ? material.name : `material_${index}`;
    const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
    if (typeof textureIndex !== 'number') continue;
    const imageIndex = textures[textureIndex]?.source;
    if (typeof imageIndex !== 'number') continue;
    const uri = images[imageIndex]?.uri;
    if (typeof uri !== 'string' || !uri || uri.startsWith('data:')) continue;
    const imagePath = safeResourcePath(prepared.outputDir, uri);
    if (fs.existsSync(imagePath)) {
      materialTextures.set(materialName, path.relative(prepared.outputDir, imagePath).replace(/\\/g, '/'));
    }
  }

  for (let index = 0; index < meshes.length; index += 1) {
    const mesh = meshes[index];
    const meshName = typeof mesh.name === 'string' && mesh.name ? mesh.name : `mesh_${index}`;
    const materialIndex = mesh.primitives?.[0]?.material;
    if (typeof materialIndex !== 'number') continue;
    const material = materials[materialIndex];
    const materialName = typeof material?.name === 'string' && material.name
      ? material.name
      : `material_${materialIndex}`;
    meshMaterials.set(meshName, materialName);
  }

  if (meshMaterials.size > 0) {
    const lines = fs.readFileSync(prepared.objPath, 'utf8').split(/\r?\n/);
    let currentObject: string | null = null;
    const patched = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('o ')) currentObject = trimmed.slice(2).trim();
      if (trimmed.startsWith('usemtl ') && currentObject && meshMaterials.has(currentObject)) {
        return `usemtl ${meshMaterials.get(currentObject)}`;
      }
      return line;
    });
    fs.writeFileSync(prepared.objPath, patched.join(os.EOL), 'utf8');
  }

  for (const mtlPath of findObjMaterialLibraries(prepared.objPath)) {
    const lines: string[] = [];
    for (const [materialName, texturePath] of materialTextures) {
      lines.push(
        `newmtl ${materialName}`,
        'Ka 0.40000000 0.40000000 0.40000000',
        'Kd 1.00000000 1.00000000 1.00000000',
        'Ks 0.40000000 0.40000000 0.40000000',
        'Ns 1.00000000',
        `map_Kd ${texturePath}`,
        '',
      );
    }
    if (lines.length > 0) fs.writeFileSync(mtlPath, lines.join(os.EOL), 'utf8');
  }
}

function finalizeCache(prepared: PreparedTile): void {
  patchObjMaterialTextures(prepared);
  const textureExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  for (const resource of prepared.resources) {
    if (!textureExtensions.has(path.extname(resource).toLowerCase()) && fs.existsSync(resource)) {
      fs.unlinkSync(resource);
    }
  }
  if (fs.existsSync(prepared.gltfPath)) fs.unlinkSync(prepared.gltfPath);
  const assets = fs.readdirSync(prepared.outputDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'cache.json')
    .map(entry => entry.name)
    .sort();
  const marker: CacheMarker = {
    version: CACHE_VERSION,
    source: sourceFingerprint(prepared.tile.b3dmPath),
    assets,
  };
  fs.writeFileSync(cacheMarkerPath(prepared.outputDir), JSON.stringify(marker, null, 2), 'utf8');
}

export async function ensureTileObjs(options: {
  tiles: SelectedTile[];
  level: number;
  tempDir: string;
  concurrency: number;
  projectRoot: string;
}): Promise<CachedTileObj[]> {
  const { tiles, level, tempDir, concurrency, projectRoot } = options;
  const cacheRoot = path.join(tempDir, String(level));
  fs.mkdirSync(cacheRoot, { recursive: true });
  const results = new Map<string, CachedTileObj>();
  const missing: Array<{ tile: SelectedTile; outputDir: string }> = [];
  for (const tile of tiles) {
    const outputDir = path.join(cacheRoot, tile.tileId);
    const cached = readValidCache(tile, outputDir);
    if (cached) results.set(tile.tileId, { tileId: tile.tileId, objPath: cached, cacheHit: true });
    else missing.push({ tile, outputDir });
  }

  if (missing.length > 0) {
    const prepared = await mapWithConcurrency(missing, concurrency, item => prepareTile(item.tile, item.outputDir));
    const jobsDir = path.join(tempDir, '.jobs');
    fs.mkdirSync(jobsDir, { recursive: true });
    const manifestPath = path.join(jobsDir, `convert-${process.pid}-${crypto.randomBytes(5).toString('hex')}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({
      items: prepared.map(item => ({ input_path: item.gltfPath, output_path: item.objPath })),
    }, null, 2), 'utf8');
    try {
      await runPythonBatch(projectRoot, manifestPath);
      for (const item of prepared) {
        if (!fs.existsSync(item.objPath)) throw new Error(`Converted OBJ is missing: ${item.objPath}`);
        finalizeCache(item);
        results.set(item.tile.tileId, { tileId: item.tile.tileId, objPath: item.objPath, cacheHit: false });
      }
    } finally {
      if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    }
  }

  return tiles.map(tile => {
    const result = results.get(tile.tileId);
    if (!result) throw new Error(`No converted OBJ available for tile ${tile.tileId}`);
    return result;
  });
}
