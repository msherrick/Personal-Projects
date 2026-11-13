/* UI for the NFL dashboard. Expects globals DATA (from build), NFLCore (core.js) and NFLAnalysis (analysis.js). */
(function (root) {
  "use strict";
  var core = NFLCore.create(DATA);
  var A = NFLAnalysis.create(core);
  var meta = DATA.meta, CUR = meta.season, WK = meta.last_week_played;
  var FORMATS = core.FORMATS;
  var TABS = ["home", "player", "compare", "matchups", "risers", "adds"];
  var TAB_LABEL = { home: "Home", player: "Player", compare: "Compare", matchups: "Matchups", risers: "Risers", adds: "Adds & drops" };

  var state = {
    fmt: "ppr", tab: "home", pid: null, logSeason: CUR, logView: "pts",
    compare: [], cmpScope: "season", cmpN: 3, pos: "WR", rpos: "ALL", basis: "last3", win: 24, apos: "ALL", cmpView: "fantasy",
    hpos: "QB", hlock: false, hpause: false, ptab: "overview", splitQ: "", splitSeason: "", splitPos: "WR", wsort: "articles", wown: "all"
  };
  var nextByTeam = {};
  DATA.players.forEach(function (p) { if (p.next && !nextByTeam[p.team]) nextByTeam[p.team] = p.next; });

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function f1(x) { return x == null || isNaN(x) ? "–" : x.toFixed(1); }
  function f2(x) { return x == null || isNaN(x) ? "–" : x.toFixed(2); }
  function f0(x) { return x == null || isNaN(x) ? "–" : String(Math.round(x)); }
  function pc(x) { return x == null || isNaN(x) ? "–" : Math.round(x * 100) + "%"; }
  function sgn(x, d) { if (x == null) return "–"; var s = x > 0 ? "+" : x < 0 ? "−" : ""; return s + Math.abs(x).toFixed(d == null ? 1 : d); }
  function sumKey(rows, k) { var s = 0; rows.forEach(function (r) { s += r[k] || 0; }); return s; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function fmtLabel() { return FORMATS[state.fmt]; }
  function fmtShort() { return state.fmt === "ppr" ? "PPR" : state.fmt === "half" ? "Half" : "Std"; }
  function player(id) { return core.byId[id]; }

  function initials(name) {
    var parts = name.replace(/\b(Jr|Sr|II|III|IV)\.?$/i, "").trim().split(/\s+/);
    return ((parts[0] || "?").charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : "")).toUpperCase();
  }
  function avatar(p, cls) {
    return '<span class="av ' + (cls || "") + '" aria-hidden="true">' + esc(initials(p.name)) +
      (p.head ? '<img alt="" loading="lazy" src="' + esc(p.head) + '">' : "") + "</span>";
  }
  function who(p) { return '<span class="nm">' + esc(p.name) + ' <span class="sub">' + p.pos + " · " + p.team + "</span></span>"; }
  function playerRow(p, vals) {
    return '<li><button class="rowbtn" data-open="' + esc(p.id) + '">' + avatar(p) + who(p) + '<span class="vals">' + vals + "</span></button></li>";
  }
  /* ESPN rostered % (share of ESPN leagues that roster the player). Empty when ESPN data is missing. */
  function ownPct(o) { return o < 10 ? o.toFixed(1) : String(Math.round(o)); }
  function ownBadge(p) {
    var o = A.own(p);
    if (o == null) return "";
    var cls = o < 25 ? "lo" : o < 60 ? "mid" : "hi";
    return ' <span class="own ' + cls + '" data-tip="Rostered in ' + ownPct(o) + '% of ESPN fantasy leagues">' + ownPct(o) + "% ESPN</span>";
  }
  function addsTxt(p) {
    var n = core.hasSleeper() ? core.slCount(p, "add", 24) : 0;
    return n ? "+" + n.toLocaleString("en-US") + " Sleeper adds (24h)" : "";
  }
  /* Injury/availability pill from Sleeper + the injury report + snap counts (analysis.avail). */
  function availPill(p) {
    var av = A.avail(p);
    if (!av.sev || av.state === "news") return "";
    var cls = av.sev >= 3 ? "down" : "flat";
    return '<span class="pill ' + cls + '" data-tip="Source: ' + esc(av.src) + (av.detail ? " · " + esc(av.detail) : "") + '">' + esc(av.label) + "</span>";
  }
  /* How many of the team's last n games (byes skipped) the player actually played. */
  function teamWin(p, n) {
    var wl = core.weekLog(p, CUR).filter(function (e) { return e.kind !== "bye"; }).slice(-n);
    return { n: wl.length, gp: wl.filter(function (e) { return e.kind === "played"; }).length };
  }
  function tierPill(m) {
    if (!m) return "";
    var cls = m.tier === "Favorable" ? "up" : m.tier === "Tough" ? "down" : "flat";
    return '<span class="pill ' + cls + '">' + esc(m.tier) + " matchup</span>";
  }
  function dateLabel(nx) {
    var d = new Date(nx.date + "T12:00:00");
    var s = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (nx.time) {
      var hm = nx.time.split(":"), h = +hm[0], ap = h >= 12 ? "PM" : "AM";
      s += ", " + ((h + 11) % 12 + 1) + ":" + hm[1] + " " + ap + " ET";
    }
    return s;
  }
  function seg(attr, opts, current, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '">' + opts.map(function (o) {
      return '<button class="segbtn' + (String(o[0]) === String(current) ? " on" : "") + '" data-' + attr + '="' + esc(o[0]) + '">' + esc(o[1]) + "</button>";
    }).join("") + "</div>";
  }

  /* ---------- tooltip ---------- */
  var tip = null;
  function initTip() {
    tip = $("tip");
    document.addEventListener("mousemove", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
      if (!t) { tip.hidden = true; return; }
      tip.innerHTML = t.getAttribute("data-tip");
      tip.hidden = false;
      var x = e.clientX + 14, y = e.clientY + 14, w = tip.offsetWidth, h = tip.offsetHeight;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
      tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
    });
    document.addEventListener("scroll", function () { tip.hidden = true; }, true);
  }

  /* ---------- charts ---------- */
  function niceMax(v) {
    if (v <= 0) return 10;
    var steps = [10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400, 500];
    for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i];
    return Math.ceil(v / 100) * 100;
  }
  function barChart(items, avgVal, label) {
    var W = 640, H = 230, L = 40, R = 12, T = 12, B = 28;
    var vals = items.map(function (i) { return i.val; }).filter(function (x) { return x != null; });
    var ymax = niceMax(Math.max.apply(null, vals.concat([avgVal || 0, 1])));
    var ymin = Math.min(0, Math.min.apply(null, vals.concat([0])));
    if (ymin < 0) ymin = Math.floor(ymin / 5) * 5;
    function y(v) { return T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin)); }
    var n = items.length, step = (W - L - R) / n, bw = Math.max(6, Math.min(34, step - 4));
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + '">';
    for (var t = 0; t <= 4; t++) {
      var tv = ymin + (ymax - ymin) * t / 4;
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(tv) + '" y2="' + y(tv) + '"/>';
      svg += '<text class="axis" x="' + (L - 6) + '" y="' + (y(tv) + 4) + '" text-anchor="end">' + Math.round(tv) + "</text>";
    }
    var y0 = y(0);
    items.forEach(function (it, i) {
      var cx = L + step * i + step / 2, x0 = cx - bw / 2;
      if (it.val != null) {
        var yv = y(it.val), top = Math.min(yv, y0), h = Math.max(1.5, Math.abs(yv - y0)), r = Math.min(3, h / 2);
        svg += '<path class="bar' + (it.latest ? " latest" : "") + (it.dnp ? " dnp" : "") + '" d="M' + x0 + " " + (top + h) + "V" + (top + r) + "Q" + x0 + " " + top + " " + (x0 + r) + " " + top + "H" + (x0 + bw - r) + "Q" + (x0 + bw) + " " + top + " " + (x0 + bw) + " " + (top + r) + "V" + (top + h) + 'Z"/>';
      }
      svg += '<text class="axis' + (it.val == null ? " dim" : "") + '" x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle">' + (it.val == null ? "BYE" : esc(it.label)) + "</text>";
      svg += '<rect class="hit" x="' + (cx - step / 2) + '" y="' + T + '" width="' + step + '" height="' + (H - T - B) + '" data-tip="' + esc(it.tip) + '"/>';
    });
    if (avgVal != null) {
      svg += '<line class="avg" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(avgVal) + '" y2="' + y(avgVal) + '"/>';
      svg += '<text class="avg-label" x="' + (W - R) + '" y="' + (y(avgVal) - 5) + '" text-anchor="end">average in games played ' + f1(avgVal) + "</text>";
    }
    return svg + "</svg>";
  }
  function lineChart(weeks, series) {
    var W = 640, H = 200, L = 40, R = 64, T = 12, B = 28;
    var n = weeks.length;
    function xs(i) { return n === 1 ? (L + (W - L - R) / 2) : L + (W - L - R) * i / (n - 1); }
    var ymax = 0;
    series.forEach(function (s) { s.vals.forEach(function (v) { if (v != null && v > ymax) ymax = v; }); });
    ymax = ymax >= 0.95 ? 1 : Math.max(0.5, Math.ceil(ymax * 10) / 10);
    function y(v) { return T + (H - T - B) * (1 - v / ymax); }
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Usage by week">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var v = ymax * f;
      svg += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      svg += '<text class="axis" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + Math.round(v * 100) + "%</text>";
    });
    weeks.forEach(function (w, i) { svg += '<text class="axis" x="' + xs(i) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(w) + "</text>"; });
    series.forEach(function (s, k) {
      var d = "", pen = false, lastI = -1;
      s.vals.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? "L" : "M") + xs(i).toFixed(1) + " " + y(v).toFixed(1); pen = true; lastI = i;
      });
      svg += '<path class="line s' + k + '" d="' + d + '"/>';
      s.vals.forEach(function (v, i) { if (v != null) svg += '<circle class="dot s' + k + '" cx="' + xs(i) + '" cy="' + y(v) + '" r="' + (i === lastI ? 4 : 2.5) + '"/>'; });
      if (lastI >= 0) svg += '<text class="series-label s' + k + '" x="' + (xs(lastI) + 8) + '" y="' + (y(s.vals[lastI]) + 4) + '">' + esc(s.short) + "</text>";
    });
    weeks.forEach(function (w, i) {
      var parts = series.map(function (s) { return s.name + ": " + (s.vals[i] == null ? "–" : Math.round(s.vals[i] * 100) + "%"); });
      svg += '<rect class="hit" x="' + (xs(i) - 14) + '" y="' + T + '" width="28" height="' + (H - T - B) + '" data-tip="' + esc(w + "<br>" + parts.join("<br>")) + '"/>';
    });
    return svg + "</svg>";
  }

  /* ---------- game log tables ---------- */
  function kc(h, key) { return { h: h, get: function (r) { return f0(r[key]); }, tot: function (rs) { return f0(sumKey(rs, key)); } }; }
  function sc(h, key) {
    return { h: h, get: function (r) { return pc(r[key]); }, tot: function (rs) { var a = rs.map(function (r) { return r[key]; }).filter(function (x) { return x != null; }); return a.length ? pc(core.avg(a)) : "–"; } };
  }
  var STAT_COLS = {
    QB: [{ h: "Cmp/Att", get: function (r) { return f0(r.cmp) + "/" + f0(r.att); }, tot: function (rs) { return f0(sumKey(rs, "cmp")) + "/" + f0(sumKey(rs, "att")); } },
      kc("Pass Yds", "pyd"), kc("Pass TD", "ptd"), kc("INT", "int"), kc("Rush", "ra"), kc("Rush Yds", "ryd"), kc("Rush TD", "rtd")],
    RB: [kc("Car", "ra"), kc("Rush Yds", "ryd"), kc("Rush TD", "rtd"), kc("Tgt", "tgt"), kc("Rec", "rec"), kc("Rec Yds", "recyd"), kc("Rec TD", "rectd"), sc("Car %", "csh")],
    WR: [kc("Tgt", "tgt"), kc("Rec", "rec"), kc("Rec Yds", "recyd"), kc("Rec TD", "rectd"), sc("Tgt %", "tsh"), sc("Air %", "ays"), kc("Rush", "ra"), kc("Rush Yds", "ryd")]
  };
  STAT_COLS.TE = STAT_COLS.WR;

  function sumFn(fn) { return function (rs) { return rs.reduce(function (s, r) { return s + fn(r); }, 0); }; }
  function pcol(h, fn, dec, cls) {
    var total = sumFn(fn), fmt = dec ? f1 : f0;
    return { h: h, cls: cls || "", get: function (r) { return fmt(fn(r)); }, tot: function (rs) { return fmt(total(rs)); }, per: function (rs) { return f1(total(rs) / rs.length); } };
  }
  function ptsCols(p) {
    var cols = [];
    if (p.pos === "QB") cols.push(pcol("Att", function (r) { return r.att || 0; }), pcol("Carries", function (r) { return r.ra || 0; }));
    else if (p.pos === "RB") cols.push(pcol("Carries", function (r) { return r.ra || 0; }), pcol("Targets", function (r) { return r.tgt || 0; }));
    else cols.push(pcol("Targets", function (r) { return r.tgt || 0; }));
    cols.push(
      pcol(p.pos === "QB" ? "Pass yds" : "Yards", function (r) { return core.keyYards(r, p.pos); }),
      pcol("TD", function (r) { return (r.ptd || 0) + (r.rtd || 0) + (r.rectd || 0); }),
      pcol("Std", function (r) { return core.fp(r, "std"); }, 1, state.fmt === "std" ? "strong" : ""),
      pcol("Half", function (r) { return core.fp(r, "half"); }, 1, state.fmt === "half" ? "strong" : ""),
      pcol("PPR", function (r) { return core.fp(r, "ppr"); }, 1, state.fmt === "ppr" ? "strong" : ""));
    return cols;
  }
  /* entries: weekLog entries (newest first). */
  function logTable(p, entries, view, withSeason) {
    var cols = view === "stats" ? STAT_COLS[p.pos] : ptsCols(p);
    var played = entries.filter(function (e) { return e.kind === "played"; }).map(function (e) { return e.row; });
    var h = "<table><thead><tr>" + (withSeason ? "<th>Yr</th>" : "") + "<th>Wk</th><th>Opp</th><th>Snap %</th>";
    cols.forEach(function (c) { h += "<th>" + c.h + "</th>"; });
    h += "</tr></thead><tbody>";
    entries.forEach(function (e) {
      var cls = e.kind === "played" ? "" : e.kind;
      h += '<tr class="' + cls + '">' + (withSeason ? "<td>" + (e.row ? e.row.season : "") + "</td>" : "") + "<td>" + e.week + "</td>";
      if (e.kind === "bye") { h += '<td>BYE</td><td colspan="' + (cols.length + 1) + '"></td></tr>'; return; }
      h += "<td>" + esc(e.opp) + "</td><td>" + (e.row.snap == null ? "–" : pc(e.row.snap)) + "</td>";
      cols.forEach(function (c) { h += '<td class="' + (c.cls || "") + '">' + c.get(e.row) + "</td>"; });
      h += "</tr>";
    });
    if (played.length) {
      var span = 3 + (withSeason ? 1 : 0);
      var snaps = played.map(function (r) { return r.snap; }).filter(function (x) { return x != null; });
      h += '<tr class="total"><td colspan="' + span + '">' + (view === "stats" ? "Total (shares: average)" : "Total") + " · " + played.length + " games played</td><td>" + (snaps.length ? pc(core.avg(snaps)) : "–") + "</td>";
      cols.forEach(function (c) { h += '<td class="' + (c.cls || "") + '">' + c.tot(played) + "</td>"; });
      h += "</tr>";
      if (view !== "stats") {
        h += '<tr class="total"><td colspan="' + (span + 1) + '">Per game played</td>';
        cols.forEach(function (c) { h += '<td class="' + (c.cls || "") + '">' + c.per(played) + "</td>"; });
        h += "</tr>";
      }
    }
    return h + "</tbody></table>";
  }

  /* ---------- player view ---------- */
  /* "Will he start now?" call-out: teammates out at his position, his place on the depth chart, and how he did without them. */
  function outlookHtml(p) {
    var o = A.outlook(p);
    if (!o.bullets.length) return "";
    var cls = o.level === "High" ? "up" : o.level ? "flat" : "down";
    var h = '<div class="callout ' + cls + '"><p class="label">' + (o.level ? "Chance at a bigger role: <b>" + o.level + "</b>" : "Availability") + '</p><ul class="bul">' +
      o.bullets.map(function (b) { return '<li class="' + b.tone + '">' + esc(b.text) + "</li>"; }).join("");
    // Compare with/without only the teammates who carried real workload (skips fullbacks and blockers).
    o.down.filter(function (d) { return (d.base.wl || 0) >= 5; }).sort(function (a, b) { return (b.base.wl || 0) - (a.base.wl || 0); }).slice(0, 2).forEach(function (d) {
      var wo = A.splitLine(p, A.applyFilters(p, { without: d.p.id }), state.fmt), wi = A.splitLine(p, A.applyFilters(p, { with: d.p.id }), state.fmt);
      if (wo.g) h += '<li class="flat">Without ' + esc(d.p.name) + " (" + wo.g + " game" + (wo.g > 1 ? "s" : "") + " since " + (CUR - 2) + "): " + f1(wo.fpg) + " pts and " + f1(wo.wl) + " " + esc(A.UNIT[p.pos]) + " per game" +
        (wi.g ? ", vs " + f1(wi.fpg) + " pts and " + f1(wi.wl) + " with him" : "") + (wo.g < 3 ? " (small sample)" : "") + "</li>";
      else h += '<li class="flat">No games in the data since ' + (CUR - 2) + " where he played without " + esc(d.p.name) + ".</li>";
    });
    return h + "</ul></div>";
  }
  function trendHtml(p) {
    var g = core.trendGroups(p, state.fmt), m = core.matchup(p, state.fmt);
    var groups = [["Recent form", g.form], ["Usage", g.usage], [m ? "Matchup vs " + m.opp : "Matchup", g.matchup], ["Availability", g.avail], ["Fantasy interest", g.interest]];
    var h = outlookHtml(p) + '<div class="trendgrid">', any = false;
    groups.forEach(function (gr) {
      if (!gr[1].length) return;
      any = true;
      h += "<div><h4>" + esc(gr[0]) + '</h4><ul class="bul">' + gr[1].map(function (b) { return '<li class="' + b.tone + '">' + esc(b.text) + "</li>"; }).join("") + "</ul></div>";
    });
    return any ? h + "</div>" : h + '</div><p class="muted">No trends yet for this player.</p>';
  }
  /* True box score: one row per game, columns grouped into passing / rushing / receiving. */
  function boxTable(p, entries, withSeason) {
    var played = entries.filter(function (e) { return e.kind === "played"; }).map(function (e) { return e.row; });
    var anyRush = p.pos !== "WR" && p.pos !== "TE" || played.some(function (r) { return r.ra > 0; });
    var groups = [];
    if (p.pos === "QB") groups.push(["Passing", [["Cmp", "cmp"], ["Att", "att"], ["Yds", "pyd"], ["TD", "ptd"], ["INT", "int"]]]);
    if (anyRush) groups.push(["Rushing", [["Car", "ra"], ["Yds", "ryd"], ["TD", "rtd"]]]);
    if (p.pos !== "QB") groups.push(["Receiving", [["Tgt", "tgt"], ["Rec", "rec"], ["Yds", "recyd"], ["TD", "rectd"]]]);
    var lead = (withSeason ? 1 : 0) + 3;
    var h = '<table class="box"><thead><tr><th colspan="' + lead + '"></th>' + groups.map(function (g) { return '<th class="grp" colspan="' + g[1].length + '">' + g[0] + "</th>"; }).join("") + '<th class="grp">Fantasy</th></tr><tr>' +
      (withSeason ? "<th>Yr</th>" : "") + "<th>Wk</th><th>Opp</th><th>Snap %</th>";
    groups.forEach(function (g) { g[1].forEach(function (c, i) { h += '<th class="' + (i === 0 ? "gs" : "") + '">' + c[0] + "</th>"; }); });
    h += '<th class="gs">' + fmtShort() + "</th></tr></thead><tbody>";
    entries.forEach(function (e) {
      h += '<tr class="' + (e.kind === "played" ? "" : e.kind) + '">' + (withSeason ? "<td>" + (e.row ? e.row.season : "") + "</td>" : "") + "<td>" + e.week + "</td>";
      if (e.kind === "bye") { h += '<td>BYE</td><td colspan="99"></td></tr>'; return; }
      h += "<td>" + esc(e.opp) + "</td><td>" + (e.row.snap == null ? "–" : pc(e.row.snap)) + "</td>";
      groups.forEach(function (g) { g[1].forEach(function (c, i) { h += '<td class="' + (i === 0 ? "gs" : "") + '">' + f0(e.row[c[1]]) + "</td>"; }); });
      h += '<td class="gs strong">' + f1(core.fp(e.row, state.fmt)) + "</td></tr>";
    });
    if (played.length) {
      h += '<tr class="total"><td colspan="' + lead + '">Total · ' + played.length + " games</td>";
      groups.forEach(function (g) { g[1].forEach(function (c, i) { h += '<td class="' + (i === 0 ? "gs" : "") + '">' + f0(sumKey(played, c[1])) + "</td>"; }); });
      h += '<td class="gs strong">' + f1(played.reduce(function (s, r) { return s + core.fp(r, state.fmt); }, 0)) + "</td></tr>";
    }
    return h + "</tbody></table>";
  }
  function gameTable(p, entries, withSeason) {
    return state.logView === "stats" ? boxTable(p, entries, withSeason) : logTable(p, entries, "pts", withSeason);
  }
  function kpi(label, value, sub) {
    return '<div class="kpi"><p class="label">' + esc(label) + '</p><p class="num">' + esc(value) + '</p><p class="sub">' + esc(sub) + "</p></div>";
  }
  function renderPlayer() {
    var p = player(state.pid) || DATA.players[0];
    var curRows = core.seasonRows(p, CUR), m = core.matchup(p, state.fmt), nx = p.next;
    var h = '<section class="phead">' + avatar(p, "lg") + '<div class="pname"><h2>' + esc(p.name) + '</h2><p class="sub">' + esc(p.pos) + " · " + esc(p.team) +
      (p.sl && p.sl.o ? " · " + esc(p.pos) + p.sl.o + " on depth chart" : "") + '</p><div class="pills">';
    var ap = availPill(p);
    h += ap || '<span class="pill up">No injury designation</span>';
    if (p.rstatus && p.rstatus !== "ACT" && !(A.avail(p).sev >= 3)) h += '<span class="pill flat">Roster: ' + esc(p.rstatus === "RES" ? "reserve list" : p.rstatus) + "</span>";
    var ow = A.own(p);
    if (ow != null) h += '<span class="pill flat" data-tip="Share of ESPN fantasy leagues that roster him' + (p.own.c != null ? "; " + sgn(p.own.c) + " points this week" : "") + '">' + ownPct(ow) + "% rostered (ESPN)" + (p.own.s != null ? " · " + ownPct(p.own.s) + "% started" : "") + "</span>";
    h += tierPill(m) + '</div></div><div class="nextgame">';
    if (!nx) h += '<p class="label">Next game</p><p class="big">None scheduled</p>';
    else if (nx.bye) h += '<p class="label">Next game</p><p class="big">Bye in Week ' + meta.next_week + "</p>";
    else {
      h += '<p class="label">Week ' + nx.week + " · " + esc(dateLabel(nx)) + "</p>";
      h += '<p class="big">' + (nx.home ? "vs " : "at ") + esc(nx.opp) + "</p>";
      h += '<p class="lines">' + (nx.spread == null ? "" : "Spread " + sgn(nx.spread) + " · ") + (nx.total == null ? "" : "Total " + f1(nx.total) + " · ") + (nx.implied == null ? "" : "Team implied " + f1(nx.implied)) + "</p>";
    }
    h += "</div></section>";
    h += '<div class="ptabs">' + seg("ptab", [["overview", "Overview"], ["splits", "Splits & stat lookup"]], state.ptab, "Player view") + "</div>";
    if (state.ptab === "splits") { $("view").innerHTML = h + splitsHtml(p); bindSplits(p); return; }

    h += '<section class="panel"><h3>Trends <span class="hint">' + esc(fmtLabel()) + " scoring</span></h3>" + trendHtml(p) + "</section>";

    if (core.hasBuzz()) {
      var pn = core.playerNews(p, 6);
      h += '<section class="panel"><h3>In the news <span class="hint">headlines from your RSS feeds, last 14 days</span></h3>' +
        (pn.length ? '<ul class="headlines">' + pn.map(function (it) { return "<li>" + headlineHtml(it, false) + "</li>"; }).join("") + "</ul>" : '<p class="muted">No recent headlines name ' + esc(p.name) + " in your feeds.</p>") + "</section>";
    }

    if (curRows.length) {
      var s = core.summary(p, state.fmt, "season"), l3 = core.summary(p, state.fmt, "last3");
      h += '<section class="kpis">' + kpi("Points / game", f1(s.fpg), "Last 3: " + f1(l3.fpg)) + kpi("Snap share", pc(s.snap), "Last 3: " + pc(l3.snap));
      if (p.pos === "QB") h += kpi("Pass yds / game", f0(s.pyd), "Rush yds / game: " + f0(s.ryd)) + kpi("Attempts + carries", f1(s.opp), "Per game");
      else if (p.pos === "RB") h += kpi("Carries + targets", f1(s.opp), "Per game · last 3: " + f1(l3.opp)) + kpi("Points per carry + target", s.ppo == null ? "–" : s.ppo.toFixed(2), "Carry share " + pc(s.csh));
      else h += kpi("Targets / game", f1(s.tgt), "Last 3: " + f1(l3.tgt)) + kpi("Points per carry or target", s.ppo == null ? "–" : s.ppo.toFixed(2), "Target share " + pc(s.tsh));
      h += "</section>";
    }

    var seasons = [CUR, CUR - 1, CUR - 2].filter(function (y) { return core.seasonRows(p, y).length; });
    if (seasons.indexOf(state.logSeason) < 0) state.logSeason = seasons[0] || CUR;
    h += '<section class="panel"><div class="panelhead"><h3>Game log</h3><div class="controls">' +
      seg("view", [["pts", "Fantasy points"], ["stats", "Box score"]], state.logView, "Log view") +
      seg("season", seasons.map(function (y) { return [y, y]; }), state.logSeason, "Season") + "</div></div>";
    if (seasons.length) {
      var wl = core.weekLog(p, state.logSeason);
      var playedIdx = -1;
      wl.forEach(function (e, i) { if (e.kind === "played") playedIdx = i; });
      var isPts = state.logView === "pts";
      if (!isPts) {
        h += '<div class="tablewrap">' + boxTable(p, wl.slice().reverse(), false) + "</div>";
        h += '<p class="note">Box score for every week of the season; greyed rows are games he missed. Charts are in the Fantasy points view.</p></section>';
        h += againstHtml(p, nx);
        $("view").innerHTML = h;
        return;
      }
      var items = wl.map(function (e, i) {
        if (e.kind === "bye") return { label: "W" + e.week, val: null, tip: "Week " + e.week + ": bye" };
        var val = isPts ? core.fp(e.row, state.fmt) : core.keyYards(e.row, p.pos);
        var tipText = e.kind === "dnp" ? "Week " + e.week + " vs " + esc(e.opp) + "<br>Did not play" :
          "Week " + e.week + " vs " + esc(e.opp) + "<br><b>" + (isPts ? f1(val) + "</b> " + fmtLabel() + " pts" : f0(val) + "</b> " + (p.pos === "QB" ? "passing yards" : "rushing + receiving yards"));
        return { label: "W" + e.week, val: val, latest: i === playedIdx, dnp: e.kind === "dnp", tip: tipText };
      });
      var pl = wl.filter(function (e) { return e.kind === "played"; });
      var avgVal = pl.length ? core.avg(pl.map(function (e) { return isPts ? core.fp(e.row, state.fmt) : core.keyYards(e.row, p.pos); })) : null;
      var cap = isPts ? fmtLabel() + " points by week" : (p.pos === "QB" ? "Passing yards by week" : "Rushing + receiving yards by week");
      h += '<h4 class="subhead first">' + esc(cap) + '</h4><div class="chart">' + barChart(items, avgVal, cap) + "</div>";
      var shareKey = p.pos === "RB" ? "csh" : "tsh";
      if (pl.length > 1) {
        var ser = [{ name: "Snap share", short: "Snaps", vals: wl.map(function (e) { return e.kind === "bye" ? null : e.row.snap; }) }];
        if (p.pos !== "QB") ser.push({ name: p.pos === "RB" ? "Carry share" : "Target share", short: p.pos === "RB" ? "Carries" : "Targets", vals: wl.map(function (e) { return e.kind === "bye" ? null : e.row[shareKey]; }) });
        h += '<h4 class="subhead">Usage by week</h4><div class="legend">' + ser.map(function (x, k) { return '<span><i class="sw s' + k + '"></i>' + esc(x.name) + "</span>"; }).join("") + '</div><div class="chart">' + lineChart(wl.map(function (e) { return "W" + e.week; }), ser) + "</div>";
      }
      h += '<div class="tablewrap">' + logTable(p, wl.slice().reverse(), state.logView, false) + "</div>";
      h += '<p class="note">Every week of the season is listed. Greyed rows are games he did not play (counted as 0 here, left out of averages); BYE is the team\'s week off.</p>';
    } else h += '<p class="muted">No games in the data for this player.</p>';
    h += "</section>";
    $("view").innerHTML = h + againstHtml(p, nx);
  }
  function againstHtml(p, nx) {
    if (!nx || nx.bye) return "";
    var vs = p.rows.filter(function (r) { return r.opp === nx.opp; }).slice().reverse();
    var h = '<section class="panel"><h3>Against ' + esc(nx.opp) + ' <span class="hint">since ' + (CUR - 2) + "</span></h3>";
    if (vs.length) {
      var ents = vs.map(function (r) { return { week: r.week, kind: "played", row: r, opp: r.opp }; });
      h += '<div class="tablewrap">' + gameTable(p, ents, true) + "</div>";
    } else h += '<p class="muted">' + esc(p.name) + " has no games against " + esc(nx.opp) + " in the data since " + (CUR - 2) + ".</p>";
    return h + "</section>";
  }

  /* ---------- splits & stat lookup (StatMuse-style questions about one player) ---------- */
  function splitExamples(p) {
    var ex = ["home games", "away games", "primetime", "last 5 games", "division games", "as underdog", "vs top 10 defenses", "in losses"];
    if (p.next && p.next.opp) ex.unshift("vs " + p.next.opp);
    var mates = A.roomOf(p.team, p.pos).filter(function (e) { return e.p.id !== p.id && e.base.snap != null && e.base.snap >= 0.3; });
    if (mates[0]) ex.splice(2, 0, "without " + mates[0].p.name.split(" ").slice(-1)[0]);
    return ex;
  }
  function splitRowHtml(label, s) {
    if (!s.g) return "<tr><th scope=\"row\">" + esc(label) + '</th><td colspan="7" class="muted">No games</td></tr>';
    return '<tr><th scope="row">' + esc(label) + "</th><td>" + s.g + '</td><td class="strong">' + f1(s.fpg) + "</td><td>" + f1(s.total) + "</td><td>" + f1(s.wl) + "</td><td>" + f0(s.yds) + "</td><td>" + f2(s.td) + "</td><td>" + pc(s.snap) + "</td></tr>";
  }
  function splitHead(first) {
    return "<thead><tr><th>" + esc(first) + "</th><th>G</th><th>" + fmtShort() + " PPG</th><th>Total pts</th><th>" + esc(A.UNIT[state.splitPos] || "Workload") + " / g</th><th>Yds / g</th><th>TD / g</th><th>Snap %</th></tr></thead>";
  }
  function splitsHtml(p) {
    state.splitPos = p.pos;
    var seasons = [["", "Since " + (CUR - 2)], [String(CUR), String(CUR)], [String(CUR - 1), String(CUR - 1)], [String(CUR - 2), String(CUR - 2)]];
    var h = '<section class="panel"><h3>Ask about ' + esc(p.name) + '</h3><p class="note">Type a question in plain words, like StatMuse. It understands opponents, home/away, primetime, division games, favorite/underdog, dome/outdoors, wins/losses, top-10 or bottom-10 defenses, "without" or "with" a teammate, a season and "last N games". Combine them freely.</p>';
    h += '<div class="picker"><label for="splitq" class="sr">Stat question</label><input id="splitq" type="search" autocomplete="off" placeholder="e.g. home games vs ' + esc(p.next && p.next.opp || "KC") + ' in primetime" value="' + esc(state.splitQ) + '"></div>';
    h += '<div class="quick">' + splitExamples(p).map(function (q) { return '<button class="tag" data-sq="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + '</div><div id="splitres"></div></section>';
    h += '<section class="panel"><div class="panelhead"><h3>Standard splits</h3>' + seg("sseason", seasons, state.splitSeason, "Season") + "</div>";
    var dims = A.atAGlance(p, state.fmt, state.splitSeason || null);
    h += '<div class="tablewrap"><table class="cmp splits">';
    dims.forEach(function (d, i) {
      h += (i === 0 ? splitHead(d.dim) : '<tr class="sect"><th colspan="8">' + esc(d.dim) + "</th></tr>") ;
      if (i === 0) h += "<tbody>";
      d.buckets.forEach(function (b) { h += splitRowHtml(b.label, b); });
    });
    h += "</tbody></table></div><p class=\"note\">Games played only. Primetime = kickoff 7pm ET or later. Defense tiers use each season's " + esc(fmtLabel()) + " points allowed to " + esc(p.pos) + "s.</p></section>";
    return h;
  }
  function runSplit(p) {
    var el = $("splitres");
    if (!el) return;
    var q = state.splitQ.trim();
    if (!q) { el.innerHTML = ""; return; }
    var pq = A.parseQuery(q, p), rows = A.applyFilters(p, pq.filters), s = A.splitLine(p, rows, state.fmt);
    var all = A.splitLine(p, A.applyFilters(p, { last: pq.filters.last, season: pq.filters.season }), state.fmt);
    var chips = A.describeFilters(pq.filters);
    var h = '<div class="pills qchips">' + (chips.length ? chips.map(function (c) { return '<span class="pill up">' + esc(c.label) + "</span>"; }).join("") : '<span class="pill flat">All games since ' + (CUR - 2) + "</span>") +
      (pq.unknown.length ? '<span class="pill down" data-tip="These words were not understood and were ignored">Ignored: ' + esc(pq.unknown.join(" ")) + "</span>" : "") + "</div>";
    if (!s.g) { el.innerHTML = h + '<p class="muted">No games match.</p>'; return; }
    h += '<div class="tablewrap"><table class="cmp splits">' + splitHead("Games") + "<tbody>" + splitRowHtml("Matching games", s) + splitRowHtml("All games (same season / window)", all) + "</tbody></table></div>";
    var ents = rows.slice().reverse().map(function (r) { return { week: r.week, kind: "played", row: r, opp: r.opp }; });
    h += '<h4 class="subhead">The games</h4><div class="tablewrap">' + boxTable(p, ents, true) + "</div>";
    el.innerHTML = h;
  }
  function bindSplits(p) {
    var q = $("splitq");
    if (!q) return;
    var t = null;
    q.addEventListener("input", function () { state.splitQ = q.value; clearTimeout(t); t = setTimeout(function () { runSplit(p); }, 200); });
    runSplit(p);
  }

  /* ---------- home ---------- */
  function riseVals(x, k, what) {
    return "<b>" + f1(x.oppRecent) + "</b> " + (k === 1 ? "last game" : "last 3") + " <i>(" + sgn(x.dOpp) + " vs " + f1(x.oppPrior) + " before)</i>";
  }
  /* f: an entry from analysis.fallout (injured/out starter plus who is next up). */
  function falloutHtml(f) {
    var p = f.p;
    var why = esc(f.av.label) + ' <span class="sub">(' + esc(f.av.src) + ")</span>. Averaged " + f1(f.avgPts) + " pts and " + pc(f.base.snap) + " of snaps while healthy" + (f.av.detail ? ". " + esc(f.av.detail) : "");
    var h = '<li class="fo"><div class="fo-down">' + avatar(p) + '<div><p class="fo-name"><button class="link" data-open="' + esc(p.id) + '">' + esc(p.name) + '</button> <span class="sub">' + p.pos + " · " + p.team + "</span>" + ownBadge(p) + '</p><p class="why">' + why + "</p>" + newsLine(p) + "</div></div>";
    h += '<div class="fo-next"><p class="label">' + (f.next.length ? "Next up at " + p.pos : "No clear replacement in the data") + "</p>";
    f.next.forEach(function (n) {
      var bits = [];
      if (n.dco != null) bits.push(p.pos + n.dco + " on depth chart");
      bits.push(n.lastSnap != null ? pc(n.lastSnap) + " of snaps last game" : "avg " + pc(n.l3) + " of snaps");
      if (n.pts != null) bits.push(f1(n.pts) + " pts");
      if (addsTxt(n.p)) bits.push(addsTxt(n.p));
      h += '<button class="mate" data-open="' + esc(n.p.id) + '">' + avatar(n.p, "sm") + "<span><b>" + esc(n.p.name) + "</b>" + ownBadge(n.p) + ' <span class="sub">' + esc(bits.join(" · ")) + "</span></span></button>";
    });
    return h + "</div></li>";
  }
  /* s: an entry from analysis.starterChanges (new name atop the depth chart). */
  function starterHtml(s) {
    var why = s.kind === "trade" && s.before.team !== s.team ? s.before.name + " was traded to " + (s.before.team || "another team")
      : s.kind === "injury" ? s.before.name + " is " + s.reason : s.reason;
    var tag = { trade: "Trade", injury: "Injury", depth: "Depth chart" }[s.kind];
    var bp = s.beforeBase && s.beforeBase.pts != null ? s.before.name + " averaged " + f1(s.beforeBase.pts) + " pts recently." : "";
    return '<li class="fo"><div class="fo-down">' + avatar(s.now) + '<div><p class="fo-name"><span class="kind">' + tag + '</span><button class="link" data-open="' + esc(s.now.id) + '">' + esc(s.now.name) + '</button> <span class="sub">' + s.pos + " · " + s.team + "</span>" + ownBadge(s.now) +
      '</p><p class="why">Now listed first at ' + s.pos + ". " + esc(why) + ". " + esc(bp) + (addsTxt(s.now) ? " " + esc(addsTxt(s.now)) + "." : "") + "</p>" +
      (s.evidence ? '<p class="why">Headline: <a class="hl" href="' + esc(safeUrl(s.evidence.u)) + '" target="_blank" rel="noopener noreferrer">' + esc(s.evidence.t) + "</a></p>" : "") + "</div></div></li>";
  }
  function scoringVals(x) {
    var tw = teamWin(x.p, 3), small = tw.gp < 3 || x.g - x.k < 2;
    return "<b>" + f1(x.fpRecent) + "</b> PPG <i>(" + sgn(x.dFp) + ")</i>" + ownBadge(x.p) + '<br><span class="sub">' + f1(x.totRecent) + " pts over his last " + x.k + " games · played " + tw.gp + " of team's last " + tw.n +
      (small ? ' · <span class="warn" data-tip="Few games in this window or before it, so the change may be noise">small sample</span>' : "") + "</span>";
  }
  var HPOS = ["QB", "RB", "WR", "TE"], rotTimer = null;
  function stopRot() { if (rotTimer) { clearInterval(rotTimer); rotTimer = null; } }
  function homeMovers() {
    var pos = state.hpos, r = core.risers(state.fmt, pos, 5, "last3"), unit = A.UNIT[pos];
    var h = '<div class="grid2"><div><h4 class="subhead first">Scoring up</h4><p class="note">' + esc(fmtLabel()) + " points per game in his last 3 games vs. earlier this season, with total points and games played so a return from injury stands out.</p><ol class=\"rank\">" +
      (r.production.map(function (x) { return playerRow(x.p, scoringVals(x)); }).join("") || '<li class="muted pad">Nobody meets the minimums.</li>') + "</ol></div>";
    h += '<div><h4 class="subhead first">Workload up</h4><p class="note">' + esc(unit.charAt(0).toUpperCase() + unit.slice(1)) + " per game, last 3 games vs. earlier this season.</p><ol class=\"rank\">" +
      (r.opportunity.map(function (x) { return playerRow(x.p, riseVals(x, 3) + ownBadge(x.p)); }).join("") || '<li class="muted pad">Nobody meets the minimums.</li>') + "</ol></div></div>";
    return h;
  }
  function paintMovers() {
    var el = $("movers"), sg = $("hposseg");
    if (!el) { stopRot(); return; }
    el.innerHTML = homeMovers();
    if (sg) sg.innerHTML = seg("hpos", HPOS.map(function (x) { return [x, x]; }), state.hpos, "Position").replace(/^<div class="seg"[^>]*>|<\/div>$/g, "");
  }
  function startRot() {
    stopRot();
    if (state.hlock) return;
    rotTimer = setInterval(function () {
      if (state.hpause || state.tab !== "home") return;
      state.hpos = HPOS[(HPOS.indexOf(state.hpos) + 1) % HPOS.length];
      paintMovers();
    }, 6000);
  }
  function renderHome() {
    var top = core.topScorers(state.fmt, null, 5), fo = A.fallout(state.fmt).out.slice(0, 3), sc = A.starterChanges().slice(0, 4);
    var quick = core.topScorers(state.fmt, null, 4);
    var h = '<section class="hero"><h1>Look up any player</h1><p class="lede">Trends, matchups and usage for every QB, RB, WR and TE, through Week ' + WK + ".</p>";
    h += '<div class="herosearch"><label for="hq" class="sr">Search players</label><input id="hq" type="search" placeholder="Search by name, like Jahmyr Gibbs" autocomplete="off"><ul id="hresults" class="results" hidden></ul></div>';
    h += '<div class="quick"><span class="sub">Top scorers in Week ' + WK + ':</span>' + quick.map(function (x) { return '<button class="tag" data-open="' + esc(x.p.id) + '">' + avatar(x.p, "sm") + esc(x.p.name) + "</button>"; }).join("") + "</div></section>";
    h += '<section class="panel" id="moverspanel"><div class="panelhead"><h3>Movers <span class="hint">' + (state.hlock ? "pick a position" : "rotates every few seconds; hover to pause, click a position to stay on it") + '</span></h3><div class="seg" role="group" aria-label="Position" id="hposseg"></div></div><div id="movers"></div></section>';
    h += '<div class="grid2">';
    h += '<section class="panel"><h3>Top scorers, Week ' + WK + '</h3><p class="note">' + esc(fmtLabel()) + ' points, all positions. Badges show the share of ESPN leagues that roster him.</p><ol class="rank">' + top.map(function (x) { return playerRow(x.p, "<b>" + f1(x.pts) + "</b> pts" + ownBadge(x.p)); }).join("") + "</ol></section>";
    if (core.hasSleeper()) h += '<section class="panel"><div class="panelhead"><h3>Most added on Sleeper</h3><button class="link" data-tab="adds">See all</button></div><p class="note">Last 24 hours, across Sleeper leagues.</p><ol class="rank">' + core.slList("add", 24, null, 5, state.fmt).map(function (x) { return slRow(x, "add"); }).join("") + "</ol></section>";
    h += "</div>";
    if (sc.length) h += '<section class="panel"><div class="panelhead"><h3>New starters</h3><button class="link" data-tab="risers">See all</button></div><p class="note">Players now listed first on their team\'s depth chart (Sleeper) because of an injury, a trade or a benching.</p><ul class="folist">' + sc.map(starterHtml).join("") + "</ul></section>";
    h += '<section class="panel"><div class="panelhead"><h3>Injury watch</h3><button class="link" data-tab="risers">See all</button></div><p class="note">Starters who are out, on IR or left Week ' + WK + " early, and who is next up.</p>";
    h += fo.length ? '<ul class="folist">' + fo.map(falloutHtml).join("") + "</ul>" : '<p class="muted">No starters flagged.</p>';
    h += "</section>";
    $("view").innerHTML = h;
    paintMovers();
    var mp = $("moverspanel");
    mp.addEventListener("mouseenter", function () { state.hpause = true; });
    mp.addEventListener("mouseleave", function () { state.hpause = false; });
    mp.addEventListener("focusin", function () { state.hpause = true; });
    startRot();
    bindSearch("hq", "hresults");
  }

  /* ---------- compare ---------- */
  /* Fantasy view only: points, consistency and the usage that drives points. Real stats live in the Stats view.
     [label, key, format, best: "high" | "low" | null] */
  var CMP_ROWS = [
    ["Scoring", null], ["Games", "g", f0, null], ["Total points", "total", f1, "high"], ["Points / game", "fpg", f1, "high"], ["Median game", "med", f1, "high"],
    ["Best game", "max", f1, "high"], ["Worst game", "min", f1, "high"],
    ["Consistency", null], ["Games with 10+ pts (QB 15+)", "s1", pc, "high"], ["Games with 15+ pts (QB 20+)", "s2", pc, "high"], ["Games with 20+ pts (QB 25+)", "s3", pc, "high"],
    ["Week-to-week swing (std dev)", "sd", f1, "low"],
    ["Opportunity", null], ["Snap share", "snap", pc, "high"], ["Workload / game", "wl", f1, "high"], ["Points per carry or target", "ppo", f2, "high"],
    ["Target share", "tsh", pc, "high"], ["Carry share", "csh", pc, "high"], ["Touchdowns / game", "td", f2, "high"]
  ];
  function cmpHead(ps, first) {
    return '<thead><tr><th>' + esc(first) + "</th>" + ps.map(function (p) {
      return '<th class="cmphead"><button class="x" data-remove="' + esc(p.id) + '" title="Remove ' + esc(p.name) + '" aria-label="Remove ' + esc(p.name) + '">×</button>' + avatar(p, "xl") +
        '<button class="link" data-open="' + esc(p.id) + '">' + esc(p.name) + '</button><br><span class="sub">' + p.pos + " · " + p.team + "</span>" + ownBadge(p) + "</th>";
    }).join("") + "</tr></thead>";
  }
  function scopeText() {
    return state.cmpScope === "season" ? CUR + " season" : state.cmpScope === "since" ? "all games since " + (CUR - 2) : "last " + state.cmpN + " game" + (state.cmpN === 1 ? "" : "s");
  }
  function renderCompare() {
    var ids = state.compare.filter(function (id) { return player(id); });
    var h = '<div class="stickybar"><h3>Compare players</h3><div class="controls">' +
      seg("cview", [["fantasy", "Fantasy"], ["stats", "Stats"]], state.cmpView, "Comparison type") +
      '<div class="seg" role="group" aria-label="Sample"><button class="segbtn' + (state.cmpScope === "season" ? " on" : "") + '" data-scope="season">' + CUR + ' season</button>' +
      '<span class="segnum' + (state.cmpScope === "last" ? " on" : "") + '"><button class="segbtn' + (state.cmpScope === "last" ? " on" : "") + '" data-scope="last">Last</button><label class="sr" for="cmpn">Number of games</label><input id="cmpn" type="number" min="1" max="60" step="1" value="' + state.cmpN + '" inputmode="numeric"><button class="segbtn' + (state.cmpScope === "last" ? " on" : "") + '" data-scope="last">games</button></span>' +
      '<button class="segbtn' + (state.cmpScope === "since" ? " on" : "") + '" data-scope="since">Since ' + (CUR - 2) + "</button></div></div></div>";
    h += '<section class="panel"><div class="picker"><label for="cmpq" class="sr">Add a player</label><input id="cmpq" type="search" placeholder="Add a player (2 to 5)" autocomplete="off"><ul id="cmpres" class="results" hidden></ul></div>';
    h += '<div id="cmpbody"></div></section>';
    $("view").innerHTML = h;
    renderCmpBody();
    bindCompareSearch();
    var n = $("cmpn");
    if (n) n.addEventListener("input", function () {
      var x = Math.floor(+n.value);
      if (!(x >= 1)) return;
      state.cmpN = Math.min(60, x); state.cmpScope = "last";
      document.querySelectorAll && Array.prototype.forEach.call(document.querySelectorAll(".segbtn[data-scope], .segnum"), function (b) {
        var on = b.getAttribute("data-scope") ? b.getAttribute("data-scope") === "last" : true;
        if (b.classList.contains("segnum")) b.classList.add("on"); else if (b.getAttribute("data-scope")) b.classList.toggle("on", on);
      });
      renderCmpBody();
    });
  }
  /* Rows follow what ESPN and Pro Football Reference list: totals, per-game figures and rates. */
  function statsCompareHtml(ps) {
    var lines = ps.map(function (p) { return core.statLine(core.sample(p, state.cmpScope, state.cmpN)); });
    var pos = {};
    ps.forEach(function (p) { pos[p.pos] = true; });
    var anyRush = pos.QB || pos.RB || lines.some(function (l) { return l.ra > 0; });
    var anyRecv = pos.RB || pos.WR || pos.TE;
    var secs = [["Games and snaps", [["Games", "g", f0, "none"], ["Snap share", "snap", pc]]]];
    if (pos.QB) secs.push(["Passing", [["Completions", "cmp", f0], ["Attempts", "att", f0], ["Completion %", "cmpPct", pc], ["Passing yards", "pyd", f0], ["Passing yards / game", "pydg", f1], ["Yards / attempt", "ypa", f2], ["Passing TD", "ptd", f0], ["Interceptions", "int", f0, "low"]]]);
    if (anyRush) secs.push(["Rushing", [["Carries", "ra", f0], ["Rushing yards", "ryd", f0], ["Rushing yards / game", "rydg", f1], ["Yards / carry", "ypc", f2], ["Rushing TD", "rtd", f0], ["Share of team carries", "csh", pc]]]);
    if (anyRecv) secs.push(["Receiving", [["Targets", "tgt", f0], ["Receptions", "rec", f0], ["Catch %", "catchPct", pc], ["Receiving yards", "recyd", f0], ["Receiving yards / game", "recydg", f1], ["Yards / reception", "ypr", f1], ["Yards / target", "ypt", f1], ["Receiving TD", "rectd", f0], ["Target share", "tsh", pc], ["Air yards share", "ays", pc], ["WOPR", "wopr", f2]]]);
    secs.push(["Scoring and ball security", [["Yards from scrimmage", "scrim", f0], ["Yards from scrimmage / game", "scrimg", f1], ["Total TD", "td", f0], ["Fumbles lost", "fl", f0, "low"]]]);
    var h = '<div class="tablewrap"><table class="cmp">' + cmpHead(ps, "Stats") + "<tbody>";
    secs.forEach(function (sec) {
      var rowsHtml = "";
      sec[1].forEach(function (r) {
        var vals = lines.map(function (l) { return l[r[1]]; });
        var any = vals.some(function (x) { return x != null && (r[1] === "g" || Math.abs(x) > 1e-9); });
        if (!any) return;
        var best = null;
        if (r[3] !== "none") {
          var nums = vals.filter(function (x) { return x != null && (r[3] === "low" || x > 0); });
          if (nums.length > 1) best = r[3] === "low" ? Math.min.apply(null, nums) : Math.max.apply(null, nums);
        }
        rowsHtml += '<tr><th scope="row">' + r[0] + "</th>" + vals.map(function (x) { return '<td class="' + (best != null && x === best ? "lead" : "") + '">' + r[2](x) + "</td>"; }).join("") + "</tr>";
      });
      if (rowsHtml) h += '<tr class="sect"><th colspan="' + (ps.length + 1) + '">' + sec[0] + "</th></tr>" + rowsHtml;
    });
    h += "</tbody></table></div>";
    h += '<p class="note">Sample: ' + esc(scopeText()) + ". Totals and rates come from the games played in that sample (for example, yards per carry is rushing yards divided by carries). The best value in each row is highlighted; for interceptions and fumbles lost, the lowest. Sacks, QB rating and advanced metrics are not included.</p>";
    return h;
  }
  function renderCmpBody() {
    var el = $("cmpbody");
    var ids = state.compare.filter(function (id) { return player(id); });
    if (ids.length < 2) {
      el.innerHTML = ids.length ? '<div class="tablewrap"><table class="cmp">' + cmpHead(ids.map(player), "") + '</table></div><p class="muted">Add one more player to compare.</p>' : '<p class="muted">Add at least two players to compare.</p>';
      return;
    }
    var ps = ids.map(player), scope = state.cmpScope, n = state.cmpN;
    if (state.cmpView === "stats") { el.innerHTML = statsCompareHtml(ps); return; }
    var sums = ps.map(function (p) { return A.fantasySummary(p, state.fmt, scope, n); });
    var h = '<div class="tablewrap"><table class="cmp">' + cmpHead(ps, fmtLabel()) + "<tbody>";
    var pending = "";
    CMP_ROWS.forEach(function (r) {
      if (!r[1]) { pending = '<tr class="sect"><th colspan="' + (ps.length + 1) + '">' + r[0] + "</th></tr>"; return; }
      var vals = sums.map(function (s) { return s.g ? s[r[1]] : null; });
      var any = vals.some(function (x) { return x != null && (r[1] === "g" || Math.abs(x) > 1e-9); });
      if (!any) return;
      var best = null;
      if (r[3]) { var nums = vals.filter(function (x) { return x != null; }); if (nums.length > 1) best = r[3] === "low" ? Math.min.apply(null, nums) : Math.max.apply(null, nums); }
      h += pending + '<tr><th scope="row">' + r[0] + "</th>" + vals.map(function (x) { return '<td class="' + (best != null && x === best ? "lead" : "") + '">' + r[2](x) + "</td>"; }).join("") + "</tr>";
      pending = "";
    });
    h += '<tr class="sect"><th colspan="' + (ps.length + 1) + '">This week</th></tr>';
    h += '<tr><th scope="row">Next opponent</th>' + ps.map(function (p) {
      var mm = core.matchup(p, state.fmt), nx = p.next;
      return "<td>" + (nx && !nx.bye ? (nx.home ? "vs " : "at ") + esc(nx.opp) + (mm ? " · " + esc(mm.tier) : "") : "Bye / none") + "</td>";
    }).join("") + "</tr></tbody></table></div>";
    h += '<p class="note">Sample: ' + esc(scopeText()) + ". Counts games played only; missed games are not included. The best value in each row is highlighted (for week-to-week swing, the lowest, meaning the steadiest). Workload = carries + targets (QBs: pass attempts + carries). Box-score stats are in the Stats view.</p>";
    if (ps.length === 2) {
      var hh = core.headToHead(ps[0], ps[1], state.fmt, scope, n);
      h += '<h4 class="subhead">Head to head, weeks both played</h4>';
      if (hh.n) h += '<p class="h2h"><b>' + esc(ps[0].name) + "</b> outscored " + esc(ps[1].name) + " in <b>" + hh.winsA + "</b> of " + hh.n + " weeks (" + hh.winsB + " the other way" + (hh.ties ? ", " + hh.ties + " tied" : "") + "). Average " + f1(hh.avgA) + " to " + f1(hh.avgB) + " points.</p>";
      else h += '<p class="muted">These two have no weeks in common in this sample.</p>';
    }
    el.innerHTML = h;
  }
  function bindCompareSearch() {
    var q = $("cmpq"), res = $("cmpres");
    if (!q) return;
    q.addEventListener("input", function () {
      var r = core.search(q.value, 7);
      res.hidden = !r.length;
      res.innerHTML = r.map(function (p) { return '<li><button data-add="' + esc(p.id) + '">' + avatar(p, "sm") + esc(p.name) + ' <span class="sub">' + p.pos + " · " + p.team + "</span></button></li>"; }).join("");
    });
    // Enter adds the top result (the only one, or the closest match when several show).
    q.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var r = core.search(q.value, 1);
      if (r.length && state.compare.indexOf(r[0].id) < 0 && state.compare.length < 5) { state.compare.push(r[0].id); render(); var q2 = $("cmpq"); if (q2) q2.focus(); }
    });
  }

  /* ---------- matchups ---------- */
  /* Rank 1 = gives up the most = best matchup (green); rank 32 = toughest (red). */
  function heat(rank, n) {
    var t = (rank - 1) / Math.max(1, n - 1);
    var mix = Math.round(t * 100);
    return ' style="background: color-mix(in srgb, var(--down-bg) ' + mix + '%, var(--up-bg))"';
  }
  function renderMatchups() {
    var T = A.dvpTables(state.fmt);
    var names = { QB: "quarterbacks", RB: "running backs", WR: "wide receivers", TE: "tight ends" };
    var h = '<div class="stickybar"><h3>Defense vs position</h3><div class="seg" role="group" aria-label="Jump to position">' +
      ["QB", "RB", "WR", "TE"].map(function (x) { return '<button class="segbtn" data-jump="dvp-' + x + '">' + x + "</button>"; }).join("") + "</div></div>";
    h += '<p class="note wide">What each defense has allowed per game to opposing ' + "players at each position in " + CUR + ". Rank 1 gives up the most (best matchup, green); rank 32 gives up the least (toughest, red). Each column is ranked on its own. Scroll inside a table to see all 32 teams.</p>";
    ["QB", "RB", "WR", "TE"].forEach(function (P) {
      var rows = T[P], n = rows.length;
      h += '<section class="panel" id="dvp-' + P + '"><h3>Defense stats vs ' + P + 's <span class="hint">opposing ' + names[P] + ", " + esc(fmtLabel()) + " scoring</span></h3>";
      h += '<div class="tablewrap dvpwrap"><table class="dvp heat"><thead><tr><th>#</th><th>Defense</th><th>G</th><th>Fantasy pts / g</th><th>' + esc(core.YARD_LABEL[P]) + " / g</th><th>TDs / g</th><th>Total TDs</th><th>Last 4 games pts / g</th><th>Week " + meta.next_week + "</th></tr></thead><tbody>";
      rows.forEach(function (r) {
        var nx = nextByTeam[r.team];
        function cell(val, rk, fmt) { return "<td" + heat(rk, n) + '><b>' + fmt(val) + '</b> <span class="rk">' + core.ordinal(rk) + "</span></td>"; }
        h += "<tr><td>" + r.r_fp + '</td><td class="strong">' + esc(r.team) + "</td><td>" + r.n + "</td>" + cell(r.fp, r.r_fp, f1) + cell(r.yd, r.r_yd, f1) + cell(r.td, r.r_td, f2) + cell(r.tdt, r.r_tdt, f0) +
          "<td>" + f1(r.l4) + "</td><td>" + (nx ? (nx.bye ? "Bye" : (nx.home ? "vs " : "at ") + esc(nx.opp)) : "–") + "</td></tr>";
      });
      h += "</tbody></table></div></section>";
    });
    $("view").innerHTML = h;
  }

  /* ---------- risers ---------- */
  function riserList(title, note, list, cols) {
    var h = '<section class="panel"><h3>' + title + '</h3><p class="note">' + note + '</p><ol class="rank">';
    list.forEach(function (x) { var ad = addsTxt(x.p); h += playerRow(x.p, cols(x) + ownBadge(x.p) + (ad ? '<br><span class="sub">' + esc(ad) + "</span>" : "")); });
    return h + (list.length ? "" : '<li class="muted pad">Nobody meets the minimums.</li>') + "</ol></section>";
  }
  function renderRisers() {
    var pos = state.rpos === "ALL" ? null : state.rpos, k = state.basis === "last1" ? 1 : 3;
    var r = core.risers(state.fmt, pos, 8, state.basis);
    var eff = core.efficiency(state.fmt, pos && pos !== "QB" ? pos : null, 8, 40);
    var fo = A.fallout(state.fmt, pos);
    var sc = A.starterChanges().filter(function (s) { return !pos || s.pos === pos; });
    var tc = A.teamChanges().filter(function (x) { return !pos || x.p.pos === pos; });
    var basisText = k === 1 ? "his last game against his average in the games before it" : "his last 3 games against his games before that";
    var h = '<div class="stickybar"><h3>Risers and fallers</h3><div class="controls">' +
      seg("basis", [["last3", "Last 3 games"], ["last1", "Last game"]], state.basis, "Compare window") +
      seg("rpos", ["ALL", "QB", "RB", "WR", "TE"].map(function (x) { return [x, x === "ALL" ? "All" : x]; }), state.rpos, "Position") + "</div></div>";
    h += '<p class="note wide">Each list compares ' + basisText + ", through Week " + WK + ". Active players with " + (k + 2) + "+ games and real volume only. Fantasy add/drop rates are on the Adds &amp; drops tab.</p>";

    h += '<section class="panel"><h3>New starters <span class="hint">injuries, trades, benchings, returns</span></h3><p class="note">Teams whose top player at a position last game is no longer listed first on the Sleeper depth chart. QB, RB and TE only; WR rotations are too fluid to call.</p>';
    h += sc.length ? '<ul class="folist">' + sc.map(starterHtml).join("") + "</ul>" : '<p class="muted">No starter changes' + (pos ? " at " + pos : "") + ".</p>";
    h += "</section>";
    h += '<section class="panel"><h3>Out, on IR or left early <span class="hint">Week ' + meta.next_week + '</span></h3><p class="note">Regular starters ruled Out, Doubtful, on injured reserve or a reserve list (Sleeper and the injury report), or who played under 40% of their usual snaps in Week ' + WK + ". Next up = healthy teammates at the same position, by depth chart then recent snaps.</p>";
    h += fo.out.length ? '<ul class="folist">' + fo.out.slice(0, 12).map(falloutHtml).join("") + "</ul>" + (fo.out.length > 12 ? '<p class="note">' + (fo.out.length - 12) + " more lower-scoring players not shown.</p>" : "") : '<p class="muted">No starters flagged' + (pos ? " at " + pos : "") + ".</p>";
    h += "</section>";
    if (tc.length) {
      h += '<section class="panel"><h3>Changed teams</h3><p class="note">Regular contributors whose roster team changed during the ' + CUR + " season (trades and signings).</p><ol class=\"rank\">";
      tc.forEach(function (x) {
        h += playerRow(x.p, (x.from ? esc(x.from) : "?") + " → <b>" + esc(x.to || "released") + "</b>" + ownBadge(x.p) + '<br><span class="sub">' + (x.base.pts != null ? f1(x.base.pts) + " pts / game recently" : "") + (x.dco ? " · " + x.p.pos + x.dco + " on new depth chart" : "") + "</span>");
      });
      h += "</ol></section>";
    }
    if (fo.risk.length) {
      h += '<section class="panel"><h3>Questionable starters</h3><p class="note">Starters listed Questionable, who missed practice, or named in an injury headline. Worth a backup plan.</p><ol class="rank">';
      fo.risk.slice(0, 10).forEach(function (f) { h += playerRow(f.p, esc(f.av.label.replace(/^Injury headline: /, "Headline: ").slice(0, 90)) + ownBadge(f.p) + '<br><span class="sub">' + f1(f.avgPts) + " pts / game" + (f.next[0] ? " · next up: " + esc(f.next[0].p.name) : "") + "</span>"); });
      h += "</ol></section>";
    }

    var oppNote = "Average carries + targets per game (QBs: pass attempts + carries), " + (k === 1 ? "last game vs. his average before that." : "last 3 games vs. his earlier games this season.");
    h += '<div class="grid2">';
    h += riserList("Opportunity up", oppNote, r.opportunity, function (x) { return riseVals(x, k) + (x.dSn != null ? " · snaps " + sgn(x.dSn * 100, 0) + " pts" : ""); });
    h += riserList("Scoring up", esc(fmtLabel()) + " points per game, " + (k === 1 ? "last game vs. average before." : "last 3 games vs. earlier games."), r.production, function (x) { return "<b>" + f1(x.fpRecent) + "</b> <i>(" + sgn(x.dFp) + " vs " + f1(x.fpPrior) + ")</i>"; });
    h += riserList("Cooling off", "Biggest drop in " + esc(fmtLabel()) + " points per game, same comparison.", r.fallers, function (x) { return "<b>" + f1(x.fpRecent) + "</b> <i>(" + sgn(x.dFp) + " vs " + f1(x.fpPrior) + ")</i>"; });
    h += riserList("Most points per carry or target", "Season " + esc(fmtLabel()) + " points for each carry or target, minimum 40 carries + targets.", eff, function (x) { return "<b>" + x.ppo.toFixed(2) + "</b> on " + f0(x.opp) + " carries + targets"; });
    $("view").innerHTML = h + "</div>";
  }

  /* ---------- adds and drops (Sleeper) and waiver headlines (RSS) ---------- */
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
  function shortDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function headlineHtml(it, withNames) {
    var meta = [it.s, shortDate(it.d)].filter(Boolean).join(" · ");
    if (withNames) {
      var names = core.buzzPlayers(it).slice(0, 6).map(function (p) { return p.name; });
      if (names.length) meta += (meta ? " · " : "") + "Names: " + names.join(", ");
    }
    return (it.k === "waiver" ? '<span class="kind">Waiver</span>' : "") + '<a class="hl" href="' + esc(safeUrl(it.u)) + '" target="_blank" rel="noopener noreferrer">' + esc(it.t) + '</a><span class="hmeta">' + esc(meta) + "</span>";
  }
  function newsLine(p) {
    if (!core.hasBuzz()) return "";
    var n = core.playerNews(p, 1)[0];
    return n ? '<p class="why">Latest headline: <a class="hl" href="' + esc(safeUrl(n.u)) + '" target="_blank" rel="noopener noreferrer">' + esc(n.t) + "</a> (" + esc([n.s, shortDate(n.d)].filter(Boolean).join(", ")) + ")</p>" : "";
  }
  function slRow(x, kind) {
    var m = x.m, parts = [];
    if (m) parts.push(f1(m.l3) + " pts last 3" + (m.dOpp != null ? " · workload " + sgn(m.dOpp) : ""));
    var wm = core.hasBuzz() ? core.waiverMentions(x.p) : 0;
    if (wm) parts.push("in " + wm + " waiver article" + (wm > 1 ? "s" : ""));
    return playerRow(x.p, "<b>" + (kind === "add" ? "+" : "−") + x.count.toLocaleString("en-US") + "</b> " + (kind === "add" ? "adds" : "drops") + ownBadge(x.p) + (parts.length ? '<br><span class="sub">' + esc(parts.join(" · ")) + "</span>" : ""));
  }
  /* Waiver buzz row: the name opens the newest waiver article that mentions him; the small button opens his page. */
  function buzzRow(x) {
    var sub = [];
    if (x.m) sub.push(f1(x.m.l3) + " pts last 3");
    if (x.adds) sub.push("+" + x.adds.toLocaleString("en-US") + " Sleeper adds (24h)");
    var art = x.articles[0];
    var h = '<li class="buzz">' + avatar(x.p);
    h += '<div class="bz-main"><p class="fo-name">' + (art ? '<a class="hl" href="' + esc(safeUrl(art.u)) + '" target="_blank" rel="noopener noreferrer">' + esc(x.p.name) + "</a>" : esc(x.p.name)) +
      ' <span class="sub">' + x.p.pos + " · " + x.p.team + "</span>" + ownBadge(x.p) + "</p>";
    if (art) h += '<p class="why">Newest: <a class="hl" href="' + esc(safeUrl(art.u)) + '" target="_blank" rel="noopener noreferrer">' + esc(art.t) + "</a> (" + esc([art.s, shortDate(art.d)].filter(Boolean).join(", ")) + ")" +
      (x.articles.length > 1 ? " · also in " + x.articles.slice(1, 3).map(function (a) { return '<a class="hl" href="' + esc(safeUrl(a.u)) + '" target="_blank" rel="noopener noreferrer">' + esc(a.s || "another article") + "</a>"; }).join(", ") : "") + "</p>";
    h += '<p class="why sub">' + x.waiver + " waiver article" + (x.waiver > 1 ? "s" : "") + (sub.length ? " · " + esc(sub.join(" · ")) : "") + "</p></div>";
    return h + '<button class="tag" data-open="' + esc(x.p.id) + '">Profile</button></li>';
  }
  function renderAdds() {
    var win = state.win, winText = win === 24 ? "last 24 hours" : "last 7 days", pos = state.apos === "ALL" ? null : state.apos;
    var sl = core.hasSleeper(), bz = core.hasBuzz();
    var h = '<div class="stickybar"><h3>Adds and drops</h3><div class="controls">' +
      seg("win", [[24, "Last 24 hours"], [168, "Last 7 days"]], win, "Time window") +
      seg("apos", ["ALL", "QB", "RB", "WR", "TE"].map(function (x) { return [x, x === "ALL" ? "All" : x]; }), state.apos, "Position") + "</div></div>";
    if (!sl && !bz) {
      h += '<section class="panel"><p class="muted">This build has no Sleeper or headline data. On your computer, run <code>python3 src/refresh.py</code>. It fetches Sleeper\'s trending adds and drops plus waiver headlines from the RSS feeds in <code>feeds.json</code>, then rebuilds this page.</p></section>';
      $("view").innerHTML = h; return;
    }
    if (bz) {
      var feeds = DATA.buzz.feeds || [], okN = feeds.filter(function (f) { return f.ok; }).length;
      var bad = feeds.filter(function (f) { return !f.ok; }).map(function (f) { return f.name + " (" + f.error + ")"; });
      var when = DATA.buzz.fetched ? new Date(DATA.buzz.fetched).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown";
      var bl = A.waiverBuzz(pos, 10, state.fmt, { sort: state.wsort, maxOwn: state.wown === "u50" ? 50 : null }), arts = core.waiverArticles(pos, 10);
      h += '<section class="panel"><div class="panelhead"><h3>Waiver buzz' + (pos ? " at " + pos : "") + '</h3><div class="controls">' +
        seg("wsort", [["articles", "Most articles"], ["recent", "Newest"], ["adds", "Most adds"]], state.wsort, "Sort") +
        (A.hasOwn() ? seg("wown", [["all", "Any rostered %"], ["u50", "Under 50% (ESPN)"]], state.wown, "Ownership") : "") + "</div></div>";
      h += '<p class="note">Players named in waiver and pickup articles from your RSS feeds over the last 14 days, as of ' + esc(when) + ". Click a name to read the newest article about him. Feeds read: " + okN + " of " + feeds.length + (bad.length ? ". Not working: " + esc(bad.join("; ")) : "") + ".</p>";
      h += bl.length ? '<ul class="buzzlist">' + bl.map(buzzRow).join("") + "</ul>" : '<p class="muted pad">No players named in waiver articles' + (pos ? " at " + pos : "") + " with these filters.</p>";
      h += '</section><section class="panel"><h3>Recent waiver articles</h3><p class="note">Headlines link to the original sites.</p>' + (arts.length ? '<ul class="headlines">' + arts.map(function (it) { return "<li>" + headlineHtml(it, true) + "</li>"; }).join("") + "</ul>" : '<p class="muted pad">No waiver headlines found in your feeds.</p>') + "</section>";
    }
    if (A.hasOwn()) {
      var gems = A.hiddenGems(state.fmt, pos, 8, 40);
      h += '<section class="panel"><h3>Good game, low ownership</h3><p class="note">Active players rostered in 40% or fewer ESPN leagues, ranked by ' + esc(fmtLabel()) + " points per game over their last 3 games (at least 20% of snaps). These are the quiet producers the add counts may not have caught yet.</p><ol class=\"rank\">";
      h += gems.map(function (g) {
        return playerRow(g.p, "<b>" + f1(g.l3) + "</b> PPG last 3" + ownBadge(g.p) + '<br><span class="sub">' + (g.lastPts != null ? f1(g.lastPts) + " pts in Week " + WK + " · " : "") + pc(g.snap) + " of snaps" + (g.why.length ? " · " + esc(g.why.join("; ")) : "") + (addsTxt(g.p) ? " · " + esc(addsTxt(g.p)) : "") + "</span>");
      }).join("") || '<li class="muted pad">Nobody fits right now.</li>';
      h += "</ol></section>";
    }
    if (!sl) {
      h += '<section class="panel"><p class="muted">Sleeper adds and drops are not in this build. Run <code>python3 src/refresh.py</code> on your computer to include them.</p></section>';
      $("view").innerHTML = h; return;
    }
    var fetched = DATA.sleeper.fetched ? new Date(DATA.sleeper.fetched).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown";
    h += '<section class="panel"><p class="note">Sleeper numbers: the number of Sleeper leagues that added or dropped each player in the ' + winText + ", as of " + esc(fetched) + ". These are counts, not roster percentages. Points and workload changes come from the " + CUR + " season data (workload = carries + targets per game; QBs: pass attempts + carries).</p></section>";
    var top = core.slList("add", win, pos, 5, state.fmt);
    h += '<section class="panel"><h3>Top 5 adds' + (pos ? " at " + pos : "") + '</h3><p class="note">Most added players in the ' + winText + ". Check the points and workload trend beside each name before you spend a waiver claim.</p><ol class=\"rank\">" + (top.map(function (x) { return slRow(x, "add"); }).join("") || '<li class="muted pad">No data for this window.</li>') + "</ol></section>";
    var positions = pos ? [pos] : ["QB", "RB", "WR", "TE"];
    var names = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends" };
    positions.forEach(function (ps) {
      var adds = core.slList("add", win, ps, 5, state.fmt), drops = core.slList("drop", win, ps, 5, state.fmt);
      h += '<section class="panel"><h3>' + names[ps] + '</h3><div class="grid2"><div><h4 class="subhead first">Most added</h4><ol class="rank">' + (adds.map(function (x) { return slRow(x, "add"); }).join("") || '<li class="muted pad">None in the data.</li>') + '</ol></div><div><h4 class="subhead first">Most dropped</h4><ol class="rank">' + (drops.map(function (x) { return slRow(x, "drop"); }).join("") || '<li class="muted pad">None in the data.</li>') + "</ol></div></div></section>";
    });
    $("view").innerHTML = h;
  }

  /* ---------- shell ---------- */
  function renderTabs() {
    $("tabs").innerHTML = TABS.map(function (t) { return '<button class="tab' + (t === state.tab ? " on" : "") + '" data-tab="' + t + '"' + (t === state.tab ? ' aria-current="page"' : "") + ">" + TAB_LABEL[t] + "</button>"; }).join("");
    $("fmt").innerHTML = ["ppr", "half", "std"].map(function (f) { return '<button class="segbtn' + (f === state.fmt ? " on" : "") + '" data-fmt="' + f + '">' + (f === "ppr" ? "PPR" : f === "half" ? "Half" : "Std") + "</button>"; }).join("");
    $("searchbox").style.visibility = state.tab === "home" ? "hidden" : "visible";
  }
  function setBarHeight() {
    var bar = $("bar");
    if (bar && bar.offsetHeight && document.documentElement && document.documentElement.style) document.documentElement.style.setProperty("--barh", bar.offsetHeight + "px");
  }
  function render() {
    stopRot();
    renderTabs();
    if (state.tab === "home") renderHome();
    else if (state.tab === "player") renderPlayer();
    else if (state.tab === "compare") renderCompare();
    else if (state.tab === "matchups") renderMatchups();
    else if (state.tab === "risers") renderRisers();
    else renderAdds();
    setBarHeight();
    $("asof").textContent = "Through Week " + WK + " · next games Week " + meta.next_week + " · data: nflverse";
  }
  function go(tab) {
    state.tab = tab;
    if (typeof location !== "undefined" && location.hash !== "#" + tab) { try { location.hash = tab; } catch (e) { /* ignore */ } }
    render();
    if (window.scrollTo) window.scrollTo(0, 0);
  }
  function openPlayer(id) { if (id !== state.pid) state.splitQ = ""; state.pid = id; state.logSeason = CUR; go("player"); }

  function bindSearch(inputId, listId) {
    var q = $(inputId), res = $(listId);
    if (!q) return;
    q.addEventListener("input", function () {
      var r = core.search(q.value, 8);
      res.hidden = !r.length;
      res.innerHTML = r.map(function (p) { return '<li><button data-open="' + esc(p.id) + '">' + avatar(p, "sm") + esc(p.name) + ' <span class="sub">' + p.pos + " · " + p.team + "</span></button></li>"; }).join("");
    });
    q.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var r = core.search(q.value, 1); if (r.length) { q.value = ""; res.hidden = true; openPlayer(r[0].id); } }
    });
  }
  function onClick(e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    var d = t.dataset;
    if (d.tab) go(d.tab);
    else if (d.fmt) { state.fmt = d.fmt; lsSet("nfl.fmt", d.fmt); render(); }
    else if (d.open) { if ($("q")) $("q").value = ""; if ($("results")) $("results").hidden = true; openPlayer(d.open); }
    else if (d.season) { state.logSeason = +d.season; render(); }
    else if (d.view) { state.logView = d.view; render(); }
    else if (d.scope) { state.cmpScope = d.scope; render(); }
    else if (d.cview) { state.cmpView = d.cview; render(); }
    else if (d.pos) { state.pos = d.pos; render(); }
    else if (d.rpos) { state.rpos = d.rpos; render(); }
    else if (d.basis) { state.basis = d.basis; render(); }
    else if (d.win) { state.win = +d.win; render(); }
    else if (d.apos) { state.apos = d.apos; render(); }
    else if (d.hpos) { state.hpos = d.hpos; state.hlock = true; stopRot(); paintMovers(); }
    else if (d.ptab) { state.ptab = d.ptab; render(); }
    else if (d.sseason != null) { state.splitSeason = d.sseason; render(); }
    else if (d.sq) { state.splitQ = d.sq; var sq = $("splitq"); if (sq) sq.value = d.sq; runSplit(player(state.pid)); }
    else if (d.jump) { var tgt = $(d.jump); if (tgt && tgt.scrollIntoView) tgt.scrollIntoView({ behavior: "smooth", block: "start" }); }
    else if (d.wsort) { state.wsort = d.wsort; render(); }
    else if (d.wown) { state.wown = d.wown; render(); }
    else if (d.add) { if (state.compare.indexOf(d.add) < 0 && state.compare.length < 5) state.compare.push(d.add); render(); }
    else if (d.remove) { state.compare = state.compare.filter(function (x) { return x !== d.remove; }); render(); }
  }

  function init() {
    var saved = lsGet("nfl.fmt");
    if (saved && FORMATS[saved]) state.fmt = saved;
    var sample = DATA.players.filter(function (p) { return core.seasonRows(p, CUR).length >= 5; }).sort(function (a, b) {
      function av(p) { return core.avg(core.seasonRows(p, CUR).map(function (r) { return r.fpp || 0; })); }
      return av(b) - av(a);
    });
    state.pid = sample.length ? sample[0].id : DATA.players[0].id;
    var wrs = sample.filter(function (p) { return p.pos === "WR"; }), rbs = sample.filter(function (p) { return p.pos === "RB"; });
    if (wrs.length > 1) state.compare = [wrs[0].id, wrs[1].id, (rbs[0] || wrs[2]).id].filter(Boolean);
    var h = (typeof location !== "undefined" && location.hash || "").replace("#", "");
    if (TABS.indexOf(h) >= 0) state.tab = h;
    document.addEventListener("click", onClick);
    document.addEventListener("error", function (e) { if (e.target && e.target.tagName === "IMG") e.target.remove(); }, true);
    if (window.addEventListener) window.addEventListener("hashchange", function () {
      var x = location.hash.replace("#", "");
      if (TABS.indexOf(x) >= 0 && x !== state.tab) { state.tab = x; render(); }
    });
    initTip();
    if (window.addEventListener) { window.addEventListener("resize", setBarHeight); window.addEventListener("load", setBarHeight); }
    bindSearch("q", "results");
    render();
  }
  root.NFLApp = { init: init, state: state, render: render, go: go, openPlayer: openPlayer };
})(typeof self !== "undefined" ? self : this);
