#!/usr/bin/env python3
"""Fetch data from Sleeper's public API (read-only, no account or key).

Writes:
  raw/sleeper_trending.json   league counts of recent adds and drops
  raw/sleeper_players.json    status, injury designation, depth chart order and current team for QB/RB/WR/TE

Endpoints:
  GET https://api.sleeper.app/v1/players/nfl/trending/{add|drop}?lookback_hours=N&limit=M
      -> [{"player_id": "4881", "count": 312}, ...]   (counts are leagues, not roster percentages)
  GET https://api.sleeper.app/v1/players/nfl
      -> one large object keyed by player id. Sleeper asks apps to call it at most about once a day,
         so the result is cached for 10 hours (use --force-players to ignore the cache).

Run on its own:   python3 src/fetch_sleeper.py
Exit code 0 if anything was fetched, 1 if nothing could be (the dashboard still builds without it).
"""
import json
import sys
import time
import urllib.error
import urllib.request
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
BASE = "https://api.sleeper.app/v1/players/nfl"
TREND = BASE + "/trending"
WINDOWS = [24, 168]            # hours: last day, last 7 days
KINDS = ["add", "drop"]
LIMITS = [200, 100, 50]         # tried in order if the API rejects a large limit
POS = {"QB", "RB", "WR", "TE"}
PLAYER_CACHE_HOURS = 10
MAX_BYTES = 60_000_000


def get_json(url: str, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "gridiron-desk-personal", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(MAX_BYTES).decode("utf-8"))


def fetch(kind: str, hours: int):
    last_err = None
    for limit in LIMITS:
        url = f"{TREND}/{kind}?lookback_hours={hours}&limit={limit}"
        try:
            data = get_json(url)
            if isinstance(data, list):
                return data
            last_err = f"unexpected response: {str(data)[:120]}"
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            last_err = str(e)
        time.sleep(0.5)
    raise RuntimeError(f"{kind}/{hours}h failed: {last_err}")


def fetch_trending() -> bool:
    out = {"fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "data": {}}
    errors = []
    for hours in WINDOWS:
        for kind in KINDS:
            try:
                out["data"][f"{kind}_{hours}"] = fetch(kind, hours)
                print(f"[sleeper] {kind} last {hours}h: {len(out['data'][f'{kind}_{hours}'])} players")
            except RuntimeError as e:
                errors.append(str(e))
                print(f"[sleeper] {e}", file=sys.stderr)
            time.sleep(0.5)   # stay well under Sleeper's rate limit
    if not out["data"]:
        return False
    (RAW / "sleeper_trending.json").write_text(json.dumps(out))
    if errors:
        print(f"[sleeper] saved partial trending data ({len(errors)} request(s) failed)", file=sys.stderr)
    return True


def fetch_players(force=False) -> bool:
    path = RAW / "sleeper_players.json"
    if path.exists() and not force:
        try:
            age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(json.loads(path.read_text())["fetched"])
            if age < dt.timedelta(hours=PLAYER_CACHE_HOURS):
                print(f"[sleeper] player database is {age.seconds // 3600}h old; using the saved copy")
                return True
        except (ValueError, KeyError, OSError):
            pass
    try:
        allp = get_json(BASE, timeout=90)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"[sleeper] player database failed: {e}", file=sys.stderr)
        return path.exists()      # an older copy is still useful
    keep = {}
    for pid, p in allp.items():
        if p.get("position") not in POS:
            continue
        if not (p.get("active") or p.get("team")):
            continue
        keep[str(pid)] = {k: p.get(k) for k in ("team", "status", "injury_status", "injury_body_part", "injury_notes",
                                                  "depth_chart_order", "depth_chart_position", "position")}
    path.write_text(json.dumps({"fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "players": keep}))
    print(f"[sleeper] player database: {len(keep)} QB/RB/WR/TE saved")
    return True


def main() -> int:
    RAW.mkdir(exist_ok=True)
    ok1 = fetch_trending()
    ok2 = fetch_players(force="--force-players" in sys.argv)
    if not (ok1 or ok2):
        print("[sleeper] nothing fetched; dashboard will build without Sleeper data", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
