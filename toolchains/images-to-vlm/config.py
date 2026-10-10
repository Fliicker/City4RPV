from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ImagesToVlmConfig:
    images_dataset_dir: Path
    output_dir: Path
    vllm_base_url: str
    model_name: str
    overwrite: bool


# Edit these values directly. No command-line arguments are required.
CONFIG = ImagesToVlmConfig(
    images_dataset_dir=PROJECT_ROOT / "artifacts" / "images" / "Munich_building2",
    output_dir=PROJECT_ROOT / "artifacts" / "predictions" / "Munich_building2",
    vllm_base_url="http://127.0.0.1:8000/v1",
    model_name="EDIT_ME",
    overwrite=True,
)
