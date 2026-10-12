"""Classify one real building using the configured vLLM service."""

from __future__ import annotations

import json
import sys
import tempfile
from dataclasses import replace
from pathlib import Path


TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT))
sys.path.insert(0, str(TOOL_ROOT / "src"))

from config import CONFIG  # noqa: E402
from images_to_vlm import run_pipeline  # noqa: E402


def main() -> None:
    source_root = CONFIG.images_dataset_dir
    source = json.loads((source_root / "manifest.json").read_text(encoding="utf-8"))
    entry = source["buildings"][0]
    source_manifest = (source_root / entry["manifest"]).resolve()
    with tempfile.TemporaryDirectory(prefix="city4rpv-vllm-test-") as work:
        root = Path(work)
        dataset = root / "images"
        dataset.mkdir()
        (dataset / "manifest.json").write_text(json.dumps({
            "schemaVersion": 1,
            "artifactType": "multiview-images-dataset",
            "buildings": [{"buildingId": entry["buildingId"], "manifest": str(source_manifest)}],
        }), encoding="utf-8")
        output = root / "predictions"
        run_pipeline(replace(
            CONFIG,
            images_dataset_dir=dataset,
            output_dir=output,
            concurrency=1,
            overwrite=True,
        ))
        result = json.loads((output / entry["buildingId"] / "result.json").read_text(encoding="utf-8"))
        assert result["artifactType"] == "roof-classification"
        assert result["roofType"] in {"flat", "pitched", "curved", "dome", "pyramidal", "other"}
        print(f"vLLM integration test passed for {entry['buildingId']}: {result['roofType']}")


if __name__ == "__main__":
    main()
