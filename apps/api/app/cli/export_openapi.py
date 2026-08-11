"""Dump the OpenAPI schema to a file.

Feeds `npm run gen:types`, so the TypeScript clients are generated from the live
FastAPI schema rather than a hand-maintained copy. Runs without a database.

    uv run python -m app.cli.export_openapi ../../packages/api-types/openapi.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m app.cli.export_openapi <output.json>", file=sys.stderr)
        return 2

    from app.main import create_app

    destination = Path(argv[0]).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    schema = create_app().openapi()
    destination.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote OpenAPI schema to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
