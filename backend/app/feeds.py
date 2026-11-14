"""RSS / Atom feed fetching for the ticker layer.

Keeps a small in-memory cache (a few minutes) so a scene can show a headline
band without hammering the upstream feed on every render. Parsing uses the
standard library only (xml.etree + urllib), so the target 2-core host keeps its
tiny footprint.
"""
from __future__ import annotations

import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

# Feed URL -> (fetched_at, items)
_CACHE: dict[str, tuple[float, list[dict[str, str]]]] = {}
_CACHE_TTL = 300.0  # seconds
_LOCK = threading.Lock()

_ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}


def _strip(text: str | None) -> str:
    return " ".join((text or "").split())


def _parse(xml_bytes: bytes) -> list[dict[str, str]]:
    """Parse an RSS 2.0 or Atom document into a list of {title, link, date}."""
    items: list[dict[str, str]] = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return items

    # RSS 2.0: <rss><channel><item>...
    for node in root.iter("item"):
        title = _strip(node.findtext("title"))
        link = _strip(node.findtext("link"))
        date = _strip(node.findtext("pubDate"))
        if title:
            items.append({"title": title, "link": link, "date": date})

    # Atom: <feed><entry>...
    if not items:
        for node in root.iterfind("a:entry", _ATOM_NS):
            title = _strip(node.findtext("a:title", namespaces=_ATOM_NS))
            link_node = node.find("a:link", _ATOM_NS)
            link = link_node.get("href", "") if link_node is not None else ""
            date = _strip(node.findtext("a:updated", namespaces=_ATOM_NS)) or _strip(
                node.findtext("a:published", namespaces=_ATOM_NS)
            )
            if title:
                items.append({"title": title, "link": link, "date": date})

    return items


def fetch(url: str, *, limit: int = 8, force: bool = False) -> list[dict[str, str]]:
    """Return up to `limit` headlines for a feed, using a short-lived cache.

    A network or parse failure yields an empty list (never raises) so a broken
    feed cannot take the engine down.
    """
    url = (url or "").strip()
    if not url:
        return []
    now = time.time()
    with _LOCK:
        cached = _CACHE.get(url)
        if cached and not force and now - cached[0] < _CACHE_TTL:
            return cached[1][:limit]

    items: list[dict[str, str]] = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "LocalLive/1.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:  # noqa: S310 (operator-provided URL)
            items = _parse(resp.read(2_000_000))
    except Exception:
        items = []

    with _LOCK:
        _CACHE[url] = (now, items)
    return items[:limit]


def ticker_text(url: str, *, limit: int = 8, separator: str = "   •   ") -> str:
    """Join the feed headlines into a single scrolling line."""
    items = fetch(url, limit=limit)
    if not items:
        return ""
    return separator.join(i["title"] for i in items)


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()
