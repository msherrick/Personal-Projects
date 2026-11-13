# Gridiron Desk: project notes for Claude Code

Personal NFL fantasy/betting research dashboard on free public data (nflverse, Sleeper, ESPN, RSS). Owner wants it to become a "fantasy guru" reference. Full PPR is the default, with toggles for half PPR and standard.

## Run
- `python3 src/refresh.py` downloads nflverse, fetches Sleeper/ESPN/RSS, builds `data/dashboard_data.json`, then `dist/dashboard.html`. Options: `--quick`, `--no-open`.
- Tests: `node tests/smoke_ui.js`, `node tests/check_core.js`, `python3 tests/test_news.py`, `python3 tests/test_sources.py`.

## Layout
- `src/build_data.py` builds all data (logs, snaps, dvp, schedule/game context `gm`, Sleeper player DB `sl`, ESPN ownership `own`, injuries `inj`, buzz, news).
- `src/fetch_sleeper.py`, `src/fetch_espn.py`, `src/fetch_news.py` (feeds in `feeds.json`), `src/build_dashboard.py` (inlines data and JS into dist).
- `dashboard/core.js` is pure logic with no DOM. `dashboard/analysis.js` is new logic on top of core: availability, outlook, fallout, starterChanges, teamChanges, hiddenGems, waiverBuzz, dvpTables, splits (parseQuery, atAGlance). `dashboard/app.js` plus `template.html` is the UI.

## State: round-3 feedback is DONE (Nov 11, 2026, in Claude Code)
- analysis.js is inlined by build_dashboard.py (`/*__ANALYSIS__*/` slot) and used in app.js as `A`.
- All round-3 UI items are built: Home movers rotator + new starters + injury watch; Player injury/ownership header,
  bigger-role call-out with with/without teammate splits, Overview/Splits tabs, table-only box score; Compare Enter-to-add,
  fantasy-only rows, large photos; Matchups four heat-map tables; Risers new starters / out / changed teams / questionable;
  Adds waiver buzz opens articles, sort + under-50% filter, ESPN badges, "good game, low ownership".
- starterChanges() ignores RB/TE committee snap swaps; it flags a depth-chart change only if the new starter missed the
  team's last game or played < 60% of the leader's snap share. Trade arrivals are labeled "trade".
- Verified in a browser on live data: every tab, filter and all 663 player pages (Overview, Box score, Splits) render with
  no errors. Node.js is NOT installed on the owner's Mac, so `node tests/*.js` has not been run here (tests updated anyway).
- Preview: the session-root `.claude/launch.json` serves `dist/` on http://localhost:8765/dashboard.html.

Design decisions agreed with the owner in the claude.ai chat:
   - Scoring up: show GP, total and PPG together; flag small samples; measure over the last 3 team games so a player back from injury isn't padded with pre-injury games.
   - Home tables: QB/RB/WR/TE switch that auto-rotates and stops on click or hover.
   - % owned is ESPN-only (Sleeper has none); label it "ESPN". Show on Adds, Risers and player pages.
   - Box score: table only (passing/rushing/receiving groups); charts stay in the Fantasy view.
   - One starter/fallout engine shared by Trends, Home and Risers: Sleeper injury + depth chart, snap counts, roster team changes (trades), returns from injury, headlines. Show how the player did in past games without the injured teammate. Owner's test cases: Minshew/Beck (ARI), Willis IR/McCord, Cousins traded to MIN/Mendoza starts (LV), Mayfield back/Daniels benched, Kiner (NE: Henderson out, Rhamondre hurt).
   - Risers = what happened on the field; Adds & drops = what the market is doing. Risers rows show ownership + add counts.
   - Compare: Fantasy toggle shows only fantasy rows, Stats only real stats.
   - No RotoWire/Rotoballer blurbs (licensed). Suggested next feature: per-player Google News watchlist.

Possible next steps: per-player Google News watchlist; install Node.js and run the JS tests.

## Live sources (verified Nov 11, 2026)
- ESPN ownership works: 971 players returned, 645 of 663 dashboard players matched via nflverse `espn_id` (misses are deep bench).
- Sleeper `players/nfl` fields (injury_status, depth_chart_order) are present and populated. Call it at most once a day (cached 10h).
- All 7 RSS feeds in `feeds.json` respond (RotoWire returns only ~5 items).

## Rules
- Fantasy points: standard = `fantasy_points`, PPR = `fantasy_points_ppr`, half = average.
- Windows are by team games (including bye/DNP), not last-N games played.
- Headline-to-player matching uses full normalized names only.
- RotoWire/Rotoballer text is licensed; link out, never copy.
- Do not revert files you did not write; read them first.
