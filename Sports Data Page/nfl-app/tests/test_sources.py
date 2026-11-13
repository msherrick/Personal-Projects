"""Offline tests for fetch_sleeper.py and fetch_espn.py using local fake servers shaped like the real responses.
Run:  python3 tests/test_sources.py"""
import http.server, importlib.util, json, sys, tempfile, threading
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "src" / f"{name}.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
sl, es = load("fetch_sleeper"), load("fetch_espn")

PLAYERS = {"4881": {"position": "QB", "team": "BAL", "active": True, "status": "Active", "injury_status": None, "depth_chart_order": 1, "depth_chart_position": "QB", "injury_body_part": None, "injury_notes": None},
           "8161": {"position": "QB", "team": "MIA", "active": True, "status": "Injured Reserve", "injury_status": "IR", "depth_chart_order": 2, "depth_chart_position": "QB", "injury_body_part": "Shoulder", "injury_notes": "Placed on IR"},
           "1": {"position": "K", "team": "BAL", "active": True}, "2": {"position": "WR", "team": None, "active": False}}
ESPN = {"players": [{"id": 4262921, "player": {"id": 4262921, "fullName": "Test Back", "defaultPositionId": 2, "ownership": {"percentOwned": 97.456, "percentStarted": 90.1, "percentChange": 0.123}}},
                    {"id": 5, "player": {"id": 5, "fullName": "A Kicker", "defaultPositionId": 5, "ownership": {"percentOwned": 80}}},
                    {"id": 6, "player": {"id": 6, "fullName": "No Own", "defaultPositionId": 3, "ownership": {}}}]}
calls = []
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        calls.append(self.path)
        if self.path.startswith("/v1/players/nfl/trending"):
            body = [{"player_id": "4881", "count": 12}]
        elif self.path == "/v1/players/nfl":
            body = PLAYERS
        elif self.path.startswith("/espn"):
            if "fail" in self.path: self.send_response(500); self.end_headers(); return
            self.filter = self.headers.get("X-Fantasy-Filter"); calls.append("FILTER " + str(self.filter)); body = ESPN
        else: self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(body).encode())
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"
tmp = Path(tempfile.mkdtemp()); sl.RAW = tmp; sl.BASE = base + "/v1/players/nfl"; sl.TREND = sl.BASE + "/trending"; sl.time.sleep = lambda s: None
rc = sl.main()
pl = json.loads((tmp / "sleeper_players.json").read_text())["players"]
n1 = len(calls)
sl.fetch_players()                         # second call must use the cache
checks = {
    "sleeper exit 0": rc == 0,
    "trending saved": (tmp / "sleeper_trending.json").exists(),
    "players keep QB with depth/status": pl.get("4881", {}).get("depth_chart_order") == 1 and pl["8161"]["injury_status"] == "IR",
    "kickers and inactive no-team players dropped": "1" not in pl and "2" not in pl,
    "player database cached (no second download)": len(calls) == n1,
}
es.RAW = tmp
es.URL = base + "/espn?x={season}"
rc2 = es.main()
oe = json.loads((tmp / "espn_ownership.json").read_text())["players"]
checks.update({
    "espn exit 0": rc2 == 0,
    "espn keeps only QB/RB/WR/TE with ownership": list(oe) == ["4262921"] and oe["4262921"]["own"] == 97.5,
    "espn sent the filter header": any(c.startswith("FILTER") and "sortPercOwned" in c for c in calls),
})
es.URL = base + "/espn-fail?x={season}"
checks["espn failure returns 1 and keeps going"] = es.main() == 1
for k, v in checks.items(): print(("PASS " if v else "FAIL ") + k)
print("ALL PASS" if all(checks.values()) else "SOME FAILED"); sys.exit(0 if all(checks.values()) else 1)
