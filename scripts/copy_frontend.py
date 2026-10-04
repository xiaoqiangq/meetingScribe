"""Copy built frontend to Go embed directory without deleting existing files."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parent.parent
source = root / "web/frontend/dist"
target = root / "internal/web/dist"
if not (source / "index.html").is_file():
    raise SystemExit("Build web/frontend first")
if target.exists() and any(target.iterdir()):
    raise SystemExit("Target is not empty. Use a fresh build checkout.")
shutil.copytree(source, target, dirs_exist_ok=True)
