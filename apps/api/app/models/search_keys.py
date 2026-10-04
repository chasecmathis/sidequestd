"""The generated columns search matches against (SPEC §6.6).

`public.search_normalize` (migration 5d2e8b4c9a17) strips accents, case and
punctuation: "Marvel's Spider-Man 2" is keyed `marvel s spider man 2`, and its
compact form, `marvelsspiderman2`, is what lets "spiderman" find it. Both are
STORED generated columns, so they can never drift from the text they key.

Mapped `deferred` wherever they appear: no response renders them, and search
only ever reads them in SQL, so loading them with every row would be cost for
nothing.
"""

from __future__ import annotations

import sqlalchemy as sa


def search_key(column: str) -> sa.Computed:
    return sa.Computed(f"public.search_normalize({column})", persisted=True)


def search_compact(column: str) -> sa.Computed:
    return sa.Computed(f"replace(public.search_normalize({column}), ' ', '')", persisted=True)
