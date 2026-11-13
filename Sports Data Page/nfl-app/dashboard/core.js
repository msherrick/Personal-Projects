/* Pure data logic for the NFL dashboard. No DOM access, so it can be tested in node.
   Load order in the browser: define DATA, then this file; use NFLCore.create(DATA). */
(function (root) {
  "use strict";

  var FORMATS = { ppr: "Full PPR", half: "Half PPR", std: "Standard" };
  var FMT_INDEX = { std: 0, half: 1, ppr: 2 };
  var YARD_LABEL = { QB: "passing yards", RB: "rushing and receiving yards", WR: "receiving yards", TE: "receiving yards" };

  function v(x) { return x == null ? 0 : x; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function avg(a) { return a.length ? sum(a) / a.length : null; }
  function last(a, n) { return a.slice(Math.max(0, a.length - n)); }
  function r1(x) { return x == null ? null : Math.round(x * 10) / 10; }
  function pct(x) { return x == null ? null : Math.round(x * 100); }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], m = n % 100;
    return n + (s[(m - 20) % 10] || s[m] || s[0]);
  }
  function nonNull(a) { return a.filter(function (x) { return x != null; }); }

  function create(data) {
    var meta = data.meta, CUR = meta.season, W = meta.last_week_played;
    var idx = {};
    meta.log_cols.forEach(function (c, i) { idx[c] = i; });

    data.players.forEach(function (p) {
      p.rows = p.log.map(function (r) {
        var o = {};
        for (var k in idx) o[k] = r[idx[k]];
        return o;
      });
    });
    var byId = {};
    data.players.forEach(function (p) { byId[p.id] = p; });

    function fp(row, fmt) {
      var std = v(row.fp), ppr = v(row.fpp);
      if (fmt === "std") return std;
      if (fmt === "ppr") return ppr;
      return (std + ppr) / 2;
    }
    function seasonRows(p, season) {
      return p.rows.filter(function (r) { return r.season === (season || CUR); });
    }
    function opps(r, pos) {
      return pos === "QB" ? v(r.att) + v(r.ra) : v(r.ra) + v(r.tgt);
    }
    function keyYards(r, pos) {
      return pos === "QB" ? v(r.pyd) : v(r.ryd) + v(r.recyd);
    }

    /* ---- one entry for every week of a season: played, did not play, or bye ---- */
    function weekLog(p, season) {
      season = season || CUR;
      var maxW = meta.weeks_played[String(season)] || 18;
      var rows = seasonRows(p, season), byWeek = {};
      rows.forEach(function (r) { byWeek[r.week] = r; });
      var sched = data.sched[String(season)] || {};
      var out = [];
      for (var w = 1; w <= maxW; w++) {
        var r = byWeek[w];
        if (r) { out.push({ week: w, kind: "played", row: r, opp: r.opp, team: r.tm }); continue; }
        var team = p.team, best = 99;
        rows.forEach(function (x) { var d = Math.abs(x.week - w); if (d < best) { best = d; team = x.tm || team; } });
        var opp = sched[team] ? sched[team][w - 1] : null;
        if (opp) {
          out.push({
            week: w, kind: "dnp", opp: opp, team: team,
            row: { season: season, week: w, opp: opp, tm: team, snap: 0, cmp: 0, att: 0, pyd: 0, ptd: 0, int: 0, ra: 0, ryd: 0, rtd: 0, tgt: 0, rec: 0, recyd: 0, rectd: 0, fl: 0, two: 0, fp: 0, fpp: 0, tsh: 0, ays: 0, wopr: 0, csh: 0 }
          });
        } else out.push({ week: w, kind: "bye", opp: null, team: team, row: null });
      }
      return out;
    }

    /* ---- matchup ---- */
    function matchup(p, fmt) {
      var nx = p.next;
      if (!nx || nx.bye) return null;
      var d = data.dvp[nx.opp] && data.dvp[nx.opp][p.pos];
      if (!d) return null;
      var i = FMT_INDEX[fmt];
      var rk = d.rk[i];
      var tier = rk <= 8 ? "Favorable" : rk >= 25 ? "Tough" : "Neutral";
      return {
        opp: nx.opp, rank: rk, tier: tier, allowed: d.fp[i], l4: d.l4 ? d.l4[i] : null, games: d.n,
        yards: d.yd, yardsRank: d.yrk, yardLabel: YARD_LABEL[p.pos]
      };
    }

    /* ---- trends, grouped for display ---- */
    function streak(rows, test) {
      var n = 0;
      for (var i = rows.length - 1; i >= 0; i--) { if (test(rows[i])) n++; else break; }
      return n;
    }
    /* Highest threshold hit in every one of the last 3+ games; otherwise in 4 of the last 5. */
    function thresholdBullet(rows, thresholds, getter, noun) {
      var i, t, n;
      for (i = 0; i < thresholds.length; i++) {
        t = thresholds[i];
        n = streak(rows, function (r) { return getter(r) >= t; });
        if (n >= 3) {
          return { tone: "up", text: t + "+ " + noun + (n === rows.length ? " in all " + n + " games this season" : " in each of the last " + n + " games") };
        }
      }
      if (rows.length >= 5) {
        var l5 = last(rows, 5);
        for (i = 0; i < thresholds.length; i++) {
          t = thresholds[i];
          var hits = l5.filter(function (r) { return getter(r) >= t; }).length;
          if (hits >= 4) return { tone: "up", text: t + "+ " + noun + " in " + hits + " of the last 5 games" };
        }
      }
      return null;
    }

    function trendGroups(p, fmt) {
      var rows = seasonRows(p);
      var g = { form: [], usage: [], matchup: [], avail: [], interest: [] };
      var pos = p.pos, b;
      if (rows.length) {
        var pts = rows.map(function (r) { return fp(r, fmt); });
        var sAvg = avg(pts), l3 = avg(last(pts, 3)), diff = l3 - sAvg;
        g.form.push({ tone: diff >= 2 ? "up" : diff <= -2 ? "down" : "flat",
          text: r1(sAvg) + " " + FORMATS[fmt] + " points per game this season; " + r1(l3) + " over the last " + Math.min(3, rows.length) + " games" });

        if (pos === "WR" || pos === "TE") {
          b = thresholdBullet(rows, [100, 80, 70, 60, 50, 40, 30], function (r) { return v(r.recyd); }, "receiving yards"); if (b) g.form.push(b);
          b = thresholdBullet(rows, [10, 8, 6, 5, 4], function (r) { return v(r.tgt); }, "targets"); if (b) g.form.push(b);
          b = thresholdBullet(rows, [8, 6, 5, 4, 3], function (r) { return v(r.rec); }, "receptions"); if (b) g.form.push(b);
        } else if (pos === "RB") {
          b = thresholdBullet(rows, [100, 80, 70, 60, 50, 40], function (r) { return v(r.ryd); }, "rushing yards"); if (b) g.form.push(b);
          b = thresholdBullet(rows, [20, 15, 12, 10], function (r) { return v(r.ra); }, "carries"); if (b) g.form.push(b);
          b = thresholdBullet(rows, [6, 5, 4, 3, 2], function (r) { return v(r.rec); }, "receptions"); if (b) g.form.push(b);
        } else if (pos === "QB") {
          b = thresholdBullet(rows, [300, 275, 250, 225, 200], function (r) { return v(r.pyd); }, "passing yards"); if (b) g.form.push(b);
          b = thresholdBullet(rows, [3, 2], function (r) { return v(r.ptd); }, "passing touchdowns"); if (b) g.form.push(b);
          b = thresholdBullet(rows, [40, 30, 20, 10], function (r) { return v(r.ryd); }, "rushing yards"); if (b) g.form.push(b);
        }
        var tdn = streak(rows, function (r) { return v(r.ptd) + v(r.rtd) + v(r.rectd) > 0; });
        if (tdn >= 2) g.form.push({ tone: "up", text: "Touchdown in " + (tdn === rows.length ? "all " : "each of the last ") + tdn + " games" });
        var td0 = streak(rows, function (r) { return v(r.ptd) + v(r.rtd) + v(r.rectd) === 0; });
        if (td0 >= 4) g.form.push({ tone: "down", text: "No touchdown in the last " + td0 + " games" });
        b = thresholdBullet(rows, [30, 25, 20, 15, 10], function (r) { return fp(r, fmt); }, FORMATS[fmt] + " points"); if (b) g.form.push(b);

        var sn = nonNull(rows.map(function (r) { return r.snap; }));
        if (sn.length >= 4) {
          var a = avg(sn), bb = avg(last(sn, 3));
          if (Math.abs(bb - a) >= 0.05) g.usage.push({ tone: bb > a ? "up" : "down", text: "Snap share " + (bb > a ? "up" : "down") + " to " + pct(bb) + "% over the last 3 games (season average " + pct(a) + "%)" });
        }
        if (pos !== "QB") {
          var ts = nonNull(rows.map(function (r) { return r.tsh; }));
          if (ts.length >= 4 && (pos === "WR" || pos === "TE" || avg(ts) > 0.08)) {
            var ta = avg(ts), tb = avg(last(ts, 3));
            if (Math.abs(tb - ta) >= 0.03) g.usage.push({ tone: tb > ta ? "up" : "down", text: "Target share " + (tb > ta ? "up" : "down") + " to " + pct(tb) + "% over the last 3 games (season average " + pct(ta) + "%)" });
          }
        }
        if (pos === "RB") {
          var cs = nonNull(rows.map(function (r) { return r.csh; }));
          if (cs.length >= 4) {
            var ca = avg(cs), cb = avg(last(cs, 3));
            if (Math.abs(cb - ca) >= 0.05) g.usage.push({ tone: cb > ca ? "up" : "down", text: "Share of team carries " + (cb > ca ? "up" : "down") + " to " + pct(cb) + "% over the last 3 games (season average " + pct(ca) + "%)" });
          }
        }
      }

      var m = matchup(p, fmt);
      if (m) {
        var tone = m.tier === "Favorable" ? "up" : m.tier === "Tough" ? "down" : "flat";
        g.matchup.push({ tone: tone, text: m.opp + " have allowed the " + ordinal(m.rank) + "-most " + FORMATS[fmt] + " points to " + pos + "s this season (" + r1(m.allowed) + " per game" + (m.l4 != null ? "; " + r1(m.l4) + " over their last 4" : "") + ")" });
        if (m.yards != null) {
          var yt = m.yardsRank <= 8 ? "up" : m.yardsRank >= 25 ? "down" : "flat";
          g.matchup.push({ tone: yt, text: m.opp + " have allowed the " + ordinal(m.yardsRank) + "-most " + m.yardLabel + " to " + pos + "s (" + r1(m.yards) + " per game)" });
        }
        var vs = p.rows.filter(function (r) { return r.opp === m.opp; });
        if (vs.length) {
          var va = avg(vs.map(function (r) { return fp(r, fmt); }));
          g.matchup.push({ tone: "flat", text: "Averaged " + r1(va) + " " + FORMATS[fmt] + " points in " + vs.length + " game" + (vs.length > 1 ? "s" : "") + " against " + m.opp + " since " + (CUR - 2) });
        }
      }

      if (SL) {
        [[24, "in the last 24 hours"], [168, "over the last 7 days"]].forEach(function (wd) {
          ["add", "drop"].forEach(function (kind) {
            var c = slCount(p, kind, wd[0]);
            if (!c) return;
            var all = slList(kind, wd[0], p.pos, 0), rank = 0;
            for (var j = 0; j < all.length; j++) if (all[j].p.id === p.id) { rank = j + 1; break; }
            g.interest.push({ tone: kind === "add" ? "up" : "down",
              text: (kind === "add" ? "Added" : "Dropped") + " in " + c.toLocaleString("en-US") + " Sleeper leagues " + wd[1] + (rank ? " (" + ordinal(rank) + " most " + (kind === "add" ? "added " : "dropped ") + p.pos + ")" : "") });
          });
        });
      }

      if (BZ) {
        var wm = waiverMentions(p), nm = (buzzBy[p.id] || []).length;
        if (wm) g.interest.push({ tone: "up", text: "Named in " + wm + " waiver or pickup article" + (wm > 1 ? "s" : "") + " from your feeds in the last 14 days" });
        else if (nm) g.interest.push({ tone: "flat", text: "In " + nm + " recent headline" + (nm > 1 ? "s" : "") + " from your feeds (listed under In the news)" });
      }

      var wl = weekLog(p, CUR), missed = 0;
      for (var i = wl.length - 1; i >= 0; i--) {
        if (wl[i].kind === "bye") continue;
        if (wl[i].kind === "dnp") missed++; else break;
      }
      if (missed) g.avail.push({ tone: "down", text: "Did not play in the last " + missed + " team game" + (missed > 1 ? "s" : "") });
      if (p.inj) g.avail.push({ tone: "down", text: "Listed " + p.inj.status + (p.inj.body ? " (" + p.inj.body + ")" : "") + " on the Week " + p.inj.week + " injury report" });
      if (p.rstatus && p.rstatus !== "ACT") g.avail.push({ tone: "down", text: "Roster status: " + (p.rstatus === "RES" ? "on a reserve list" : p.rstatus) });
      return g;
    }
    function chips(p, fmt) {
      var g = trendGroups(p, fmt);
      return g.form.concat(g.usage, g.matchup, g.avail, g.interest);
    }

    /* ---- summary over a sample: season, last N games (any season), or everything loaded ---- */
    function summary(p, fmt, scope, n) {
      var rows;
      if (scope === "last3") { rows = last(seasonRows(p), 3); }
      else if (scope === "last") { rows = last(p.rows, Math.max(1, n || 3)); }
      else if (scope === "since") rows = p.rows;
      else rows = seasonRows(p);
      var g = rows.length;
      var o = { g: g };
      if (!g) return o;
      function pg(k) { return sum(rows.map(function (r) { return v(r[k]); })) / g; }
      var pts = rows.map(function (r) { return fp(r, fmt); });
      o.fpg = avg(pts);
      o.max = Math.max.apply(null, pts);
      o.min = Math.min.apply(null, pts);
      var sn = nonNull(rows.map(function (r) { return r.snap; }));
      o.snap = sn.length ? avg(sn) : null;
      var ts = nonNull(rows.map(function (r) { return r.tsh; }));
      o.tsh = ts.length ? avg(ts) : null;
      var cs = nonNull(rows.map(function (r) { return r.csh; }));
      o.csh = cs.length ? avg(cs) : null;
      o.pyd = pg("pyd"); o.ptd = pg("ptd"); o.int = pg("int"); o.att = pg("att");
      o.ra = pg("ra"); o.ryd = pg("ryd"); o.rtd = pg("rtd");
      o.tgt = pg("tgt"); o.rec = pg("rec"); o.recyd = pg("recyd"); o.rectd = pg("rectd");
      o.td = o.ptd + o.rtd + o.rectd;
      var totOpp = sum(rows.map(function (r) { return opps(r, p.pos); }));
      o.opp = totOpp / g;
      o.ppo = totOpp > 0 ? sum(pts) / totOpp : null;
      return o;
    }

    /* ---- the games a compare sample covers ---- */
    function sample(p, scope, n) {
      if (scope === "last") return last(p.rows, Math.max(1, n || 3));
      if (scope === "since") return p.rows;
      return seasonRows(p);
    }
    /* Box-score totals and rates (the stats ESPN and Pro Football Reference list), from a set of games. */
    function statLine(rows) {
      var g = rows.length, o = { g: g };
      if (!g) return o;
      function S(k) { return sum(rows.map(function (r) { return v(r[k]); })); }
      o.cmp = S("cmp"); o.att = S("att"); o.pyd = S("pyd"); o.ptd = S("ptd"); o.int = S("int");
      o.ra = S("ra"); o.ryd = S("ryd"); o.rtd = S("rtd");
      o.tgt = S("tgt"); o.rec = S("rec"); o.recyd = S("recyd"); o.rectd = S("rectd"); o.fl = S("fl");
      o.scrim = o.ryd + o.recyd; o.td = o.ptd + o.rtd + o.rectd;
      o.cmpPct = o.att ? o.cmp / o.att : null;
      o.ypa = o.att ? o.pyd / o.att : null;
      o.ypc = o.ra ? o.ryd / o.ra : null;
      o.ypr = o.rec ? o.recyd / o.rec : null;
      o.ypt = o.tgt ? o.recyd / o.tgt : null;
      o.catchPct = o.tgt ? o.rec / o.tgt : null;
      o.pydg = o.pyd / g; o.rydg = o.ryd / g; o.recydg = o.recyd / g; o.scrimg = o.scrim / g;
      function A(k) { var a = nonNull(rows.map(function (r) { return r[k]; })); return a.length ? avg(a) : null; }
      o.snap = A("snap"); o.tsh = A("tsh"); o.ays = A("ays"); o.wopr = A("wopr"); o.csh = A("csh");
      return o;
    }

    /* ---- head to head: weeks both played ---- */
    function headToHead(a, b, fmt, scope, n) {
      function key(r) { return r.season + "-" + r.week; }
      var ra = scope === "since" ? a.rows : scope === "last" ? last(a.rows, n || 3) : seasonRows(a);
      var rb = scope === "since" || scope === "last" ? b.rows : seasonRows(b);
      var mb = {};
      rb.forEach(function (r) { mb[key(r)] = r; });
      var wa = 0, wb = 0, ties = 0, cnt = 0, da = [], db = [];
      ra.forEach(function (r) {
        var o = mb[key(r)];
        if (!o) return;
        cnt++;
        var x = fp(r, fmt), y = fp(o, fmt);
        da.push(x); db.push(y);
        if (x > y + 1e-9) wa++; else if (y > x + 1e-9) wb++; else ties++;
      });
      return { n: cnt, winsA: wa, winsB: wb, ties: ties, avgA: avg(da), avgB: avg(db) };
    }

    /* ---- risers: recent window vs the games before it ---- */
    function riserRow(p, fmt, k) {
      var rows = seasonRows(p);
      if (rows.length < k + 2 || p.rstatus !== "ACT") return null;
      var recent = last(rows, k), prior = rows.slice(0, rows.length - k);
      var oppRecent = avg(recent.map(function (r) { return opps(r, p.pos); }));
      var oppPrior = avg(prior.map(function (r) { return opps(r, p.pos); }));
      var fpRecent = avg(recent.map(function (r) { return fp(r, fmt); }));
      var fpPrior = avg(prior.map(function (r) { return fp(r, fmt); }));
      var sn = rows.map(function (r) { return r.snap; });
      var snRecent = avg(nonNull(last(sn, k)));
      var snPrior = avg(nonNull(sn.slice(0, sn.length - k)));
      return {
        p: p, g: rows.length, k: k, gp: rows.length,
        totRecent: sum(recent.map(function (r) { return fp(r, fmt); })), totSeason: sum(rows.map(function (r) { return fp(r, fmt); })),
        oppRecent: oppRecent, oppPrior: oppPrior, dOpp: oppRecent - oppPrior,
        fpRecent: fpRecent, fpPrior: fpPrior, dFp: fpRecent - fpPrior,
        snRecent: snRecent, snPrior: snPrior,
        dSn: (snRecent != null && snPrior != null) ? snRecent - snPrior : null
      };
    }
    function risers(fmt, pos, n, basis) {
      var k = basis === "last1" ? 1 : 3, list = [];
      data.players.forEach(function (p) {
        if (pos && p.pos !== pos) return;
        var r = riserRow(p, fmt, k);
        if (!r) return;
        var minOpp = p.pos === "QB" ? (k === 1 ? 15 : 20) : (k === 1 ? 5 : 4);
        if (r.oppRecent < minOpp) return;
        list.push(r);
      });
      return {
        k: k,
        opportunity: list.slice().sort(function (a, b) { return b.dOpp - a.dOpp; }).slice(0, n),
        production: list.slice().sort(function (a, b) { return b.dFp - a.dFp; }).slice(0, n),
        fallers: list.slice().sort(function (a, b) { return a.dFp - b.dFp; }).slice(0, n)
      };
    }
    function efficiency(fmt, pos, n, minOpp) {
      var list = [];
      data.players.forEach(function (p) {
        if (pos && p.pos !== pos) return;
        if (p.pos === "QB") return;
        var rows = seasonRows(p);
        var tot = sum(rows.map(function (r) { return opps(r, p.pos); }));
        if (tot < (minOpp || 40)) return;
        list.push({ p: p, opp: tot, ppo: sum(rows.map(function (r) { return fp(r, fmt); })) / tot, g: rows.length });
      });
      return list.sort(function (a, b) { return b.ppo - a.ppo; }).slice(0, n);
    }
    function topScorers(fmt, pos, n) {
      var list = [];
      data.players.forEach(function (p) {
        if (pos && p.pos !== pos) return;
        var r = seasonRows(p).filter(function (x) { return x.week === W; })[0];
        if (r) list.push({ p: p, row: r, pts: fp(r, fmt) });
      });
      return list.sort(function (a, b) { return b.pts - a.pts; }).slice(0, n);
    }

    /* ---- injury fallout: starters who left the latest game early or were ruled out, and who steps in ---- */
    function fallout(fmt, pos) {
      var found = [], ids = {};
      data.players.forEach(function (p) {
        if (pos && p.pos !== pos) return;
        var rows = seasonRows(p);
        if (rows.length < 2 && !(rows.length === 1 && rows[0].week < W)) return;
        var lastRow = rows[rows.length - 1];
        var played = lastRow.week === W;
        var prior = played ? rows.slice(0, -1) : rows;
        var sn = nonNull(prior.map(function (r) { return r.snap; }));
        if (!sn.length) return;
        var base = avg(last(sn, 3));
        var starter = base >= (p.pos === "QB" ? 0.8 : 0.5);
        if (!starter) return;
        var reason = null;
        if (played && lastRow.snap != null && lastRow.snap <= 0.4 * base) reason = "left";
        else if (!played && p.inj && (p.inj.status === "Out" || p.inj.status === "Doubtful")) reason = "out";
        if (!reason) return;
        ids[p.id] = true;
        found.push({ p: p, reason: reason, base: base, lastSnap: played ? lastRow.snap : null, avgPts: avg(rows.map(function (r) { return fp(r, fmt); })) });
      });
      found.forEach(function (f) {
        var list = [];
        data.players.forEach(function (q) {
          if (q.team !== f.p.team || q.pos !== f.p.pos || q.id === f.p.id || ids[q.id] || q.rstatus !== "ACT") return;
          var rows = seasonRows(q);
          if (!rows.length) return;
          var lr = rows.filter(function (x) { return x.week === W; })[0];
          var l3 = avg(nonNull(last(rows, 3).map(function (x) { return x.snap; })));
          var lastSnap = lr ? lr.snap : null;
          if (!(lastSnap >= 0.1 || (l3 != null && l3 >= 0.2))) return;
          list.push({ p: q, lastSnap: lastSnap, l3: l3, opp: lr ? opps(lr, q.pos) : null, pts: lr ? fp(lr, fmt) : null });
        });
        list.sort(function (a, b) { return (b.lastSnap || 0) - (a.lastSnap || 0) || (b.l3 || 0) - (a.l3 || 0); });
        f.next = list.slice(0, 2);
      });
      return found.sort(function (a, b) { return b.avgPts - a.avgPts; });
    }

    /* ---- Sleeper adds/drops (present only when refresh.py fetched them) ---- */
    var SL = data.sleeper && data.sleeper.windows && Object.keys(data.sleeper.windows).length ? data.sleeper : null;
    function hasSleeper() { return !!SL; }
    function slCount(p, kind, win) {
      var w = SL && SL.windows[String(win)];
      return w && w[kind] ? (w[kind][p.id] || 0) : 0;
    }
    function recentMetrics(p, fmt) {
      var rows = seasonRows(p);
      if (!rows.length) return null;
      var pts = rows.map(function (r) { return fp(r, fmt); });
      var prior = rows.slice(0, Math.max(0, rows.length - 3));
      var o3 = avg(last(rows, 3).map(function (r) { return opps(r, p.pos); }));
      var oP = prior.length ? avg(prior.map(function (r) { return opps(r, p.pos); })) : null;
      return { l3: avg(last(pts, 3)), season: avg(pts), opp3: o3, dOpp: oP == null ? null : o3 - oP, games: rows.length };
    }
    function slList(kind, win, pos, n, fmt) {
      var w = SL && SL.windows[String(win)];
      if (!w || !w[kind]) return [];
      var list = [];
      data.players.forEach(function (p) {
        if (pos && p.pos !== pos) return;
        var c = w[kind][p.id];
        if (c > 0) list.push({ p: p, count: c, m: recentMetrics(p, fmt || "ppr") });
      });
      list.sort(function (a, b) { return b.count - a.count; });
      return n ? list.slice(0, n) : list;
    }

    /* ---- headlines from RSS feeds (present only when refresh.py fetched them) ---- */
    var BZ = data.buzz && data.buzz.items ? data.buzz : null;
    var buzzBy = {};
    if (BZ) BZ.items.forEach(function (it) { it.p.forEach(function (pid) { (buzzBy[pid] = buzzBy[pid] || []).push(it); }); });
    function hasBuzz() { return !!BZ; }
    function playerNews(p, n) { var a = buzzBy[p.id] || []; return n ? a.slice(0, n) : a; }
    function waiverMentions(p) { return (buzzBy[p.id] || []).filter(function (i) { return i.k === "waiver"; }).length; }
    function buzzPlayers(it) { return it.p.map(function (id) { return byId[id]; }).filter(Boolean); }
    function buzzList(pos, n, fmt) {
      var list = [];
      data.players.forEach(function (p) {
        if (pos && p.pos !== pos) return;
        var w = waiverMentions(p);
        if (w > 0) list.push({ p: p, waiver: w, total: (buzzBy[p.id] || []).length, m: recentMetrics(p, fmt || "ppr") });
      });
      list.sort(function (a, b) { return b.waiver - a.waiver || b.total - a.total || (b.m ? b.m.l3 : 0) - (a.m ? a.m.l3 : 0); });
      return n ? list.slice(0, n) : list;
    }
    function waiverArticles(pos, n) {
      var list = BZ ? BZ.items.filter(function (i) {
        if (i.k !== "waiver") return false;
        return !pos || buzzPlayers(i).some(function (p) { return p.pos === pos; });
      }) : [];
      return n ? list.slice(0, n) : list;
    }

    /* ---- matchup table ---- */
    function dvpTable(pos, fmt) {
      var i = FMT_INDEX[fmt], out = [];
      for (var team in data.dvp) {
        var d = data.dvp[team][pos];
        if (!d) continue;
        out.push({ team: team, n: d.n, allowed: d.fp[i], l4: d.l4 ? d.l4[i] : null, rank: d.rk[i], yards: d.yd, yardsRank: d.yrk });
      }
      return out.sort(function (a, b) { return a.rank - b.rank; });
    }

    function search(q, limit) {
      q = q.toLowerCase().trim();
      if (!q) return [];
      var starts = [], contains = [];
      data.players.forEach(function (p) {
        var n = p.name.toLowerCase();
        if (n.indexOf(q) === 0 || n.split(" ").slice(1).join(" ").indexOf(q) === 0) starts.push(p);
        else if (n.indexOf(q) >= 0) contains.push(p);
      });
      return starts.concat(contains).slice(0, limit || 8);
    }

    return {
      data: data, byId: byId, FORMATS: FORMATS, YARD_LABEL: YARD_LABEL,
      sample: sample, statLine: statLine, fp: fp, seasonRows: seasonRows, weekLog: weekLog, matchup: matchup, trendGroups: trendGroups, chips: chips,
      summary: summary, headToHead: headToHead, risers: risers, efficiency: efficiency, topScorers: topScorers,
      fallout: fallout, dvpTable: dvpTable, hasSleeper: hasSleeper, hasBuzz: hasBuzz, playerNews: playerNews, waiverMentions: waiverMentions, buzzList: buzzList, waiverArticles: waiverArticles, buzzPlayers: buzzPlayers, slCount: slCount, slList: slList, recentMetrics: recentMetrics, search: search, avg: avg, r1: r1, pct: pct, ordinal: ordinal,
      opps: opps, keyYards: keyYards
    };
  }

  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NFLCore = api;
})(typeof self !== "undefined" ? self : this);
