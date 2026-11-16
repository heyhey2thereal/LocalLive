"""Semantic version comparison helpers.

Used to decide whether a published version is actually newer than the running
one, so the UI only offers an update when there is genuinely something to install.
"""
from __future__ import annotations


def parse(value: str | None) -> tuple[int, int, int]:
    """Parse "v1.2.3" (or "1.2.3-rc1") into a comparable (major, minor, patch).

    Anything unparseable degrades to (0, 0, 0).
    """
    if not value:
        return (0, 0, 0)
    text = value.strip().lstrip("vV")
    # Drop pre-release / build metadata.
    core = text.split("-")[0].split("+")[0]
    parts = core.split(".")
    numbers = []
    for part in parts[:3]:
        digits = "".join(ch for ch in part if ch.isdigit())
        numbers.append(int(digits) if digits else 0)
    while len(numbers) < 3:
        numbers.append(0)
    return (numbers[0], numbers[1], numbers[2])


def is_newer(candidate: str | None, current: str | None) -> bool:
    """True only when `candidate` is strictly newer than `current`."""
    return parse(candidate) > parse(current)
