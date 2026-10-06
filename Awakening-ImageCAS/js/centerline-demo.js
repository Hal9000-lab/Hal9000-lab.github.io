// Canvas animation of the simplified centerline tracking (uses CenterlineAlgo from centerline-algo.js).
(function () {
    "use strict";

    var canvas = document.getElementById("cl-canvas");
    if (!canvas || !window.CenterlineAlgo) return;

    var model = window.CenterlineAlgo.build();
    var W = model.W, H = model.H;

    var ACCENT = (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#4c6273").trim();
    var COL = {
        bg: "#12101c",
        vessel: [200, 212, 226],
        aorta: [226, 170, 170],
        R: "#ffb454",
        L: "#5ec8e5",
        white: "#ffffff"
    };
    var RAMP_R = [[255, 232, 150], [255, 160, 60], [200, 70, 40]];
    var RAMP_L = [[190, 245, 250], [70, 190, 235], [40, 90, 190]];
    var RAMP_DIST = [[43, 27, 90], [31, 158, 137], [253, 231, 37]];

    // ---- timeline (seconds)
    var SCENES = [
        { t0: 0,  t1: 5,  title: "Segmentation mask",             sub: "The coronary tree is segmented from the CT volume." },
        { t0: 5,  t1: 10, title: "The model places the ostia",    sub: "One landmark for the left and one for the right coronary artery." },
        { t0: 10, t1: 15, title: "Distance to the vessel wall",   sub: "Voxels close to the wall are expensive, central ones are cheap." },
        { t0: 15, t1: 21, title: "Minimal-cost fronts",           sub: "A front grows from each ostium, so paths stay short and central." },
        { t0: 21, t1: 28, title: "Growing the tree",              sub: "Trace the path to the farthest uncovered voxel and keep it if it adds a branch." },
        { t0: 28, t1: 34, title: "The centerline graph",          sub: "One rooted tree per side, with position and radius at every node." }
    ];
    var T = SCENES[SCENES.length - 1].t1;
    var HOLD = 1.5;               // pause on the last frame before looping
    var CUT_FADE = 0.16;

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

    // ---- offscreen layers (one canvas pixel per voxel, drawn scaled without smoothing)
    function layer() {
        var c = document.createElement("canvas");
        c.width = W; c.height = H;
        return c;
    }
    var maskLayer = layer(), distLayer = layer(), geoLayer = layer();
    (function () {
        var mctx = maskLayer.getContext("2d"), dctx = distLayer.getContext("2d");
        var mi = mctx.createImageData(W, H), di = dctx.createImageData(W, H);
        var dMax = 6;
        for (var i = 0; i < W * H; i++) {
            if (!model.mask[i]) continue;
            var c = model.aorta[i] ? COL.aorta : COL.vessel;
            mi.data[i * 4] = c[0]; mi.data[i * 4 + 1] = c[1]; mi.data[i * 4 + 2] = c[2]; mi.data[i * 4 + 3] = 255;
            var r = ramp(RAMP_DIST, model.wall[i] / dMax);
            di.data[i * 4] = r[0]; di.data[i * 4 + 1] = r[1]; di.data[i * 4 + 2] = r[2]; di.data[i * 4 + 3] = 255;
        }
        mctx.putImageData(mi, 0, 0);
        dctx.putImageData(di, 0, 0);
    })();
    var geoCtx = geoLayer.getContext("2d");
    var geoImg = geoCtx.createImageData(W, H);
    var geoFront = -1;
    function updateGeo(front) {
        if (front === geoFront) return;
        geoFront = front;
        var d = geoImg.data;
        for (var i = 0; i < W * H; i++) {
            var g = model.geo[i];
            if (!model.vessel[i] || g > front) { d[i * 4 + 3] = 0; continue; }
            var ramp_ = model.side[i] === 0 ? RAMP_R : RAMP_L;
            var c = ramp(ramp_, g / model.maxGeo);
            d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2];
            // bright rim right behind the front
            d[i * 4 + 3] = g > front - model.maxGeo * 0.02 ? 255 : 215;
        }
        geoCtx.putImageData(geoImg, 0, 0);
    }

    // ---- branch schedule in scene 5
    var S5 = SCENES[4];
    var sched = (function () {
        var flash = 0.45, tail = 0.5;
        var total = model.branches.reduce(function (s, b) { return s + b.length; }, 0);
        var avail = (S5.t1 - S5.t0) - tail - flash * model.branches.length;
        var t = S5.t0 + 0.2, out = [];
        model.branches.forEach(function (b) {
            var dur = avail * b.length / total;
            var xs = b.pts.map(function (p) { return p[0]; }), ys = b.pts.map(function (p) { return p[1]; });
            var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
            var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
            var z = clamp(Math.min(W * 0.6 / Math.max(x1 - x0, 1), H * 0.62 / Math.max(y1 - y0, 1)), 1.6, 3.2);
            out.push({ tFlash: t, tDraw: t + flash, tEnd: t + flash + dur, cam: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z: z } });
            t += flash + dur;
        });
        return out;
    })();

    function cameraAt(t) {
        var s = sceneAt(t), k = (t - SCENES[s].t0) / (SCENES[s].t1 - SCENES[s].t0);
        switch (s) {
            case 0: return { cx: 100, cy: 65, z: lerp(1.0, 1.08, k) };
            case 1: return { cx: lerp(100, 102, k), cy: lerp(34, 38, k), z: lerp(2.5, 3.0, ease(k)) };
            case 2: return { cx: lerp(146, 150, k), cy: lerp(66, 80, k), z: lerp(2.2, 2.4, k) };
            case 3: return { cx: 100, cy: 65, z: lerp(1.35, 1.0, ease(k)) };
            case 4:
                var cur = 0;
                for (var i = 0; i < sched.length; i++) if (t >= sched[i].tFlash) cur = i;
                var from = cur === 0 ? { cx: 100, cy: 65, z: 1.15 } : sched[cur - 1].cam;
                var e = ease((t - sched[cur].tFlash) / 0.8);
                return { cx: lerp(from.cx, sched[cur].cam.cx, e), cy: lerp(from.cy, sched[cur].cam.cy, e), z: lerp(from.z, sched[cur].cam.z, e) };
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

    function rgb(c, a) { return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a + ")"; }
    function sideColor(s) { return s === "R" ? COL.R : COL.L; }

    function polyline(pts, upTo) {
        // path through pts, optionally only the first fraction (0..1) of its length
        var total = 0, i, segs = [];
        for (i = 1; i < pts.length; i++) { var l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
        var goal = total * clamp(upTo === undefined ? 1 : upTo, 0, 1), acc = 0;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (i = 1; i < pts.length; i++) {
            if (acc + segs[i - 1] <= goal) { ctx.lineTo(pts[i][0], pts[i][1]); acc += segs[i - 1]; }
            else {
                var f = segs[i - 1] ? (goal - acc) / segs[i - 1] : 0;
                ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f));
                return { x: lerp(pts[i - 1][0], pts[i][0], f), y: lerp(pts[i - 1][1], pts[i][1], f) };
            }
        }
        return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
    }

    function drawBranch(b, frac, px) {
        // soft band (the covered region) and bright core line
        var meanR = b.pts.reduce(function (s, p) { return s + p[2]; }, 0) / b.pts.length;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.strokeStyle = sideColor(b.side);
        var a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.28; ctx.lineWidth = 2 * meanR;
        polyline(b.pts, frac); ctx.stroke();
        ctx.globalAlpha = a; ctx.lineWidth = 3.2 * px;
        var head = polyline(b.pts, frac); ctx.stroke();
        return head;
    }

    function drawMarker(o, k, px, t) {
        var c = sideColor(o.side), pop = ease(k);
        if (pop <= 0) return;
        var pulse = 1 + 0.25 * Math.sin(t * 5);
        ctx.save();
        ctx.globalAlpha = pop;
        ctx.strokeStyle = c; ctx.lineWidth = 2.2 * px;
        ctx.beginPath(); ctx.arc(o.pos[0], o.pos[1], 6 * px * pulse * pop, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(o.pos[0], o.pos[1], 3 * px, 0, 6.2832); ctx.fill();
        ctx.restore();
    }

    function text(str, x, y, size, color, weight, align) {
        ctx.font = (weight || "normal") + " " + size + "px 'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif";
        ctx.fillStyle = color; ctx.textAlign = align || "left"; ctx.textBaseline = "alphabetic";
        ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 6;
        ctx.fillText(str, x, y);
        ctx.shadowBlur = 0;
    }

    function render(t) {
        t = clamp(t, 0, T);
        var cw = canvas.width, ch = canvas.height, u = cw / BASE;
        var s = sceneAt(t), sc = SCENES[s];
        var cam = cameraAt(t);
        var scale = (cw / W) * cam.z, px = 1 / scale;     // px: one screen pixel in grid units

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, cw, ch);
        ctx.setTransform(scale, 0, 0, scale, cw / 2 - cam.cx * scale, ch / 2 - cam.cy * scale);
        ctx.imageSmoothingEnabled = false;

        // mask
        var maskA = s === 0 ? ease(t / 1.6) : (s === 4 ? 0.55 : (s === 5 ? lerp(0.55, 0.28, ease((t - 28) / 1.5)) : 1));
        ctx.globalAlpha = maskA;
        ctx.drawImage(maskLayer, 0, 0);

        // scene 3: distance field
        if (s === 2) {
            ctx.globalAlpha = ease((t - 10.4) / 1.6);
            ctx.drawImage(distLayer, 0, 0);
        }
        // scene 4: geodesic fronts
        if (s === 3) {
            var front = clamp((t - 15.5) / 4.6, 0, 1) * model.maxGeo * 1.001;
            updateGeo(front);
            ctx.globalAlpha = ease((t - 15.2) / 0.5);
            ctx.drawImage(geoLayer, 0, 0);
        }
        ctx.globalAlpha = 1;

        // scene 2: model heatmaps shrinking onto the ostia
        if (s === 1) {
            var hk = clamp((t - 5.7) / 2.8, 0, 1), fade = 1 - ease((t - 8.4) / 0.8);
            model.ostia.forEach(function (o, i) {
                var k = clamp(hk - i * 0.08, 0, 1);
                var rad = lerp(11, 2.2, ease(k));
                var g = ctx.createRadialGradient(o.pos[0], o.pos[1], 0, o.pos[0], o.pos[1], rad);
                var c = o.side === "R" ? "255,180,84" : "94,200,229";
                g.addColorStop(0, "rgba(" + c + "," + 0.95 * fade + ")");
                g.addColorStop(1, "rgba(" + c + ",0)");
                ctx.fillStyle = g;
                ctx.globalAlpha = ease((t - 5.5) / 0.6);
                ctx.beginPath(); ctx.arc(o.pos[0], o.pos[1], rad, 0, 6.2832); ctx.fill();
            });
            ctx.globalAlpha = 1;
        }

        // ostium markers from scene 2 on
        if (t >= 8.3) model.ostia.forEach(function (o, i) { drawMarker(o, (t - 8.3 - i * 0.2) / 0.5, px, t); });

        // scene 5/6: branches
        if (t >= S5.t0) {
            var heads = [];
            model.branches.forEach(function (b, i) {
                var sd = sched[i];
                if (t < sd.tFlash) return;
                if (t < sd.tDraw) {
                    // the farthest uncovered voxel, flagged before tracing
                    var tip = b.pts[0], k = (t - sd.tFlash) / (sd.tDraw - sd.tFlash);
                    ctx.strokeStyle = COL.white; ctx.lineWidth = 2 * px;
                    ctx.globalAlpha = 1 - 0.3 * k;
                    ctx.beginPath(); ctx.arc(tip[0], tip[1], lerp(9, 3, ease(k)) * px * 2.2, 0, 6.2832); ctx.stroke();
                    ctx.fillStyle = COL.white;
                    ctx.beginPath(); ctx.arc(tip[0], tip[1], 2.6 * px, 0, 6.2832); ctx.fill();
                    ctx.globalAlpha = 1;
                    return;
                }
                var frac = clamp((t - sd.tDraw) / (sd.tEnd - sd.tDraw), 0, 1);
                var head = drawBranch(b, frac, px);
                if (frac < 1) heads.push(head);
            });
            heads.forEach(function (h) {
                ctx.fillStyle = COL.white;
                ctx.beginPath(); ctx.arc(h.x, h.y, 3 * px, 0, 6.2832); ctx.fill();
            });
        }

        // scene 6: nodes of the graph
        if (s === 5) {
            var n = 0;
            ctx.lineWidth = 1.6 * px;
            model.branches.forEach(function (b) {
                var tip = b.pts[0], c = sideColor(b.side);
                var j = n++;
                var a = ease((t - 28.4 - j * 0.22) / 0.4);
                ctx.globalAlpha = a;
                // tip node with its radius
                ctx.strokeStyle = c; ctx.fillStyle = c;
                ctx.beginPath(); ctx.arc(tip[0], tip[1], 3.4 * px, 0, 6.2832); ctx.fill();
                ctx.strokeStyle = COL.white;
                ctx.beginPath(); ctx.arc(tip[0], tip[1], Math.max(tip[2], 1) + 1.5 * px, 0, 6.2832); ctx.stroke();
                // bifurcation node where the branch joins
                var at = b.attach, p = null;
                if (at.branch !== undefined) p = model.branches[at.branch].pts[at.idx];
                if (p) {
                    ctx.fillStyle = COL.white;
                    ctx.beginPath(); ctx.arc(p[0], p[1], 3.6 * px, 0, 6.2832); ctx.fill();
                }
            });
            ctx.globalAlpha = 1;
        }

        // ---- screen-space overlays
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // caption lower third
        var ca = ease((t - sc.t0) / 0.5) * (1 - ease((t - (sc.t1 - 0.3)) / 0.3) * (s === SCENES.length - 1 ? 0 : 1));
        ctx.globalAlpha = ca;
        var bw = 400 * u, bh = 100 * u, bx = (cw - bw) / 2, by = ch - bh - 18 * u;
        ctx.fillStyle = "rgba(18,16,28,0.8)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = ACCENT; ctx.fillRect(bx, by, 6 * u, bh);
        text((s + 1) + " / " + SCENES.length, bx + 20 * u, by + 24 * u, 14 * u, "rgba(255,255,255,0.6)", "normal");
        text(sc.title, bx + 20 * u, by + 50 * u, 24 * u, "#ffffff", "bold");
        // subtitle, wrapped to the box width
        ctx.font = "normal " + 13 * u + "px 'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif";
        var words = sc.sub.split(" "), line = "", ly2 = by + 72 * u;
        words.forEach(function (w) {
            var test = line ? line + " " + w : w;
            if (ctx.measureText(test).width > bw - 34 * u && line) {
                text(line, bx + 20 * u, ly2, 13 * u, "rgba(255,255,255,0.78)", "normal");
                line = w; ly2 += 17 * u;
            } else line = test;
        });
        text(line, bx + 20 * u, ly2, 13 * u, "rgba(255,255,255,0.78)", "normal");
        ctx.globalAlpha = 1;

        // scene 3 legend
        if (s === 2) {
            var lx = cw - 250 * u, ly = 34 * u, lw = 200 * u;
            var grad = ctx.createLinearGradient(lx, 0, lx + lw, 0);
            [0, 0.5, 1].forEach(function (f, i) { var c = RAMP_DIST[i]; grad.addColorStop(f, rgb(c, 1)); });
            ctx.globalAlpha = ease((t - 11) / 0.6);
            ctx.fillStyle = grad; ctx.fillRect(lx, ly, lw, 12 * u);
            text("wall", lx, ly + 32 * u, 14 * u, "rgba(255,255,255,0.8)", "normal", "left");
            text("centre", lx + lw, ly + 32 * u, 14 * u, "rgba(255,255,255,0.8)", "normal", "right");
            ctx.globalAlpha = 1;
        }
        // scene 2 labels
        if (s === 1 && t > 8.8) {
            ctx.globalAlpha = ease((t - 8.8) / 0.6);
            model.ostia.forEach(function (o) {
                var sx = cw / 2 + (o.pos[0] - cam.cx) * scale, sy = ch / 2 + (o.pos[1] - cam.cy) * scale;
                var left = o.side === "R";
                var label = o.side === "R" ? "right ostium" : "left ostium";
                ctx.font = "bold " + 18 * u + "px 'Gill Sans','Gill Sans MT',Calibri,'Trebuchet MS',sans-serif";
                var tw = ctx.measureText(label).width, lx2 = sx + (left ? -34 * u - tw : 34 * u), ly3 = sy - 52 * u;
                ctx.fillStyle = "rgba(18,16,28,0.85)";
                ctx.fillRect(lx2 - 8 * u, ly3 - 21 * u, tw + 16 * u, 30 * u);
                text(label, lx2, ly3, 18 * u, sideColor(o.side), "bold", "left");
                ctx.strokeStyle = sideColor(o.side); ctx.lineWidth = 1.5 * u;
                ctx.beginPath(); ctx.moveTo(left ? lx2 + tw + 8 * u : lx2 - 8 * u, ly3 - 6 * u); ctx.lineTo(sx, sy); ctx.stroke();
            });
            ctx.globalAlpha = 1;
        }

        // scene cuts: quick dip to black
        var cutA = 0;
        for (var i = 1; i < SCENES.length; i++) cutA = Math.max(cutA, 1 - Math.abs(t - SCENES[i].t0) / CUT_FADE);
        if (t < 0.4) cutA = Math.max(cutA, 1 - t / 0.4);
        if (cutA > 0) { ctx.fillStyle = "rgba(0,0,0," + clamp(cutA, 0, 1) + ")"; ctx.fillRect(0, 0, cw, ch); }
    }

    // ---- playback
    var playBtn = document.getElementById("cl-play"), restartBtn = document.getElementById("cl-restart"),
        seek = document.getElementById("cl-seek"), clock = document.getElementById("cl-time");
    var time = 0, playing = false, userPaused = false, last = 0, visible = false, raf = 0;
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    seek.max = T; seek.step = 0.01;
    function fmt(x) { return Math.floor(x / 60) + ":" + ("0" + Math.floor(x % 60)).slice(-2); }
    function draw() {
        render(time);
        seek.value = Math.min(time, T);
        clock.textContent = fmt(Math.min(time, T)) + " / " + fmt(T);
    }
    function setPlaying(p) {
        playing = p;
        playBtn.textContent = p ? "Pause" : "Play";
        if (p) { last = performance.now(); if (!raf) raf = requestAnimationFrame(tick); }
    }
    function tick(now) {
        raf = 0;
        if (!playing) return;
        time += (now - last) / 1000; last = now;
        if (time >= T + HOLD) time = 0;
        draw();
        raf = requestAnimationFrame(tick);
    }
    playBtn.addEventListener("click", function () { userPaused = playing; setPlaying(!playing); });
    restartBtn.addEventListener("click", function () { time = 0; draw(); userPaused = false; setPlaying(true); });
    seek.addEventListener("input", function () { time = parseFloat(seek.value); if (playing) last = performance.now(); draw(); });
    window.addEventListener("resize", function () { resize(); draw(); });
    var fullBtn = document.getElementById("cl-full");
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
            visible = e[0].isIntersecting;
            if (visible && !userPaused && !reduced) setPlaying(true);
            if (!visible) setPlaying(false);
        }, { threshold: 0.4 }).observe(canvas);
    } else if (!reduced) setPlaying(true);

    // optional ?t=12 : open paused at that time (handy to link to a given frame)
    var qt = parseFloat(new URLSearchParams(location.search).get("t"));
    if (!isNaN(qt)) { time = qt; userPaused = true; }
    else if (reduced) time = T;      // no motion: show the final frame, user can scrub or play
    draw();
})();
