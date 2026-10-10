# roof-classification workflow

This thin workflow composes the three toolchains in order without importing their internal implementation modules:

1. `tiles-to-mesh`
2. `mesh-to-images`
3. `images-to-vlm`

Stage switches live in `config.py`; detailed settings remain owned by each toolchain. The workflow will stop at the currently unimplemented Blender stage until that toolchain is completed.
