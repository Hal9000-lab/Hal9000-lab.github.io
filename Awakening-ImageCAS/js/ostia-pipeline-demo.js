// Canvas animation of the ostia pipeline: how the annotations were built and how the benchmark was trained.
// Schematic (no real data): every scene is drawn in a 1000 x 650 design space.
(function () {
    "use strict";

    var canvas = document.getElementById("op-canvas");
    if (!canvas) return;

    var DW = 1000, DH = 650;
    var ACCENT = (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#4c6273").trim();
    var C = {
        bg: "#12101c", panel: "rgba(255,255,255,0.06)", base: "rgb(62,60,84)", text: "rgba(255,255,255,0.88)", dim: "rgba(255,255,255,0.55)",
        R: "#ffb454", L: "#5ec8e5", manual: "#8fb4ff", semi: "#c79bff", ok: "#7be0a0", cand: "#ffd36b", adj: "#ff8fb1", bad: "#ff5d6c",
        white: "#ffffff", aorta: "rgba(120,70,85,0.6)", vessel: "rgb(200,212,226)"
    };
    var ANN = ["#ff8a65", "#ffd54f", "#81c784", "#4dd0e1", "#7986cb", "#ba68c8"];
    var ANN_NAME = ["A", "B", "C", "D", "E", "F"];

    // ---- timeline (script seconds)
    var SCENES = [
        { t0: 0,   t1: 7,   title: "The starting point",           sub: "ImageCAS offers 1000 CCTA volumes with coronary masks but no ostium annotation. CAT08 and ASOCA come with ostium references of their own." },
        { t0: 7,   t1: 13,  title: "One definition of the ostium", sub: "Three operational definitions are reconciled into one landmark per side and per patient." },
        { t0: 13,  t1: 23,  title: "Stage 1: manual annotation",   sub: "The first 500 volumes: six annotators in rotating groups of three, reshuffled every 25 images. Each volume gets three independent annotations; each annotator labels 250." },
        { t0: 23,  t1: 31,  title: "Consensus and inspection",     sub: "The consensus is the centroid of the three markers (k-means, k = 1). Every volume and marker is then visually inspected." },
        { t0: 31,  t1: 40,  title: "Training the assistant model", sub: "A SwinUNETRv2, trained only to speed up the next stage, learns from CAT08, ASOCA and the first 500 ImageCAS volumes." },
        { t0: 40,  t1: 47,  title: "Predicting the second 500",    sub: "The assistant model proposes candidate ostia for the remaining 500 volumes." },
        { t0: 47,  t1: 57,  title: "Stage 2: single-annotator correction", sub: "One annotator checks every candidate against the CT volume and corrects it where needed: a lighter, model-assisted process, not an independent annotation." },
        { t0: 57,  t1: 63,  title: "One dataset, 1000 volumes",    sub: "Left and right ostia for every ImageCAS volume, next to the reconciled CAT08 and ASOCA references." },
        { t0: 63,  t1: 69,  title: "The test set",                 sub: "58 volumes: 50 from the independently annotated half, chosen at random, plus 4 from CAT08 and 4 from ASOCA. Everything else is for training and validation." },
        { t0: 69,  t1: 79,  title: "Training the benchmark",       sub: "Five architectures are trained in the same framework. Preprocessing, loss, training strategy, postprocessing and metrics are shared." },
        { t0: 79,  t1: 87,  title: "Evaluation",                   sub: "Sliding 128-voxel patches cover each test volume; the heatmap peaks give the ostia, and the error in mm is graded against anatomical and inter-annotator thresholds." },
        { t0: 87,  t1: 98,  title: "Ablations",                    sub: "Six studies, each changing one setting at a time and keeping the others fixed, on the same test set." },
        { t0: 98,  t1: 104, title: "Release",                      sub: "Annotations, annotation protocol, code and model weights are made publicly available." }
    ];
    var T = SCENES[SCENES.length - 1].t1;
    var HOLD = 1.5, CUT_FADE = 0.16, SLOW = 1.0, SCENE_HOLD = 2.0;

    var segs = (function () {
        var out = [], r = 0;
        SCENES.forEach(function (sc, i) {
            var last = i === SCENES.length - 1, tf = last ? sc.t1 : sc.t1 - CUT_FADE * 1.05;
            out.push({ r0: r, r1: r + (tf - sc.t0) * SLOW, a0: sc.t0, a1: tf }); r += (tf - sc.t0) * SLOW;
            if (!last) {
                out.push({ r0: r, r1: r + SCENE_HOLD, a0: tf, a1: tf }); r += SCENE_HOLD;
                out.push({ r0: r, r1: r + (sc.t1 - tf) * SLOW, a0: tf, a1: sc.t1 }); r += (sc.t1 - tf) * SLOW;
            }
        });
        return out;
    })();
    var R = segs[segs.length - 1].r1;
    function toScript(r) {
        for (var i = 0; i < segs.length; i++) {
            var g = segs[i];
            if (r <= g.r1 || i === segs.length - 1) return g.r1 > g.r0 ? g.a0 + (g.a1 - g.a0) * clamp((r - g.r0) / (g.r1 - g.r0), 0, 1) : g.a0;
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
    function prog(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }
    function sceneAt(t) { for (var i = SCENES.length - 1; i >= 0; i--) if (t >= SCENES[i].t0) return i; return 0; }
    function rnd(seed) { var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

    var ctx = canvas.getContext("2d");
    var DPR = 1;
    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        var fig = canvas.parentNode;
        if (document.fullscreenElement === fig) {
            canvas.style.width = Math.floor(Math.min(window.innerWidth, (window.innerHeight - 150) * DW / DH)) + "px";
        } else canvas.style.width = "";
        var w = canvas.clientWidth || DW;
        canvas.width = Math.round(Math.max(w, 400) * DPR);
        canvas.height = Math.round(canvas.width * DH / DW);
    }
    resize();

    var FONT = "'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif";
    function text(str, x, y, size, color, weight, align) {
        ctx.font = (weight || "normal") + " " + size + "px " + FONT;
        ctx.fillStyle = color; ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
        ctx.fillText(str, x, y);
    }
    function rrect(x, y, w, h, r, fill, stroke, lw) {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.5; ctx.stroke(); }
    }
    function dot(x, y, r, fill, stroke) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    function arrow(x0, y0, x1, y1, color, k) {
        k = k === undefined ? 1 : k;
        var x = lerp(x0, x1, k), y = lerp(y0, y1, k);
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
        if (k > 0.95) {
            var a = Math.atan2(y1 - y0, x1 - x0);
            ctx.beginPath(); ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - 10 * Math.cos(a - 0.4), y1 - 10 * Math.sin(a - 0.4));
            ctx.lineTo(x1 - 10 * Math.cos(a + 0.4), y1 - 10 * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
        }
    }
    // grid of volume cells; colorFn(i, row) returns a colour (or null to skip)
    function grid(x, y, cols, n, size, gap, colorFn) {
        for (var i = 0; i < n; i++) {
            var col = colorFn(i, Math.floor(i / cols));
            if (!col) continue;
            ctx.fillStyle = col;
            ctx.fillRect(x + (i % cols) * (size + gap), y + Math.floor(i / cols) * (size + gap), size, size);
        }
    }
    function gridW(cols, size, gap) { return cols * (size + gap) - gap; }
    function gridH(n, cols, size, gap) { return Math.ceil(n / cols) * (size + gap) - gap; }
    function cellPos(x, y, cols, size, gap, i) { return [x + (i % cols) * (size + gap) + size / 2, y + Math.floor(i / cols) * (size + gap) + size / 2]; }

    // schematic aorta with its two coronary stubs; returns ostium positions
    function aortaIcon(cx, cy, s, a) {
        ctx.save(); ctx.globalAlpha *= a;
        ctx.fillStyle = C.aorta; dot(cx, cy, 60 * s, C.aorta);
        ctx.strokeStyle = C.vessel; ctx.lineWidth = 10 * s; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cx - 58 * s, cy + 22 * s); ctx.lineTo(cx - 100 * s, cy + 58 * s); ctx.lineTo(cx - 118 * s, cy + 120 * s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 58 * s, cy + 22 * s); ctx.lineTo(cx + 100 * s, cy + 52 * s); ctx.lineTo(cx + 124 * s, cy + 120 * s); ctx.stroke();
        ctx.restore();
        return { R: [cx - 56 * s, cy + 21 * s], L: [cx + 56 * s, cy + 21 * s] };
    }
    function marker(p, color, k, r) {
        if (k <= 0) return;
        r = r || 7;
        ctx.save(); ctx.globalAlpha *= clamp(k, 0, 1);
        ctx.strokeStyle = color; ctx.lineWidth = 2.4; dot(p[0], p[1], r * (1.6 - 0.6 * clamp(k, 0, 1)) + 3, null, color);
        dot(p[0], p[1], r * 0.5, color);
        ctx.restore();
    }
    function tileBox(x, y, w, h, a) { ctx.save(); ctx.globalAlpha *= a === undefined ? 1 : a; rrect(x, y, w, h, 10, C.panel, "rgba(255,255,255,0.12)", 1); ctx.restore(); }

    // ---- scenes
    var COMBOS = (function () {
        var all = [];
        for (var a = 0; a < 6; a++) for (var b = a + 1; b < 6; b++) for (var c = b + 1; c < 6; c++) all.push([a, b, c]);
        var out = []; for (var j = 0; j < 20; j++) out.push(all[(j * 7) % 20]);
        return out;
    })();
    var HALF1 = 500, N = 1000;
    var secondTypes = (function () {          // 10 undetected, 88 adjusted, rest unchanged
        var order = []; for (var i = 0; i < 500; i++) order.push(i);
        order.sort(function (a, b) { return rnd(a + 1) - rnd(b + 1); });
        var ty = new Array(500).fill(0);
        order.slice(0, 10).forEach(function (i) { ty[i] = 2; });
        order.slice(10, 98).forEach(function (i) { ty[i] = 1; });
        return ty;
    })();
    var testPick = (function () {
        var order = []; for (var i = 0; i < 500; i++) order.push(i);
        order.sort(function (a, b) { return rnd(a + 900) - rnd(b + 900); });
        var s = {}; order.slice(0, 50).forEach(function (i) { s[i] = true; });
        var c4 = {}, a4 = {};
        [0, 1, 2, 3].forEach(function (k) { c4[Math.floor(rnd(k + 40) * 32 * 0.999)] = true; });
        for (var k = 0; c4 && Object.keys(c4).length < 4; k++) c4[Math.floor(rnd(k + 70) * 32 * 0.999)] = true;
        for (k = 0; Object.keys(a4).length < 4; k++) a4[Math.floor(rnd(k + 100) * 40 * 0.999)] = true;
        return { imagecas: s, cat: c4, asoca: a4 };
    })();

    // layout used by several scenes: two 25x20 halves + two small reference grids
    var HG = { cols: 25, size: 11, gap: 2 };
    function halfGrid(x, y, colorFn) { grid(x, y, HG.cols, 500, HG.size, HG.gap, colorFn); }
    var HW = gridW(25, 11, 2), HH = gridH(500, 25, 11, 2);

    function scene0(t, k) {
        var gx = 215, gy = 190;
        grid(gx, gy, 50, 1000, 9, 2, function (i, row) { return prog(t, 0.4, 2.4) * 20 > row ? C.base : null; });
        text("ImageCAS: 1000 CCTA volumes and coronary masks", gx, gy - 14, 17, C.text, "bold");
        var a = ease(prog(t, 2.2, 3.0));
        ctx.globalAlpha = a; text("no ostium annotation", gx + 550, gy - 14, 17, C.bad, "bold", "right"); ctx.globalAlpha = 1;
        // CAT08 and ASOCA, each cell carries its ostium reference
        var by = 470;
        text("CAT08 (32 volumes)", gx, by - 12, 15, C.text, "bold");
        text("ASOCA (40 volumes)", gx + 280, by - 12, 15, C.text, "bold");
        grid(gx, by, 8, 32, 12, 3, function (i, row) { return prog(t, 3.0 + row * 0.15, 3.6 + row * 0.15) > 0 ? C.base : null; });
        grid(gx + 280, by, 8, 40, 12, 3, function (i, row) { return prog(t, 3.2 + row * 0.15, 3.8 + row * 0.15) > 0 ? C.base : null; });
        var p = ease(prog(t, 4.2, 5.4));
        function dots(x0, n) {
            for (var i = 0; i < n; i++) {
                var c = cellPos(x0, by, 8, 12, 3, i);
                if (prog(t, 4.2 + (i / n) * 1.2, 4.6 + (i / n) * 1.2) > 0) dot(c[0], c[1], 3, C.ok);
            }
        }
        dots(gx, 32); dots(gx + 280, 40);
        ctx.globalAlpha = p;
        text("start point of the centerline (pointS.txt)", gx, by + 98, 14, C.dim, "normal");
        text("first point of the centerline, after inspection", gx + 280, by + 98, 14, C.dim, "normal");
        text("ostium reference: ", gx + 600, by + 20, 14, C.dim, "normal"); dot(gx + 722, by + 15, 4, C.ok);
        ctx.globalAlpha = 1;
    }

    function scene1(t, k) {
        var cx = 640, cy = 300, ic = aortaIcon(cx, cy, 1.1, ease(prog(t, 7.2, 8.0)));
        var boxes = [
            { y: 190, label: "CAT08", sub: "start point of the centerline (pointS.txt)", col: C.ok },
            { y: 310, label: "ASOCA", sub: "first point of the centerline, after visual inspection", col: C.ok },
            { y: 430, label: "ImageCAS", sub: "new manual annotation (this work)", col: C.manual }
        ];
        boxes.forEach(function (b, i) {
            var a = ease(prog(t, 7.6 + i * 0.5, 8.4 + i * 0.5));
            tileBox(70, b.y, 330, 84, a);
            ctx.save(); ctx.globalAlpha = a;
            text(b.label, 90, b.y + 32, 20, b.col, "bold"); text(b.sub, 90, b.y + 58, 14, C.dim, "normal");
            ctx.restore();
            var k2 = ease(prog(t, 9.2 + i * 0.4, 10.2 + i * 0.4));
            ctx.globalAlpha = 0.9; arrow(400, b.y + 42, ic.R[0] - 10, ic.R[1] + 6 + (i - 1) * 6, "rgba(255,255,255,0.45)", k2); ctx.globalAlpha = 1;
        });
        marker(ic.R, C.R, prog(t, 10.8, 11.6), 8); marker(ic.L, C.L, prog(t, 11.0, 11.8), 8);
        var a2 = ease(prog(t, 11.6, 12.4));
        ctx.globalAlpha = a2;
        text("right ostium", ic.R[0] - 20, ic.R[1] - 36, 17, C.R, "bold", "right");
        text("left ostium", ic.L[0] + 20, ic.L[1] - 36, 17, C.L, "bold", "left");
        text("one landmark per side and per patient", cx, 520, 18, C.text, "bold", "center");
        ctx.globalAlpha = 1;
    }

    function scene2(t, k) {
        var bx0 = 60, bw = 44, by = 215;
        text("25 images per block, 20 blocks = 500 volumes", bx0, by - 18, 16, C.text, "bold");
        text("illustrative group order", bx0 + 880, by - 18, 13, C.dim, "normal", "right");
        var counts = [0, 0, 0, 0, 0, 0];
        for (var j = 0; j < 20; j++) {
            var tb = 14.4 + j * 0.4, a = ease(prog(t, tb, tb + 0.3)), x = bx0 + j * bw;
            rrect(x, by, bw - 6, 30, 5, a > 0 ? "rgba(143,180,255," + (0.25 + 0.5 * a) + ")" : C.panel, "rgba(255,255,255,0.12)", 1);
            if (a > 0) {
                COMBOS[j].forEach(function (an, q) { dot(x + (bw - 6) / 2, by + 52 + q * 17, 6 * a, ANN[an]); counts[an] += 25; });
                ctx.globalAlpha = a; text(String(j + 1), x + (bw - 6) / 2, by + 21, 12, "rgba(18,16,28,0.9)", "bold", "center"); ctx.globalAlpha = 1;
            } else text(String(j + 1), x + (bw - 6) / 2, by + 21, 12, C.dim, "normal", "center");
        }
        // annotators
        var cur = Math.min(19, Math.max(0, Math.floor((t - 14.4) / 0.4)));
        for (var i = 0; i < 6; i++) {
            var ax = 160 + i * 138, ay = 470, active = t > 14.4 && t < 22.6 && COMBOS[cur].indexOf(i) >= 0;
            dot(ax, ay, active ? 30 : 26, ANN[i]);
            text(ANN_NAME[i], ax, ay + 8, 22, "rgba(18,16,28,0.9)", "bold", "center");
            text(counts[i] + " images", ax, ay + 56, 15, active ? C.white : C.dim, active ? "bold" : "normal", "center");
        }
        text("each annotator ends with 250 volumes, each volume has 3 annotations", 500, 580, 16, C.text, "normal", "center");
    }

    function scene3(t, k) {
        // two zoomed ostium panels with three annotator markers and the consensus
        var panels = [
            { x: 60, side: "R", col: C.R, name: "right ostium", mm: "1.45", off: [[-34, -18], [22, 28], [30, -26]] },
            { x: 300, side: "L", col: C.L, name: "left ostium", mm: "1.95", off: [[-44, 20], [40, 34], [8, -52]] }
        ];
        panels.forEach(function (p, pi) {
            var y = 210, w = 220, h = 250, cx = p.x + w / 2, cy = y + 125;
            tileBox(p.x, y, w, h, 1);
            ctx.strokeStyle = C.vessel; ctx.lineWidth = 16; ctx.lineCap = "round"; ctx.globalAlpha = 0.5;
            ctx.beginPath(); ctx.moveTo(cx + (pi ? 60 : -60), y + h - 10); ctx.lineTo(cx, cy + 6); ctx.stroke(); ctx.globalAlpha = 1;
            ctx.fillStyle = C.aorta; ctx.beginPath(); ctx.arc(cx, y - 70, 120, 0, 6.2832); ctx.save(); ctx.clip(); ctx.restore();
            text(p.name, cx, y + 28, 16, p.col, "bold", "center");
            var cen = [0, 0];
            p.off.forEach(function (o) { cen[0] += cx + o[0]; cen[1] += cy + o[1]; });
            cen = [cen[0] / 3, cen[1] / 3];
            p.off.forEach(function (o, i) {
                var a = ease(prog(t, 24.0 + i * 0.35 + pi * 0.2, 24.5 + i * 0.35 + pi * 0.2));
                var ptn = [cx + o[0], cy + o[1]];
                var l = ease(prog(t, 25.8, 26.8));
                if (l > 0) { ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ptn[0], ptn[1]); ctx.lineTo(lerp(ptn[0], cen[0], l), lerp(ptn[1], cen[1], l)); ctx.stroke(); ctx.setLineDash([]); }
                if (a > 0) dot(ptn[0], ptn[1], 7 * a, ANN[COMBOS[0][i]]);
            });
            var s = ease(prog(t, 26.6, 27.4));
            if (s > 0) { ctx.save(); ctx.globalAlpha = s; ctx.strokeStyle = C.white; ctx.lineWidth = 2.4; dot(cen[0], cen[1], 11, null, C.white); dot(cen[0], cen[1], 3.5, C.white); ctx.restore(); }
            var m = ease(prog(t, 27.2, 28.0));
            ctx.globalAlpha = m; text("mean distance from consensus: " + p.mm + " mm", cx, y + h + 22, 13, C.text, "normal", "center"); ctx.globalAlpha = 1;
        });
        text("consensus = centroid of the three markers", 280, 530, 15, C.dim, "normal", "center");
        // inspection of all 500 volumes
        var gx = 580, gy = 240;
        text("first 500 volumes", gx, gy - 14, 16, C.text, "bold");
        var sw = prog(t, 28.0, 30.4) * 20;
        halfGrid(gx, gy, function (i, row) { return row < sw ? C.ok : C.manual; });
        ctx.globalAlpha = ease(prog(t, 28.0, 28.6)); text("every volume and marker visually inspected", gx, gy + HH + 30, 15, C.ok, "bold"); ctx.globalAlpha = 1;
    }

    function scene4(t, k) {
        var srcs = [
            { label: "ImageCAS, first 500", n: 500, cols: 25, size: 5, gap: 1, x: 60, y: 200, col: C.manual },
            { label: "CAT08, 32", n: 32, cols: 8, size: 7, gap: 2, x: 60, y: 365, col: C.ok },
            { label: "ASOCA, 40", n: 40, cols: 8, size: 7, gap: 2, x: 60, y: 445, col: C.ok }
        ];
        var bx = 450, by = 280, bw = 220, bh = 120;
        srcs.forEach(function (s, i) {
            var a = ease(prog(t, 31.2 + i * 0.3, 32.0 + i * 0.3));
            ctx.globalAlpha = a;
            text(s.label, s.x, s.y - 8, 14, C.text, "bold");
            grid(s.x, s.y, s.cols, s.n, s.size, s.gap, function () { return s.col; });
            ctx.globalAlpha = 1;
            // particles flowing to the model
            for (var q = 0; q < 14; q++) {
                var ph = (t * 0.45 + q / 14 + i * 0.11) % 1, on = t > 33 && t < 37.5;
                if (!on) continue;
                var sx = s.x + gridW(s.cols, s.size, s.gap), sy = s.y + gridH(s.n, s.cols, s.size, s.gap) / 2;
                var px = lerp(sx + 10, bx, ph), py = lerp(sy, by + bh / 2, ease(ph));
                ctx.globalAlpha = Math.sin(ph * 3.14); dot(px, py, 3, s.col); ctx.globalAlpha = 1;
            }
        });
        var ba = ease(prog(t, 32.4, 33.2));
        ctx.globalAlpha = ba; rrect(bx, by, bw, bh, 12, ACCENT, "rgba(255,255,255,0.4)", 2);
        text("SwinUNETRv2", bx + bw / 2, by + 52, 24, C.white, "bold", "center");
        text("assistant model", bx + bw / 2, by + 82, 16, "rgba(255,255,255,0.8)", "normal", "center");
        ctx.globalAlpha = 1;
        // learning curve (schematic, no axes values)
        var px0 = 730, py0 = 230, pw = 220, ph2 = 150, p = prog(t, 33.4, 37.6);
        tileBox(px0 - 12, py0 - 24, pw + 24, ph2 + 70, ease(prog(t, 33, 33.8)));
        if (p > 0) {
            ctx.strokeStyle = C.white; ctx.lineWidth = 2.4; ctx.beginPath();
            for (var x = 0; x <= 60 * p; x++) {
                var u = x / 60, y = 0.12 + 0.88 * Math.exp(-3.2 * u) + 0.035 * Math.sin(u * 40) * (1 - u);
                var X = px0 + pw * u, Y = py0 + ph2 * (1 - clamp(1 - y, 0, 1));
                if (x) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
            }
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0, py0 + ph2); ctx.lineTo(px0 + pw, py0 + ph2); ctx.stroke();
            text("training (schematic)", px0 + pw / 2, py0 + ph2 + 24, 14, C.dim, "normal", "center");
        }
        ctx.globalAlpha = ease(prog(t, 37.4, 38.2));
        text("trained only to accelerate the annotation of the next 500 volumes", 500, 580, 16, C.text, "normal", "center"); ctx.globalAlpha = 1;
    }

    function modelBox(x, y, w, h, title, sub, a) {
        ctx.save(); ctx.globalAlpha *= a; rrect(x, y, w, h, 12, ACCENT, "rgba(255,255,255,0.4)", 2);
        text(title, x + w / 2, y + h / 2 - 2, 22, C.white, "bold", "center"); text(sub, x + w / 2, y + h / 2 + 22, 14, "rgba(255,255,255,0.8)", "normal", "center"); ctx.restore();
    }

    function scene5(t, k) {
        modelBox(60, 270, 220, 110, "SwinUNETRv2", "assistant model", ease(prog(t, 40.2, 40.8)));
        var gx = 440, gy = 200;
        text("second 500 volumes", gx, gy - 14, 16, C.text, "bold");
        arrow(280, 325, 425, 325, "rgba(255,255,255,0.5)", ease(prog(t, 40.8, 41.6)));
        var sw = prog(t, 41.6, 45.4) * 20;
        halfGrid(gx, gy, function (i, row) { return row < sw ? C.cand : C.base; });
        ctx.globalAlpha = ease(prog(t, 42, 42.8));
        dot(gx + HW + 30, gy + 10, 6, C.cand); text("candidate ostia (left and right)", gx + HW + 44, gy + 15, 14, C.text, "normal");
        ctx.globalAlpha = 1;
    }

    function scene6(t, k) {
        var gx = 440, gy = 200;
        text("second 500 volumes", gx, gy - 14, 16, C.text, "bold");
        var sw = prog(t, 48.0, 52.8) * 20;
        halfGrid(gx, gy, function (i, row) {
            if (row >= sw) return C.cand;
            var ty = secondTypes[i];
            return ty === 2 ? C.bad : (ty === 1 ? C.adj : C.ok);
        });
        // the reviewing annotator sweeps down the grid
        if (t > 48 && t < 53) { var yy = gy + (sw / 20) * (HH + 2); ctx.strokeStyle = C.white; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(gx - 6, yy); ctx.lineTo(gx + HW + 6, yy); ctx.stroke(); dot(gx - 26, yy, 14, "#ffffff"); text("1", gx - 26, yy + 5, 14, "rgba(18,16,28,0.9)", "bold", "center"); }
        // legend and counts
        var a = ease(prog(t, 52.4, 53.4));
        var lx = 60, ly = 230;
        ctx.globalAlpha = Math.max(a, 0);
        [[C.ok, "402", "confirmed as predicted"], [C.adj, "88", "imprecise placements adjusted"], [C.bad, "10", "ostium not detected, placed manually"]].forEach(function (r, i) {
            tileBox(lx, ly + i * 82, 330, 66, 1);
            ctx.fillStyle = r[0]; ctx.fillRect(lx + 14, ly + i * 82 + 14, 8, 38);
            text(r[1], lx + 38, ly + i * 82 + 46, 34, r[0], "bold"); text(r[2], lx + 108, ly + i * 82 + 40, 14, C.text, "normal");
        });
        ctx.globalAlpha = 1;
        var b = ease(prog(t, 54.2, 55.2));
        ctx.globalAlpha = b;
        text("human effort", 60, 500, 15, C.dim, "bold");
        var s5 = 330 * 5 / 144;
        rrect(60, 512, 330, 16, 4, "rgba(143,180,255,0.7)"); text("fully manual, first batch: about 144 person-hours", 60, 548, 13, C.text, "normal");
        rrect(60, 560, Math.max(s5, 4), 16, 4, C.semi); text("this batch: about 5 person-hours of review", 60, 596, 13, C.text, "normal");
        ctx.globalAlpha = 1;
    }

    function scene7(t, k) {
        var x1 = 90, x2 = 460, gy = 210;
        var a1 = ease(prog(t, 57.2, 58.0));
        ctx.globalAlpha = a1; text("first 500: manual, consensus of three", x1, gy - 14, 15, C.manual, "bold");
        halfGrid(x1, gy, function () { return C.manual; });
        ctx.globalAlpha = 1;
        var a2 = ease(prog(t, 58.0, 58.8));
        ctx.globalAlpha = a2; text("second 500: model + one annotator", x2, gy - 14, 15, C.semi, "bold");
        halfGrid(x2, gy, function () { return C.semi; });
        ctx.globalAlpha = 1;
        var a3 = ease(prog(t, 58.8, 59.6));
        ctx.globalAlpha = a3;
        text("CAT08 (32)", 840, gy - 14, 15, C.ok, "bold");
        grid(840, gy, 8, 32, 11, 3, function () { return C.ok; });
        text("ASOCA (40)", 840, gy + 130, 15, C.ok, "bold");
        grid(840, gy + 144, 8, 40, 11, 3, function () { return C.ok; });
        ctx.globalAlpha = 1;
        var a4 = ease(prog(t, 60.0, 61.0));
        ctx.globalAlpha = a4;
        text("ostia for all 1000 ImageCAS volumes, reconciled with the 72 reference volumes of CAT08 and ASOCA", 500, 560, 17, C.text, "bold", "center");
        text("the two annotation stages are not methodologically equivalent", 500, 588, 14, C.dim, "normal", "center");
        ctx.globalAlpha = 1;
    }

    function scene8(t, k) {
        var x1 = 90, x2 = 460, gy = 210;
        var hi = ease(prog(t, 63.8, 65.0)), ver = ease(prog(t, 66.4, 67.4));
        text("first 500: manual", x1, gy - 14, 15, C.text, "bold");
        halfGrid(x1, gy, function (i) { return testPick.imagecas[i] ? (hi > 0 ? C.white : C.manual) : "rgba(143,180,255," + (0.9 - 0.55 * hi) + ")"; });
        text("second 500: model-assisted", x2, gy - 14, 15, C.text, "bold");
        halfGrid(x2, gy, function () { return "rgba(199,155,255," + (0.9 - 0.55 * hi) + ")"; });
        text("CAT08", 840, gy - 14, 15, C.text, "bold");
        grid(840, gy, 8, 32, 11, 3, function (i) { return testPick.cat[i] ? (hi > 0 ? C.white : C.ok) : "rgba(123,224,160," + (0.9 - 0.55 * hi) + ")"; });
        text("ASOCA", 840, gy + 130, 15, C.text, "bold");
        grid(840, gy + 144, 8, 40, 11, 3, function (i) { return testPick.asoca[i] ? (hi > 0 ? C.white : C.ok) : "rgba(123,224,160," + (0.9 - 0.55 * hi) + ")"; });
        ctx.globalAlpha = hi;
        dot(110, 540, 6, C.white); text("test set: 58 volumes (50 + 4 + 4)", 126, 545, 16, C.white, "bold");
        dot(500, 540, 6, "rgba(143,180,255,0.4)"); text("training and validation", 516, 545, 16, C.dim, "normal");
        ctx.globalAlpha = 1;
        ctx.globalAlpha = ver;
        text("the 50 ImageCAS test volumes come only from the manually annotated half and got an extra verification pass by all annotators", 500, 590, 14, C.text, "normal", "center");
        ctx.globalAlpha = 1;
    }

    var MODELS = ["SwinUNETRv2", "ResNet50", "ResNet101", "nnResUNet", "MedNeXt"];
    function scene9(t, k) {
        // training data on the left, five models trained in the same framework, weights on the right (MedNeXt: not released)
        tileBox(50, 200, 190, 300, ease(prog(t, 69.3, 70.1)));
        ctx.globalAlpha = ease(prog(t, 69.4, 70.2));
        text("training and validation", 145, 228, 14, C.text, "bold", "center");
        grid(70, 245, 25, 500, 5, 1, function (i) { return i < 450 ? "rgba(143,180,255,0.75)" : (i % 2 ? "rgba(199,155,255,0.75)" : C.ok); });
        text("ImageCAS + CAT08 + ASOCA", 145, 480, 13, C.dim, "normal", "center");
        ctx.globalAlpha = 1;
        MODELS.forEach(function (m, i) {
            var y = 195 + i * 62, a = ease(prog(t, 70.0 + i * 0.25, 70.8 + i * 0.25));
            ctx.globalAlpha = a;
            arrow(244, 350, 300, y + 24, "rgba(255,255,255,0.3)", 1);
            rrect(305, y, 200, 48, 9, ACCENT, "rgba(255,255,255,0.35)", 1.5);
            text(m, 405, y + 31, 19, C.white, "bold", "center");
            // training progress
            var p = prog(t, 71.2 + i * 0.15, 76.4 + i * 0.2);
            rrect(530, y + 16, 250, 14, 7, "rgba(255,255,255,0.1)");
            if (p > 0) rrect(530, y + 16, Math.max(14, 250 * p), 14, 7, C.manual);
            if (p >= 1) {
                if (m === "MedNeXt") { rrect(805, y + 4, 140, 40, 8, "rgba(255,255,255,0.06)", C.dim, 1.5); text("not released", 875, y + 30, 14, C.dim, "normal", "center"); }
                else { rrect(805, y + 4, 140, 40, 8, "rgba(123,224,160,0.15)", C.ok, 1.5); text("weights", 875, y + 30, 16, C.ok, "bold", "center"); }
            }
            ctx.globalAlpha = 1;
        });
        ctx.globalAlpha = ease(prog(t, 72, 73));
        text("shared framework: 3D heatmaps (background, right, left) | 0.5 mm isotropic grid | same loss, training strategy, postprocessing and metrics", 500, 560, 14, C.text, "normal", "center");
        ctx.globalAlpha = 1;
    }

    function scene10(t, k) {
        // sliding patches on a volume
        var vx = 70, vy = 210, vw = 330, vh = 260;
        tileBox(vx, vy, vw, vh, 1);
        var ic = aortaIcon(vx + vw / 2, vy + 96, 0.9, 1);
        text("test volume", vx + vw / 2, vy - 10, 15, C.text, "bold", "center");
        var pw = 150, ph = 150, step = 75, nx = 3, ny = 2;
        var np = nx * ny, cur = Math.floor(prog(t, 79.6, 82.6) * np);
        for (var i = 0; i < np; i++) {
            var px = vx + 8 + (i % nx) * step, py = vy + 8 + Math.floor(i / nx) * step;
            if (i > cur) continue;
            ctx.save(); ctx.strokeStyle = i === cur ? C.cand : "rgba(255,216,107,0.45)"; ctx.lineWidth = i === cur ? 3 : 1.5;
            ctx.strokeRect(px, py, pw, ph); ctx.restore();
        }
        text("128-voxel patches, 50% overlap", vx + vw / 2, vy + vh + 24, 14, C.dim, "normal", "center");
        // heatmap peaks and ground truth
        var hk = ease(prog(t, 82.4, 83.4));
        arrow(410, 340, 470, 340, "rgba(255,255,255,0.5)", ease(prog(t, 82.2, 82.8)));
        var hx = 480, hy = 210;
        tileBox(hx, hy, 220, 260, 1);
        text("predicted ostia", hx + 110, hy - 10, 15, C.text, "bold", "center");
        var ic2 = aortaIcon(hx + 110, hy + 96, 0.62, 1);
        [[ic2.R, C.R], [ic2.L, C.L]].forEach(function (q, i) {
            var g = ctx.createRadialGradient(q[0][0] + 5, q[0][1] + 4, 0, q[0][0] + 5, q[0][1] + 4, 26);
            g.addColorStop(0, i ? "rgba(94,200,229,0.9)" : "rgba(255,180,84,0.9)"); g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.globalAlpha = hk; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0][0] + 5, q[0][1] + 4, 26, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
            // reference marker next to the peak
            ctx.globalAlpha = ease(prog(t, 83.6, 84.2)); dot(q[0][0], q[0][1], 5, null, C.white); dot(q[0][0] + 5, q[0][1] + 4, 3, q[1]);
            ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[0][0] + 5, q[0][1] + 4); ctx.stroke(); ctx.globalAlpha = 1;
        });
        text("error in mm against the reference", hx + 110, hy + 252, 13, C.dim, "normal", "center");
        // accuracy buckets
        var bx = 740, by = 240, bh = 46;
        text("accuracy buckets", bx + 100, by - 20, 15, C.text, "bold", "center");
        var bk = [["Optimal", C.ok], ["Good", "#6fd0c8"], ["Acceptable", C.cand], ["Failed", C.bad]];
        bk.forEach(function (b, i) {
            var a = ease(prog(t, 84.0 + i * 0.25, 84.8 + i * 0.25));
            ctx.globalAlpha = a; rrect(bx, by + i * (bh + 12), 200, bh, 8, "rgba(255,255,255,0.06)", b[1], 2);
            ctx.fillStyle = b[1]; ctx.fillRect(bx + 10, by + i * (bh + 12) + 10, 6, bh - 20);
            text(b[0], bx + 28, by + i * (bh + 12) + 30, 18, b[1], "bold"); ctx.globalAlpha = 1;
        });
        ctx.globalAlpha = ease(prog(t, 85.0, 85.8));
        text("thresholds from the ostial anatomy and from the variability between annotators", 500, 590, 15, C.text, "normal", "center");
        ctx.globalAlpha = 1;
    }

    var ABL = [
        { name: "Training set size", sub: "number of ImageCAS images used to train", icon: "size" },
        { name: "Training voxel spacing", sub: "resolution the network is trained at", icon: "spacing" },
        { name: "Spacing mismatch", sub: "training and inference spacing differ", icon: "mismatch" },
        { name: "Centroid window", sub: "window used to read the heatmap peak", icon: "window" },
        { name: "Window overlap", sub: "overlap of the sliding patches", icon: "overlap" },
        { name: "Right-left loss weighting", sub: "dynamic weighting of the two ostia", icon: "balance" }
    ];
    function ablIcon(kind, cx, cy, t) {
        var ph = (Math.sin(t * 2) + 1) / 2;
        ctx.save();
        if (kind === "size") {
            var n = 4 + Math.floor(ph * 8);
            grid(cx - 60, cy - 30, 12, 36, 8, 2, function (i) { return i < n * 3 ? C.manual : "rgba(255,255,255,0.12)"; });
        } else if (kind === "spacing") {
            var s = 8 + ph * 10;
            ctx.strokeStyle = C.manual; ctx.lineWidth = 1.5;
            for (var x = -60; x <= 60; x += s) { ctx.beginPath(); ctx.moveTo(cx + x, cy - 36); ctx.lineTo(cx + x, cy + 36); ctx.stroke(); }
            for (var y = -36; y <= 36; y += s) { ctx.beginPath(); ctx.moveTo(cx - 60, cy + y); ctx.lineTo(cx + 60, cy + y); ctx.stroke(); }
        } else if (kind === "mismatch") {
            ctx.strokeStyle = C.manual; ctx.lineWidth = 1.5;
            for (var a = -48; a <= 48; a += 12) { ctx.beginPath(); ctx.moveTo(cx - 70 + a + 48, cy - 32); ctx.lineTo(cx - 70 + a + 48, cy + 32); ctx.stroke(); }
            ctx.strokeStyle = C.cand;
            for (var b = -48; b <= 48; b += 16) { ctx.beginPath(); ctx.moveTo(cx + 22 + b + 48, cy - 32); ctx.lineTo(cx + 22 + b + 48, cy + 32); ctx.stroke(); }
            ctx.strokeStyle = C.white; ctx.beginPath(); ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy); ctx.stroke();
        } else if (kind === "window") {
            var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40); g.addColorStop(0, "rgba(255,180,84,0.95)"); g.addColorStop(1, "rgba(255,180,84,0)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 40, 0, 6.2832); ctx.fill();
            var w = 16 + ph * 38; ctx.strokeStyle = C.white; ctx.lineWidth = 2; ctx.strokeRect(cx - w / 2, cy - w / 2, w, w);
        } else if (kind === "overlap") {
            var o = ph * 50;
            ctx.lineWidth = 2; ctx.strokeStyle = C.cand; ctx.strokeRect(cx - 60, cy - 28, 70, 56);
            ctx.strokeStyle = C.manual; ctx.strokeRect(cx - 60 + 70 - o, cy - 28, 70, 56);
        } else if (kind === "balance") {
            var tilt = (ph - 0.5) * 0.5;
            ctx.translate(cx, cy + 6); ctx.rotate(tilt); ctx.strokeStyle = C.white; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(60, 0); ctx.stroke();
            dot(-60, 14, 12, C.R); dot(60, 14, 12, C.L); text("R", -60, 19, 14, "rgba(18,16,28,0.9)", "bold", "center"); text("L", 60, 19, 14, "rgba(18,16,28,0.9)", "bold", "center");
            ctx.rotate(-tilt); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 40); ctx.stroke();
        }
        ctx.restore();
    }
    function scene11(t, k) {
        ABL.forEach(function (a, i) {
            var col = i % 3, row = Math.floor(i / 3), x = 40 + col * 316, y = 190 + row * 210, w = 296, h = 190;
            var ap = ease(prog(t, 87.6 + i * 1.3, 88.6 + i * 1.3));
            if (ap <= 0) return;
            ctx.save(); ctx.globalAlpha = ap; ctx.translate(0, (1 - ap) * 14);
            tileBox(x, y, w, h, 1);
            ablIcon(a.icon, x + w / 2, y + 66, t);
            text(a.name, x + w / 2, y + 140, 18, C.white, "bold", "center");
            text(a.sub, x + w / 2, y + 164, 13, C.dim, "normal", "center");
            ctx.restore();
        });
        ctx.globalAlpha = ease(prog(t, 95.4, 96.2));
        text("each study changes one setting; all the others stay fixed", 500, 626, 16, C.text, "bold", "center");
        ctx.globalAlpha = 1;
    }

    function scene12(t, k) {
        var items = [
            { name: "Ostia annotations", sub: "1000 ImageCAS volumes", col: C.R },
            { name: "Centerline graphs", sub: "rooted at the ostia", col: C.L },
            { name: "Annotation protocol", sub: "and the code", col: C.manual },
            { name: "Model weights", sub: "the benchmark models", col: C.ok }
        ];
        items.forEach(function (it, i) {
            var x = 70 + i * 225, a = ease(prog(t, 98.4 + i * 0.5, 99.4 + i * 0.5));
            ctx.save(); ctx.globalAlpha = a; ctx.translate(0, (1 - a) * 20);
            tileBox(x, 230, 205, 120, 1);
            ctx.fillStyle = it.col; ctx.fillRect(x + 14, 250, 6, 80);
            text(it.name, x + 34, 282, 19, C.white, "bold"); text(it.sub, x + 34, 308, 14, C.dim, "normal");
            ctx.restore();
            arrow(x + 102, 360, 500, 440, "rgba(255,255,255,0.3)", ease(prog(t, 100.6 + i * 0.2, 101.6 + i * 0.2)));
        });
        var b = ease(prog(t, 101.6, 102.6));
        ctx.globalAlpha = b; rrect(300, 450, 400, 90, 14, ACCENT, "rgba(255,255,255,0.5)", 2);
        text("open resources", 500, 505, 28, C.white, "bold", "center");
        ctx.globalAlpha = 1;
    }
    var DRAW = [scene0, scene1, scene2, scene3, scene4, scene5, scene6, scene7, scene8, scene9, scene10, scene11, scene12];

    // ---- render
    function render(t) {
        t = clamp(t, 0, T);
        var cw = canvas.width, ch = canvas.height, u = cw / DW;
        var s = sceneAt(t), sc = SCENES[s], k = (t - sc.t0) / (sc.t1 - sc.t0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, cw, ch);
        // slow push-in, different in each scene
        var z = 1 + 0.025 * ease(k), cx = DW / 2 + (s % 2 ? 12 : -12) * k, cy = DH / 2;
        ctx.setTransform(u * z, 0, 0, u * z, cw / 2 - cx * u * z, ch / 2 - cy * u * z);
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = 1;
        DRAW[s](t, k);
        ctx.globalAlpha = 1;

        // overlays in screen space
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var bw = 380 * u, pad = 20 * u, lh = 17 * u;
        ctx.font = "normal " + 13 * u + "px " + FONT;
        var words = sc.sub.split(" "), lines = [], line = "";
        words.forEach(function (w) {
            var test = line ? line + " " + w : w;
            if (ctx.measureText(test).width > bw - pad - 16 * u && line) { lines.push(line); line = w; } else line = test;
        });
        lines.push(line);
        var bh = 62 * u + lines.length * lh, bx = 24 * u, by = 24 * u, ca = ease((t - sc.t0) / 0.5);
        ctx.globalAlpha = ca;
        ctx.fillStyle = "rgba(18,16,28,0.88)"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = ACCENT; ctx.fillRect(bx, by, 6 * u, bh);
        text((s + 1) + " / " + SCENES.length, bx + pad, by + 24 * u, 13 * u, "rgba(255,255,255,0.6)", "normal");
        text(sc.title, bx + pad, by + 48 * u, 21 * u, "#ffffff", "bold");
        lines.forEach(function (l, i) { text(l, bx + pad, by + 68 * u + i * lh, 13 * u, "rgba(255,255,255,0.8)", "normal"); });
        ctx.globalAlpha = 1;

        var cutA = 0;
        for (var i = 1; i < SCENES.length; i++) cutA = Math.max(cutA, 1 - Math.abs(t - SCENES[i].t0) / CUT_FADE);
        if (t < 0.4) cutA = Math.max(cutA, 1 - t / 0.4);
        if (cutA > 0) { ctx.fillStyle = "rgba(0,0,0," + clamp(cutA, 0, 1) + ")"; ctx.fillRect(0, 0, cw, ch); }
    }

    // ---- playback, chapters, full screen
    var playBtn = document.getElementById("op-play"), restartBtn = document.getElementById("op-restart"), fullBtn = document.getElementById("op-full"),
        seek = document.getElementById("op-seek"), clock = document.getElementById("op-time"), chips = document.getElementById("op-chapters");
    var time = 0, playing = false, userPaused = false, last = 0, raf = 0;
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    seek.max = R; seek.step = 0.01;
    SCENES.forEach(function (sc, i) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = (i + 1) + ". " + sc.title.replace(/^Stage \d: /, "");
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
    if (fullBtn && document.fullscreenEnabled) {
        fullBtn.addEventListener("click", function () { if (document.fullscreenElement) document.exitFullscreen(); else canvas.parentNode.requestFullscreen(); });
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

    var qt = parseFloat(new URLSearchParams(location.search).get("to"));
    if (!isNaN(qt)) { time = qt; userPaused = true; }
    else if (reduced) time = R;
    draw();
})();
