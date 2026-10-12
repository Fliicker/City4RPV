import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config import ImagesToVlmConfig


@dataclass(frozen=True)
class ImageView:
    view_id: str
    image_path: Path
    azimuth_deg: float
    elevation_deg: float
    width: int
    height: int


@dataclass(frozen=True)
class ViewClassificationJob:
    building_id: str
    images_manifest: Path
    views: tuple[ImageView, ...]
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
    dataset_manifest_path = images_dataset_dir / "manifest.json"
    dataset = _load_json(dataset_manifest_path)
    if dataset.get("artifactType") != "multiview-images-dataset":
        raise ValueError(f"Expected a multiview-images-dataset manifest: {dataset_manifest_path}")
    entries = dataset.get("buildings")
    if not isinstance(entries, list) or not entries:
        raise ValueError(f"Image dataset contains no buildings: {dataset_manifest_path}")
    jobs: list[ViewClassificationJob] = []
    seen_buildings: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("manifest"), str):
            raise ValueError(f"Invalid building entry in {dataset_manifest_path}")
        manifest_path = images_dataset_dir / entry["manifest"]
        manifest = _load_json(manifest_path)
        if manifest.get("artifactType") != "multiview-images":
            raise ValueError(f"Expected a multiview-images manifest: {manifest_path}")
        building_id = manifest.get("buildingId")
        views = manifest.get("views")
        if not isinstance(building_id, str) or not building_id or not isinstance(views, list) or not views:
            raise ValueError(f"Invalid multi-view manifest: {manifest_path}")
        if building_id in seen_buildings:
            raise ValueError(f"Duplicate buildingId in image dataset: {building_id}")
        seen_buildings.add(building_id)
        image_views: list[ImageView] = []
        seen_views: set[str] = set()
        for view in views:
            if not isinstance(view, dict):
                raise ValueError(f"Invalid view entry in {manifest_path}")
            view_id = view.get("id")
            image = view.get("image")
            width = view.get("width")
            height = view.get("height")
            azimuth = view.get("azimuthDeg")
            elevation = view.get("elevationDeg")
            if (
                not isinstance(view_id, str) or not view_id or view_id in seen_views
                or not isinstance(image, str) or not image
                or not isinstance(width, int) or width <= 0
                or not isinstance(height, int) or height <= 0
                or not isinstance(azimuth, (int, float))
                or not isinstance(elevation, (int, float))
            ):
                raise ValueError(f"Invalid view entry in {manifest_path}")
            seen_views.add(view_id)
            image_path = manifest_path.parent / image
            if not image_path.is_file():
                raise ValueError(f"PNG referenced by {manifest_path} does not exist: {image_path}")
            image_views.append(ImageView(
                view_id=view_id,
                image_path=image_path,
                azimuth_deg=float(azimuth),
                elevation_deg=float(elevation),
                width=width,
                height=height,
            ))
        jobs.append(ViewClassificationJob(
            building_id=building_id,
            images_manifest=manifest_path,
            views=tuple(image_views),
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
