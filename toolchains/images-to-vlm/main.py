import sys

from config import CONFIG
from src.images_to_vlm import run_pipeline


if __name__ == "__main__":
    try:
        run_pipeline(CONFIG)
    except NotImplementedError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2) from error
