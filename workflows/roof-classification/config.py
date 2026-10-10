from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class RoofClassificationWorkflowConfig:
    run_tiles_to_mesh: bool = True
    run_mesh_to_images: bool = True
    run_images_to_vlm: bool = True


# Edit stage switches here. Each toolchain keeps its own detailed configuration.
CONFIG = RoofClassificationWorkflowConfig()
