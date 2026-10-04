"""Check Python syntax and local documentation links without installing GPU models."""
import ast
from pathlib import Path
import re
root = Path(__file__).resolve().parent.parent
for folder in ("scripts", "runtime"):
    for path in (root / folder).rglob("*.py"):
        ast.parse(path.read_text(), filename=str(path))
errors = []
for path in [root / "README.md", root / "README.en.md", *root.joinpath("docs").glob("*.md")]:
    body = path.read_text()
    if body.count("```") % 2:
        errors.append(f"{path.name}: unclosed code fence")
    for target in re.findall(r"\]\(([^)]+)\)", body):
        if "://" in target or target.startswith(("#", "mailto:")):
            continue
        target = target.split("#")[0]
        if not (path.parent / target).exists():
            errors.append(f"{path.name}: missing {target}")
if errors:
    raise SystemExit("\n".join(errors))
print("Python syntax and local documentation links OK")
