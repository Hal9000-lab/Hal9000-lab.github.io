// Canvas animation of the centerline extraction, step by step
// (uses CenterlineAlgoDetailed from centerline-algo-detailed.js).
(function () {
    "use strict";

    var canvas = document.getElementById("cd-canvas");
    if (!canvas || !window.CenterlineAlgoDetailed) return;

    var M = window.CenterlineAlgoDetailed.build();
    var W = M.W, H = M.H, N = W * H, MM = M.MM;

    var ACCENT = (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#4c6273").trim();
    var COL = {
        bg: "#12101c", vessel: [200, 212, 226], aortaFill: "rgba(120,70,85,0.55)",
        R: "#ffb454", L: "#5ec8e5", white: "#ffffff", red: "#ff5d6c", dil: [110, 220, 235], spec: [255, 130, 60]
    };
    var SIDE = { R: [255, 180, 84], L: [94, 200, 229] };
    var RAMP_D = [[43, 27, 90], [31, 158, 137], [253, 231, 37]];
    var RAMP_C = [[25, 25, 70], [120, 40, 140], [255, 170, 60]];
    var RAMP_R = [[255, 232, 150], [255, 160, 60], [200, 70, 40]];
    var RAMP_L = [[190, 245, 250], [70, 190, 235], [40, 90, 190]];

    function mm(px) { return (px * MM).toFixed(px * MM < 10 ? 1 : 0); }

    // ---- ordered growth events of the first pass (all trees together, farthest first)
    var EV = [];
    M.pass1.forEach(function (pp, s) {
        pp.events.forEach(function (ev) { EV.push({ ev: ev, side: M.ostia[s].side, tree: s }); });
    });
    EV.sort(function (a, b) { return b.ev.G - a.ev.G; });
    var covEv = new Int16Array(N).fill(-1);
    EV.forEach(function (e, i) { e.ev.newCov.forEach(function (p) { covEv[p] = i; }); });

    // ---- timeline
    var SCENES = [
        { t0: 0,  t1: 4,  title: "Inputs",                        sub: "The coronary segmentation mask and the two annotated ostia. Image intensities are not used." },
        { t0: 4,  t1: 9,  title: "Resampling and dilation",       sub: "On the 0.5 mm grid the mask can break. A one-voxel dilation repairs it; the added voxels cost 1000 times more, so paths use them only where the mask is interrupted." },
        { t0: 9,  t1: 14, title: "Connecting ostia and gaps",     sub: "Each ostium joins the mask through the smallest ball that reaches it. Gaps of at most 10 mm, e.g. at a severe stenosis, are bridged by a straight segment, at the same high cost." },
        { t0: 14, t1: 18, title: "Distance from the wall, D",     sub: "Euclidean distance of every voxel from the boundary of the dilated mask." },
        { t0: 18, t1: 23, title: "Centred cost",                  sub: "c = (D + 0.5)^-4. A path is penalised at once for its length and for its distance from the vessel axis." },
        { t0: 23, t1: 30, title: "Two minimal-cost fronts",       sub: "From each ostium, a unit-cost front gives the geodesic distance G; a centred-cost front links every voxel to the ostium along its minimal path. Each voxel goes to the ostium with the smaller G." },
        { t0: 30, t1: 39, title: "Growing the tree",              sub: "Select the uncovered voxel with the largest G, read its minimal path up to the tree, and mark the surrounding lumen as covered. Keep the path only if it adds at least 5 mm outside the covered region." },
        { t0: 39, t1: 44, title: "Second pass: capped distance",  sub: "Where the mask is locally bulky, the deepest voxels attract paths. Each tree is grown again with D capped at 1.2 times the local vessel radius; elsewhere the cost is unchanged." },
        { t0: 44, t1: 48, title: "Trimming the tips",             sub: "2 mm of centerline are removed from every endpoint, where the lumen tapers and the path is poorly constrained." },
        { t0: 48, t1: 53, title: "Smoothing",                     sub: "Branch by branch, positions and radii are replaced by a Gaussian-weighted average along the arc length (sigma = 2 mm). Ostium, endpoints and junctions stay in place." },
        { t0: 53, t1: 59, title: "The centerline graph",          sub: "One rooted tree per side. Every node has a position, a lumen radius, a topological type and a side." }
    ];
    var T = SCENES[SCENES.length - 1].t1;      // length of the script (script time)
    var HOLD = 1.5, CUT_FADE = 0.16;

    // ---- pacing: the script is played slower than written, and every scene ends with a still hold
    // on its completed view (just before the cut), so that it can be taken in.
    var SLOW = 1.2, SCENE_HOLD = 1.9;
    var segs = (function () {
        var out = [], r = 0;
        SCENES.forEach(function (sc, i) {
            var last = i === SCENES.length - 1;
            var tf = last ? sc.t1 : sc.t1 - CUT_FADE * 1.05;       // hold right before the cut dip starts
            out.push({ r0: r, r1: r + (tf - sc.t0) * SLOW, a0: sc.t0, a1: tf });
            r += (tf - sc.t0) * SLOW;
            if (!last) {
                out.push({ r0: r, r1: r + SCENE_HOLD, a0: tf, a1: tf });
                r += SCENE_HOLD;
                out.push({ r0: r, r1: r + (sc.t1 - tf) * SLOW, a0: tf, a1: sc.t1 });
                r += (sc.t1 - tf) * SLOW;
            }
        });
        return out;
    })();
    var R = segs[segs.length - 1].r1;           // real duration, seconds
    function toScript(r) {
        for (var i = 0; i < segs.length; i++) {
            var g = segs[i];
            if (r <= g.r1 || i === segs.length - 1) {
                return g.r1 > g.r0 ? g.a0 + (g.a1 - g.a0) * clamp((r - g.r0) / (g.r1 - g.r0), 0, 1) : g.a0;
            }
        }
        return T;
    }
    function sceneStartReal(i) {
        for (var k = 0; k < segs.length; k++) if (Math.abs(segs[k].a0 - SCENES[i].t0) < 1e-9 && segs[k].a1 > segs[k].a0) return segs[k].r0;
        return 0;
    }

    // ---- helpers
    function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
    function ease(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    function lerp(a, b, k) { return a + (b - a) * k; }
    function ramp(stops, t) {
        t = clamp(t, 0, 1) * (stops.length - 1);
        var i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
        return [lerp(stops[i][0], stops[i + 1][0], f), lerp(stops[i][1], stops[i + 1][1], f), lerp(stops[i][2], stops[i + 1][2], f)];
    }
    function sceneAt(t) {
        for (var i = SCENES.length - 1; i >= 0; i--) if (t >= SCENES[i].t0) return i;
        return 0;
    }
    function px2(p) { return [p % W + 0.5, ((p / W) | 0) + 0.5]; }
    function sideCol(s) { return s === "R" ? COL.R : COL.L; }

    // ---- offscreen voxel layers
    function layer() { var c = document.createElement("canvas"); c.width = W; c.height = H; return c; }
    function paint(fn) {
        var c = layer(), ctx = c.getContext("2d"), img = ctx.createImageData(W, H), d = img.data;
        for (var i = 0; i < N; i++) {
            var col = fn(i);
            if (col) { d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = col.length > 3 ? col[3] : 255; }
        }
        ctx.putImageData(img, 0, 0);
        return c;
    }
    var maskL = paint(function (i) { return M.mask0[i] ? COL.vessel : null; });
    var breakL = paint(function (i) { return null; });
    (function () {
        var ctx = breakL.getContext("2d"), img = ctx.createImageData(W, H);
        M.breakPix.concat(M.gapPix).forEach(function (p) {
            img.data[p * 4] = 255; img.data[p * 4 + 1] = 93; img.data[p * 4 + 2] = 108; img.data[p * 4 + 3] = 255;
        });
        ctx.putImageData(img, 0, 0);
    })();
    var dilL = paint(function (i) { return M.dilated[i] ? COL.dil : null; });
    var specL = paint(function (i) { return M.extra[i] && !M.dilated[i] ? COL.spec : null; });
    var dMax = 6;
    var dL = paint(function (i) { return M.domain[i] ? ramp(RAMP_D, M.D[i] / dMax) : null; });
    var costL = paint(function (i) {
        if (!M.domain[i]) return null;
        if (M.extra[i]) return [255, 110, 60];
        return ramp(RAMP_C, (Math.log(Math.pow(M.D[i] + 0.5, -4)) / Math.LN10 + 3.7) / 3.0);
    });
    var ownL = paint(function (i) { return M.owner[i] >= 0 && M.domain[i] ? SIDE[M.ostia[M.owner[i]].side].concat([150]) : null; });
    var bindL = paint(function (i) { return M.domain[i] && M.cap[i] < 1e8 && M.D[i] > M.cap[i] + 0.3 ? [255, 70, 200] : null; });

    function dynLayer() {
        var c = layer(), ctx = c.getContext("2d");
        return { c: c, ctx: ctx, img: ctx.createImageData(W, H), key: "" };
    }
    var geoL = dynLayer(), covL = dynLayer();
    function updateGeo(front) {
        var k = Math.round(front);
        if (geoL.key === k) return; geoL.key = k;
        var d = geoL.img.data;
        for (var i = 0; i < N; i++) {
            var o = M.owner[i], g = o >= 0 ? M.fronts[o].unit.dist[i] : 1e9;
            if (o < 0 || !M.domain[i] || g > front) { d[i * 4 + 3] = 0; continue; }
            var stripe = Math.floor(g / 10) % 2 === 0;
            var c = ramp(M.ostia[o].side === "R" ? RAMP_R : RAMP_L, g / M.maxG);
            var f = stripe ? 1 : 0.72;
            d[i * 4] = c[0] * f; d[i * 4 + 1] = c[1] * f; d[i * 4 + 2] = c[2] * f; d[i * 4 + 3] = g > front - 3 ? 255 : 225;
        }
        geoL.ctx.putImageData(geoL.img, 0, 0);
    }
    function updateCov(k, frac) {
        var key = k + ":" + Math.round(frac * 12);
        if (covL.key === key) return; covL.key = key;
        var d = covL.img.data;
        for (var i = 0; i < N; i++) {
            var e = covEv[i];
            if (e < 0 || e > k) { d[i * 4 + 3] = 0; continue; }
            var kept = EV[e].ev.kind === "keep", c = kept ? SIDE[EV[e].side] : [255, 93, 108];
            d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2];
            d[i * 4 + 3] = (e < k ? 0.30 : 0.30 * frac) * 255;
        }
        covL.ctx.putImageData(covL.img, 0, 0);
    }

    // ---- predecessor chains (sampled voxels read back to the ostium along the centred-cost front)
    var chains = (function () {
        var out = [], cnt = 0;
        for (var i = 0; i < N; i++) {
            if (!M.domain[i] || M.owner[i] < 0) continue;
            cnt++;
            if (cnt % 23) continue;
            var o = M.owner[i], par = M.fronts[o].centred.parent, p = i, pts = [px2(p)], guard = 0;
            while (par[p] >= 0 && guard++ < 400) { p = par[p]; pts.push(px2(p)); }
            if (pts.length > 8) out.push({ side: M.ostia[o].side, pts: pts });
        }
        return out;
    })();

    // ---- growth schedule (scene 7)
    var S7 = SCENES[6];
    var sched = (function () {
        var FL = 0.35, CV = 0.5, n = EV.length;
        var lens = EV.map(function (e) { return Math.max(e.ev.path.length, 18); });
        var tot = lens.reduce(function (a, b) { return a + b; }, 0);
        var avail = (S7.t1 - S7.t0) - 0.5 - n * (FL + CV);
        var t = S7.t0 + 0.2, out = [];
        EV.forEach(function (e, i) {
            var dur = Math.max(0.35, avail * lens[i] / tot);
            var pts = e.ev.path.map(px2);
            var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
            var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
            var z = clamp(Math.min(W * 0.6 / Math.max(x1 - x0, 6), H * 0.6 / Math.max(y1 - y0, 6)), 1.5, 2.4);
            out.push({ tFlash: t, tDraw: t + FL, tEnd: t + FL + dur, tCov: t + FL + dur + CV, pts: pts,
                       cam: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z: z } });
            t += FL + dur + CV;
        });
        return out;
    })();

    // ---- places of interest
    var breakAt = (function () { var p = px2(M.breakPix[(M.breakPix.length / 2) | 0]); return { x: p[0], y: p[1] }; })();
    var gapAt = (function () {
        var xs = 0, ys = 0; M.gapPix.forEach(function (p) { var q = px2(p); xs += q[0]; ys += q[1]; });
        return { x: xs / M.gapPix.length, y: ys / M.gapPix.length };
    })();
    var oR = M.ostia[0], oL = M.ostia[1];
    var bulgeA = { x: 138, y: 52 }, bulgeB = { x: 149, y: 80 };
    var tipFocus = (function () {
        var b = M.branches[2]; return { x: b.raw[0][0], y: b.raw[0][1] };
    })();
    var tipFocus2 = (function () { var b = M.branches[1]; return { x: b.raw[0][0], y: b.raw[0][1] }; })();
    var bendFocus = (function () {
        // point of largest turning angle on the longest branch
        var best = null, ba = -1;
        M.branches.forEach(function (b) {
            for (var k = 6; k < b.pts.length - 6; k++) {
                var a = Math.atan2(b.pts[k][1] - b.pts[k - 6][1], b.pts[k][0] - b.pts[k - 6][0]);
                var c = Math.atan2(b.pts[k + 6][1] - b.pts[k][1], b.pts[k + 6][0] - b.pts[k][0]);
                var d = Math.abs(Math.atan2(Math.sin(c - a), Math.cos(c - a)));
                if (d > ba) { ba = d; best = { x: b.pts[k][0], y: b.pts[k][1] }; }
            }
        });
        return best;
    })();

    function cameraAt(t) {
        var s = sceneAt(t), sc = SCENES[s], k = (t - sc.t0) / (sc.t1 - sc.t0);
        switch (s) {
            case 0: return { cx: 100, cy: 65, z: lerp(1.0, 1.06, k) };
            case 1: return { cx: breakAt.x, cy: breakAt.y, z: lerp(6.5, 7.5, k) };
            case 2: return t < 11.6 ? { cx: oR.pos[0] - 2, cy: oR.pos[1] + 2, z: lerp(7, 8, (t - 9) / 2.6) }
                                    : { cx: gapAt.x, cy: gapAt.y, z: lerp(5.2, 5.8, (t - 11.6) / 2.4) };
            case 3: return { cx: 100, cy: 65, z: lerp(1.25, 1.0, ease(k)) };
            case 4: return { cx: lerp(110, 100, k), cy: 70, z: lerp(2.0, 1.2, ease(k)) };
            case 5: return { cx: 100, cy: 65, z: lerp(1.25, 1.0, ease(k)) };
            case 6:
                var cur = 0;
                for (var i = 0; i < sched.length; i++) if (t >= sched[i].tFlash) cur = i;
                var from = cur === 0 ? { cx: 100, cy: 65, z: 1.15 } : sched[cur - 1].cam;
                var e = ease((t - sched[cur].tFlash) / 0.45);
                return { cx: lerp(from.cx, sched[cur].cam.cx, e), cy: lerp(from.cy, sched[cur].cam.cy, e), z: lerp(from.z, sched[cur].cam.z, e) };
            case 7: return t < 41.5 ? { cx: bulgeA.x, cy: bulgeA.y, z: lerp(4.2, 4.8, (t - 39) / 2.5) }
                                    : { cx: bulgeB.x, cy: bulgeB.y, z: lerp(4.2, 4.8, (t - 41.5) / 2.5) };
            case 8: return t < 46.0 ? { cx: tipFocus.x, cy: tipFocus.y, z: lerp(6, 6.6, (t - 44) / 2) }
                                    : { cx: tipFocus2.x, cy: tipFocus2.y, z: lerp(6, 6.6, (t - 46) / 2) };
            case 9: return { cx: lerp(bendFocus.x, bendFocus.x + 2, k), cy: bendFocus.y, z: lerp(5, 5.8, k) };
            default: return { cx: 100, cy: 65, z: lerp(1.18, 1.0, ease(k)) };
        }
    }

    // ---- drawing
    var ctx = canvas.getContext("2d");
    var BASE = 1000, DPR = 1;
    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        var fig = canvas.parentNode;
        if (document.fullscreenElement === fig) {
            // full screen: fit the canvas to the screen, leaving room for the controls
            var cssW = Math.floor(Math.min(window.innerWidth, (window.innerHeight - 110) * W / H));
            canvas.style.width = cssW + "px";
        } else canvas.style.width = "";
        var w = canvas.clientWidth || BASE;
        canvas.width = Math.round(Math.max(w, 400) * DPR);
        canvas.height = Math.round(canvas.width * H / W);
    }
    resize();

    function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); if (fill) ctx.fill(); else ctx.stroke(); }
    function trace(pts, upTo) {
        var total = 0, i, segs = [];
        for (i = 1; i < pts.length; i++) { var l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
        var goal = total * clamp(upTo === undefined ? 1 : upTo, 0, 1), acc = 0;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (i = 1; i < pts.length; i++) {
            if (acc + segs[i - 1] <= goal) { ctx.lineTo(pts[i][0], pts[i][1]); acc += segs[i - 1]; }
            else {
                var f = segs[i - 1] ? (goal - acc) / segs[i - 1] : 0;
                var x = lerp(pts[i - 1][0], pts[i][0], f), y = lerp(pts[i - 1][1], pts[i][1], f);
                ctx.lineTo(x, y); return { x: x, y: y };
            }
        }
        return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
    }
    function text(str, x, y, size, color, weight, align) {
        ctx.font = (weight || "normal") + " " + size + "px 'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif";
        ctx.fillStyle = color; ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
        ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 6;
        ctx.fillText(str, x, y);
        ctx.shadowBlur = 0;
    }
    function rgba(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a + ")"; }

    var scr = { cw: 0, ch: 0, scale: 1, cam: null };
    function toScreen(x, y) { return [scr.cw / 2 + (x - scr.cam.cx) * scr.scale, scr.ch / 2 + (y - scr.cam.cy) * scr.scale]; }
    function tag(x, y, label, color, u, dx, dy) {
        // screen-space label with a leader line to the world point (x, y)
        var p = toScreen(x, y), lx = p[0] + dx * u, ly = p[1] + dy * u;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = "bold " + 16 * u + "px 'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif";
        var tw = ctx.measureText(label).width, left = dx < 0, bx = left ? lx - tw : lx;
        bx = clamp(bx, 14 * u, scr.cw - tw - 14 * u); ly = clamp(ly, 150 * u, scr.ch - 14 * u);
        ctx.fillStyle = "rgba(18,16,28,0.88)"; ctx.fillRect(bx - 7 * u, ly - 19 * u, tw + 14 * u, 27 * u);
        ctx.strokeStyle = color; ctx.lineWidth = 1.4 * u;
        ctx.beginPath(); ctx.moveTo(left ? bx + tw + 7 * u : bx - 7 * u, ly - 5 * u); ctx.lineTo(p[0], p[1]); ctx.stroke();
        text(label, bx, ly, 16 * u, color, "bold", "left");
        ctx.restore();
    }

    function treeLines(frac, branchesFn) { /* placeholder to keep structure explicit */ }

    function drawMarker(o, k, px, t) {
        var c = sideCol(o.side), pop = ease(k);
        if (pop <= 0) return;
        ctx.save();
        ctx.globalAlpha = pop; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2 * px;
        circle(o.pos[0], o.pos[1], 5 * px * (1 + 0.2 * Math.sin(t * 5)) * pop, false);
        circle(o.pos[0], o.pos[1], 2.6 * px, true);
        ctx.restore();
    }

    function render(t) {
        t = clamp(t, 0, T);
        var cw = canvas.width, ch = canvas.height, u = cw / BASE;
        var s = sceneAt(t), sc = SCENES[s];
        var cam = cameraAt(t);
        var scale = (cw / W) * cam.z, px = 1 / scale;
        scr = { cw: cw, ch: ch, scale: scale, cam: cam };

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, cw, ch);
        ctx.setTransform(scale, 0, 0, scale, cw / 2 - cam.cx * scale, ch / 2 - cam.cy * scale);
        ctx.imageSmoothingEnabled = false;
        ctx.lineCap = "round"; ctx.lineJoin = "round";

        // aorta (context, not part of the mask)
        ctx.globalAlpha = s === 0 ? ease(t / 1.2) : 1;
        ctx.fillStyle = COL.aortaFill; circle(M.aortaCircle.x, M.aortaCircle.y, M.aortaCircle.r, true);

        // mask
        var maskA = s === 0 ? ease((t - 0.3) / 1.4) : (s === 6 ? 0.55 : (s >= 7 && s <= 9 ? 0.55 : (s === 10 ? lerp(0.55, 0.28, ease((t - 53) / 1.5)) : 1)));
        if (s === 5 && t > 26.5) maskA = 0.5;
        ctx.globalAlpha = maskA; ctx.drawImage(maskL, 0, 0);
        ctx.globalAlpha = 1;

        // scene 2: break, then dilation
        if (s === 1) {
            var pulse = 0.65 + 0.35 * Math.sin(t * 7);
            ctx.globalAlpha = ease((t - 4.4) / 0.4) * (t > 6.4 ? 1 - 0.5 * ease((t - 6.4) / 0.6) : pulse);
            ctx.drawImage(breakL, 0, 0);
            ctx.globalAlpha = ease((t - 6.4) / 1.2); ctx.drawImage(dilL, 0, 0);
            ctx.globalAlpha = 1;
        }
        // scene 3: ostium ball, then the gap and its bridge
        if (s === 2) {
            if (t < 11.6) {
                ctx.globalAlpha = ease((t - 9.4) / 0.8); ctx.drawImage(dilL, 0, 0);
                ctx.globalAlpha = ease((t - 9.8) / 0.8); ctx.drawImage(specL, 0, 0);
                ctx.globalAlpha = 1;
            } else {
                var a = ease((t - 11.8) / 0.5);
                ctx.globalAlpha = a; ctx.drawImage(dilL, 0, 0);
                ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(t * 6)); ctx.drawImage(breakL, 0, 0);
                ctx.globalAlpha = ease((t - 12.9) / 0.8); ctx.drawImage(specL, 0, 0);
                ctx.globalAlpha = 1;
            }
        }
        // ostium rings for the ball
        if (s === 2 && t < 11.6) {
            ctx.strokeStyle = COL.R; ctx.lineWidth = 1.6 * px; ctx.setLineDash([4 * px, 3 * px]);
            ctx.globalAlpha = ease((t - 9.6) / 0.8);
            circle(oR.pos[0], oR.pos[1], oR.radius + 0.7, false);
            ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
        // bridge segment
        if (s === 2 && t >= 12.9 && M.bridges.length) {
            var b = M.bridges[0], pa = px2(b.a), pb = px2(b.b);
            ctx.strokeStyle = COL.white; ctx.lineWidth = 1.2 * px; ctx.setLineDash([3 * px, 2 * px]);
            ctx.globalAlpha = ease((t - 12.9) / 0.8);
            ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(lerp(pa[0], pb[0], ease((t - 12.9) / 0.9)), lerp(pa[1], pb[1], ease((t - 12.9) / 0.9))); ctx.stroke();
            ctx.setLineDash([]); ctx.globalAlpha = 1;
        }

        // scene 4: D
        if (s === 3) { ctx.globalAlpha = ease((t - 14.3) / 1.2); ctx.drawImage(dL, 0, 0); ctx.globalAlpha = 1; }
        // scene 5: cost
        if (s === 4) { ctx.globalAlpha = ease((t - 18.3) / 1.0); ctx.drawImage(costL, 0, 0); ctx.globalAlpha = 1; }

        // scene 6: fronts, then ownership and predecessor chains
        if (s === 5) {
            if (t < 26.5) {
                var front = clamp((t - 23.4) / 2.8, 0, 1) * M.maxG * 1.001;
                updateGeo(front);
                ctx.globalAlpha = ease((t - 23.2) / 0.4); ctx.drawImage(geoL.c, 0, 0); ctx.globalAlpha = 1;
            } else {
                ctx.globalAlpha = ease((t - 26.5) / 0.6); ctx.drawImage(ownL, 0, 0);
                ctx.globalAlpha = 1;
                var prog = ease((t - 26.9) / 2.2);
                ctx.lineWidth = 1.1 * px;
                chains.forEach(function (c) {
                    ctx.strokeStyle = "rgba(255,255,255,0.55)";
                    var part = Math.max(2, Math.floor(c.pts.length * prog));
                    ctx.beginPath(); ctx.moveTo(c.pts[0][0], c.pts[0][1]);
                    for (var q = 1; q < part; q++) ctx.lineTo(c.pts[q][0], c.pts[q][1]);
                    ctx.stroke();
                });
            }
        }

        // ostium markers (annotations) from the start
        M.ostia.forEach(function (o, i) { drawMarker(o, (t - 1.8 - i * 0.3) / 0.5, px, t); });

        // scene 7: tree growing, first pass
        if (s === 6) {
            var cur = -1;
            sched.forEach(function (sd, i) { if (t >= sd.tFlash) cur = i; });
            if (cur >= 0) {
                var sd = sched[cur];
                updateCov(cur, clamp((t - sd.tEnd) / (sd.tCov - sd.tEnd), 0, 1));
                ctx.globalAlpha = 1; ctx.drawImage(covL.c, 0, 0);
            }
            sched.forEach(function (sd2, i) {
                if (t < sd2.tFlash) return;
                var e = EV[i], kept = e.ev.kind === "keep", col = kept ? sideCol(e.side) : COL.red;
                if (t < sd2.tDraw) {
                    var k = (t - sd2.tFlash) / (sd2.tDraw - sd2.tFlash), tip = sd2.pts[0];
                    ctx.strokeStyle = COL.white; ctx.fillStyle = COL.white; ctx.lineWidth = 2 * px;
                    circle(tip[0], tip[1], lerp(9, 3, ease(k)) * px * 2.2, false);
                    circle(tip[0], tip[1], 2.6 * px, true);
                    return;
                }
                var frac = clamp((t - sd2.tDraw) / (sd2.tEnd - sd2.tDraw), 0, 1);
                ctx.strokeStyle = col; ctx.lineWidth = 3 * px; ctx.globalAlpha = kept || t < sd2.tEnd + 0.8 ? 1 : 1 - ease((t - sd2.tEnd - 0.8) / 0.5);
                var head = trace(sd2.pts, frac); ctx.stroke();
                if (frac < 1) { ctx.fillStyle = COL.white; circle(head.x, head.y, 3 * px, true); }
                ctx.globalAlpha = 1;
            });
            if (cur >= 0) {
                var sdc = sched[cur], ec = EV[cur], tip2 = sdc.pts[0];
                if (t < sdc.tDraw + 0.6) tag(tip2[0], tip2[1], "farthest voxel, G = " + mm(ec.ev.G) + " mm", COL.white, u, tip2[0] > 100 ? 40 : -40, -46);
                else if (t > sdc.tEnd) {
                    var kept2 = ec.ev.kind === "keep";
                    tag(tip2[0], tip2[1], kept2 ? "+" + mm(ec.ev.added) + " mm: kept" : "+" + mm(ec.ev.added) + " mm < 5 mm: discarded", kept2 ? sideCol(ec.side) : COL.red, u, tip2[0] > 100 ? 40 : -40, -46);
                }
            }
        }

        // scenes 8+: final raw trees (first-pass in scene 8 for comparison)
        function branchLine(b, arr, from, w, col, dash) {
            ctx.strokeStyle = col; ctx.lineWidth = w * px;
            if (dash) ctx.setLineDash([4 * px, 3 * px]);
            ctx.beginPath(); ctx.moveTo(arr[from][0], arr[from][1]);
            for (var q = from + 1; q < arr.length; q++) ctx.lineTo(arr[q][0], arr[q][1]);
            ctx.stroke(); ctx.setLineDash([]);
        }
        if (s === 7) {
            var kb = ease((t - 39.4) / 0.6);
            ctx.globalAlpha = kb * (0.75 + 0.25 * Math.sin(t * 6)); ctx.drawImage(bindL, 0, 0); ctx.globalAlpha = 1;
            // first pass (dashed) and second pass (solid), left tree
            M.pass1[1].events.forEach(function (ev) {
                if (ev.kind !== "keep") return;
                ctx.globalAlpha = ease((t - 40) / 0.5) * 0.95;
                branchLine(null, ev.path.map(px2), 0, 2.6, "#ff8a8a", true);
            });
            M.pass2[1].events.forEach(function (ev) {
                if (ev.kind !== "keep") return;
                ctx.globalAlpha = ease((t - 40.8) / 0.5);
                branchLine(null, ev.path.map(px2), 0, 2.2, COL.L, false);
            });
            ctx.globalAlpha = 1;
        }

        if (s >= 8) {
            var morph = s === 9 ? ease((t - 48.8) / 2.4) : (s > 9 ? 1 : 0);
            M.branches.forEach(function (b, bi) {
                var rs = bi === 2 ? 45.2 : 47.0;
                var trimK = s === 8 ? (t > rs + 0.7 ? 1 : 0) : (s > 8 ? 1 : 0);
                var col = sideCol(b.side);
                // band (covered lumen)
                ctx.globalAlpha = s === 10 ? 0.22 : 0.18; ctx.strokeStyle = col; ctx.lineWidth = 2 * 2.6;
                var arrB = b.pts.map(function (p, k) { return [lerp(p[0], b.smooth[k][0], morph), lerp(p[1], b.smooth[k][1], morph)]; });
                ctx.beginPath(); ctx.moveTo(arrB[0][0], arrB[0][1]);
                for (var q = 1; q < arrB.length; q++) ctx.lineTo(arrB[q][0], arrB[q][1]);
                ctx.stroke(); ctx.globalAlpha = 1;
                // the jagged voxel path, kept as a reference while it is smoothed
                if (s === 9) { ctx.globalAlpha = 0.45; branchLine(b, b.pts, 0, 1, "#ffffff", true); ctx.globalAlpha = 1; }
                // core line
                var useRaw = s === 8 ? b.raw : null;
                var arr = useRaw ? useRaw : arrB;
                branchLine(b, arr, useRaw && trimK > 0 ? b.cut : 0, s === 9 ? 1.6 : 2.2, col, false);
                // the 2 mm that trimming removes
                if (s === 8 && b.cut > 0) {
                    var cutPts = b.raw.slice(0, b.cut + 1);
                    ctx.globalAlpha = ease((t - 44.4) / 0.4) * (0.7 + 0.3 * Math.sin(t * 8)) * (1 - ease((t - rs) / 0.7));
                    ctx.strokeStyle = COL.red; ctx.lineWidth = 4.2 * px;
                    ctx.beginPath(); ctx.moveTo(cutPts[0][0], cutPts[0][1]);
                    for (var c2 = 1; c2 < cutPts.length; c2++) ctx.lineTo(cutPts[c2][0], cutPts[c2][1]);
                    ctx.stroke(); ctx.globalAlpha = 1;
                }
                // voxel path dots while smoothing
                if (s === 9) {
                    ctx.fillStyle = "rgba(255,255,255," + (0.8 * (1 - morph)) + ")";
                    b.pts.forEach(function (p, k) { if (k % 2 === 0) circle(p[0], p[1], 0.7 * px * 3, true); });
                }
            });
        }

        // scene 11: nodes
        if (s === 10) {
            var cnt = 0;
            M.branches.forEach(function (b) {
                b.smooth.forEach(function (p, k) {
                    var ty = b.types[k];
                    if (ty === "segment" && k % 8) return;
                    var j = cnt++;
                    var a = ease((t - 53.4 - j * 0.035) / 0.35);
                    if (a <= 0) return;
                    ctx.globalAlpha = a; ctx.lineWidth = 1.5 * px;
                    var col = sideCol(b.side);
                    if (ty === "ostium") return;
                    if (ty === "segment") { ctx.fillStyle = col; circle(p[0], p[1], 1.6 * px * 1.4, true); }
                    else if (ty === "bifurcation") {
                        ctx.fillStyle = COL.white; circle(p[0], p[1], 3.6 * px, true);
                        ctx.strokeStyle = col; circle(p[0], p[1], Math.max(p[2], 1.2), false);
                    } else {
                        ctx.fillStyle = col; circle(p[0], p[1], 3.2 * px, true);
                        ctx.strokeStyle = COL.white; circle(p[0], p[1], Math.max(p[2], 1.2) + 1 * px, false);
                    }
                    ctx.globalAlpha = 1;
                });
            });
            ctx.globalAlpha = 1;
            M.ostia.forEach(function (o) {
                ctx.strokeStyle = COL.white; ctx.fillStyle = sideCol(o.side); ctx.lineWidth = 2.4 * px;
                ctx.globalAlpha = ease((t - 53.5) / 0.5);
                circle(o.pos[0], o.pos[1], 5.2 * px, true); circle(o.pos[0], o.pos[1], 7.5 * px, false);
                ctx.globalAlpha = 1;
            });
        }

        // labels tied to the scene
        if (s === 0 && t > 1.6) { ctx.globalAlpha = ease((t - 1.6) / 0.6); tag(M.aortaCircle.x, M.aortaCircle.y + 4, "aortic root (not in the mask)", "#e8b4bf", u, 70, 90); ctx.globalAlpha = 1; }
        if (s === 1 && t > 4.8) { ctx.globalAlpha = ease((t - 4.8) / 0.4); tag(breakAt.x, breakAt.y, t < 6.8 ? "broken connection" : "+1 voxel, cost x1000", t < 6.8 ? COL.red : "#7ee0ee", u, 48, -52); ctx.globalAlpha = 1; }
        if (s === 2 && t < 11.6 && t > 10.2) { ctx.globalAlpha = ease((t - 10.2) / 0.4); tag(oR.pos[0], oR.pos[1], "smallest ball reaching the mask", COL.R, u, -44, -56); ctx.globalAlpha = 1; }
        if (s === 2 && t >= 12.6) { ctx.globalAlpha = ease((t - 12.6) / 0.4); tag(gapAt.x, gapAt.y, "gap " + mm(Math.hypot(M.bridges[0] ? px2(M.bridges[0].a)[0] - px2(M.bridges[0].b)[0] : 0, M.bridges[0] ? px2(M.bridges[0].a)[1] - px2(M.bridges[0].b)[1] : 0)) + " mm: bridged", COL.white, u, 50, -50); ctx.globalAlpha = 1; }
        if (s === 7 && t > 40.4) { ctx.globalAlpha = ease((t - 40.4) / 0.4); tag(t < 41.5 ? bulgeA.x : bulgeB.x, t < 41.5 ? bulgeA.y : bulgeB.y, "D > 1.2 r (capped)", "#ff7ad9", u, -50, -70); ctx.globalAlpha = 1; }
        if (s === 9 && t > 49.5) { ctx.globalAlpha = ease((t - 49.5) / 0.6); tag(bendFocus.x, bendFocus.y, "max. displacement " + (M.maxDisp * MM).toFixed(1) + " mm", COL.white, u, 50, -56); ctx.globalAlpha = 1; }

        // ---- screen-space overlays
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // caption (top left, wrapped)
        var bw = 380 * u, pad = 20 * u, lh = 17 * u;
        ctx.font = "normal " + 13 * u + "px 'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif";
        var words = sc.sub.split(" "), lines = [], line = "";
        words.forEach(function (w) {
            var test = line ? line + " " + w : w;
            if (ctx.measureText(test).width > bw - pad - 16 * u && line) { lines.push(line); line = w; } else line = test;
        });
        lines.push(line);
        var bh = 62 * u + lines.length * lh, bx = 24 * u, by = 24 * u;
        var ca = ease((t - sc.t0) / 0.5);
        ctx.globalAlpha = ca;
        ctx.fillStyle = "rgba(18,16,28,0.82)"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = ACCENT; ctx.fillRect(bx, by, 6 * u, bh);
        text((s + 1) + " / " + SCENES.length, bx + pad, by + 24 * u, 13 * u, "rgba(255,255,255,0.6)", "normal");
        text(sc.title, bx + pad, by + 48 * u, 22 * u, "#ffffff", "bold");
        lines.forEach(function (l, i) { text(l, bx + pad, by + 68 * u + i * lh, 13 * u, "rgba(255,255,255,0.8)", "normal"); });
        ctx.globalAlpha = 1;

        // legends / insets
        if (s === 3 || s === 4) {
            var lx = cw - 250 * u, ly = 34 * u, lw = 200 * u, stops = s === 3 ? RAMP_D : RAMP_C;
            var grad = ctx.createLinearGradient(lx, 0, lx + lw, 0);
            [0, 0.5, 1].forEach(function (f, i) { grad.addColorStop(f, rgba(stops[i], 1)); });
            ctx.globalAlpha = ease((t - (s === 3 ? 14.8 : 18.8)) / 0.6);
            ctx.fillStyle = grad; ctx.fillRect(lx, ly, lw, 12 * u);
            text(s === 3 ? "wall" : "centre (cheap)", lx, ly + 32 * u, 14 * u, "rgba(255,255,255,0.85)", "normal", "left");
            text(s === 3 ? "centre" : "wall (expensive)", lx + lw, ly + 32 * u, 14 * u, "rgba(255,255,255,0.85)", "normal", "right");
            ctx.globalAlpha = 1;
        }
        if (s === 4 && t > 19.2) {
            // cost vs. offset from the axis, exponent 4 against 1 (log scale)
            var gx = cw - 290 * u, gy = 120 * u, gw = 240 * u, gh = 150 * u, prog = ease((t - 19.2) / 1.6);
            ctx.globalAlpha = ease((t - 19.2) / 0.5);
            ctx.fillStyle = "rgba(18,16,28,0.85)"; ctx.fillRect(gx - 14 * u, gy - 18 * u, gw + 28 * u, gh + 66 * u);
            ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = u;
            ctx.beginPath(); ctx.moveTo(gx, gy + gh); ctx.lineTo(gx + gw, gy + gh); ctx.moveTo(gx + gw / 2, gy); ctx.lineTo(gx + gw / 2, gy + gh); ctx.stroke();
            var Rv = 4;
            [{ p: 4, c: "#ffffff", w: 2.6 }, { p: 1, c: "rgba(255,255,255,0.5)", w: 1.6 }].forEach(function (cv) {
                ctx.strokeStyle = cv.c; ctx.lineWidth = cv.w * u;
                if (cv.p === 1) ctx.setLineDash([5 * u, 4 * u]);
                ctx.beginPath();
                var steps = Math.floor(80 * prog);
                for (var q = 0; q <= steps; q++) {
                    var off = -Rv + 2 * Rv * q / 80, Dv = Rv - Math.abs(off) + 0.001;
                    var val = Math.log(Math.pow(Dv + 0.5, -cv.p) / Math.pow(Rv + 0.5, -cv.p)) / Math.LN10 / 3.9;
                    var X = gx + gw * (off + Rv) / (2 * Rv), Y = gy + gh - clamp(val, 0, 1) * gh;
                    if (q) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
                }
                ctx.stroke(); ctx.setLineDash([]);
            });
            text("cost across a vessel (log scale)", gx + gw / 2, gy + gh + 22 * u, 13 * u, "rgba(255,255,255,0.85)", "normal", "center");
            text("p = 4 (used)   p = 1", gx + gw / 2, gy + gh + 42 * u, 12 * u, "rgba(255,255,255,0.6)", "normal", "center");
            text("wall", gx, gy + gh + 12 * u, 11 * u, "rgba(255,255,255,0.5)", "normal", "left");
            text("wall", gx + gw, gy + gh + 12 * u, 11 * u, "rgba(255,255,255,0.5)", "normal", "right");
            ctx.globalAlpha = 1;
        }
        if (s === 7 && t > 40.2) {
            ctx.globalAlpha = ease((t - 40.2) / 0.5);
            var ky = ch - 90 * u, kx = cw - 270 * u;
            ctx.fillStyle = "rgba(18,16,28,0.85)"; ctx.fillRect(kx - 14 * u, ky - 22 * u, 260 * u, 68 * u);
            ctx.strokeStyle = "#ff8a8a"; ctx.lineWidth = 2.6 * u; ctx.setLineDash([6 * u, 4 * u]);
            ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + 36 * u, ky); ctx.stroke(); ctx.setLineDash([]);
            text("first pass", kx + 46 * u, ky + 5 * u, 14 * u, "#ffffff", "normal");
            ctx.strokeStyle = COL.L; ctx.lineWidth = 2.2 * u;
            ctx.beginPath(); ctx.moveTo(kx, ky + 28 * u); ctx.lineTo(kx + 36 * u, ky + 28 * u); ctx.stroke();
            text("second pass (D capped)", kx + 46 * u, ky + 33 * u, 14 * u, "#ffffff", "normal");
            ctx.globalAlpha = 1;
        }
        if (s === 10) {
            var lx2 = cw - 220 * u, ly2 = 40 * u, items = [["ostium", "o"], ["bifurcation", "b"], ["endpoint", "e"], ["segment", "s"]];
            ctx.globalAlpha = ease((t - 54.5) / 0.6);
            ctx.fillStyle = "rgba(18,16,28,0.85)"; ctx.fillRect(lx2 - 16 * u, ly2 - 26 * u, 200 * u, 28 * u + items.length * 26 * u);
            items.forEach(function (it, i) {
                var y = ly2 + i * 26 * u, cx0 = lx2 + 6 * u;
                ctx.strokeStyle = COL.white; ctx.lineWidth = 1.6 * u;
                if (it[1] === "o") { ctx.fillStyle = COL.L; ctx.beginPath(); ctx.arc(cx0, y, 6 * u, 0, 6.2832); ctx.fill(); ctx.beginPath(); ctx.arc(cx0, y, 9 * u, 0, 6.2832); ctx.stroke(); }
                if (it[1] === "b") { ctx.fillStyle = COL.white; ctx.beginPath(); ctx.arc(cx0, y, 5 * u, 0, 6.2832); ctx.fill(); }
                if (it[1] === "e") { ctx.fillStyle = COL.L; ctx.beginPath(); ctx.arc(cx0, y, 4 * u, 0, 6.2832); ctx.fill(); ctx.beginPath(); ctx.arc(cx0, y, 8 * u, 0, 6.2832); ctx.stroke(); }
                if (it[1] === "s") { ctx.fillStyle = COL.L; ctx.beginPath(); ctx.arc(cx0, y, 2.5 * u, 0, 6.2832); ctx.fill(); }
                text(it[0], lx2 + 28 * u, y + 5 * u, 15 * u, "#ffffff", "normal");
            });
            ctx.globalAlpha = 1;
        }

        // scene cuts: quick dip to black
        var cutA = 0;
        for (var i = 1; i < SCENES.length; i++) cutA = Math.max(cutA, 1 - Math.abs(t - SCENES[i].t0) / CUT_FADE);
        [11.6, 41.5].forEach(function (c) { cutA = Math.max(cutA, 1 - Math.abs(t - c) / CUT_FADE); });
        if (t < 0.4) cutA = Math.max(cutA, 1 - t / 0.4);
        if (cutA > 0) { ctx.fillStyle = "rgba(0,0,0," + clamp(cutA, 0, 1) + ")"; ctx.fillRect(0, 0, cw, ch); }
    }

    // ---- playback and chapter chips
    var playBtn = document.getElementById("cd-play"), restartBtn = document.getElementById("cd-restart"),
        seek = document.getElementById("cd-seek"), clock = document.getElementById("cd-time"), chips = document.getElementById("cd-chapters");
    var time = 0, playing = false, userPaused = false, last = 0, raf = 0;
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    seek.max = R; seek.step = 0.01;
    SCENES.forEach(function (sc, i) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = (i + 1) + ". " + sc.title.replace(/,.*$/, "");
        b.addEventListener("click", function () { time = sceneStartReal(i); if (playing) last = performance.now(); draw(); });
        chips.appendChild(b);
    });
    function fmt(x) { return Math.floor(x / 60) + ":" + ("0" + Math.floor(x % 60)).slice(-2); }
    function draw() {
        var rt = Math.min(time, R), tau = toScript(rt);
        render(tau);
        seek.value = rt;
        clock.textContent = fmt(rt) + " / " + fmt(R);
        var cs = sceneAt(tau);
        for (var i = 0; i < chips.children.length; i++) chips.children[i].className = i === cs ? "on" : "";
    }
    function setPlaying(p) {
        playing = p; playBtn.textContent = p ? "Pause" : "Play";
        if (p) { last = performance.now(); if (!raf) raf = requestAnimationFrame(tick); }
    }
    function tick(now) {
        raf = 0; if (!playing) return;
        time += Math.min((now - last) / 1000, 0.1); last = now;      // a stall (another figure initialising) must not skip the timeline ahead
        if (time >= R + HOLD) time = 0;
        draw();
        raf = requestAnimationFrame(tick);
    }
    playBtn.addEventListener("click", function () { userPaused = playing; setPlaying(!playing); });
    restartBtn.addEventListener("click", function () { time = 0; draw(); userPaused = false; setPlaying(true); });
    seek.addEventListener("input", function () { time = parseFloat(seek.value); if (playing) last = performance.now(); draw(); });
    window.addEventListener("resize", function () { resize(); draw(); });
    var fullBtn = document.getElementById("cd-full");
    if (fullBtn && document.fullscreenEnabled) {
        fullBtn.addEventListener("click", function () {
            var fig = canvas.parentNode;
            if (document.fullscreenElement) document.exitFullscreen(); else fig.requestFullscreen();
        });
        document.addEventListener("fullscreenchange", function () {
            fullBtn.textContent = document.fullscreenElement === canvas.parentNode ? "Exit full screen" : "Full screen";
            resize(); draw();
        });
    } else if (fullBtn) fullBtn.style.display = "none";

    if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (e) {
            if (e[0].isIntersecting && !userPaused && !reduced) setPlaying(true);
            if (!e[0].isIntersecting) setPlaying(false);
        }, { threshold: 0.4 }).observe(canvas);
    } else if (!reduced) setPlaying(true);

    var qt = parseFloat(new URLSearchParams(location.search).get("td"));
    if (!isNaN(qt)) { time = qt; userPaused = true; }
    else if (reduced) time = R;
    draw();
})();
