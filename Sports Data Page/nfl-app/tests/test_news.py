"""Tests fetch_news.py against a local fake feed server, then matches headlines to real players.
Run:  python3 tests/test_news.py   (no internet needed)"""
import http.server, importlib.util, json, subprocess, sys, tempfile, threading, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("fn", ROOT / "src" / "fetch_news.py")
fn = importlib.util.module_from_spec(spec); spec.loader.exec_module(fn)

now = dt.datetime.now(dt.timezone.utc)
def rfc(d): return d.strftime("%a, %d %b %Y %H:%M:%S +0000")
RSS = f"""<?xml version="1.0"?><rss version="2.0"><channel><title>Fake</title>
<item><title>Week 10 Waiver Wire: Joe Fagnano and Tyler Allgeier lead the pickups</title><link>https://example.com/a</link><pubDate>{rfc(now - dt.timedelta(hours=5))}</pubDate><description>&lt;p&gt;Add Chris Godwin if he is out there.&lt;/p&gt;</description></item>
<item><title>Jahmyr Gibbs's big day powers Lions</title><link>https://example.com/b</link><pubDate>{rfc(now - dt.timedelta(days=1))}</pubDate></item>
<item><title>Old waiver article about Joe Fagnano</title><link>https://example.com/old</link><pubDate>{rfc(now - dt.timedelta(days=40))}</pubDate></item>
<item><title>Bad link item mentions Jahmyr Gibbs</title><link>javascript:alert(1)</link></item>
<item><title>Unrelated: kicker news</title><link>https://example.com/c</link><pubDate>{rfc(now)}</pubDate></item>
<item><title>Duplicate of first</title><link>https://example.com/a</link></item>
</channel></rss>""".encode()
ATOM = f"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Fake Atom</title>
<entry><title>Must-add: Tyler Allgeier steps in</title><link rel="alternate" href="https://example.org/x"/><link rel="self" href="https://example.org/self"/><updated>{(now - dt.timedelta(hours=2)).isoformat()}</updated><summary>Short summary</summary></entry>
</feed>""".encode()
EVIL = b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa">]><rss><channel><item><title>&a;</title><link>https://e.com</link></item></channel></rss>'

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/rss": body = RSS
        elif self.path == "/atom": body = ATOM
        elif self.path == "/evil": body = EVIL
        elif self.path == "/junk": body = b"<html>not a feed"
        else: self.send_response(404); self.end_headers(); return
        self.send_response(200); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_port}"

tmp = Path(tempfile.mkdtemp())
(tmp / "feeds.json").write_text(json.dumps({"feeds": [
    {"name": "Fake RSS", "url": base + "/rss"}, {"name": "Fake Atom", "url": base + "/atom"},
    {"name": "Missing", "url": base + "/nope"}, {"name": "Evil", "url": base + "/evil"}, {"name": "Junk", "url": base + "/junk"}]}))
rc = fn.main(tmp / "feeds.json", tmp / "news_feed.json")
out = json.loads((tmp / "news_feed.json").read_text())
st = {s["name"]: s for s in out["feeds"]}
titles = [i["title"] for i in out["items"]]
checks = {
    "exit code 0 with some feeds failing": rc == 0,
    "RSS kept 3 items (old, bad-link, duplicate dropped)": st["Fake RSS"]["items"] == 3 and st["Fake RSS"]["ok"],
    "Atom entry read with alternate link": any(i["link"] == "https://example.org/x" for i in out["items"]),
    "stale item dropped": not any("Old waiver" in t for t in titles),
    "javascript: link dropped": not any(i["link"].startswith("javascript") for i in out["items"]),
    "404, entity file, and junk page reported as failed": not st["Missing"]["ok"] and not st["Evil"]["ok"] and not st["Junk"]["ok"],
    "HTML stripped from summary": any(i["summary"] == "Add Chris Godwin if he is out there." for i in out["items"]),
}
# all feeds failing -> exit 1
(tmp / "bad.json").write_text(json.dumps({"feeds": [{"name": "Missing", "url": base + "/nope"}]}))
checks["exit code 1 when every feed fails"] = fn.main(tmp / "bad.json", tmp / "x.json") == 1

# match against the real player list
r = subprocess.run([sys.executable, "-I", str(ROOT / "src" / "build_data.py"), "--news", str(tmp / "news_feed.json"), "--out", str(tmp / "data.json")], capture_output=True, text=True)
d = json.loads((tmp / "data.json").read_text())
name = {p["id"]: p["name"] for p in d["players"]}
def find(prefix):
    for i in d["buzz"]["items"]:
        if i["t"].startswith(prefix): return (i["k"], sorted(name[x] for x in i["p"]))
    raise SystemExit("no headline starting with " + prefix)
w = find("Week 10 Waiver Wire")
checks["waiver headline tagged waiver"] = w[0] == "waiver"
checks["names in headline matched"] = {"Joe Fagnano", "Tyler Allgeier"} <= set(w[1])
checks["name found in summary matched (suffix Jr. dropped)"] = any(n.startswith("Chris Godwin") for n in w[1])
checks["possessive matched"] = "Jahmyr Gibbs" in find("Jahmyr Gibbs's big day")[1]
checks["Atom must-add tagged waiver"] = find("Must-add: Tyler Allgeier")[0] == "waiver"
checks["unrelated non-waiver headline excluded"] = not any("kicker" in i["t"] for i in d["buzz"]["items"])
for k, v in checks.items(): print(("PASS " if v else "FAIL ") + k)
print("ALL PASS" if all(checks.values()) else "SOME FAILED"); print(r.stderr.strip().splitlines()[-2] if r.stderr else "")
sys.exit(0 if all(checks.values()) else 1)
