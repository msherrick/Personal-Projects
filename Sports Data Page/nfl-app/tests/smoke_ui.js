// Runs the UI code in node with a stub DOM and renders every view, checking for exceptions.
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "..");
const els = {};
function el(id) { return els[id] || (els[id] = { id, innerHTML: "", textContent: "", hidden: false, style: {}, value: "", addEventListener() {}, getAttribute() { return ""; } }); }
const noop = () => 0;
const ctx = { console, setInterval: noop, clearInterval: noop, setTimeout: noop, clearTimeout: noop, document: { getElementById: el, addEventListener() {} }, window: { addEventListener() {}, scrollTo() {}, innerWidth: 1200, innerHeight: 800 }, location: { hash: "" }, localStorage: { getItem() { return null; }, setItem() {} } };
ctx.self = ctx; vm.createContext(ctx);
vm.runInContext("var DATA = " + fs.readFileSync(process.env.DATA_JSON || path.join(root, "data/dashboard_data.json"), "utf8") + ";", ctx);
vm.runInContext(fs.readFileSync(path.join(root, "dashboard/core.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "dashboard/analysis.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "dashboard/app.js"), "utf8"), ctx);
vm.runInContext("NFLApp.init();", ctx);
const checks = [];
for (const fmt of ["ppr", "half", "std"]) for (const tab of ["home", "player", "compare", "matchups", "risers", "adds"]) {
  vm.runInContext(`NFLApp.state.fmt='${fmt}'; NFLApp.state.tab='${tab}'; NFLApp.render();`, ctx);
  const html = els.view.innerHTML;
  if (!html || html.includes("undefined") || html.includes("NaN")) checks.push(`${fmt}/${tab}: suspicious output (${html.length} chars)` + (html.includes("undefined") ? " has 'undefined'" : "") + (html.includes("NaN") ? " has 'NaN'" : ""));
}
for (const pos of ["ALL", "QB", "RB", "WR", "TE"]) for (const basis of ["last3", "last1"]) {
  vm.runInContext(`NFLApp.state.rpos='${pos}'; NFLApp.state.pos='${pos === "ALL" ? "WR" : pos}'; NFLApp.state.basis='${basis}'; NFLApp.state.tab='risers'; NFLApp.render(); `, ctx);
  if (/undefined|NaN/.test(els.view.innerHTML)) checks.push("risers " + pos + " " + basis + " bad output");
  vm.runInContext(`NFLApp.state.tab='matchups'; NFLApp.render();`, ctx);
  if (/undefined|NaN/.test(els.view.innerHTML)) checks.push("matchups " + pos + " bad output");
}
for (const win of [24, 168]) for (const apos of ["ALL", "QB", "RB", "WR", "TE"]) {
  vm.runInContext(`NFLApp.state.win=${win}; NFLApp.state.apos='${apos}'; NFLApp.state.tab='adds'; NFLApp.render();`, ctx);
  if (/undefined|NaN/.test(els.view.innerHTML)) checks.push("adds " + win + apos + " bad output");
}
const hasBz = vm.runInContext("!!(DATA.buzz && DATA.buzz.items)", ctx);
if (hasBz) {
  vm.runInContext(`NFLApp.state.apos='ALL'; NFLApp.state.tab='adds'; NFLApp.render();`, ctx);
  const a = els.view.innerHTML;
  console.log("Buzz in data: true | adds tab:", a.includes("Waiver buzz") ? "Waiver buzz" : "MISSING", a.includes("Recent waiver articles") ? "articles" : "MISSING articles", a.includes("Not working: Example broken feed") ? "feed status" : "MISSING feed status", /href="javascript/.test(a) ? "UNSAFE LINK" : "links safe");
  vm.runInContext(`NFLApp.state.pid=DATA.players.find(p=>p.name==='Lamar Jackson').id; NFLApp.state.tab='player'; NFLApp.render();`, ctx);
  const pj = els.view.innerHTML;
  console.log("Lamar page:", pj.includes("In the news") && pj.includes("Lamar Jackson injury update") ? "headline shown" : "MISSING headline");
  vm.runInContext(`NFLApp.state.tab='risers'; NFLApp.state.rpos='ALL'; NFLApp.render();`, ctx);
  console.log("Injury fallout latest headline:", els.view.innerHTML.includes("Latest headline") ? "shown" : "not shown (no flagged player has one)");
  for (const pos of ["QB", "RB", "WR", "TE"]) { vm.runInContext(`NFLApp.state.apos='${pos}'; NFLApp.state.tab='adds'; NFLApp.render();`, ctx); if (/undefined|NaN/.test(els.view.innerHTML)) checks.push("adds+buzz " + pos + " bad output"); }
}
const hasSl = vm.runInContext("!!(DATA.sleeper && DATA.sleeper.windows)", ctx);
vm.runInContext(`NFLApp.state.win=24; NFLApp.state.apos='ALL'; NFLApp.state.tab='adds'; NFLApp.render();`, ctx);
console.log("Sleeper in data:", hasSl, "| adds tab shows", hasSl ? (els.view.innerHTML.includes("Top 5 adds") ? "Top 5 adds" : "MISSING top 5") : (els.view.innerHTML.includes(hasBz ? "Sleeper adds and drops are not in this build" : "has no Sleeper or headline data") ? "setup message" : "MISSING message"));
for (const view of ["fantasy", "stats"]) for (const ids of [["WR", "WR"], ["QB", "QB"], ["RB", "WR", "TE"], ["QB", "RB"]]) {
  vm.runInContext(`(function(){var pick=function(pos,i){return DATA.players.filter(function(p){return p.pos===pos && p.rows.length>5;})[i].id;}; var seen={}; NFLApp.state.compare=${JSON.stringify(ids)}.map(function(pos){seen[pos]=(seen[pos]===undefined?0:seen[pos]+1); return pick(pos,seen[pos]);}); NFLApp.state.cmpView='${view}'; NFLApp.state.cmpScope='last'; NFLApp.state.cmpN=6; NFLApp.state.tab='compare'; NFLApp.render();})()`, ctx);
  if (/undefined|NaN/.test(els.cmpbody.innerHTML) || els.cmpbody.innerHTML.length < 300) checks.push("compare " + view + " " + ids.join("/") + " bad output");
}
for (const [scope, n] of [["season", 3], ["last", 1], ["last", 5], ["last", 40], ["since", 3]]) {
  vm.runInContext(`NFLApp.state.cmpView='fantasy'; NFLApp.state.cmpScope='${scope}'; NFLApp.state.cmpN=${n}; NFLApp.state.tab='compare'; NFLApp.render();`, ctx);
  if (/undefined|NaN/.test(els.cmpbody.innerHTML) || !els.cmpbody.innerHTML.includes("Points / game")) checks.push("compare " + scope + n + " bad output");
}
vm.runInContext(`NFLApp.state.pid=DATA.players.find(p=>p.name==='Jameis Winston').id; NFLApp.state.tab='player'; NFLApp.state.logSeason=2026; NFLApp.state.logView='pts'; NFLApp.render();`, ctx);
const jw = els.view.innerHTML;
console.log("Jameis: BYE row", /<tr class="bye"><td>8<\/td><td>BYE/.test(jw), "| week-1 DNP row", /<tr class="dnp"><td>1<\/td><td>DAL/.test(jw));
// every player page
const n = vm.runInContext("DATA.players.length", ctx);
let bad = 0;
for (let i = 0; i < n; i++) for (const view of ["pts", "stats", "splits"]) {
  try {
    const ptab = view === "splits" ? "splits" : "overview", lv = view === "splits" ? "pts" : view;
    vm.runInContext(`NFLApp.state.tab='player'; NFLApp.state.ptab='${ptab}'; NFLApp.state.splitQ=''; NFLApp.state.pid=DATA.players[${i}].id; NFLApp.state.logSeason=2026; NFLApp.state.logView='${lv}'; NFLApp.render();`, ctx);
    if (/undefined|NaN/.test(els.view.innerHTML)) { bad++; if (bad < 4) console.log("bad page:", vm.runInContext(`DATA.players[${i}].name`, ctx), (els.view.innerHTML.match(/.{40}(undefined|NaN).{20}/) || [])[0]); }
  } catch (e) { bad++; console.log("exception", i, e.message); }
}
// round 3: home position rotation, waiver sort/filter, matchups has four 32-row tables
for (const hpos of ["QB", "RB", "WR", "TE"]) {
  vm.runInContext(`NFLApp.state.ptab='overview'; NFLApp.state.hpos='${hpos}'; NFLApp.state.tab='home'; NFLApp.render();`, ctx);
  if (/undefined|NaN/.test(els.view.innerHTML + els.movers.innerHTML) || !els.movers.innerHTML.includes("Scoring up")) checks.push("home movers " + hpos + " bad output");
}
for (const wsort of ["articles", "recent", "adds"]) for (const wown of ["all", "u50"]) {
  vm.runInContext(`NFLApp.state.apos='ALL'; NFLApp.state.wsort='${wsort}'; NFLApp.state.wown='${wown}'; NFLApp.state.tab='adds'; NFLApp.render();`, ctx);
  if (/undefined|NaN/.test(els.view.innerHTML)) checks.push("adds " + wsort + "/" + wown + " bad output");
}
vm.runInContext(`NFLApp.state.tab='matchups'; NFLApp.render();`, ctx);
if ((els.view.innerHTML.match(/Defense stats vs/g) || []).length !== 4) checks.push("matchups: expected 4 tables");
console.log(checks.length ? checks.join("\n") : "views ok", "| player pages rendered:", n, "bad:", bad);
