import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config import ImagesToVlmConfig


@dataclass(frozen=True)
class ViewClassificationJob:
    building_id: str
    images_manifest: Path
    front_png: Path
    oblique_png: Path
    top_png: Path
    output_dir: Path


def _load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to read manifest {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Manifest root must be an object: {path}")
    return value


def discover_view_jobs(images_dataset_dir: Path, output_dir: Path) -> list[ViewClassificationJob]:
    if not images_dataset_dir.is_dir():
        raise ValueError(f"Image dataset directory does not exist: {images_dataset_dir}")
    jobs: list[ViewClassificationJob] = []
    for manifest_path in sorted(images_dataset_dir.glob("*/manifest.json")):
        manifest = _load_json(manifest_path)
        if manifest.get("artifactType") != "multiview-images":
            continue
        building_id = manifest.get("buildingId")
        views = manifest.get("views")
        if not isinstance(building_id, str) or not isinstance(views, dict):
            raise ValueError(f"Invalid multi-view manifest: {manifest_path}")
        paths = {name: manifest_path.parent / str(views.get(name, "")) for name in ("front", "oblique", "top")}
        missing = [str(path) for path in paths.values() if not path.is_file()]
        if missing:
            raise ValueError(f"PNG files referenced by {manifest_path} do not exist: {', '.join(missing)}")
        jobs.append(ViewClassificationJob(
            building_id=building_id,
            images_manifest=manifest_path,
            front_png=paths["front"],
            oblique_png=paths["oblique"],
            top_png=paths["top"],
            output_dir=output_dir / building_id,
        ))
    return jobs


def write_result(job: ViewClassificationJob, roof_type: str) -> Path:
    if not roof_type.strip():
        raise ValueError("roof_type must be a non-empty string")
    job.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = job.output_dir / "result.json"
    output_path.write_text(json.dumps({
        "schemaVersion": 1,
        "artifactType": "roof-classification",
        "buildingId": job.building_id,
        "roofType": roof_type.strip(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def run_pipeline(config: "ImagesToVlmConfig") -> None:
    jobs = discover_view_jobs(config.images_dataset_dir, config.output_dir)
    raise NotImplementedError(
        f"images-to-vlm framework found {len(jobs)} view job(s), but vLLM inference is not implemented yet"
    )
