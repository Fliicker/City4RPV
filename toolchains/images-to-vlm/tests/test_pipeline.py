import asyncio
import base64
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx
import openai

TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT / "src"))

from images_to_vlm import (  # noqa: E402
    BatchInferenceError,
    ROOF_TYPE_MAP,
    build_request_content,
    classify_job,
    discover_view_jobs,
    has_valid_result,
    run_pipeline_async,
    write_result,
)


MODEL = "/root/models/Qwen3-VL-2B-Instruct-GPTQ-Int4"


def create_dataset(root: Path, count: int = 1) -> tuple[Path, Path]:
    dataset = root / "images"
    entries = []
    for index in range(count):
        building_id = f"w{index + 1}"
        building = dataset / building_id
        building.mkdir(parents=True)
        views = []
        for view_index, (azimuth, elevation) in enumerate(((0, 90), (0, 45), (90, 45)), 1):
            name = f"view_{view_index:03d}.png"
            (building / name).write_bytes(f"png-{building_id}-{view_index}".encode())
            views.append({
                "id": f"view_{view_index:03d}", "image": name,
                "azimuthDeg": azimuth, "elevationDeg": elevation,
                "width": 128, "height": 160,
            })
        (building / "manifest.json").write_text(json.dumps({
            "artifactType": "multiview-images", "buildingId": building_id, "views": views,
        }), encoding="utf-8")
        entries.append({"buildingId": building_id, "manifest": f"{building_id}/manifest.json"})
    (dataset / "manifest.json").write_text(json.dumps({
        "artifactType": "multiview-images-dataset", "buildings": entries,
    }), encoding="utf-8")
    return dataset, root / "predictions"


def make_config(dataset: Path, output: Path, **changes):
    values = {
        "images_dataset_dir": dataset,
        "output_dir": output,
        "vllm_base_url": "http://test/v1",
        "model_name": MODEL,
        "concurrency": 8,
        "request_timeout_seconds": 120.0,
        "max_attempts": 3,
        "temperature": 0.0,
        "max_tokens": 16,
        "overwrite": True,
    }
    values.update(changes)
    return SimpleNamespace(**values)


def response(answer: str):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=answer))])


class FakeClient:
    def __init__(self, create):
        self.models = SimpleNamespace(list=self.list_models)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

    async def list_models(self):
        return SimpleNamespace(data=[SimpleNamespace(id=MODEL)])


class ViewJobsTest(unittest.TestCase):
    def test_request_contains_three_ordered_views_and_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            dataset, output = create_dataset(Path(work))
            job = discover_view_jobs(dataset, output)[0]
            content = build_request_content(job)
            self.assertEqual(len(content), 7)
            self.assertIn("三张图片", content[0]["text"])
            for index, view in enumerate(job.views):
                label = content[1 + index * 2]["text"]
                image = content[2 + index * 2]["image_url"]["url"]
                self.assertIn(view.view_id, label)
                self.assertIn(f"方位角 {view.azimuth_deg:g}°", label)
                decoded = base64.b64decode(image.split(",", 1)[1])
                self.assertEqual(decoded, view.image_path.read_bytes())

    def test_result_is_atomic_and_validated(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            dataset, output = create_dataset(Path(work))
            job = discover_view_jobs(dataset, output)[0]
            result_path = write_result(job, "flat")
            self.assertTrue(has_valid_result(job))
            result = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertEqual(result["roofType"], "flat")
            self.assertEqual(list(job.output_dir.glob(".*.tmp-*")), [])
            with self.assertRaises(ValueError):
                write_result(job, "unknown")


class ClassificationTest(unittest.IsolatedAsyncioTestCase):
    async def test_all_constrained_choices_map_to_normalized_codes(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            dataset, output = create_dataset(Path(work))
            job = discover_view_jobs(dataset, output)[0]
            for chinese, normalized in ROOF_TYPE_MAP.items():
                calls = []

                async def create(**kwargs):
                    calls.append(kwargs)
                    return response(chinese)

                result = await classify_job(
                    FakeClient(create), job, model_name=MODEL, temperature=0,
                    max_tokens=16, max_attempts=3,
                )
                self.assertEqual(result, normalized)
                self.assertEqual(calls[0]["extra_body"]["structured_outputs"]["choice"], list(ROOF_TYPE_MAP))

    async def test_retries_connection_errors_but_not_bad_requests(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            dataset, output = create_dataset(Path(work))
            job = discover_view_jobs(dataset, output)[0]
            attempts = 0
            delays = []

            async def eventually_succeeds(**_kwargs):
                nonlocal attempts
                attempts += 1
                if attempts < 3:
                    raise openai.APIConnectionError(request=httpx.Request("POST", "http://test"))
                return response("坡屋顶")

            async def record_sleep(delay):
                delays.append(delay)

            result = await classify_job(
                FakeClient(eventually_succeeds), job, model_name=MODEL, temperature=0,
                max_tokens=16, max_attempts=3, sleep=record_sleep,
            )
            self.assertEqual(result, "pitched")
            self.assertEqual(delays, [1.0, 2.0])

            for status_code in (429, 503):
                status_attempts = 0

                async def transient_status(**_kwargs):
                    nonlocal status_attempts
                    status_attempts += 1
                    if status_attempts == 1:
                        request = httpx.Request("POST", "http://test")
                        raise openai.APIStatusError(
                            "transient", response=httpx.Response(status_code, request=request), body=None,
                        )
                    return response("平屋顶")

                result = await classify_job(
                    FakeClient(transient_status), job, model_name=MODEL, temperature=0,
                    max_tokens=16, max_attempts=3, sleep=record_sleep,
                )
                self.assertEqual(result, "flat")
                self.assertEqual(status_attempts, 2)

            bad_attempts = 0

            async def bad_request(**_kwargs):
                nonlocal bad_attempts
                bad_attempts += 1
                request = httpx.Request("POST", "http://test")
                raise openai.BadRequestError(
                    "bad request", response=httpx.Response(400, request=request), body=None,
                )

            with self.assertRaises(openai.BadRequestError):
                await classify_job(
                    FakeClient(bad_request), job, model_name=MODEL, temperature=0,
                    max_tokens=16, max_attempts=3, sleep=record_sleep,
                )
            self.assertEqual(bad_attempts, 1)

    async def test_pipeline_bounds_concurrency_and_supports_resume(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            dataset, output = create_dataset(Path(work), count=10)
            active = 0
            maximum_active = 0
            request_count = 0

            async def create(**_kwargs):
                nonlocal active, maximum_active, request_count
                active += 1
                maximum_active = max(maximum_active, active)
                request_count += 1
                await asyncio.sleep(0.005)
                active -= 1
                return response("平屋顶")

            config = make_config(dataset, output, concurrency=3)
            await run_pipeline_async(config, client=FakeClient(create))
            self.assertEqual(request_count, 10)
            self.assertLessEqual(maximum_active, 3)
            root_manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(len(root_manifest["buildings"]), 10)

            async def must_not_run(**_kwargs):
                raise AssertionError("Valid results should have been reused")

            await run_pipeline_async(
                make_config(dataset, output, overwrite=False), client=FakeClient(must_not_run),
            )

            (output / "w1" / "result.json").write_text("{}", encoding="utf-8")
            repaired = 0

            async def repair_invalid(**_kwargs):
                nonlocal repaired
                repaired += 1
                return response("坡屋顶")

            await run_pipeline_async(
                make_config(dataset, output, overwrite=False), client=FakeClient(repair_invalid),
            )
            self.assertEqual(repaired, 1)
            self.assertEqual(
                json.loads((output / "w1" / "result.json").read_text(encoding="utf-8"))["roofType"],
                "pitched",
            )

    async def test_partial_failure_preserves_successful_results(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            dataset, output = create_dataset(Path(work), count=3)
            calls = 0

            async def create(**_kwargs):
                nonlocal calls
                calls += 1
                if calls == 2:
                    return response("not-a-choice")
                return response("平屋顶")

            with self.assertRaises(BatchInferenceError):
                await run_pipeline_async(
                    make_config(dataset, output, concurrency=1), client=FakeClient(create),
                )
            self.assertEqual(len(list(output.glob("*/result.json"))), 2)
            self.assertFalse((output / "manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
