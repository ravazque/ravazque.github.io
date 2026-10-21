"""Write the public snapshot for the GitHub Pages site from a saved report, without publishing it.

    python scripts/snapshot.py preview/data.json /srv/site/data/42.json

Same whitelist as the publish button (app.publish.snapshot), so the local site shows exactly what would be published.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.publish import snapshot  # noqa: E402


def main(src: str, dst: str):
    report = json.loads(Path(src).read_text())
    generated = report["periods"]["all"].get("generated", "")
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    Path(dst).write_text(json.dumps(snapshot(report, generated), ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {dst}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
