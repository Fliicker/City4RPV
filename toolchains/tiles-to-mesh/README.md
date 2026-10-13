# tiles-to-mesh

Converts an EPSG:4326 OSM building FeatureCollection and a selected 3D Tiles level into one textured, local-ENU OBJ bundle per `full_id`.

Implementation:

- `node/`: selection, coordinate transforms, clipping, merging, manifests, and orchestration.
- `python/`: batch glTF-to-OBJ conversion helper used by the Node implementation.

Edit `node/src/config.ts`, then run from the repository root:

```powershell
npm run tiles-to-mesh:python:sync
npm run tiles-to-mesh:run
```

Each building output contains both detailed `metadata.json` and the small cross-toolchain `manifest.json` documented in `contracts/README.md`.

Mesh faces are cut exactly against the buffered building footprint in local ENU XY. New boundary vertices interpolate Z positions, texture coordinates, and normals; Polygon holes, MultiPolygon components, and near-vertical faces are handled by the same clipping path.
