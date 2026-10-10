from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class MeshToImagesConfig:
    mesh_dataset_dir: Path
    output_dir: Path
    blender_executable: str
    overwrite: bool


# Edit these values directly. No command-line arguments are required.
CONFIG = MeshToImagesConfig(
    mesh_dataset_dir=PROJECT_ROOT / "artifacts" / "meshes" / "Munich_building2",
    output_dir=PROJECT_ROOT / "artifacts" / "images" / "Munich_building2",
    blender_executable="blender",
    overwrite=True,
)
