# Personal Projects

A collection of things I'm building.

## Gridiron Desk: NFL fantasy research dashboard

**[▶ Open the live dashboard](https://msherrick.github.io/Personal-Projects/gridiron-desk/)** · [Project details and setup](Sports%20Data%20Page/nfl-app/README.md) · [Code](Sports%20Data%20Page/nfl-app)

A fantasy football "guru" page built entirely on free public data, rebuilt twice a week.

- **Player pages:** trends, injury status, ESPN % rostered, a "chance at a bigger role" call-out when teammates are out, a full box score, and a plain-English stat lookup ("home games vs KC in primetime", "without Henderson").
- **New starters and injury fallout:** who takes over after injuries, trades, benchings and returns, using Sleeper depth charts, snap counts and headlines.
- **Matchups:** what every defense allows to QBs, RBs, WRs and TEs, ranked 1–32.
- **Risers, adds and drops:** usage and scoring changes, Sleeper add/drop trends, waiver articles, and "good game, low ownership" sleepers.
- Full PPR, half PPR and standard scoring.

Built with Python (pandas) for the data and plain JavaScript for the page. Data: [nflverse](https://github.com/nflverse/nflverse-data) stats, the public [Sleeper API](https://docs.sleeper.com/), ESPN fantasy ownership, and RSS headlines from public NFL news sites (headlines link to the original articles). Not affiliated with the NFL, ESPN or Sleeper.
