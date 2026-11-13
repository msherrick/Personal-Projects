# Gridiron Desk (NFL)

Personal fantasy and betting research dashboard built on free public data.

## Refresh the dashboard (this is all you need each week)
One-time setup:

    pip install pandas numpy

Then, from this folder, either double-click a launcher or run the command:

- Mac: double-click `Refresh Dashboard.command` (first time: right-click, Open)
- Windows: double-click `Refresh Dashboard.bat`
- Any system: `python3 src/refresh.py`

It downloads the latest nflverse stats, pulls Sleeper's trending adds and drops, reads headlines from the RSS feeds in
`feeds.json`, rebuilds the page, and opens `dist/dashboard.html` in your browser. You never need a new zip unless the
code itself is being changed.

Options:
- `python3 src/refresh.py --quick` skips the nflverse downloads. Use it midweek to update just Sleeper and headlines.
- `python3 src/refresh.py --no-open` rebuilds without opening the page.

Best timing: Tuesday after Monday Night Football for new stats, then again Wednesday or Thursday morning for waiver
headlines and Sleeper adds/drops.

Sleeper and the RSS feeds are optional. If either fails, the run says so and the dashboard still builds without it.

## Headlines (RSS)
`feeds.json` lists the feeds. Add, remove or fix entries freely (a feed that errors is named on the Adds & drops tab).
Only headlines and links are stored; articles open on the original sites. A player counts as named when his full name
appears in a headline or in the short summary the feed supplies. Waiver articles are spotted by words like waiver,
pickup, streamer, stash, sleeper and must-add in the headline.

## What is here
- `src/refresh.py`            one command: download, fetch, build, open
- `src/fetch_sleeper.py`      trending adds/drops from Sleeper (public API, no account or key)
- `src/fetch_espn.py`         ESPN "% rostered" for every player (unofficial ESPN endpoint; ESPN leagues only)
- `src/fetch_news.py`         headlines from the feeds in feeds.json
- `src/build_data.py`         builds data/dashboard_data.json (logs, snap %, defense vs position, schedule, Sleeper, headlines)
- `src/build_dashboard.py`    inlines data and code into dist/dashboard.html
- `dashboard/core.js`         the fantasy math (scoring formats, trends, compare, risers). Tested against pandas.
- `dashboard/analysis.js`     availability, new starters (injury, trade, benching, return), injury fallout, splits and
                              plain-English stat questions, hidden gems, waiver buzz, defense-vs-position tables
- `dashboard/app.js`, `template.html`   the interface
- `tests/`                    `node tests/smoke_ui.js` renders every view and player page;
                              `python3 tests/test_news.py` checks the feed reader and name matching offline.
                              `python3 tests/test_sources.py` checks the Sleeper and ESPN fetchers offline.
                              The node tests need Node.js (https://nodejs.org).
                              `tests/sample_news_feed.json` is fake sample data for testing.

## Fantasy scoring
nflverse supplies standard and PPR points. Half PPR = (standard + PPR) / 2. Standard formula: 0.04 per pass yard,
4 per pass TD, -2 per INT, 0.1 per rush or receiving yard, 6 per TD, -2 per fumble lost, 2 per two-point conversion.

## What each tab shows
- Home: movers (scoring up / workload up) that rotate QB, RB, WR, TE until you pick one; new starters; injury watch.
- Player: injury status and ESPN % rostered in the header; a "chance at a bigger role" call-out when teammates are out,
  with his numbers in past games without them; Overview (charts, or a table-only box score) and Splits & stat lookup
  (type questions like "home games vs KC in primetime" or "without Henderson").
- Compare: Fantasy view (points, consistency, opportunity) or Stats view (box-score totals and rates). Enter adds a player.
- Matchups: four tables, defense stats vs QB / RB / WR / TE, ranked 1-32 per column, green (easiest) to red (toughest).
- Risers: new starters, players out or on IR with who is next up, players who changed teams, questionable starters,
  then the usage and scoring lists.
- Adds & drops: waiver buzz (click a name to open the article), "good game, low ownership", Sleeper adds and drops.

## Not included yet
Prop lines, RotoWire/RotoBaller player blurbs (licensed text, no public feed), Reddit or social media, how long an
injured player is expected to be out, a per-player news watchlist.
