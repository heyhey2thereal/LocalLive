"""Rotating file logging with a small, predictable footprint."""
from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from . import config


def setup_logging() -> None:
    config.ensure_dirs()
    root = logging.getLogger()
    if root.handlers:
        return
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

    file_handler = RotatingFileHandler(
        config.LOGS_DIR / "locallive.log",
        maxBytes=config.LOG_MAX_BYTES,
        backupCount=config.LOG_BACKUPS,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    root.addHandler(file_handler)

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root.addHandler(console)
