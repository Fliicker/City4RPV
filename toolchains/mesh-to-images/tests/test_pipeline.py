import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT / "src"))

from mesh_to_images import discover_mesh_jobs  # noqa: E402


class DiscoverMeshJobsTest(unittest.TestCase):
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
