"""Batch-convert separated glTF files to OBJ using the GeoWind3D approach."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import trimesh


logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s", stream=sys.stderr)
logger = logging.getLogger("city4rpv.convert")


def convert_item(input_path: Path, output_path: Path) -> None:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input glTF not found: {input_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    mesh = trimesh.load(input_path)
    mesh.export(output_path)
    if not output_path.is_file():
        raise RuntimeError(f"Trimesh did not create the requested OBJ: {output_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="JSON manifest containing conversion items")
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    items = manifest.get("items")
    if not isinstance(items, list):
        raise ValueError("Manifest must contain an 'items' array")

    output_paths: list[str] = []
    failed_items: list[dict[str, str]] = []
    for index, item in enumerate(items, start=1):
        input_path = Path(item["input_path"])
        output_path = Path(item["output_path"])
        logger.info("[%d/%d] converting %s", index, len(items), input_path.name)
        try:
            convert_item(input_path, output_path)
            output_paths.append(str(output_path))
        except Exception as exc:  # noqa: BLE001 - each failed item must be reported
            logger.exception("Conversion failed for %s", input_path)
            failed_items.append(
                {
                    "input_path": str(input_path),
                    "output_path": str(output_path),
                    "error": str(exc),
                }
            )

    result = {
        "success": not failed_items,
        "output_paths": output_paths,
        "failed_items": failed_items,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if not failed_items else 1


if __name__ == "__main__":
    raise SystemExit(main())
