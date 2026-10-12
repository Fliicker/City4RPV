import math
import sys
import unittest
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT / "src"))

from mesh_to_images import calculate_render_frame, camera_basis  # noqa: E402


def dot(first, second):
    return sum(a * b for a, b in zip(first, second))


def visible_spans(frame):
    aspect = frame.resolution_x / frame.resolution_y
    if aspect >= 1:
        return frame.ortho_scale, frame.ortho_scale / aspect
    return frame.ortho_scale * aspect, frame.ortho_scale


class CameraGeometryTest(unittest.TestCase):
    def test_top_view_is_east_right_and_north_up(self) -> None:
        basis = camera_basis(0, 90)
        self.assertTupleEqual(basis.right, (1.0, 0.0, 0.0))
        self.assertTupleEqual(basis.up, (0.0, 1.0, 0.0))
        self.assertAlmostEqual(basis.backward[2], 1.0)

    def test_oblique_basis_uses_clockwise_enu_azimuth(self) -> None:
        north = camera_basis(0, 45)
        east = camera_basis(90, 45)
        self.assertAlmostEqual(north.backward[1], math.sqrt(0.5))
        self.assertAlmostEqual(east.backward[0], math.sqrt(0.5))
        for basis in (north, east):
            self.assertAlmostEqual(dot(basis.right, basis.up), 0.0)
            self.assertAlmostEqual(dot(basis.right, basis.backward), 0.0)
            self.assertAlmostEqual(dot(basis.up, basis.backward), 0.0)

    def test_resolution_is_rectangular_and_does_not_magnify(self) -> None:
        vertices = [(x, y, z) for x in (-20.0, 20.0) for y in (-5.0, 5.0) for z in (0.0, 8.0)]
        frame = calculate_render_frame(
            vertices,
            azimuth_deg=0,
            elevation_deg=90,
            pixels_per_metre=10,
            margin=1.1,
            max_dimension=512,
            min_dimension=128,
            dimension_multiple=16,
        )
        self.assertGreater(frame.resolution_x, frame.resolution_y)
        self.assertLessEqual(max(frame.resolution_x, frame.resolution_y), 512)
        self.assertGreaterEqual(min(frame.resolution_x, frame.resolution_y), 128)
        self.assertEqual(frame.resolution_x % 16, 0)
        self.assertEqual(frame.resolution_y % 16, 0)
        self.assertLessEqual(frame.effective_pixels_per_metre, 10.0)
        visible_width, visible_height = visible_spans(frame)
        self.assertGreaterEqual(visible_width + 1e-9, frame.projected_width * 1.1)
        self.assertGreaterEqual(visible_height + 1e-9, frame.projected_height * 1.1)

    def test_large_mesh_reduces_density_and_small_mesh_only_adds_padding(self) -> None:
        large = calculate_render_frame(
            [(0, 0, 0), (100, 20, 10)], azimuth_deg=0, elevation_deg=90,
            pixels_per_metre=10, margin=1.1, max_dimension=512, min_dimension=128,
            dimension_multiple=16,
        )
        small = calculate_render_frame(
            [(0, 0, 0), (2, 1, 1)], azimuth_deg=0, elevation_deg=90,
            pixels_per_metre=10, margin=1.1, max_dimension=512, min_dimension=128,
            dimension_multiple=16,
        )
        self.assertLess(large.effective_pixels_per_metre, 10)
        self.assertLessEqual(small.effective_pixels_per_metre, 10)
        self.assertEqual(min(small.resolution_x, small.resolution_y), 128)

    def test_portrait_frame_contains_projected_vertices(self) -> None:
        vertices = [(x, y, z) for x in (-5.0, 5.0) for y in (-25.0, 25.0) for z in (0.0, 8.0)]
        frame = calculate_render_frame(
            vertices, azimuth_deg=0, elevation_deg=90, pixels_per_metre=10,
            margin=1.1, max_dimension=512, min_dimension=128, dimension_multiple=16,
        )
        self.assertLess(frame.resolution_x, frame.resolution_y)
        visible_width, visible_height = visible_spans(frame)
        self.assertGreaterEqual(visible_width + 1e-9, frame.projected_width * 1.1)
        self.assertGreaterEqual(visible_height + 1e-9, frame.projected_height * 1.1)


if __name__ == "__main__":
    unittest.main()
