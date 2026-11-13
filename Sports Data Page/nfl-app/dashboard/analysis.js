/* Higher-level analysis on top of core.js: availability and opportunity, starter changes, split lookups,
   hidden gems, waiver buzz, compare summaries, defense-vs-position tables. No DOM access.
   Usage: var A = NFLAnalysis.create(NFLCore.create(DATA)); */
(function (root) {
  "use strict";

  var TEAM_NAMES = {
    ARI: ["cardinals", "arizona"], ATL: ["falcons", "atlanta"], BAL: ["ravens", "baltimore"], BUF: ["bills", "buffalo"],
    CAR: ["panthers", "carolina"], CHI: ["bears", "chicago"], CIN: ["bengals", "cincinnati"], CLE: ["browns", "cleveland"],
    DAL: ["cowboys", "dallas"], DEN: ["broncos", "denver"], DET: ["lions", "detroit"], GB: ["packers", "green bay"],
    HOU: ["texans", "houston"], IND: ["colts", "indianapolis"], JAX: ["jaguars", "jacksonville"], KC: ["chiefs", "kansas city"],
    LA: ["rams", "los angeles rams", "la rams"], LAC: ["chargers", "los angeles chargers", "la chargers"], LV: ["raiders", "las vegas"],
    MIA: ["dolphins", "miami"], MIN: ["vikings", "minnesota"], NE: ["patriots", "new england"], NO: ["saints", "new orleans"],
    NYG: ["giants", "new york giants"], NYJ: ["jets", "new york jets"], PHI: ["eagles", "philadelphia"], PIT: ["steelers", "pittsburgh"],
    SEA: ["seahawks", "seattle"], SF: ["49ers", "niners", "san francisco"], TB: ["buccaneers", "bucs", "tampa bay", "tampa"],
    TEN: ["titans", "tennessee"], WAS: ["commanders", "washington"]
  };
  var SEV = { out: 5, doubtful: 4, left: 3, dnp: 3, questionable: 2, limited: 1, news: 1, ok: 0 };
  var START_THR = { QB: 0.7, RB: 0.35, WR: 0.5, TE: 0.5 };
  var VACATE_THR = { QB: 0.5, RB: 0.15, WR: 0.3, TE: 0.3 };

  function v(x) { return x == null ? 0 : x; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function avg(a) { return a.length ? sum(a) / a.length : null; }
  function last(a, n) { return a.slice(Math.max(0, a.length - n)); }
  function nonNull(a) { return a.filter(function (x) { return x != null; }); }
  function r1(x) { return x == null ? null : Math.round(x * 10) / 10; }
  function pcs(x) { return x == null ? "–" : Math.round(x * 100) + "%"; }

  function create(core) {
    var data = core.data, meta = data.meta, CUR = meta.season, W = meta.last_week_played, fp = core.fp;
    var teamList = {};
    data.players.forEach(function (p) { if (p.team) teamList[p.team] = true; });
    teamList = Object.keys(teamList).sort();

    /* ---------- baseline: what a player did while healthy ---------- */
    var baseCache = {};
    function baseline(p) {
      if (baseCache[p.id]) return baseCache[p.id];
      var rows = core.seasonRows(p, CUR);
      if (!rows.length) rows = core.seasonRows(p, CUR - 1);
      var out = { snap: null, wl: 0, n: 0, pts: null };
      if (rows.length) {
        var snaps = nonNull(rows.map(function (r) { return r.snap; }));
        var best = snaps.length ? Math.max.apply(null, snaps) : null;
        var healthy = rows.filter(function (r) { return r.snap != null && best != null && r.snap >= Math.max(0.2, 0.5 * best); });
        var use = last(healthy.length ? healthy : rows, 3);
        out = { snap: avg(nonNull(use.map(function (r) { return r.snap; }))), wl: avg(use.map(function (r) { return core.opps(r, p.pos); })), n: use.length, pts: avg(use.map(function (r) { return r.fpp || 0; })) };
      }
      baseCache[p.id] = out;
      return out;
    }

    /* ---------- availability ---------- */
    function refDate() { return data.buzz && data.buzz.fetched ? new Date(data.buzz.fetched) : new Date(); }
    function injuryNews(p, days) {
      if (!core.hasBuzz()) return [];
      var ref = refDate().getTime();
      return core.playerNews(p).filter(function (it) {
        return it.g && it.g.indexOf("injury") >= 0 && it.d && (ref - new Date(it.d).getTime()) <= days * 864e5;
      });
    }
    var availCache = {};
    function avail(p) {
      if (availCache[p.id]) return availCache[p.id];
      var sl = p.sl || {}, inj = p.inj || {};
      var out = { state: "ok", label: "", src: "", sev: 0, detail: "" };
      function set(state, label, src) { if (SEV[state] > out.sev) out = { state: state, label: label, src: src, sev: SEV[state], detail: "" }; }
      var s = (sl.inj || "").toLowerCase(), st = (sl.st || "").toLowerCase(), body = sl.b || inj.body || "";
      var bodyTxt = body ? " (" + body.toLowerCase() + ")" : "";
      if (s === "ir" || /injured reserve/.test(st)) set("out", "On injured reserve" + bodyTxt, "Sleeper");
      else if (s === "pup" || /pup/.test(st)) set("out", "On the PUP list" + bodyTxt, "Sleeper");
      else if (s === "sus" || /suspend/.test(st)) set("out", "Suspended", "Sleeper");
      else if (s === "out") set("out", "Out" + bodyTxt, "Sleeper");
      else if (s === "doubtful") set("doubtful", "Doubtful" + bodyTxt, "Sleeper");
      else if (s === "questionable") set("questionable", "Questionable" + bodyTxt, "Sleeper");
      if (inj.status === "Out") set("out", "Out" + bodyTxt, "injury report");
      else if (inj.status === "Doubtful") set("doubtful", "Doubtful" + bodyTxt, "injury report");
      else if (inj.status === "Questionable") set("questionable", "Questionable" + bodyTxt, "injury report");
      if (!inj.status && inj.prac === "DNP") set("dnp", "Did not practice" + bodyTxt, "injury report");
      else if (!inj.status && inj.prac === "LP") set("limited", "Limited in practice" + bodyTxt, "injury report");
      if (p.rstatus === "RES") set("out", "On a reserve list", "roster");
      var b = baseline(p), rows = core.seasonRows(p, CUR), lastRow = rows[rows.length - 1];
      if (lastRow && lastRow.week === W && lastRow.snap != null && b.snap != null && b.snap >= 0.3 && lastRow.snap <= 0.4 * b.snap && rows.length >= 2) {
        set("left", "Played " + pcs(lastRow.snap) + " of snaps in Week " + W + " (usual " + pcs(b.snap) + ")", "snap counts");
      }
      var news = injuryNews(p, 5);
      if (news.length) set("news", "Injury headline: " + news[0].t, "headline");
      out.news = news;
      if (out.sev >= 1 && sl.n) out.detail = sl.n;
      availCache[p.id] = out;
      return out;
    }

    /* ---------- position room ---------- */
    var roomCache = {};
    function orderFn(a, b) {
      var da = a.dco == null ? 99 : a.dco, db = b.dco == null ? 99 : b.dco;
      if (da !== db) return da - db;
      return (b.l3 == null ? -1 : b.l3) - (a.l3 == null ? -1 : a.l3);
    }
    function roomOf(team, pos) {
      var key = team + "|" + pos;
      if (roomCache[key]) return roomCache[key];
      var list = [];
      data.players.forEach(function (q) {
        if (q.team !== team || q.pos !== pos) return;
        var rows = core.seasonRows(q, CUR);
        var active = q.rstatus === "ACT" || q.rstatus === "RES" || q.rstatus === "INA";
        var recent = last(rows, 3).some(function (r) { return r.snap != null && r.snap >= 0.1; });
        if (!active && !recent) return;
        var lr = rows[rows.length - 1];
        var l3 = avg(nonNull(last(rows, 3).map(function (r) { return r.snap; })));
        list.push({ p: q, av: avail(q), base: baseline(q), lastSnap: lr ? lr.snap : null, lastWeek: lr ? lr.week : null, l3: l3, dco: q.sl ? q.sl.o : null,
          wl: rows.length ? avg(last(rows, 3).map(function (r) { return core.opps(r, q.pos); })) : null });
      });
      list.sort(function (a, b) { return a.av.sev >= 3 !== b.av.sev >= 3 ? (a.av.sev >= 3 ? 1 : -1) : orderFn(a, b); });
      roomCache[key] = list;
      return list;
    }
    var UNIT = { QB: "pass attempts + carries", RB: "carries + targets", WR: "targets + carries", TE: "targets + carries" };

    /* ---------- outlook for one player ---------- */
    function outlook(p) {
      var room = roomOf(p.team, p.pos);
      var me = room.filter(function (e) { return e.p.id === p.id; })[0];
      var mates = room.filter(function (e) { return e.p.id !== p.id; });
      var thr = VACATE_THR[p.pos];
      var down = mates.filter(function (e) { return e.av.sev >= 3 && e.base.snap != null && e.base.snap >= thr; });
      var healthy = room.filter(function (e) { return e.av.sev <= 2; }).sort(orderFn);
      var rank = healthy.map(function (e) { return e.p.id; }).indexOf(p.id) + 1;
      var res = { level: null, bullets: [], down: down, healthy: healthy, rank: rank, room: room, vacSnap: 0, vacWl: 0 };
      if (!me) return res;
      var haveDco = healthy.every(function (e) { return e.dco != null; });
      if (down.length && me.av.sev <= 2) {
        res.vacSnap = Math.min(1, sum(down.map(function (e) { return e.base.snap || 0; })));
        res.vacWl = sum(down.map(function (e) { return e.base.wl || 0; }));
        var names = down.map(function (e) { return e.p.name + " (" + e.av.label.replace(/^Injury headline: .*/, "injury headline") + ")"; }).join("; ");
        res.bullets.push({ tone: "up", text: names + (down.length > 1 ? " are" : " is") + " out or hurt at " + p.pos + " for " + p.team + ". " +
          (down.length > 1 ? "Together they" : "He") + " averaged " + r1(res.vacWl) + " " + UNIT[p.pos] + " per game and " + pcs(res.vacSnap) + " of the snaps while healthy" });
        var basis = haveDco ? "depth chart (Sleeper)" : "recent snaps";
        if (rank === 1) {
          res.bullets.push({ tone: "up", text: "Top healthy " + p.pos + " on the " + p.team + " " + basis + (me.lastSnap != null ? "; played " + pcs(me.lastSnap) + " of snaps in his last game" : "") + ", so he is the most likely to absorb that work" });
          res.level = (res.vacSnap >= 0.35 || p.pos === "QB") ? "High" : "Medium";
        } else if (rank === 2) {
          res.bullets.push({ tone: "flat", text: "Second healthy " + p.pos + " on the " + basis + " behind " + healthy[0].p.name + "; shares the opening" });
          res.level = "Medium";
        } else if (rank > 2) {
          res.bullets.push({ tone: "flat", text: "Number " + rank + " healthy " + p.pos + " on the " + basis + "; limited upside unless more of the room is out" });
          res.level = "Low";
        }
      } else if (me.av.sev >= 3) {
        var nxt = healthy.filter(function (e) { return e.p.id !== p.id; }).slice(0, 2).map(function (e) { return e.p.name; });
        res.bullets.push({ tone: "down", text: "Listed as " + me.av.label.toLowerCase() + (nxt.length ? ". Likely to absorb his work: " + nxt.join(" and ") : "") });
      }
      return res;
    }

    /* ---------- injury fallout across the league ---------- */
    function nextUp(room, excludeIds) {
      return room.filter(function (e) { return e.av.sev <= 2 && !excludeIds[e.p.id]; }).sort(orderFn)
        .filter(function (e) { return (e.lastSnap != null && e.lastSnap >= 0.1) || e.dco != null || (e.l3 != null && e.l3 >= 0.15); })
        .slice(0, 2);
    }
    function fallout(fmt, pos) {
      var out = [], risk = [], positions = pos ? [pos] : ["QB", "RB", "WR", "TE"];
      teamList.forEach(function (team) {
        positions.forEach(function (ps) {
          var room = roomOf(team, ps), downIds = {};
          var downs = room.filter(function (e) { return e.av.sev >= 3 && e.av.state !== "dnp" && e.base.snap != null && e.base.snap >= START_THR[ps]; });
          downs.forEach(function (e) { downIds[e.p.id] = true; });
          var risks = room.filter(function (e) { return (e.av.state === "dnp" || e.av.state === "questionable" || e.av.state === "news") && e.base.snap != null && e.base.snap >= START_THR[ps]; });
          function entry(e) {
            var rows = core.seasonRows(e.p, CUR);
            var nx = nextUp(room, downIds).filter(function (x) { return x.p.id !== e.p.id; });
            return { p: e.p, av: e.av, base: e.base, avgPts: avg(rows.map(function (r) { return fp(r, fmt); })) || 0, news: e.av.news && e.av.news[0] || null,
              next: nx.map(function (x) { var lr = core.seasonRows(x.p, CUR).filter(function (r) { return r.week === x.lastWeek; })[0]; return { p: x.p, lastSnap: x.lastSnap, l3: x.l3, dco: x.dco, pts: lr ? fp(lr, fmt) : null }; }) };
          }
          downs.forEach(function (e) { out.push(entry(e)); });
          risks.forEach(function (e) { if (!downIds[e.p.id]) risk.push(entry(e)); });
        });
      });
      function byPts(a, b) { return b.avgPts - a.avgPts; }
      return { out: out.sort(byPts), risk: risk.sort(byPts) };
    }

    /* ---------- depth-chart starter changes and team changes ---------- */
    function starterChanges() {
      var idx = {};
      data.players.forEach(function (q) {
        core.seasonRows(q, CUR).forEach(function (r) {
          var t = idx[r.tm] || (idx[r.tm] = {});
          (t[r.week] = t[r.week] || []).push({ p: q, row: r });
        });
      });
      var res = [];
      teamList.forEach(function (team) {
        var weeks = Object.keys(idx[team] || {}).map(Number);
        if (!weeks.length) return;
        var wk = Math.max.apply(null, weeks);
        if (wk < W - 1) return;
        ["QB", "RB", "TE"].forEach(function (ps) {
          var cand = (idx[team][wk] || []).filter(function (x) { return x.p.pos === ps && x.row.snap != null; }).sort(function (a, b) { return b.row.snap - a.row.snap; });
          var before = cand[0];
          if (!before || before.row.snap < (ps === "QB" ? 0.5 : 0.4)) return;
          var now = roomOf(team, ps).filter(function (e) { return e.av.sev <= 2 && e.dco === 1; })[0];
          if (!now || now.p.id === before.p.id) return;
          var bp = before.p, kind, reason;
          if (bp.team !== team) { kind = "trade"; reason = bp.team ? "now with " + bp.team : "no longer on a roster"; }
          else if (avail(bp).sev >= 3) { kind = "injury"; reason = avail(bp).label.toLowerCase(); }
          else if (now.p.prev && now.p.prev !== team) { kind = "trade"; reason = now.p.name + " arrived by trade from " + now.p.prev + " and is listed first on the depth chart"; }
          else {
            // Depth-chart change with no injury or trade. Committees (RB/TE) swap the snap lead often, so only flag
            // a new starter who sat out the team's last game (returning) or played well under the leader's share.
            var nr = core.seasonRows(now.p, CUR), nlast = nr[nr.length - 1];
            var playedLast = nlast && nlast.week === wk && nlast.snap != null;
            var share = Math.max(v(now.lastSnap), v(now.base && now.base.snap));
            if (playedLast && share >= 0.6 * before.row.snap) return;
            kind = "depth";
            reason = playedLast ? now.p.name + " moved ahead of " + bp.name + " on the depth chart (possible benching)"
                                : now.p.name + " is back atop the depth chart after missing Week " + wk;
          }
          var ev = core.hasBuzz() ? core.playerNews(now.p).concat(core.playerNews(bp)).filter(function (it) { return it.g && (it.g.indexOf("role") >= 0 || it.g.indexOf("trade") >= 0 || it.g.indexOf("injury") >= 0); })
            .sort(function (a, b) { return (b.d || "") < (a.d || "") ? -1 : 1; })[0] : null;
          res.push({ team: team, pos: ps, now: now.p, nowBase: now.base, nowLast: now.lastSnap, before: bp, beforeBase: baseline(bp), beforeSnap: before.row.snap, kind: kind, reason: reason, evidence: ev || null });
        });
      });
      var order = { QB: 0, RB: 1, TE: 2 };
      return res.sort(function (a, b) { return order[a.pos] - order[b.pos] || (b.beforeBase.pts || 0) - (a.beforeBase.pts || 0); });
    }
    function teamChanges() {
      var out = [];
      data.players.forEach(function (p) {
        var rows = core.seasonRows(p, CUR);
        if (!rows.length) return;
        var b = baseline(p);
        var significant = p.pos === "QB" || (b.snap != null && b.snap >= 0.4);
        if (!significant) return;
        if (p.prev && p.prev !== p.team) out.push({ p: p, from: p.prev, to: p.team, dco: p.sl ? p.sl.o : null, base: b });
        else if (p.sl && p.sl.t === null && rows[rows.length - 1].week >= W - 1 && p.sl.st !== "Active") out.push({ p: p, from: p.team, to: null, dco: null, base: b });
      });
      return out.sort(function (a, b) { return (b.base.pts || 0) - (a.base.pts || 0); });
    }

    /* ---------- ownership and hidden gems ---------- */
    function own(p) { return p.own && p.own.p != null ? p.own.p : null; }
    function hasOwn() { return data.players.some(function (p) { return own(p) != null; }); }
    function hiddenGems(fmt, pos, n, maxOwn) {
      if (!hasOwn()) return [];
      var list = [], fo = fallout(fmt, pos), nextFor = {};
      fo.out.forEach(function (e) { e.next.forEach(function (x) { (nextFor[x.p.id] = nextFor[x.p.id] || []).push(e.p.name); }); });
      data.players.forEach(function (p) {
        if (pos && p.pos !== pos) return;
        var o = own(p);
        if (o == null || o > (maxOwn == null ? 40 : maxOwn) || p.rstatus !== "ACT") return;
        var rows = core.seasonRows(p, CUR);
        if (rows.length < 2) return;
        var lr = rows[rows.length - 1];
        if (lr.week < W - 1) return;
        var l3 = avg(last(rows, 3).map(function (r) { return fp(r, fmt); }));
        var snap3 = avg(nonNull(last(rows, 3).map(function (r) { return r.snap; })));
        if (snap3 != null && snap3 < 0.2) return;
        var why = [];
        if (nextFor[p.id]) why.push("next up for " + nextFor[p.id].join(" and "));
        list.push({ p: p, own: o, l3: l3, lastPts: lr.week === W ? fp(lr, fmt) : null, snap: snap3, why: why });
      });
      list.sort(function (a, b) { return b.l3 - a.l3; });
      return list.slice(0, n || 5);
    }

    /* ---------- waiver buzz with sorting and filters ---------- */
    function waiverBuzz(pos, n, fmt, opts) {
      opts = opts || {};
      var list = core.buzzList(pos, 0, fmt).map(function (x) {
        var arts = core.playerNews(x.p).filter(function (i) { return i.k === "waiver"; });
        return { p: x.p, waiver: x.waiver, total: x.total, m: x.m, articles: arts, newest: arts[0] ? arts[0].d || "" : "", own: own(x.p),
          adds: core.hasSleeper() ? core.slCount(x.p, "add", 24) : 0 };
      });
      if (opts.maxOwn != null) list = list.filter(function (x) { return x.own == null || x.own <= opts.maxOwn; });
      var s = opts.sort || "articles";
      list.sort(function (a, b) {
        if (s === "recent") return a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : b.waiver - a.waiver;
        if (s === "adds") return b.adds - a.adds || b.waiver - a.waiver;
        return b.waiver - a.waiver || b.total - a.total || b.adds - a.adds;
      });
      return n ? list.slice(0, n) : list;
    }

    /* ---------- compare: fantasy summary ---------- */
    function fantasySummary(p, fmt, scope, n) {
      var rows = core.sample(p, scope, n), g = rows.length;
      if (!g) return { g: 0 };
      var pts = rows.map(function (r) { return fp(r, fmt); }), sorted = pts.slice().sort(function (a, b) { return a - b; });
      var mean = avg(pts), med = g % 2 ? sorted[(g - 1) / 2] : (sorted[g / 2 - 1] + sorted[g / 2]) / 2;
      var sd = Math.sqrt(sum(pts.map(function (x) { return (x - mean) * (x - mean); })) / g);
      var th = p.pos === "QB" ? [15, 20, 25] : [10, 15, 20];
      function share(t) { return pts.filter(function (x) { return x >= t; }).length / g; }
      var tot = sum(rows.map(function (r) { return core.opps(r, p.pos); }));
      function A(k) { var a = nonNull(rows.map(function (r) { return r[k]; })); return a.length ? avg(a) : null; }
      return { g: g, total: sum(pts), fpg: mean, med: med, max: sorted[g - 1], min: sorted[0], sd: sd, th: th, s1: share(th[0]), s2: share(th[1]), s3: share(th[2]),
        snap: A("snap"), wl: tot / g, ppo: tot > 0 ? sum(pts) / tot : null, tsh: A("tsh"), csh: A("csh"), wopr: A("wopr"),
        td: sum(rows.map(function (r) { return v(r.ptd) + v(r.rtd) + v(r.rectd); })) / g };
    }

    /* ---------- defense vs position tables ---------- */
    function dvpTables(fmt) {
      var i = { std: 0, half: 1, ppr: 2 }[fmt || "ppr"], out = {};
      ["QB", "RB", "WR", "TE"].forEach(function (pos) {
        var rows = [];
        for (var team in data.dvp) {
          var d = data.dvp[team][pos];
          if (d) rows.push({ team: team, n: d.n, fp: d.fp[i], l4: d.l4 ? d.l4[i] : null, yd: d.yd, td: d.td, tdt: d.tdt });
        }
        ["fp", "yd", "td", "tdt"].forEach(function (key) {
          var s = rows.slice().sort(function (a, b) { return b[key] - a[key]; }), rk = 0, prev = null;
          s.forEach(function (r, j) { if (prev === null || r[key] !== prev) rk = j + 1; prev = r[key]; r["r_" + key] = rk; });
        });
        out[pos] = rows.sort(function (a, b) { return a.r_fp - b.r_fp || a.team.localeCompare(b.team); });
      });
      return out;
    }

    /* ---------- splits ---------- */
    function ctxOf(p, row) {
      var gm = data.gm && data.gm[String(row.season)], arr = gm && gm[row.tm], g = arr && arr[row.week - 1];
      if (!g) return null;
      var drk = data.drk && data.drk[String(row.season)] && data.drk[String(row.season)][p.pos];
      var rk = drk ? drk[g[0]] : null, sp = g[4], pf = g[8], pa = g[9];
      return { opp: g[0], home: g[1] === 1, wd: g[2], time: g[3], spread: sp, total: g[5], roof: g[6], div: g[7] === 1, pf: pf, pa: pa,
        prime: g[3] != null && g[3] >= "19:00", fav: sp == null ? null : sp < 0, win: (pf == null || pa == null || pf === pa) ? null : pf > pa,
        rank: rk, tier: rk == null ? null : rk <= 10 ? "soft" : rk >= 23 ? "tough" : "mid" };
    }
    function mateKeyed(mateId) {
      var m = byIdSafe(mateId), map = {};
      if (m) m.rows.forEach(function (r) { map[r.season + "-" + r.week] = r; });
      return map;
    }
    function byIdSafe(id) { return core.byId[id] || null; }
    function matchRow(p, row, f, mate) {
      if (f.season && String(row.season) !== String(f.season)) return false;
      var needCtx = f.home != null || f.prime != null || f.opp || f.div != null || f.fav != null || f.roof || f.result || f.tier;
      var c = needCtx ? ctxOf(p, row) : null;
      if (needCtx && !c) return false;
      if (f.home != null && c.home !== f.home) return false;
      if (f.prime != null && c.prime !== f.prime) return false;
      if (f.opp && c.opp !== f.opp) return false;
      if (f.div != null && c.div !== f.div) return false;
      if (f.fav != null && (c.fav == null || (f.fav === "fav") !== c.fav)) return false;
      if (f.roof && c.roof !== f.roof) return false;
      if (f.result && (c.win == null || (f.result === "W") !== c.win)) return false;
      if (f.tier && c.tier !== f.tier) return false;
      if (mate) {
        var mr = mate.map[row.season + "-" + row.week];
        var played = !!mr && mr.tm === row.tm && (mr.snap == null || mr.snap >= 0.25);
        if (mate.mode === "with" && !played) return false;
        if (mate.mode === "without" && (played || (mr && mr.tm !== row.tm))) return false;
      }
      return true;
    }
    function applyFilters(p, f) {
      var mate = null;
      if (f.without || f.with) { var id = f.without || f.with; mate = { map: mateKeyed(id), mode: f.without ? "without" : "with" }; }
      var rows = p.rows.filter(function (r) { return matchRow(p, r, f, mate); });
      if (f.last) rows = rows.slice(-f.last);
      return rows;
    }
    function splitLine(p, rows, fmt) {
      var g = rows.length;
      if (!g) return { g: 0 };
      var s = core.statLine(rows), pts = rows.map(function (r) { return fp(r, fmt); });
      var snaps = nonNull(rows.map(function (r) { return r.snap; }));
      var wl = sum(rows.map(function (r) { return core.opps(r, p.pos); })) / g;
      return { g: g, fpg: avg(pts), total: sum(pts), max: Math.max.apply(null, pts), min: Math.min.apply(null, pts), snap: snaps.length ? avg(snaps) : null, wl: wl, line: s,
        yds: core.keyYards ? sum(rows.map(function (r) { return core.keyYards(r, p.pos); })) / g : null, td: s.td / g };
    }
    function describeFilters(f) {
      var chips = [];
      function add(key, label) { chips.push({ key: key, label: label }); }
      if (f.season) add("season", f.season + " season");
      if (f.last) add("last", "Last " + f.last + " games");
      if (f.home != null) add("home", f.home ? "Home games" : "Away games");
      if (f.prime != null) add("prime", f.prime ? "Primetime (7pm ET or later)" : "Not primetime");
      if (f.opp) add("opp", "vs " + f.opp);
      if (f.div != null) add("div", f.div ? "Division games" : "Non-division games");
      if (f.fav != null) add("fav", f.fav === "fav" ? "As favorite" : "As underdog");
      if (f.roof) add("roof", f.roof === "d" ? "Dome or closed roof" : "Outdoors");
      if (f.result) add("result", f.result === "W" ? "Team won" : "Team lost");
      if (f.tier) add("tier", f.tier === "soft" ? "vs bottom-10 defenses (most points allowed)" : f.tier === "tough" ? "vs top-10 defenses (fewest points allowed)" : "vs middle defenses");
      if (f.without) add("without", "Without " + (byIdSafe(f.without) ? byIdSafe(f.without).name : "teammate"));
      if (f.with) add("with", "With " + (byIdSafe(f.with) ? byIdSafe(f.with).name : "teammate"));
      return chips;
    }
    function resolveTeam(tok) {
      tok = tok.trim().toLowerCase().replace(/^the\s+/, "");
      if (!tok) return null;
      var up = tok.toUpperCase();
      if (TEAM_NAMES[up]) return up;
      var alias = { jac: "JAX", wsh: "WAS", lar: "LA", lvr: "LV", sd: "LAC", arz: "ARI", gb: "GB" };
      if (alias[tok]) return alias[tok];
      for (var t in TEAM_NAMES) if (TEAM_NAMES[t].indexOf(tok) >= 0) return t;
      for (var t2 in TEAM_NAMES) if (TEAM_NAMES[t2].some(function (n) { return n.indexOf(tok) >= 0 && tok.length >= 4; })) return t2;
      return null;
    }
    /* Turn typed text such as "home games vs KC last 5" into filters. Unrecognized words are reported back. */
    function parseQuery(text, p) {
      var t = " " + String(text).toLowerCase().replace(/[,;.]/g, " ").replace(/\s+/g, " ") + " ";
      var f = {}, unknown = [];
      function take(rx, fn) { var m = t.match(rx); if (m) { fn(m); t = t.replace(m[0], " "); return true; } return false; }
      take(/\bwithout\s+([a-z' -]+?)(?=\s+(?:at|in|vs|against|last|home|away|prime|as|on|with|when|during)\b|\s*$)/, function (m) {
        var tm = core.data.players.filter(function (q) { return q.team === p.team && q.id !== p.id && q.name.toLowerCase().indexOf(m[1].trim()) >= 0; })[0];
        if (tm) f.without = tm.id; else unknown.push("without " + m[1].trim());
      });
      take(/\b(?:with|when)\s+([a-z' -]+?)\s+(?:playing|active|healthy)\b/, function (m) {
        var tm = core.data.players.filter(function (q) { return q.team === p.team && q.id !== p.id && q.name.toLowerCase().indexOf(m[1].trim()) >= 0; })[0];
        if (tm) f.with = tm.id; else unknown.push("with " + m[1].trim());
      });
      take(/\b(?:vs\.?|versus|against)\s+(?:the\s+)?(?:top|best|toughest)\s*(?:10)?\s*defen[sc]es?\b/, function () { f.tier = "tough"; });
      take(/\b(?:vs\.?|versus|against)\s+(?:the\s+)?(?:bottom|worst|weakest|softest|easiest)\s*(?:10)?\s*defen[sc]es?\b/, function () { f.tier = "soft"; });
      take(/\b(?:vs\.?|versus|against|v)\s+(?:the\s+)?([a-z0-9 ]+?)(?=\s+(?:at|in|last|home|away|prime|as|on|with|without|when|during)\b|\s*$)/, function (m) {
        var tm = resolveTeam(m[1]); if (tm) f.opp = tm; else unknown.push(m[1].trim());
      });
      take(/\blast\s+(\d{1,2})(?:\s+games?)?\b/, function (m) { f.last = Math.max(1, +m[1]); });
      take(/\b(2024|2025|2026)(?:\s+season)?\b/, function (m) { f.season = m[1]; });
      take(/\b(?:non[- ]?prime ?time|day games?|afternoon games?)\b/, function () { f.prime = false; });
      take(/\b(?:prime ?time|night games?|snf|mnf|tnf|(?:sunday|monday|thursday) night)\b/, function () { f.prime = true; });
      take(/\b(?:home|at home)\b/, function () { f.home = true; });
      take(/\b(?:away|road|on the road)\b/, function () { f.home = false; });
      take(/\b(?:non[- ]?divisional|non[- ]?division)\b/, function () { f.div = false; });
      take(/\b(?:divisional|division)\b/, function () { f.div = true; });
      take(/\b(?:favou?rites?|favou?red)\b/, function () { f.fav = "fav"; });
      take(/\b(?:underdogs?|dogs?)\b/, function () { f.fav = "dog"; });
      take(/\b(?:domes?|indoors?|closed roof)\b/, function () { f.roof = "d"; });
      take(/\b(?:outdoors?|outside)\b/, function () { f.roof = "o"; });
      take(/\b(?:wins?|won|victories)\b/, function () { f.result = "W"; });
      take(/\b(?:loss(?:es)?|lost|defeats?)\b/, function () { f.result = "L"; });
      var rest = t.replace(/\b(games?|stats?|numbers?|in|the|his|her|a|an|as|and|for|show|me|when|during|of|on|at|what|are|is|how|did|does|do|he|she|they|play|played|playing|record)\b/g, " ").replace(/\s+/g, " ").trim();
      if (rest) unknown = unknown.concat(rest.split(" "));
      return { filters: f, unknown: unknown };
    }
    function atAGlance(p, fmt, season) {
      var base = p.rows.filter(function (r) { return !season || String(r.season) === String(season); });
      var withCtx = base.map(function (r) { return { r: r, c: ctxOf(p, r) }; }).filter(function (x) { return x.c; });
      var dims = [
        ["Home or away", [["Home", function (c) { return c.home; }], ["Away", function (c) { return !c.home; }]]],
        ["Kickoff time", [["Primetime (7pm ET or later)", function (c) { return c.prime; }], ["Daytime", function (c) { return !c.prime; }]]],
        ["Opponent", [["Division opponent", function (c) { return c.div; }], ["Non-division", function (c) { return !c.div; }]]],
        ["Game script (spread)", [["Favorite", function (c) { return c.fav === true; }], ["Underdog", function (c) { return c.fav === false; }]]],
        ["Stadium", [["Dome or closed roof", function (c) { return c.roof === "d"; }], ["Outdoors", function (c) { return c.roof === "o"; }]]],
        ["Result", [["Team won", function (c) { return c.win === true; }], ["Team lost", function (c) { return c.win === false; }]]],
        ["Defense faced", [["Bottom 10 (soft)", function (c) { return c.tier === "soft"; }], ["Middle 12", function (c) { return c.tier === "mid"; }], ["Top 10 (tough)", function (c) { return c.tier === "tough"; }]]],
        ["Game total (over/under)", [["47 or higher", function (c) { return c.total != null && c.total >= 47; }], ["Under 47", function (c) { return c.total != null && c.total < 47; }]]]
      ];
      return dims.map(function (d) {
        return { dim: d[0], buckets: d[1].map(function (b) {
          var rows = withCtx.filter(function (x) { return b[1](x.c); }).map(function (x) { return x.r; });
          var line = splitLine(p, rows, fmt); line.label = b[0]; return line;
        }) };
      });
    }
    function opponentOptions(p) {
      var seen = {};
      p.rows.forEach(function (r) { if (r.opp) seen[r.opp] = (seen[r.opp] || 0) + 1; });
      return Object.keys(seen).sort();
    }

    return {
      core: core, TEAM_NAMES: TEAM_NAMES, teams: teamList, UNIT: UNIT,
      baseline: baseline, avail: avail, injuryNews: injuryNews, roomOf: roomOf, outlook: outlook,
      fallout: fallout, starterChanges: starterChanges, teamChanges: teamChanges,
      own: own, hasOwn: hasOwn, hiddenGems: hiddenGems, waiverBuzz: waiverBuzz,
      fantasySummary: fantasySummary, dvpTables: dvpTables,
      ctxOf: ctxOf, applyFilters: applyFilters, splitLine: splitLine, describeFilters: describeFilters,
      parseQuery: parseQuery, resolveTeam: resolveTeam, atAGlance: atAGlance, opponentOptions: opponentOptions
    };
  }

  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NFLAnalysis = api;
})(typeof self !== "undefined" ? self : this);
