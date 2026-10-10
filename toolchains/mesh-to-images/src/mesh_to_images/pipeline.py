import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config import MeshToImagesConfig


@dataclass(frozen=True)
class MeshRenderJob:
    building_id: str
    mesh_manifest: Path
    obj_path: Path
    mtl_path: Path
    output_dir: Path


def _load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to read manifest {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Manifest root must be an object: {path}")
    return value


def discover_mesh_jobs(mesh_dataset_dir: Path, output_dir: Path) -> list[MeshRenderJob]:
    dataset_manifest_path = mesh_dataset_dir / "manifest.json"
    dataset = _load_json(dataset_manifest_path)
    if dataset.get("artifactType") != "textured-mesh-dataset":
        raise ValueError(f"Expected a textured-mesh-dataset manifest: {dataset_manifest_path}")

    jobs: list[MeshRenderJob] = []
    for entry in dataset.get("buildings", []):
        if not isinstance(entry, dict) or not isinstance(entry.get("manifest"), str):
            raise ValueError(f"Invalid building entry in {dataset_manifest_path}")
        manifest_path = mesh_dataset_dir / entry["manifest"]
        manifest = _load_json(manifest_path)
        if manifest.get("artifactType") != "textured-mesh":
            raise ValueError(f"Expected a textured-mesh manifest: {manifest_path}")
        building_id = manifest.get("buildingId")
        obj = manifest.get("obj")
        mtl = manifest.get("mtl")
        if not isinstance(building_id, str) or not isinstance(obj, str) or not isinstance(mtl, str):
            raise ValueError(f"Invalid building mesh manifest: {manifest_path}")
        obj_path = manifest_path.parent / obj
        mtl_path = manifest_path.parent / mtl
        if not obj_path.is_file() or not mtl_path.is_file():
            raise ValueError(f"Mesh files referenced by {manifest_path} do not exist")
        jobs.append(MeshRenderJob(
            building_id=building_id,
            mesh_manifest=manifest_path,
            obj_path=obj_path,
            mtl_path=mtl_path,
            output_dir=output_dir / building_id,
        ))
    return jobs


def run_pipeline(config: "MeshToImagesConfig") -> None:
    jobs = discover_mesh_jobs(config.mesh_dataset_dir, config.output_dir)
    raise NotImplementedError(
        f"mesh-to-images framework found {len(jobs)} mesh job(s), but Blender rendering is not implemented yet"
    )
