#!/usr/bin/env python3
"""Refresh everything and rebuild the dashboard.

    python3 src/refresh.py            full refresh: nflverse stats, Sleeper, RSS headlines, rebuild, open page
    python3 src/refresh.py --quick    skip the nflverse downloads (use between games to update just
                                      Sleeper adds/drops and headlines)
    python3 src/refresh.py --no-open  rebuild without opening the page in your browser

Needs: python3, pandas, numpy.   (pip install pandas numpy)
Sleeper and the RSS feeds are optional: if one fails, the dashboard still builds without it.
"""
import argparse
import subprocess
import sys
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
RAW.mkdir(exist_ok=True)
CUR = 2026
SEASONS = [2024, 2025, 2026]
BASE = "https://github.com/nflverse/nflverse-data/releases/download"


def download_nflverse():
    files = {"games.csv": f"{BASE}/schedules/games.csv"}
    for s in SEASONS:
        files[f"stats_player_week_{s}.csv"] = f"{BASE}/stats_player/stats_player_week_{s}.csv"
        files[f"snap_counts_{s}.csv"] = f"{BASE}/snap_counts/snap_counts_{s}.csv"
    files[f"injuries_{CUR}.csv"] = f"{BASE}/injuries/injuries_{CUR}.csv"
    files[f"rosters_{CUR}.csv"] = f"{BASE}/rosters/roster_{CUR}.csv"
    for name, url in files.items():
        print("downloading", name)
        req = urllib.request.Request(url, headers={"User-Agent": "gridiron-desk-personal"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                (RAW / name).write_bytes(r.read())
        except Exception as e:  # noqa: BLE001 - show a plain message, keep the old file if there is one
            if (RAW / name).exists():
                print(f"  could not download {name} ({e}); using the copy from last time")
            else:
                sys.exit(f"Could not download {name} ({e}). Check your internet connection and try again.")


def run_optional(script, label):
    r = subprocess.run([sys.executable, str(ROOT / "src" / script)])
    if r.returncode != 0:
        print(f"{label} could not be fetched this time. Continuing without it.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--quick", action="store_true", help="skip the nflverse downloads")
    ap.add_argument("--no-open", action="store_true", help="do not open the page when finished")
    a = ap.parse_args()

    if a.quick:
        if not (RAW / "games.csv").exists():
            sys.exit("No earlier data found. Run without --quick first.")
        print("Quick mode: using the nflverse files already downloaded.")
    else:
        download_nflverse()
    run_optional("fetch_sleeper.py", "Sleeper data")
    run_optional("fetch_espn.py", "ESPN rostered percentages")
    run_optional("fetch_news.py", "Headlines")
    for script in ("build_data.py", "build_dashboard.py"):
        subprocess.run([sys.executable, str(ROOT / "src" / script)], check=True)

    page = ROOT / "dist" / "dashboard.html"
    print(f"\nDone. Dashboard: {page}")
    if not a.no_open:
        try:
            webbrowser.open(page.as_uri())
        except Exception:  # noqa: BLE001
            print("Open that file in your browser.")


if __name__ == "__main__":
    main()
