// Prints core.js results for a few players as JSON so a pandas script can cross-check them.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "data", "dashboard_data.json"), "utf8"));
const core = require(path.join(root, "dashboard", "core.js")).create(data);

const names = process.argv.slice(2);
const out = {};
for (const n of names) {
  const p = core.search(n, 1)[0];
  if (!p) { out[n] = null; continue; }
  const res = {};
  for (const f of ["ppr", "half", "std"]) {
    const s = core.summary(p, f, "season"), l3 = core.summary(p, f, "last3");
    res[f] = { g: s.g, fpg: s.fpg, l3: l3.fpg, opp: s.opp, ppo: s.ppo, snap: s.snap };
  }
  res.name = p.name; res.pos = p.pos; res.team = p.team;
  res.chips = core.chips(p, "ppr").map(c => c.text);
  res.matchup = core.matchup(p, "ppr");
  out[n] = res;
}
console.log(JSON.stringify(out));
