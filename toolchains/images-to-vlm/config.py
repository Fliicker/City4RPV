from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ImagesToVlmConfig:
    images_dataset_dir: Path
    output_dir: Path
    vllm_base_url: str
    model_name: str
    concurrency: int
    request_timeout_seconds: float
    max_attempts: int
    temperature: float
    max_tokens: int
    overwrite: bool


# Edit these values directly. No command-line arguments are required.
CONFIG = ImagesToVlmConfig(
    images_dataset_dir=PROJECT_ROOT / "artifacts" / "images" / "Munich_building2",
    output_dir=PROJECT_ROOT / "artifacts" / "predictions" / "Munich_building2",
    vllm_base_url="http://127.0.0.1:8000/v1",
    model_name="/root/models/Qwen3-VL-2B-Instruct-GPTQ-Int4",
    concurrency=8,
    request_timeout_seconds=120.0,
    max_attempts=3,
    temperature=0.0,
    max_tokens=16,
    overwrite=True,
)
