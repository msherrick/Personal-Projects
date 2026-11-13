"""Writes a FAKE Sleeper response (random counts) for testing the UI. Never used for the real build.
Usage: python3 tests/make_mock_sleeper.py <dashboard_data.json> <out.json>"""
import json, random, sys
d = json.load(open(sys.argv[1]))
ids = [p["sleeper"] for p in d["players"] if p["sleeper"]]
rnd = random.Random(7)
out = {"fetched": "2026-11-03T12:00:00+00:00", "data": {}}
for kind in ("add", "drop"):
    for hrs, scale in ((24, 1), (168, 4)):
        sample = rnd.sample(ids, 120) + ["99999999", "00000000"]   # two unknown ids exercise the unmatched path
        out["data"][f"{kind}_{hrs}"] = sorted(({"player_id": i, "count": rnd.randint(5, 900) * scale} for i in sample), key=lambda x: -x["count"])
json.dump(out, open(sys.argv[2], "w"))
