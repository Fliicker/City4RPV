# City4RPV 3D Tiles Mesh Extractor

This repository contains a TypeScript entry point that extracts one textured OBJ mesh per OSM building feature from the Munich 3D Tiles dataset. The input is an EPSG:4326 FeatureCollection whose Polygon/MultiPolygon features have unique `full_id` properties. `GeoWind3D-public/` is reference code and is not modified by the toolchain.

## What it does

1. Loads and validates every building feature and its unique `full_id`.
2. Expands every building footprint by the configured metric buffer (2 metres by default).
3. Finds the union of octant tiles needed by all buffered footprints and converts each `b3dm` only once through GLB and separated glTF to the persistent textured OBJ cache.
4. For each building, applies the root tileset transform, builds an ENU frame at the buffered footprint's bounding-box center, and retains every complete triangle whose horizontal projection intersects that buffered footprint.
5. Writes an independent textured OBJ bundle under a directory named exactly from the building's `full_id`.

Boundary-crossing triangles are intentionally retained whole. The result can therefore extend slightly beyond the GeoJSON boundary. No tile or triangle R-tree is created.

## Requirements and installation

- Node.js 20 or later (Node.js 20 LTS is recommended)
- Python 3.10–3.13
- [uv](https://docs.astral.sh/uv/) for the managed Python environment, or a Python interpreter with Trimesh installed

```powershell
npm ci
npm run geometry:sync
```

The pipeline uses `geometry/.venv` when it exists. To select another interpreter, set `CITY4RPV_PYTHON` to its executable path.

## Configuration and usage

Edit the `CONFIG` object near the top of `server/src/main.ts`. It contains the OSM FeatureCollection path, tile level, per-building `bufferMeters` (currently `2`), source directory, cache directory, dataset output root, conversion concurrency, and overwrite behavior. Every input feature must:

- have Polygon or MultiPolygon geometry in EPSG:4326 `[longitude, latitude]` coordinates;
- contain a non-empty, unique `properties.full_id`;
- use a `full_id` that is safe as a directory name, such as `w19901814` or `r1155799`.

Run the TypeScript entry point without arguments:

```powershell
npm run extract
```

You can also invoke the same file directly:

```powershell
npx tsx server/src/main.ts
```

The configured level must be from 13 through 19. Missing coverage is not filled from a parent level. Set `overwrite: true` to replace an existing output directory, or `false` to fail safely when it already exists.

## Outputs and coordinates

Converted source tiles are cached as:

```text
temp/<level>/<octant>/<octant>.obj
temp/<level>/<octant>/<octant>.mtl
temp/<level>/<octant>/<texture files>
temp/<level>/<octant>/cache.json
```

The final dataset output is:

```text
output/Munich_building2/
├── metadata.json
├── r1155799/
│   ├── model.obj
│   ├── model.mtl
│   ├── metadata.json
│   └── textures/*
├── w19901814/
│   └── ...
└── <full_id>/
    └── ...
```

Final OBJ coordinates are metres in an AOI-local ENU frame:

- X: east
- Y: north
- Z: up
- Origin: center of the individual buffered footprint's bounding box at WGS84 ellipsoid height 0

Each building directory has its own `metadata.json` recording the `full_id`, original properties and bounding box, buffer distance and buffered bounding box, WGS84/ENU origin, transforms, selected tiles, and mesh counts. The root `metadata.json` summarizes the complete batch. Cached tile OBJs remain in the original tileset-local coordinate system so they can be reused by different buildings and datasets.

## Tests

```powershell
npm test
```

The optional end-to-end Munich test performs a real b3dm conversion and verifies cache reuse:

```powershell
$env:MUNICH_TILES_DIR = "E:\data\Google3DTile\Cities\Munich"
npm run test:integration
```
