from __future__ import annotations

import asyncio
import base64
import json
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

import httpx
import openai
from openai import AsyncOpenAI

if TYPE_CHECKING:
    from config import ImagesToVlmConfig


ROOF_TYPE_MAP = {
    "平屋顶": "flat",
    "坡屋顶": "pitched",
    "弧形屋顶": "curved",
    "穹顶": "dome",
    "金字塔顶": "pyramidal",
    "其他特殊屋顶": "other",
}
ROOF_TYPES = frozenset(ROOF_TYPE_MAP.values())
PROMPT = """
请综合观察同一栋建筑的三张图片，
判断其主要屋顶形态。

可选类型：
平屋顶、坡屋顶、弧形屋顶、穹顶、金字塔顶、其他特殊屋顶。

只输出选择的类型，不要输出任何解释或额外文本。
""".strip()


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


class BatchInferenceError(RuntimeError):
    def __init__(self, failures: list[tuple[str, BaseException]]) -> None:
        self.failures = failures
        detail = "; ".join(f"{building_id}: {error}" for building_id, error in failures)
        super().__init__(f"{len(failures)} building(s) failed classification: {detail}")


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
        if not isinstance(building_id, str) or not building_id or not isinstance(views, list) or len(views) != 3:
            raise ValueError(f"Multi-view manifest must contain exactly three views: {manifest_path}")
        if entry.get("buildingId") != building_id:
            raise ValueError(f"Dataset and building manifest IDs differ: {manifest_path}")
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


def build_request_content(job: ViewClassificationJob) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "text", "text": PROMPT}]
    for view in job.views:
        content.append({
            "type": "text",
            "text": f"视图 {view.view_id}：方位角 {view.azimuth_deg:g}°，高度角 {view.elevation_deg:g}°。",
        })
        image_b64 = base64.b64encode(view.image_path.read_bytes()).decode("ascii")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{image_b64}"},
        })
    return content


def _atomic_write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_result(job: ViewClassificationJob, roof_type: str) -> Path:
    if roof_type not in ROOF_TYPES:
        raise ValueError(f"Unsupported normalized roof type: {roof_type}")
    output_path = job.output_dir / "result.json"
    _atomic_write_json(output_path, {
        "schemaVersion": 1,
        "artifactType": "roof-classification",
        "buildingId": job.building_id,
        "roofType": roof_type,
    })
    return output_path


def has_valid_result(job: ViewClassificationJob) -> bool:
    path = job.output_dir / "result.json"
    if not path.is_file():
        return False
    try:
        result = _load_json(path)
    except ValueError:
        return False
    return (
        result.get("artifactType") == "roof-classification"
        and result.get("buildingId") == job.building_id
        and result.get("roofType") in ROOF_TYPES
    )


def _is_retryable(error: BaseException) -> bool:
    if isinstance(error, (openai.APIConnectionError, openai.APITimeoutError)):
        return True
    return isinstance(error, openai.APIStatusError) and (error.status_code == 429 or error.status_code >= 500)


async def classify_job(
    client: Any,
    job: ViewClassificationJob,
    *,
    model_name: str,
    temperature: float,
    max_tokens: int,
    max_attempts: int,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> str:
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    content = build_request_content(job)
    for attempt in range(1, max_attempts + 1):
        try:
            response = await client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": content}],
                temperature=temperature,
                max_tokens=max_tokens,
                extra_body={"structured_outputs": {"choice": list(ROOF_TYPE_MAP)}},
            )
            answer = response.choices[0].message.content
            if not isinstance(answer, str) or answer.strip() not in ROOF_TYPE_MAP:
                raise ValueError(f"Model returned an unsupported roof type: {answer!r}")
            return ROOF_TYPE_MAP[answer.strip()]
        except Exception as error:
            if attempt >= max_attempts or not _is_retryable(error):
                raise
            await sleep(float(2 ** (attempt - 1)))
    raise AssertionError("unreachable")


async def _validate_model(client: Any, model_name: str) -> None:
    response = await client.models.list()
    available = [model.id for model in response.data]
    if model_name not in available:
        raise ValueError(f"Configured model {model_name!r} is unavailable; server models: {available}")


async def run_pipeline_async(config: "ImagesToVlmConfig", *, client: Any | None = None) -> None:
    if config.concurrency < 1:
        raise ValueError("concurrency must be at least 1")
    if config.request_timeout_seconds <= 0 or config.max_attempts < 1 or config.max_tokens < 1:
        raise ValueError("Timeout, max_attempts, and max_tokens must be positive")
    jobs = discover_view_jobs(config.images_dataset_dir, config.output_dir)
    config.output_dir.mkdir(parents=True, exist_ok=True)
    owned_client: AsyncOpenAI | None = None
    if client is None:
        http_client = httpx.AsyncClient(
            trust_env=False,
            timeout=httpx.Timeout(config.request_timeout_seconds),
        )
        owned_client = AsyncOpenAI(
            base_url=config.vllm_base_url,
            api_key="dummy",
            http_client=http_client,
            max_retries=0,
        )
        client = owned_client

    try:
        await _validate_model(client, config.model_name)
        pending = jobs if config.overwrite else [job for job in jobs if not has_valid_result(job)]
        skipped = len(jobs) - len(pending)
        semaphore = asyncio.Semaphore(config.concurrency)
        completed = 0

        async def execute(job: ViewClassificationJob) -> tuple[str, Exception | None]:
            nonlocal completed
            try:
                async with semaphore:
                    roof_type = await classify_job(
                        client,
                        job,
                        model_name=config.model_name,
                        temperature=config.temperature,
                        max_tokens=config.max_tokens,
                        max_attempts=config.max_attempts,
                    )
                    write_result(job, roof_type)
                return job.building_id, None
            except Exception as error:
                return job.building_id, error
            finally:
                completed += 1
                print(f"Classified {completed}/{len(pending)} pending building(s)", flush=True)

        outcomes = await asyncio.gather(*(execute(job) for job in pending))
        failures = [(building_id, error) for building_id, error in outcomes if error is not None]
        if failures:
            raise BatchInferenceError(failures)
        invalid = [job.building_id for job in jobs if not has_valid_result(job)]
        if invalid:
            raise RuntimeError(f"Classification results are incomplete or invalid: {invalid}")
        _atomic_write_json(config.output_dir / "manifest.json", {
            "schemaVersion": 1,
            "artifactType": "roof-classification-dataset",
            "buildings": [
                {"buildingId": job.building_id, "result": f"{job.building_id}/result.json"}
                for job in jobs
            ],
        })
        print(
            f"Classified {len(jobs)} building(s) to {config.output_dir} "
            f"({len(pending)} inferred, {skipped} reused)",
            flush=True,
        )
    finally:
        if owned_client is not None:
            await owned_client.close()


def run_pipeline(config: "ImagesToVlmConfig") -> None:
    asyncio.run(run_pipeline_async(config))
