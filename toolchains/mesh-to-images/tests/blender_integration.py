"""Render one real building with Blender and validate the produced artifacts."""

from __future__ import annotations

import json
import struct
import sys
import tempfile
from dataclasses import replace
from pathlib import Path


TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT))
sys.path.insert(0, str(TOOL_ROOT / "src"))

from config import CONFIG  # noqa: E402
from mesh_to_images import run_pipeline  # noqa: E402


def png_info(path: Path) -> tuple[int, int, int]:
    data = path.read_bytes()[:29]
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise AssertionError(f"Not a PNG: {path}")
    width, height = struct.unpack(">II", data[16:24])
    return width, height, data[25]


def main() -> None:
    source_root = CONFIG.mesh_dataset_dir
    source = json.loads((source_root / "manifest.json").read_text(encoding="utf-8"))
    entry = source["buildings"][0]
    source_manifest = (source_root / entry["manifest"]).resolve()
    with tempfile.TemporaryDirectory(prefix="city4rpv-blender-test-") as work:
        root = Path(work)
        dataset = root / "meshes"
        dataset.mkdir()
        (dataset / "manifest.json").write_text(json.dumps({
            "schemaVersion": 1,
            "artifactType": "textured-mesh-dataset",
            "buildings": [{"buildingId": entry["buildingId"], "manifest": str(source_manifest)}],
        }), encoding="utf-8")
        output = root / "images"
        run_pipeline(replace(CONFIG, mesh_dataset_dir=dataset, output_dir=output))

        dataset_result = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        assert dataset_result["artifactType"] == "multiview-images-dataset"
        manifest_path = output / dataset_result["buildings"][0]["manifest"]
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        assert len(manifest["views"]) == 3
        for view in manifest["views"]:
            width, height, colour_type = png_info(manifest_path.parent / view["image"])
            assert (width, height) == (view["width"], view["height"])
            assert colour_type == 2, f"Expected RGB PNG, found PNG colour type {colour_type}"
            assert width <= 512 and height <= 512
            assert width % 16 == 0 and height % 16 == 0
        print(f"Blender integration test passed for {entry['buildingId']}: {manifest_path.parent}")


if __name__ == "__main__":
    main()
