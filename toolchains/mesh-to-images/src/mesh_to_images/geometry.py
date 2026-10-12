import math
from dataclasses import asdict, dataclass
from typing import Iterable, Sequence


Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class CameraBasis:
    right: Vec3
    up: Vec3
    backward: Vec3


@dataclass(frozen=True)
class RenderFrame:
    centre: Vec3
    basis: CameraBasis
    resolution_x: int
    resolution_y: int
    ortho_scale: float
    camera_distance: float
    clip_start: float
    clip_end: float
    projected_width: float
    projected_height: float
    effective_pixels_per_metre: float

    def to_dict(self) -> dict:
        return asdict(self)


def _dot(first: Vec3, second: Vec3) -> float:
    return sum(a * b for a, b in zip(first, second))


def _cross(first: Vec3, second: Vec3) -> Vec3:
    return (
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
    )


def _add(*vectors: Vec3) -> Vec3:
    return tuple(sum(values) for values in zip(*vectors))  # type: ignore[return-value]


def _scale(vector: Vec3, value: float) -> Vec3:
    return tuple(component * value for component in vector)  # type: ignore[return-value]


def _normalise(vector: Vec3) -> Vec3:
    length = math.sqrt(_dot(vector, vector))
    if length <= 1e-12:
        raise ValueError("Cannot normalise a zero-length vector")
    return _scale(vector, 1.0 / length)


def camera_basis(azimuth_deg: float, elevation_deg: float) -> CameraBasis:
    if not math.isfinite(azimuth_deg) or not math.isfinite(elevation_deg):
        raise ValueError("Camera angles must be finite")
    if elevation_deg < 0 or elevation_deg > 90:
        raise ValueError("Camera elevation must be between 0 and 90 degrees")
    azimuth = math.radians(azimuth_deg)
    elevation = math.radians(elevation_deg)
    backward = _normalise((
        math.sin(azimuth) * math.cos(elevation),
        math.cos(azimuth) * math.cos(elevation),
        math.sin(elevation),
    ))
    if abs(elevation_deg - 90.0) <= 1e-8:
        up = (0.0, 1.0, 0.0)
    else:
        world_up = (0.0, 0.0, 1.0)
        up = _normalise(_add(world_up, _scale(backward, -_dot(world_up, backward))))
    right = _normalise(_cross(up, backward))
    return CameraBasis(right=right, up=up, backward=backward)


def _ceil_multiple(value: float, multiple: int) -> int:
    return int(math.ceil(value / multiple) * multiple)


def calculate_render_frame(
    vertices: Sequence[Vec3] | Iterable[Vec3],
    *,
    azimuth_deg: float,
    elevation_deg: float,
    pixels_per_metre: float,
    margin: float,
    max_dimension: int,
    min_dimension: int,
    dimension_multiple: int,
) -> RenderFrame:
    points = list(vertices)
    if not points:
        raise ValueError("Mesh contains no vertices")
    if pixels_per_metre <= 0 or not math.isfinite(pixels_per_metre):
        raise ValueError("pixels_per_metre must be a finite positive number")
    if margin < 1 or not math.isfinite(margin):
        raise ValueError("margin must be finite and at least 1")
    if dimension_multiple < 1:
        raise ValueError("dimension_multiple must be positive")
    if min_dimension < dimension_multiple or max_dimension < min_dimension:
        raise ValueError("Image dimension bounds are invalid")
    if min_dimension % dimension_multiple or max_dimension % dimension_multiple:
        raise ValueError("Image dimension bounds must be multiples of dimension_multiple")

    basis = camera_basis(azimuth_deg, elevation_deg)
    mins = [min(point[index] for point in points) for index in range(3)]
    maxs = [max(point[index] for point in points) for index in range(3)]
    origin: Vec3 = tuple((mins[index] + maxs[index]) / 2 for index in range(3))  # type: ignore[assignment]
    relative = [tuple(point[index] - origin[index] for index in range(3)) for point in points]
    projected_x = [_dot(point, basis.right) for point in relative]
    projected_y = [_dot(point, basis.up) for point in relative]
    projected_z = [_dot(point, basis.backward) for point in relative]
    x_min, x_max = min(projected_x), max(projected_x)
    y_min, y_max = min(projected_y), max(projected_y)
    z_min, z_max = min(projected_z), max(projected_z)
    width = max(x_max - x_min, 1e-6)
    height = max(y_max - y_min, 1e-6)
    frame_width = width * margin
    frame_height = height * margin
    effective_ppm = min(pixels_per_metre, max_dimension / frame_width, max_dimension / frame_height)
    resolution_x = min(max_dimension, max(min_dimension, _ceil_multiple(frame_width * effective_ppm, dimension_multiple)))
    resolution_y = min(max_dimension, max(min_dimension, _ceil_multiple(frame_height * effective_ppm, dimension_multiple)))
    aspect = resolution_x / resolution_y
    # Blender applies Camera.ortho_scale to the render's longer image axis.
    # The shorter span follows from the aspect ratio.
    if aspect >= 1.0:
        ortho_scale = max(frame_width, frame_height * aspect, resolution_x / effective_ppm)
        actual_ppm = resolution_x / ortho_scale
    else:
        ortho_scale = max(frame_height, frame_width / aspect, resolution_y / effective_ppm)
        actual_ppm = resolution_y / ortho_scale

    centre = _add(
        origin,
        _scale(basis.right, (x_min + x_max) / 2),
        _scale(basis.up, (y_min + y_max) / 2),
        _scale(basis.backward, (z_min + z_max) / 2),
    )
    diagonal = math.sqrt(sum((maxs[index] - mins[index]) ** 2 for index in range(3)))
    depth = max(z_max - z_min, 1e-6)
    camera_distance = max(10.0, diagonal * 2.0, depth * 2.0)
    return RenderFrame(
        centre=centre,
        basis=basis,
        resolution_x=resolution_x,
        resolution_y=resolution_y,
        ortho_scale=ortho_scale,
        camera_distance=camera_distance,
        clip_start=0.01,
        clip_end=max(100.0, camera_distance + depth * 2.0 + 10.0),
        projected_width=width,
        projected_height=height,
        effective_pixels_per_metre=actual_ppm,
    )
