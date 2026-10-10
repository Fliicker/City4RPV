import subprocess
import sys
import os

from config import CONFIG, PROJECT_ROOT


def run() -> None:
    if CONFIG.run_tiles_to_mesh:
        npm = "npm.cmd" if os.name == "nt" else "npm"
        subprocess.run([npm, "run", "tiles-to-mesh:run"], cwd=PROJECT_ROOT, check=True, shell=False)
    if CONFIG.run_mesh_to_images:
        subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "toolchains" / "mesh-to-images" / "main.py")],
            cwd=PROJECT_ROOT,
            check=True,
            shell=False,
        )
    if CONFIG.run_images_to_vlm:
        subprocess.run(
            [sys.executable, str(PROJECT_ROOT / "toolchains" / "images-to-vlm" / "main.py")],
            cwd=PROJECT_ROOT,
            check=True,
            shell=False,
        )


if __name__ == "__main__":
    run()
