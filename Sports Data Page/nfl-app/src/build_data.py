#!/usr/bin/env python3
"""Build data/dashboard_data.json from nflverse CSVs in raw/ plus optional Sleeper, ESPN and RSS files.

Run:  python3 src/build_data.py
Inputs (raw/): stats_player_week_YYYY.csv, snap_counts_YYYY.csv, injuries_YYYY.csv, rosters_YYYY.csv, games.csv
Optional (raw/): sleeper_trending.json, sleeper_players.json, espn_ownership.json, espn_props.json, news_feed.json
"""
import json
import re
import sys
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)

CUR = 2026
SEASONS = [2024, 2025, 2026]
POS = ["QB", "RB", "WR", "TE"]
ESPN_POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE"}
SLEEPER_TEAM = {"LAR": "LA", "WSH": "WAS", "ARZ": "ARI", "JAC": "JAX", "LVR": "LV", "SD": "LAC", "STL": "LA", "OAK": "LV"}

# Kickers and team defenses keep their own game-log columns so the QB/RB/WR/TE rows stay small.
K_COLS = ["season", "week", "opp", "fgm", "fga", "fg39", "fg40", "fg50", "xpm", "xpa", "lng", "fp", "fpp", "tm"]
DST_COLS = ["season", "week", "opp", "sk", "dint", "fr", "dtd", "sttd", "sf", "blk", "pa", "yda", "fp", "fpp", "tm"]
TEAM_NAME = {"ARI": "Cardinals", "ATL": "Falcons", "BAL": "Ravens", "BUF": "Bills", "CAR": "Panthers", "CHI": "Bears",
             "CIN": "Bengals", "CLE": "Browns", "DAL": "Cowboys", "DEN": "Broncos", "DET": "Lions", "GB": "Packers",
             "HOU": "Texans", "IND": "Colts", "JAX": "Jaguars", "KC": "Chiefs", "LA": "Rams", "LAC": "Chargers",
             "LV": "Raiders", "MIA": "Dolphins", "MIN": "Vikings", "NE": "Patriots", "NO": "Saints", "NYG": "Giants",
             "NYJ": "Jets", "PHI": "Eagles", "PIT": "Steelers", "SEA": "Seahawks", "SF": "49ers", "TB": "Buccaneers",
             "TEN": "Titans", "WAS": "Commanders"}
ESPN_LOGO = {"LA": "lar", "WAS": "wsh"}
SLEEPER_DEF = {"LA": "LAR"}


def kicker_points(r) -> float:
    """Sleeper default kicker scoring: FG 0-39 = 3, 40-49 = 4, 50+ = 5, PAT = 1, missed FG or PAT = -1."""
    def v(c):
        x = getattr(r, c, 0)
        return 0 if pd.isna(x) else float(x)
    m39 = v("fg_made_0_19") + v("fg_made_20_29") + v("fg_made_30_39")
    m40, m50 = v("fg_made_40_49"), v("fg_made_50_59") + v("fg_made_60_")
    return 3 * m39 + 4 * m40 + 5 * m50 + v("pat_made") - (v("fg_att") - v("fg_made")) - (v("pat_att") - v("pat_made"))


def pa_points(pa) -> int:
    """Sleeper default D/ST points-allowed tiers."""
    if pa == 0: return 10
    if pa <= 6: return 7
    if pa <= 13: return 4
    if pa <= 20: return 1
    if pa <= 27: return 0
    if pa <= 34: return -1
    return -4


def load_team_stats() -> pd.DataFrame:
    frames = [pd.read_csv(RAW / f"stats_team_week_{s}.csv", low_memory=False) for s in SEASONS
              if (RAW / f"stats_team_week_{s}.csv").exists()]
    if not frames:
        return pd.DataFrame()
    t = pd.concat(frames, ignore_index=True)
    return t[t.season_type == "REG"].copy()


def dst_games(tst: pd.DataFrame, allg: pd.DataFrame) -> pd.DataFrame:
    """One row per team defense per game, with Sleeper default D/ST fantasy points.
    Sack 1, INT 2, fumble recovery 2, defensive or return TD 6, safety 2, blocked FG/punt 2, plus points-allowed tiers."""
    if tst.empty:
        return pd.DataFrame()
    t = tst.copy()
    for c in ["def_sacks", "def_interceptions", "fumble_recovery_opp", "def_tds", "special_teams_tds", "def_safeties",
              "def_fg_blocks", "def_punt_blocks", "passing_yards", "rushing_yards"]:
        t[c] = t[c].fillna(0) if c in t else 0
    opp = t[["season", "week", "team", "passing_yards", "rushing_yards"]].rename(columns={"team": "opponent_team"})
    opp["yda"] = opp.passing_yards + opp.rushing_yards
    t = t.merge(opp[["season", "week", "opponent_team", "yda"]], on=["season", "week", "opponent_team"], how="left")
    reg = allg[allg.game_type == "REG"]
    sc = pd.concat([reg[["season", "week", "home_team", "away_score"]].rename(columns={"home_team": "team", "away_score": "pa"}),
                    reg[["season", "week", "away_team", "home_score"]].rename(columns={"away_team": "team", "home_score": "pa"})])
    t = t.merge(sc, on=["season", "week", "team"], how="left")
    t = t[t.pa.notna()].copy()
    t["blk"] = t.def_fg_blocks + t.def_punt_blocks
    t["fp"] = (t.def_sacks + 2 * t.def_interceptions + 2 * t.fumble_recovery_opp + 6 * (t.def_tds + t.special_teams_tds)
               + 2 * t.def_safeties + 2 * t.blk + t.pa.map(lambda x: pa_points(int(x))))
    return t.sort_values(["season", "week"])


LOG_COLS = [
    "season", "week", "opp", "snap", "cmp", "att", "pyd", "ptd", "int",
    "ra", "ryd", "rtd", "tgt", "rec", "recyd", "rectd", "fl", "two",
    "fp", "fpp", "tsh", "ays", "wopr", "csh", "tm",
]


def norm_name(s: str) -> str:
    s = str(s).lower()
    s = re.sub(r"[.'’`]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    s = re.sub(r"[^a-z ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_stats() -> pd.DataFrame:
    frames = []
    for s in SEASONS:
        f = RAW / f"stats_player_week_{s}.csv"
        if f.exists():
            frames.append(pd.read_csv(f, low_memory=False))
    df = pd.concat(frames, ignore_index=True)
    return df[df.season_type == "REG"].copy()


def load_snaps() -> pd.DataFrame:
    frames = []
    for s in SEASONS:
        f = RAW / f"snap_counts_{s}.csv"
        if f.exists():
            frames.append(pd.read_csv(f))
    sn = pd.concat(frames, ignore_index=True)
    sn = sn[sn.game_type == "REG"].copy()
    sn["nm"] = sn.player.map(norm_name)
    sn = sn.drop_duplicates(["season", "week", "team", "nm"], keep="first")
    return sn[["season", "week", "team", "nm", "offense_pct", "offense_snaps"]]


# ---------------------------------------------------------------- headlines
WAIVER_RE = re.compile(r"waiver|pick-?ups?\b|pick ups?\b|streamers?|stash|sleepers?|must[- ]adds?|\badds\b|who to add|drop candidates?", re.I)
INJURY_RE = re.compile(r"ruled out|out for (?:the )?(?:season|year|rest)|season-ending|placed on (?:injured reserve|ir)\b|\bto ir\b|\bir\b|injur|\btorn\b|\bacl\b|will miss|expected to miss|exits?\b|leaves? (?:the )?game|carted|sidelined|doubtful|questionable|inactive|surgery|hamstring|concussion|ankle|\bknee\b|shoulder", re.I)
ROLE_RE = re.compile(r"named (?:the )?(?:starter|starting)|will start|to start|set to start|takes? over|taking over|steps? in|promoted|starting (?:qb|rb|wr|te|quarterback)|benched|replaces?\b|replaced|lead back|lead role|bell ?cow|elevated|activated|returns?\b|returning|expected to start", re.I)
TRADE_RE = re.compile(r"\btrad(?:ed|e)\b|acquire[sd]?|acquisition|claimed|\bwaived\b|released|signs? with|\bsigned\b", re.I)


def news_norm(s: str) -> str:
    """Normalize a headline or summary for name matching."""
    s = re.sub(r"['’]s\b", "", str(s).lower())
    return " " + norm_name(s) + " "


def build_buzz(raw: dict, players: list) -> dict:
    """Match player names to feed headlines. Full names only, so a last name alone never matches."""
    counts = {}
    for p in players:
        counts.setdefault(norm_name(p["name"]), []).append(p["id"])
    names = {n: ids[0] for n, ids in counts.items() if len(ids) == 1 and len(n.split()) >= 2}
    items = []
    for it in raw.get("items", []):
        link = str(it.get("link", ""))
        if not re.match(r"https?://", link, re.I):
            continue
        title = str(it.get("title", ""))
        summary = str(it.get("summary", ""))
        hay = news_norm(title + " . " + summary)
        hit = sorted({pid for n, pid in names.items() if " " + n + " " in hay})
        kind = "waiver" if WAIVER_RE.search(title) else "news"
        if not hit and kind != "waiver":
            continue
        text = title + " " + summary[:240]
        tags = [k for k, rx in (("injury", INJURY_RE), ("role", ROLE_RE), ("trade", TRADE_RE)) if rx.search(text)]
        snippet = summary[:220].rsplit(" ", 1)[0] + "…" if len(summary) > 220 else summary
        if snippet.strip().lower() == title.strip().lower():
            snippet = ""
        items.append({"t": title, "u": link, "s": it.get("source", ""), "d": it.get("published"),
                      "k": kind, "p": hit, "g": tags, "x": snippet})
    items.sort(key=lambda x: x["d"] or "", reverse=True)
    items = items[:700]
    print(f"[news] {len(items)} headlines kept; {sum(1 for i in items if i['p'])} name at least one QB/RB/WR/TE", file=sys.stderr)
    return {"fetched": raw.get("fetched"), "feeds": raw.get("feeds", []), "items": items}


def short_prac(s):
    if not isinstance(s, str):
        return None
    s = s.lower()
    if s.startswith("did not"):
        return "DNP"
    if s.startswith("limited"):
        return "LP"
    if s.startswith("full"):
        return "FP"
    return None


def main(out_path=None, sleeper_path=None, news_path=None, sleeper_players_path=None, espn_path=None, props_path=None) -> None:
    st = load_stats()
    for c in ["sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost",
              "passing_2pt_conversions", "rushing_2pt_conversions", "receiving_2pt_conversions",
              "passing_tds", "rushing_tds", "receiving_tds", "passing_yards", "rushing_yards", "receiving_yards"]:
        st[c] = st[c].fillna(0)
    st["fl"] = st.sack_fumbles_lost + st.rushing_fumbles_lost + st.receiving_fumbles_lost
    st["two"] = (st.passing_2pt_conversions + st.rushing_2pt_conversions + st.receiving_2pt_conversions)

    # Team carry totals per week -> carry share (all positions)
    team_car = (st.groupby(["season", "week", "team"]).carries.sum().rename("team_carries").reset_index())
    st = st.merge(team_car, on=["season", "week", "team"], how="left")
    st["csh"] = np.where(st.team_carries > 0, st.carries / st.team_carries, np.nan)

    # ---- defense vs position (season-to-date, current season) ----
    cur = st[(st.season == CUR) & st.position.isin(POS)].copy()
    cur["half"] = cur.fantasy_points + 0.5 * cur.receptions
    cur["tdall"] = cur.passing_tds + cur.rushing_tds + cur.receiving_tds
    cur["keyyd"] = np.where(cur.position == "QB", cur.passing_yards,
                            np.where(cur.position == "RB", cur.rushing_yards + cur.receiving_yards, cur.receiving_yards))
    g = (cur.groupby(["opponent_team", "position", "week"])
         [["fantasy_points", "half", "fantasy_points_ppr", "keyyd", "tdall"]].sum().reset_index())
    max_week = int(st[st.season == CUR].week.max())
    dvp = {}
    for pos in POS:
        gp = g[g.position == pos]
        fcols = ["fantasy_points", "half", "fantasy_points_ppr"]
        season_avg = gp.groupby("opponent_team")[fcols].mean()
        l4 = gp[gp.week > max_week - 4].groupby("opponent_team")[fcols].mean()
        n = gp.groupby("opponent_team").week.nunique()
        yd = gp.groupby("opponent_team").keyyd.mean()
        tdg = gp.groupby("opponent_team").tdall.mean()
        tdt = gp.groupby("opponent_team").tdall.sum()
        ranks = [season_avg[c].rank(ascending=False, method="min") for c in fcols]
        yr = yd.rank(ascending=False, method="min")
        for team in season_avg.index:
            dvp.setdefault(team, {})[pos] = {
                "n": int(n[team]),
                "fp": [round(float(x), 2) for x in season_avg.loc[team]],
                "l4": [round(float(x), 2) for x in l4.loc[team]] if team in l4.index else None,
                "rk": [int(r[team]) for r in ranks],
                "yd": round(float(yd[team]), 1), "yrk": int(yr[team]),
                "td": round(float(tdg[team]), 2), "tdt": int(tdt[team]),
            }

    # ---- defense rank by season and position (all weeks of that season, PPR points allowed) ----
    drk = {}
    allst = st[st.position.isin(POS)]
    for s in SEASONS:
        sub = allst[allst.season == s]
        if sub.empty:
            continue
        gg = sub.groupby(["opponent_team", "position", "week"]).fantasy_points_ppr.sum().reset_index()
        avg = gg.groupby(["position", "opponent_team"]).fantasy_points_ppr.mean()
        d = {}
        for pos in POS:
            a = avg.xs(pos, level=0)
            rk = a.rank(ascending=False, method="min")
            d[pos] = {t: int(rk[t]) for t in a.index}
        drk[str(s)] = d

    # ---- schedule and per-game context ----
    allg = pd.read_csv(RAW / "games.csv", low_memory=False)
    sched, weeks_played, gm = {}, {}, {}
    for s in SEASONS:
        reg = allg[(allg.season == s) & (allg.game_type == "REG")]
        sub = reg[reg.home_score.notna()]
        if sub.empty:
            continue
        d = {}
        for r in sub.itertuples():
            d.setdefault(r.home_team, [None] * 18)[int(r.week) - 1] = r.away_team
            d.setdefault(r.away_team, [None] * 18)[int(r.week) - 1] = r.home_team
        sched[str(s)] = d
        weeks_played[str(s)] = int(sub.week.max())
        # [opp, home, weekday, kickoff, team spread (negative = favorite), total, roof d/o, division, points for, points against]
        mm = {}
        for r in reg.itertuples():
            wk = int(r.week) - 1
            roof = None if pd.isna(r.roof) else ("d" if r.roof in ("dome", "closed") else "o")
            sp = None if pd.isna(r.spread_line) else float(r.spread_line)
            tot = None if pd.isna(r.total_line) else float(r.total_line)
            hs = None if pd.isna(r.home_score) else int(r.home_score)
            as_ = None if pd.isna(r.away_score) else int(r.away_score)
            wd = None if pd.isna(r.weekday) else str(r.weekday)[:3]
            tm = None if pd.isna(r.gametime) else str(r.gametime)
            dv = 0 if pd.isna(r.div_game) else int(r.div_game)
            for team, opp, home in ((r.home_team, r.away_team, 1), (r.away_team, r.home_team, 0)):
                spread = None if sp is None else (-sp if home else sp)
                mm.setdefault(team, [None] * 18)[wk] = [opp, home, wd, tm, spread, tot, roof, dv,
                                                        hs if home else as_, as_ if home else hs]
        gm[str(s)] = mm

    games = allg[(allg.season == CUR) & (allg.game_type == "REG")].copy()
    played_mask = games.home_score.notna()
    next_games = {}
    teams = sorted(set(games.home_team) | set(games.away_team))
    upcoming = games[~played_mask].sort_values(["week", "gameday", "gametime"])
    next_week = int(upcoming.week.min()) if len(upcoming) else None
    for t in teams:
        mine = upcoming[(upcoming.home_team == t) | (upcoming.away_team == t)]
        if mine.empty:
            continue
        r = mine.iloc[0]
        home = r.home_team == t
        sp = r.spread_line
        tot = r.total_line
        spread = None if pd.isna(sp) else float(-sp if home else sp)
        implied = None
        if not pd.isna(sp) and not pd.isna(tot):
            implied = float((tot + sp) / 2 if home else (tot - sp) / 2)
        next_games[t] = {
            "week": int(r.week),
            "opp": r.away_team if home else r.home_team,
            "home": bool(home),
            "date": str(r.gameday),
            "time": None if pd.isna(r.gametime) else str(r.gametime),
            "spread": spread,
            "total": None if pd.isna(tot) else float(tot),
            "implied": None if implied is None else round(implied, 2),
            "bye": bool(next_week is not None and int(r.week) > next_week),
        }

    # ---- snaps join ----
    sn = load_snaps()
    st["nm"] = st.player_display_name.map(norm_name)
    st = st.merge(sn, on=["season", "week", "team", "nm"], how="left")
    off = st[st.position.isin(POS + ["K"])]
    cur_off = off[off.position.isin(POS) & (off.season == CUR) & ((off.targets.fillna(0) + off.carries.fillna(0) + off.attempts.fillna(0)) > 0)]
    miss = cur_off.offense_pct.isna().mean()
    print(f"[snap join] {CUR} offensive rows without snap match: {miss:.1%}", file=sys.stderr)

    # ---- roster / injuries ----
    ros_all = pd.read_csv(RAW / f"rosters_{CUR}.csv", low_memory=False)
    ros = ros_all.sort_values("week").drop_duplicates("gsis_id", keep="last").set_index("gsis_id")
    inj = pd.read_csv(RAW / f"injuries_{CUR}.csv")
    inj_week = int(inj.week.max())
    inj = inj[inj.week == inj_week].drop_duplicates("gsis_id").set_index("gsis_id")

    # ---- optional: Sleeper player database (status, depth chart, current team) ----
    slp, slp_fetched = {}, None
    spp = Path(sleeper_players_path) if sleeper_players_path else RAW / "sleeper_players.json"
    if spp.exists():
        j = json.loads(spp.read_text())
        slp, slp_fetched = j.get("players", {}), j.get("fetched")
        print(f"[sleeper] player database: {len(slp)} players", file=sys.stderr)

    # ---- optional: ESPN rostered percentages ----
    esp, esp_by_name, esp_fetched = {}, {}, None
    epp = Path(espn_path) if espn_path else RAW / "espn_ownership.json"
    if epp.exists():
        j = json.loads(epp.read_text())
        esp, esp_fetched = j.get("players", {}), j.get("fetched")
        for k, v in esp.items():
            if v.get("pos") in list(ESPN_POS.values()) + ["K"]:
                esp_by_name.setdefault((norm_name(v.get("name", "")), v["pos"]), v)
        print(f"[espn] ownership for {len(esp)} players", file=sys.stderr)

    # ---- optional: DraftKings player lines (via ESPN) for the upcoming week ----
    props, props_meta = {}, None
    ppp = Path(props_path) if props_path else RAW / "espn_props.json"
    if ppp.exists():
        j = json.loads(ppp.read_text())
        props_meta = {"fetched": j.get("fetched"), "week": j.get("week"), "book": j.get("book", "DraftKings")}
        props = j.get("players", {})
        print(f"[props] lines for {len(props)} players, week {j.get('week')}", file=sys.stderr)

    def n(x, d=None):
        return None if pd.isna(x) else (round(float(x), 3) if d is None else round(float(x), d))

    # ---- players: everyone with a 2026 stat line, plus active roster players who have not played yet ----
    pool_ids = set(off[off.season == CUR].player_id)
    grouped = {pid: grp.sort_values(["season", "week"]) for pid, grp in off[off.player_id.isin(pool_ids)].groupby("player_id")}
    roster_only = [gid for gid, r in ros.iterrows()
                   if gid not in grouped and r.get("position") in POS + ["K"] and r.get("status") in ("ACT", "RES")]
    entries = [(pid, grp) for pid, grp in grouped.items()] + [(gid, None) for gid in roster_only]

    players = []
    for pid, grp in entries:
        rr = ros.loc[pid] if pid in ros.index else None
        last = grp.iloc[-1] if grp is not None else None
        stat_team = last.team if last is not None else None
        team = (rr.team if rr is not None and isinstance(rr.team, str) else stat_team)
        name = last.player_display_name if last is not None else rr.full_name
        pos = last.position if last is not None else rr.position
        sleeper_id = (str(int(rr.sleeper_id)) if rr is not None and not pd.isna(rr.sleeper_id) else None)
        espn_id = (str(int(rr.espn_id)) if rr is not None and not pd.isna(rr.espn_id) else None)

        rows = []
        if grp is not None and pos == "K":
            for r in grp.itertuples():
                rows.append([
                    int(r.season), int(r.week), r.opponent_team,
                    n(r.fg_made, 0), n(r.fg_att, 0),
                    n(sum(0 if pd.isna(getattr(r, c)) else getattr(r, c) for c in ("fg_made_0_19", "fg_made_20_29", "fg_made_30_39")), 0),
                    n(r.fg_made_40_49, 0), n((0 if pd.isna(r.fg_made_50_59) else r.fg_made_50_59) + (0 if pd.isna(r.fg_made_60_) else r.fg_made_60_), 0),
                    n(r.pat_made, 0), n(r.pat_att, 0), n(r.fg_long, 0),
                    round(kicker_points(r), 2), round(kicker_points(r), 2), r.team,
                ])
        elif grp is not None:
            for r in grp.itertuples():
                rows.append([
                    int(r.season), int(r.week), r.opponent_team,
                    n(r.offense_pct, 3),
                    n(r.completions), n(r.attempts), n(r.passing_yards), n(r.passing_tds), n(r.passing_interceptions),
                    n(r.carries), n(r.rushing_yards), n(r.rushing_tds),
                    n(r.targets), n(r.receptions), n(r.receiving_yards), n(r.receiving_tds),
                    n(r.fl), n(r.two),
                    n(r.fantasy_points, 2), n(r.fantasy_points_ppr, 2),
                    n(r.target_share, 3), n(r.air_yards_share, 3), n(r.wopr, 3),
                    n(r.csh, 3), r.team,
                ])

        # Sleeper: current team, status, depth chart position
        sl = None
        prev = None
        if sleeper_id and sleeper_id in slp:
            s = slp[sleeper_id]
            st_team = s.get("team")
            st_team = SLEEPER_TEAM.get(st_team, st_team) if st_team else None
            sl = {"t": st_team, "st": s.get("status"), "inj": s.get("injury_status"), "b": s.get("injury_body_part"),
                  "n": (s.get("injury_notes") or "")[:160] or None, "o": s.get("depth_chart_order"), "dp": s.get("depth_chart_position")}
            if st_team:
                if stat_team and st_team != stat_team:
                    prev = stat_team
                elif not stat_team and isinstance(team, str) and st_team != team:
                    prev = team
                team = st_team

        ij = inj.loc[pid] if pid in inj.index else None
        inj_obj = None
        if ij is not None:
            status = None if pd.isna(ij.report_status) else ij.report_status
            prac = short_prac(ij.practice_status)
            if status or prac in ("DNP", "LP"):
                inj_obj = {"status": status, "week": inj_week, "prac": prac,
                           "body": None if pd.isna(ij.report_primary_injury) else ij.report_primary_injury}

        own = None
        if esp:
            e = esp.get(espn_id) if espn_id else None
            if e is None:
                e = esp_by_name.get((norm_name(name), pos))
            if e is not None:
                own = {"p": e.get("own"), "s": e.get("start"), "c": e.get("chg")}

        # Lines as {market: [current, open]}; only for the week the dashboard is previewing.
        pr = None
        if props and espn_id and props_meta and props_meta.get("week") == next_week:
            got = props.get(espn_id)
            if got:
                pr = {k: [v.get("cur"), v.get("open")] for k, v in got.items()}

        head = (rr.headshot_url if rr is not None and isinstance(rr.headshot_url, str)
                else (last.headshot_url if last is not None and isinstance(last.headshot_url, str) else None))
        players.append({
            "id": pid, "name": name, "pos": pos, "team": team, "prev": prev, "head": head,
            "sleeper": sleeper_id, "espn": espn_id,
            "rstatus": (rr.status if rr is not None and isinstance(rr.status, str) else None),
            "inj": inj_obj, "sl": sl, "own": own, "props": pr,
            "next": next_games.get(team),
            "log": rows,
        })
    # ---- team defenses (D/ST) as their own "players" ----
    dst = dst_games(load_team_stats(), allg)
    esp_dst = {v.get("name"): k for k, v in esp.items() if v.get("pos") == "DST"}
    for team in teams:
        g = dst[dst.team == team] if not dst.empty else dst
        rows = [[int(r.season), int(r.week), r.opponent_team, int(r.def_sacks), int(r.def_interceptions), int(r.fumble_recovery_opp),
                 int(r.def_tds), int(r.special_teams_tds), int(r.def_safeties), int(r.blk), int(r.pa),
                 None if pd.isna(r.yda) else int(r.yda), float(r.fp), float(r.fp), team] for r in g.itertuples()]
        name = TEAM_NAME.get(team, team) + " D/ST"
        own = None
        eid = esp_dst.get(name)
        if eid is not None:
            e = esp[eid]
            own = {"p": e.get("own"), "s": e.get("start"), "c": e.get("chg")}
        players.append({
            "id": "DST-" + team, "name": name, "pos": "DST", "team": team, "prev": None,
            "head": f"https://a.espncdn.com/i/teamlogos/nfl/500/{ESPN_LOGO.get(team, team.lower())}.png",
            "sleeper": SLEEPER_DEF.get(team, team), "espn": eid, "rstatus": "ACT", "inj": None, "sl": None,
            "own": own, "props": None, "next": next_games.get(team), "log": rows,
        })

    # ---- matchups for K and D/ST (current season) ----
    def team_allow(df, key_team, cols, fp_col="fp"):
        """Per-game averages of `cols` grouped by `key_team`, plus fantasy points and last-4 points."""
        out = {}
        if df.empty:
            return out
        g = df.groupby([key_team, "week"])[[fp_col] + cols].sum().reset_index()
        avg = g.groupby(key_team).mean(numeric_only=True)
        l4 = g[g.week > max_week - 4].groupby(key_team)[fp_col].mean()
        rk = avg[fp_col].rank(ascending=False, method="min")
        for t in avg.index:
            fpv = round(float(avg.loc[t, fp_col]), 2)
            l4v = round(float(l4[t]), 2) if t in l4.index else None
            o = {"n": int(g[g[key_team] == t].week.nunique()), "fp": [fpv, fpv, fpv], "l4": None if l4v is None else [l4v, l4v, l4v],
                 "rk": [int(rk[t])] * 3}
            for c in cols:
                o[c] = round(float(avg.loc[t, c]), 2)
            out[t] = o
        return out

    kc = st[(st.season == CUR) & (st.position == "K")].copy()
    if not kc.empty:
        kc["kfp"] = [kicker_points(r) for r in kc.itertuples()]
        for c in ("fg_made", "fg_att", "pat_made"):
            kc[c] = kc[c].fillna(0)
        kc = kc.rename(columns={"fg_made": "fgm", "fg_att": "fga", "pat_made": "xpm"})
        for t, o in team_allow(kc, "opponent_team", ["fgm", "fga", "xpm"], "kfp").items():
            dvp.setdefault(t, {})["K"] = o
    if not dst.empty:
        dc = dst[dst.season == CUR].copy()
        dc["to"] = dc.def_interceptions + dc.fumble_recovery_opp
        dc = dc.rename(columns={"def_sacks": "sk", "pa": "pts"})
        # Keyed by the OFFENSE (opponent_team): what defenses score against that offense.
        for t, o in team_allow(dc, "opponent_team", ["pts", "sk", "to"]).items():
            dvp.setdefault(t, {})["DST"] = o

    players.sort(key=lambda p: p["name"])

    # ---- Sleeper trending adds/drops (optional; written by fetch_sleeper.py) ----
    sleeper = None
    sp = Path(sleeper_path) if sleeper_path else RAW / "sleeper_trending.json"
    if sp.exists():
        raw = json.loads(sp.read_text())
        s2g = {p["sleeper"]: p["id"] for p in players if p["sleeper"]}
        windows, matched, total = {}, 0, 0
        for key, lst in raw.get("data", {}).items():
            kind, hrs = key.split("_")
            for item in lst:
                total += 1
                gid = s2g.get(str(item.get("player_id")))
                if gid is None:
                    continue
                matched += 1
                windows.setdefault(hrs, {}).setdefault(kind, {})[gid] = int(item.get("count", 0))
        sleeper = {"fetched": raw.get("fetched"), "windows": windows}
        print(f"[sleeper] matched {matched} of {total} trending entries to players and defenses in the data", file=sys.stderr)

    # ---- headlines from RSS feeds (optional; written by fetch_news.py) ----
    buzz = None
    npth = Path(news_path) if news_path else RAW / "news_feed.json"
    if npth.exists():
        buzz = build_buzz(json.loads(npth.read_text()), players)

    news_file = DATA / "news.json"
    news = json.loads(news_file.read_text()) if news_file.exists() else {}

    out = {
        "meta": {
            "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "season": CUR,
            "last_week_played": max_week,
            "next_week": next_week,
            "injury_report_week": inj_week,
            "log_cols": LOG_COLS,
            "log_cols_k": K_COLS,
            "log_cols_dst": DST_COLS,
            "weeks_played": weeks_played,
            "sleeper_players_fetched": slp_fetched,
            "ownership_fetched": esp_fetched,
            "props": props_meta,
            "source": "nflverse (stats_player, snap_counts, injuries, rosters, schedules)",
        },
        "dvp": dvp,
        "drk": drk,
        "sched": sched,
        "gm": gm,
        "news": news,
        "sleeper": sleeper,
        "buzz": buzz,
        "players": players,
    }
    path = Path(out_path) if out_path else DATA / "dashboard_data.json"
    path.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print(f"wrote {path} ({path.stat().st_size/1e6:.2f} MB), {len(players)} players, "
          f"last week played {max_week}, next week {next_week}")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="output JSON path (default data/dashboard_data.json)")
    ap.add_argument("--sleeper", help="Sleeper trending JSON path (default raw/sleeper_trending.json)")
    ap.add_argument("--sleeper-players", help="Sleeper player database JSON (default raw/sleeper_players.json)")
    ap.add_argument("--espn", help="ESPN ownership JSON (default raw/espn_ownership.json)")
    ap.add_argument("--props", help="DraftKings lines JSON (default raw/espn_props.json)")
    ap.add_argument("--news", help="headline feed JSON path (default raw/news_feed.json)")
    a = ap.parse_args()
    main(a.out, a.sleeper, a.news, a.sleeper_players, a.espn, a.props)
