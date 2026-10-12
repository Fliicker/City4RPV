import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from collections import deque
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


def _validate_texture_references(mtl_path: Path) -> None:
    for line in mtl_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped.lower().startswith("map_kd "):
            continue
        relative_path = stripped.split(maxsplit=1)[1].strip()
        texture_path = mtl_path.parent / relative_path
        if not texture_path.is_file():
            raise ValueError(f"Texture referenced by {mtl_path} does not exist: {texture_path}")


def discover_mesh_jobs(mesh_dataset_dir: Path, output_dir: Path) -> list[MeshRenderJob]:
    dataset_manifest_path = mesh_dataset_dir / "manifest.json"
    dataset = _load_json(dataset_manifest_path)
    if dataset.get("artifactType") != "textured-mesh-dataset":
        raise ValueError(f"Expected a textured-mesh-dataset manifest: {dataset_manifest_path}")

    entries = dataset.get("buildings")
    if not isinstance(entries, list) or not entries:
        raise ValueError(f"Mesh dataset contains no buildings: {dataset_manifest_path}")
    jobs: list[MeshRenderJob] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("manifest"), str):
            raise ValueError(f"Invalid building entry in {dataset_manifest_path}")
        manifest_path = mesh_dataset_dir / entry["manifest"]
        manifest = _load_json(manifest_path)
        if manifest.get("artifactType") != "textured-mesh":
            raise ValueError(f"Expected a textured-mesh manifest: {manifest_path}")
        building_id = manifest.get("buildingId")
        obj = manifest.get("obj")
        mtl = manifest.get("mtl")
        if not isinstance(building_id, str) or not building_id or not isinstance(obj, str) or not isinstance(mtl, str):
            raise ValueError(f"Invalid building mesh manifest: {manifest_path}")
        if building_id in seen:
            raise ValueError(f"Duplicate buildingId in mesh dataset: {building_id}")
        seen.add(building_id)
        obj_path = manifest_path.parent / obj
        mtl_path = manifest_path.parent / mtl
        if not obj_path.is_file() or not mtl_path.is_file():
            raise ValueError(f"Mesh files referenced by {manifest_path} do not exist")
        _validate_texture_references(mtl_path)
        jobs.append(MeshRenderJob(
            building_id=building_id,
            mesh_manifest=manifest_path,
            obj_path=obj_path,
            mtl_path=mtl_path,
            output_dir=output_dir / building_id,
        ))
    return jobs


def _resolve_blender(executable: Path) -> Path:
    if executable.is_file():
        return executable.resolve()
    found = shutil.which(str(executable))
    if found:
        return Path(found).resolve()
    raise ValueError(f"Blender executable not found: {executable}")


def _rename_with_retry(source: Path, target: Path) -> None:
    for attempt in range(8):
        try:
            source.rename(target)
            return
        except OSError:
            if attempt == 7:
                raise
            time.sleep(0.1 * (attempt + 1))


def _move_staging_into_place(staging_dir: Path, output_dir: Path) -> None:
    """Commit a completed staging tree, including across Windows security contexts."""
    try:
        _rename_with_retry(staging_dir, output_dir)
    except PermissionError:
        # Blender can create descendants under a different Windows sandbox token.
        # Copy to a second private tree owned by this process, then atomically expose
        # that complete tree. The public target never contains a partial copy.
        commit_dir = output_dir.parent / f".{output_dir.name}.commit-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        try:
            shutil.copytree(staging_dir, commit_dir)
            _rename_with_retry(commit_dir, output_dir)
        except Exception:
            if commit_dir.exists():
                shutil.rmtree(commit_dir, ignore_errors=True)
            raise
        shutil.rmtree(staging_dir)


def _replace_output(staging_dir: Path, output_dir: Path) -> None:
    backup_dir = output_dir.with_name(f"{output_dir.name}.previous-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    previous_moved = False
    try:
        if output_dir.exists():
            _rename_with_retry(output_dir, backup_dir)
            previous_moved = True
        _move_staging_into_place(staging_dir, output_dir)
    except Exception:
        if previous_moved and not output_dir.exists() and backup_dir.exists():
            _rename_with_retry(backup_dir, output_dir)
        raise
    if backup_dir.exists():
        shutil.rmtree(backup_dir)


def _rendered_building_id(line: str) -> str | None:
    prefix = "Rendered building "
    stripped = line.strip()
    if not stripped.startswith(prefix):
        return None
    building_id, separator, suffix = stripped[len(prefix):].partition(" (")
    if not building_id or not separator or not suffix.endswith(" views)"):
        return None
    return building_id


def _run_blender(command: list[str], cwd: Path, building_ids: set[str]) -> tuple[int, str]:
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    recent_lines: deque[str] = deque(maxlen=200)
    completed: set[str] = set()
    try:
        if process.stdout is None:
            raise RuntimeError("Unable to read Blender output")
        for line in process.stdout:
            stripped = line.rstrip()
            recent_lines.append(stripped)
            building_id = _rendered_building_id(stripped)
            if building_id in building_ids and building_id not in completed:
                completed.add(building_id)
                print(f"Rendered {len(completed)}/{len(building_ids)}: {building_id}", flush=True)
        return process.wait(), "\n".join(recent_lines)
    except BaseException:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        raise
    finally:
        if process.stdout is not None:
            process.stdout.close()


def run_pipeline(config: "MeshToImagesConfig") -> None:
    blender = _resolve_blender(config.blender_executable)
    if config.output_dir.exists() and not config.overwrite:
        raise ValueError(f"Output directory already exists and overwrite is disabled: {config.output_dir}")
    if len(config.views) != 3 or len({view.view_id for view in config.views}) != len(config.views):
        raise ValueError("Exactly three uniquely named views must be configured")
    config.output_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_dir = config.output_dir.parent / f".{config.output_dir.name}.staging-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    jobs = discover_mesh_jobs(config.mesh_dataset_dir, staging_dir)
    staging_dir.mkdir(parents=True)
    tool_root = Path(__file__).resolve().parents[2]
    blender_script = tool_root / "blender" / "render_batch.py"

    try:
        with tempfile.TemporaryDirectory(prefix="city4rpv-render-") as temporary:
            temporary_dir = Path(temporary)
            request_path = temporary_dir / "request.json"
            result_path = temporary_dir / "result.json"
            request_path.write_text(json.dumps({
                "resultPath": str(result_path),
                "jobs": [{
                    "buildingId": job.building_id,
                    "objPath": str(job.obj_path.resolve()),
                    "outputDir": str(job.output_dir.resolve()),
                } for job in jobs],
                "views": [{
                    "id": view.view_id,
                    "azimuthDeg": view.azimuth_deg,
                    "elevationDeg": view.elevation_deg,
                } for view in config.views],
                "render": {
                    "pixelsPerMetre": config.pixels_per_metre,
                    "margin": config.margin,
                    "maxDimension": config.max_dimension,
                    "minDimension": config.min_dimension,
                    "dimensionMultiple": config.dimension_multiple,
                },
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            return_code, recent_output = _run_blender(
                [str(blender), "--background", "--factory-startup", "--python", str(blender_script), "--", str(request_path)],
                tool_root,
                {job.building_id for job in jobs},
            )
            result = _load_json(result_path) if result_path.is_file() else {}
            if return_code != 0 or result.get("success") is not True:
                detail = result.get("error") or recent_output[-4000:].strip() or "No Blender diagnostic output"
                raise RuntimeError(f"Blender rendering failed: {detail}")
            buildings = result.get("buildings")
            if not isinstance(buildings, list) or len(buildings) != len(jobs):
                raise RuntimeError("Blender returned an incomplete building result list")
            (staging_dir / "manifest.json").write_text(json.dumps({
                "schemaVersion": 1,
                "artifactType": "multiview-images-dataset",
                "buildings": buildings,
            }, ensure_ascii=False, indent=2), encoding="utf-8")
        _replace_output(staging_dir, config.output_dir)
        print(f"Rendered {len(jobs)} building(s) to {config.output_dir}")
    except Exception:
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)
        raise
