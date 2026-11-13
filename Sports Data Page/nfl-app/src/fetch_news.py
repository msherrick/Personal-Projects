#!/usr/bin/env python3
"""Fetch recent headlines from the public RSS/Atom feeds listed in feeds.json.

Saves raw/news_feed.json. Only titles, links, dates and a short feed-supplied summary are kept
(the summary is used locally to match player names and is not shown in the dashboard).
A feed that fails is skipped and reported; the run succeeds if at least one feed worked.

Run on its own:   python3 src/fetch_news.py
"""
import html
import json
import re
import sys
import urllib.error
import urllib.request
import datetime as dt
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
FEEDS_FILE = ROOT / "feeds.json"
USER_AGENT = "gridiron-desk-personal/1.0"
MAX_AGE_DAYS = 14
MAX_ITEMS_PER_FEED = 150
MAX_BYTES = 3_000_000


def strip_tags(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d


def local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_feed(data: bytes):
    """Return a list of {title, link, summary, date} from RSS 2.0 or Atom bytes."""
    if b"<!ENTITY" in data:          # refuse entity tricks; real feeds do not need them
        raise ValueError("feed uses XML entities; skipped")
    root = ET.fromstring(data)
    out = []
    for el in root.iter():
        if local(el.tag) not in ("item", "entry"):
            continue
        d = {"title": "", "link": "", "summary": "", "date": None}
        for ch in el:
            n = local(ch.tag)
            if n == "title" and not d["title"]:
                d["title"] = strip_tags(ch.text)
            elif n == "link" and not d["link"]:
                if ch.get("href") and ch.get("rel") in (None, "alternate"):
                    d["link"] = ch.get("href").strip()
                elif ch.text and ch.text.strip():
                    d["link"] = ch.text.strip()
            elif n in ("description", "summary", "encoded", "content") and not d["summary"]:
                d["summary"] = strip_tags(ch.text)[:500]
            elif n in ("pubDate", "published", "updated", "date") and d["date"] is None:
                d["date"] = parse_date(ch.text)
        if d["title"] and re.match(r"https?://", d["link"], re.I):
            out.append(d)
    return out


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(MAX_BYTES)


def main(feeds_path=None, out_path=None) -> int:
    feeds_path = Path(feeds_path) if feeds_path else FEEDS_FILE
    out_path = Path(out_path) if out_path else RAW / "news_feed.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    feeds = json.loads(feeds_path.read_text()).get("feeds", [])
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=MAX_AGE_DAYS)
    items, status, seen = [], [], set()
    for f in feeds:
        name, url = f.get("name", "feed"), f.get("url", "")
        try:
            parsed = parse_feed(fetch_bytes(url))
        except (urllib.error.URLError, TimeoutError, ET.ParseError, ValueError, OSError) as e:
            msg = str(getattr(e, "reason", e))[:120]
            print(f"[news] {name}: failed ({msg})", file=sys.stderr)
            status.append({"name": name, "ok": False, "items": 0, "error": msg})
            continue
        kept = 0
        for d in parsed[:MAX_ITEMS_PER_FEED]:
            if d["date"] is not None and d["date"] < cutoff:
                continue
            if d["link"] in seen:
                continue
            seen.add(d["link"])
            items.append({"title": d["title"], "link": d["link"], "source": name, "summary": d["summary"],
                          "published": d["date"].isoformat(timespec="seconds") if d["date"] else None})
            kept += 1
        print(f"[news] {name}: {kept} recent headlines")
        status.append({"name": name, "ok": True, "items": kept, "error": None})
    if not any(s["ok"] for s in status):
        print("[news] no feed could be read; dashboard will build without headlines", file=sys.stderr)
        return 1
    out_path.write_text(json.dumps({"fetched": now.isoformat(timespec="seconds"), "feeds": status, "items": items}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
