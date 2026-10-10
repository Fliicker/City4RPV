# mesh-to-images

Planned input: the textured-mesh dataset manifest produced by `tiles-to-mesh`.

Planned output for every OSM `full_id`:

```text
artifacts/images/<dataset>/<full_id>/
  front.png
  oblique.png
  top.png
  manifest.json
```

The output manifest format is documented in `contracts/README.md`. The launcher and manifest discovery boundary are present; Blender scene setup, camera placement, and rendering are intentionally not implemented yet. Running `main.py` validates and counts upstream mesh jobs, then exits with an explicit not-implemented error.
