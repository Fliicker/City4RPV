import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOL_ROOT / "src"))

from images_to_vlm import discover_view_jobs, write_result  # noqa: E402


class ViewJobsTest(unittest.TestCase):
    def test_discovers_three_views_and_writes_structured_result(self) -> None:
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            building = root / "images" / "w1"
            building.mkdir(parents=True)
            for name in ("view_001.png", "view_002.png", "view_003.png"):
                (building / name).write_bytes(b"png")
            (building / "manifest.json").write_text(json.dumps({
                "artifactType": "multiview-images",
                "buildingId": "w1",
                "views": [
                    {"id": "view_001", "image": "view_001.png", "azimuthDeg": 0, "elevationDeg": 90, "width": 128, "height": 160},
                    {"id": "view_002", "image": "view_002.png", "azimuthDeg": 0, "elevationDeg": 45, "width": 128, "height": 192},
                    {"id": "view_003", "image": "view_003.png", "azimuthDeg": 90, "elevationDeg": 45, "width": 160, "height": 192},
                ],
            }), encoding="utf-8")
            (root / "images" / "manifest.json").write_text(json.dumps({
                "artifactType": "multiview-images-dataset",
                "buildings": [{"buildingId": "w1", "manifest": "w1/manifest.json"}],
            }), encoding="utf-8")

            jobs = discover_view_jobs(root / "images", root / "predictions")
            self.assertEqual(len(jobs), 1)
            self.assertEqual([view.view_id for view in jobs[0].views], ["view_001", "view_002", "view_003"])
            result_path = write_result(jobs[0], "flat")
            result = json.loads(result_path.read_text(encoding="utf-8"))
            self.assertEqual(result["buildingId"], "w1")
            self.assertEqual(result["roofType"], "flat")


if __name__ == "__main__":
    unittest.main()
