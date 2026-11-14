#!/usr/bin/env python3
"""Fetch this week's DraftKings player prop lines (over/under numbers) and save raw/espn_props.json.

The lines come from ESPN's public sports data, which carries DraftKings' player props for each upcoming game.
It is not a documented or supported API, so it can change or stop working without notice. If it fails, the
dashboard simply hides the lines. Only the line itself is kept (for example 270.5 passing yards), with the
opening line when ESPN has it; payout odds are not stored.

Games that have already kicked off are skipped, so a Saturday run covers Sunday and Monday games.

Run on its own:   python3 src/fetch_props.py
"""
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
ODDS = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{eid}/competitions/{eid}/odds"
PROPS = ODDS + "/{prov}/propBets?lang=en&region=us&limit=1000&page={page}"
DRAFTKINGS = "100"

# ESPN market name (without " (incl. overtime)") -> short key used by the dashboard.
MARKETS = {
    "Total Passing Yards": "pyd",
    "Total Passing Touchdowns": "ptd",
    "Total Pass Completions": "cmp",
    "Total Passing Attempts": "att",
    "Total Passing Interceptions": "int",
    "Total Rushing Yards": "ryd",
    "Total Carries": "ra",
    "Total Receiving Yards": "recyd",
    "Total Receptions": "rec",
    "Total Rushing Plus Receiving Yards": "rryd",
    "Total Passing Plus Rushing Yards": "pryd",
    "Anytime Touchdown Scorer": "atd",
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "gridiron-desk-personal", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read(20_000_000).decode("utf-8"))


def _num(side):
    t = (side or {}).get("target") or {}
    v = t.get("value")
    return None if v is None else float(v)


def parse_props(items, out):
    """Add lines from propBets items into out = {espn_athlete_id: {key: {"cur", "open", "upd"}}}."""
    for it in items:
        ath = ((it.get("athlete") or {}).get("$ref") or "")
        if "/athletes/" not in ath:
            continue
        aid = ath.split("/athletes/")[1].split("?")[0].split("/")[0]
        name = ((it.get("type") or {}).get("name") or "").replace(" (incl. overtime)", "").strip()
        key = MARKETS.get(name)
        if not key:
            continue
        cur, opn, upd = _num(it.get("current")), _num(it.get("open")), it.get("lastUpdated") or ""
        if key == "atd":
            cur, opn = 0.5, None          # listed for an anytime TD: "over 0.5 touchdowns"
        if cur is None:
            continue
        prev = out.setdefault(aid, {}).get(key)
        if prev is None or upd >= prev["upd"]:     # several entries per market; keep the newest
            out[aid][key] = {"cur": cur, "open": opn if opn is not None else (prev or {}).get("open"), "upd": upd}
    return out


def main(out_path=None) -> int:
    RAW.mkdir(exist_ok=True)
    out_path = Path(out_path) if out_path else RAW / "espn_props.json"
    try:
        sb = get(SCOREBOARD)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"[props] scoreboard failed: {getattr(e, 'reason', e)}", file=sys.stderr)
        return 1
    week = (sb.get("week") or {}).get("number")
    season = (sb.get("season") or {}).get("year")
    events = [e for e in sb.get("events", []) if ((e.get("status") or {}).get("type") or {}).get("state") == "pre"]
    lines, games, failed = {}, 0, 0
    for ev in events:
        eid = ev.get("id")
        try:
            pages, page = 1, 1
            while page <= pages:
                d = get(PROPS.format(eid=eid, prov=DRAFTKINGS, page=page))
                pages = d.get("pageCount") or 1
                parse_props(d.get("items", []), lines)
                page += 1
                time.sleep(0.2)
            games += 1
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            failed += 1
            print(f"[props] {ev.get('shortName', eid)}: {getattr(e, 'reason', e)}", file=sys.stderr)
    if not lines:
        print("[props] no player lines found (none posted yet, or ESPN changed its format)", file=sys.stderr)
        return 1
    out_path.write_text(json.dumps({"fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                                    "season": season, "week": week, "book": "DraftKings", "players": lines}))
    print(f"[props] DraftKings lines for {len(lines)} players in {games} games, week {week}"
          + (f" ({failed} games failed)" if failed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
