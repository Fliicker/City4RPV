import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT / "src"))

from mesh_to_images import discover_mesh_jobs  # noqa: E402
from mesh_to_images.pipeline import _rendered_building_id  # noqa: E402


class DiscoverMeshJobsTest(unittest.TestCase):
    def test_recognizes_only_completed_building_log_lines(self) -> None:
        self.assertEqual(_rendered_building_id("Rendered building w123 (3 views)"), "w123")
        self.assertEqual(_rendered_building_id("  Rendered building r9 (3 views)  "), "r9")
        self.assertIsNone(_rendered_building_id("Fra:1 Mem:20.00M | Rendering 1 / 64 samples"))
        self.assertIsNone(_rendered_building_id("Rendered building w123"))

    def test_discovers_manifest_and_mesh_files(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            dataset = root / "meshes"
            building = dataset / "w1"
            building.mkdir(parents=True)
            (building / "model.obj").write_text("", encoding="utf-8")
            (building / "model.mtl").write_text("", encoding="utf-8")
            (building / "manifest.json").write_text(json.dumps({
                "artifactType": "textured-mesh",
                "buildingId": "w1",
                "obj": "model.obj",
                "mtl": "model.mtl",
            }), encoding="utf-8")
            (dataset / "manifest.json").write_text(json.dumps({
                "artifactType": "textured-mesh-dataset",
                "buildings": [{"buildingId": "w1", "manifest": "w1/manifest.json"}],
            }), encoding="utf-8")

            jobs = discover_mesh_jobs(dataset, root / "images")
            self.assertEqual(len(jobs), 1)
            self.assertEqual(jobs[0].building_id, "w1")
            self.assertEqual(jobs[0].output_dir, root / "images" / "w1")


if __name__ == "__main__":
    unittest.main()
