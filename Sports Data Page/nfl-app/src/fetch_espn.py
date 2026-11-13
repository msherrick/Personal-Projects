#!/usr/bin/env python3
"""Fetch the share of ESPN fantasy leagues that roster each player (percent owned) and save raw/espn_ownership.json.

This uses ESPN's public fantasy site data (the same data its player pages show). It is not a documented or
supported API, so it can change or stop working without notice. If it fails, the dashboard simply hides the
rostered-percentage numbers.

Run on its own:   python3 src/fetch_espn.py
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
SEASON = 2026
POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE"}
URL = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leaguedefaults/3?"
       + urllib.parse.urlencode({"view": "kona_player_info"}))
FILTER = {"players": {"limit": 1500, "sortPercOwned": {"sortPriority": 1, "sortAsc": False}}}


def parse(data: dict) -> dict:
    """Return {espn_id: {own, start, chg, name, pos}} for QB/RB/WR/TE."""
    out = {}
    for entry in data.get("players", []):
        pl = entry.get("player") or {}
        pos = POS.get(pl.get("defaultPositionId"))
        own = pl.get("ownership") or entry.get("ownership") or {}
        if not pos or own.get("percentOwned") is None:
            continue
        pid = pl.get("id", entry.get("id"))
        if pid is None:
            continue
        out[str(pid)] = {"own": round(float(own["percentOwned"]), 1),
                         "start": None if own.get("percentStarted") is None else round(float(own["percentStarted"]), 1),
                         "chg": None if own.get("percentChange") is None else round(float(own["percentChange"]), 2),
                         "name": pl.get("fullName", ""), "pos": pos}
    return out


def main(out_path=None) -> int:
    RAW.mkdir(exist_ok=True)
    out_path = Path(out_path) if out_path else RAW / "espn_ownership.json"
    req = urllib.request.Request(
        URL.format(season=SEASON),
        headers={"User-Agent": "gridiron-desk-personal", "Accept": "application/json",
                 "X-Fantasy-Filter": json.dumps(FILTER), "X-Fantasy-Source": "kona"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read(30_000_000).decode("utf-8"))
        players = parse(data)
    except (urllib.error.URLError, TimeoutError, ValueError, AttributeError) as e:
        print(f"[espn] ownership failed: {getattr(e, 'reason', e)}", file=sys.stderr)
        return 1
    if not players:
        print("[espn] response had no ownership data (ESPN may have changed its format)", file=sys.stderr)
        return 1
    out_path.write_text(json.dumps({"fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                                    "season": SEASON, "players": players}))
    print(f"[espn] percent owned for {len(players)} QB/RB/WR/TE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
