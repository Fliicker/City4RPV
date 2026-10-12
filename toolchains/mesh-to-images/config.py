from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class ViewSpec:
    view_id: str
    azimuth_deg: float
    elevation_deg: float


@dataclass(frozen=True)
class MeshToImagesConfig:
    mesh_dataset_dir: Path
    output_dir: Path
    blender_executable: Path
    views: tuple[ViewSpec, ...]
    pixels_per_metre: float
    margin: float
    max_dimension: int
    min_dimension: int
    dimension_multiple: int
    overwrite: bool


# Edit these values directly. No command-line arguments are required.
CONFIG = MeshToImagesConfig(
    mesh_dataset_dir=PROJECT_ROOT / "artifacts" / "meshes" / "Munich_building2",
    output_dir=PROJECT_ROOT / "artifacts" / "images" / "Munich_building2",
    blender_executable=Path(r"D:\Applications\Blender\blender.exe"),
    views=(
        ViewSpec("view_001", azimuth_deg=0, elevation_deg=90),
        ViewSpec("view_002", azimuth_deg=0, elevation_deg=45),
        ViewSpec("view_003", azimuth_deg=90, elevation_deg=45),
    ),
    pixels_per_metre=10.0,
    margin=1.10,
    max_dimension=512,
    min_dimension=128,
    dimension_multiple=16,
    overwrite=True,
)
