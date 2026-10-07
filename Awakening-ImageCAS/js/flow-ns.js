// Real-time 2D viscous incompressible flow (WebGL2) inside the unfolded left and right coronary trees.
//
// - The fluid can only move inside the vessel masks (rigid, no-slip walls); the mouse adds 2x2 rigid obstacles.
// - A pulsatile inflow enters at the ostium of each tree (a source on a small disk) and leaves along the tree (distributed sinks).
// - Staggered (MAC) grid, semi-Lagrangian advection, implicit viscous diffusion, pressure projection.
// - Long-range pressure: a thin 600-cell tree is far too long for a Jacobi solve (errors with wavelengths of tens of cells never
//   decay and the flow stalls). The pressure is therefore solved in two levels. Coarse level: one unknown per BFS layer of each tree
//   (one cell thick, split in connected pieces), i.e. the 1D tree-shaped reduction of the problem. Every step the GPU sums the
//   divergence residual of each layer, a small graph system (~1-3k unknowns) is solved on the CPU (Jacobi-preconditioned CG,
//   warm-started) and its solution seeds the pressure; Jacobi sweeps on the GPU then smooth the local residual. This removes the
//   flux error at every cross-section of every vessel.
// - Views: dye (live flow) or the solver's pressure per unit time.
(function (root) {
    "use strict";

    // =====================================================================================================
    // Pure geometry and numerics (no DOM): also loaded by node for the reference tests
    // =====================================================================================================
    var Core = (function () {
        function chamfer(mask, W, H) {
            var d = new Float32Array(W * H), i, x, y, S2 = Math.SQRT2;
            for (i = 0; i < W * H; i++) d[i] = mask[i] ? 1e9 : 0;
            function rel(i, j, c) { if (d[j] + c < d[i]) d[i] = d[j] + c; }
            for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
                i = y * W + x; if (!mask[i]) continue;
                if (x === 0 || y === 0) d[i] = 1;
                if (x > 0) rel(i, i - 1, 1); if (y > 0) rel(i, i - W, 1);
                if (x > 0 && y > 0) rel(i, i - W - 1, S2); if (x < W - 1 && y > 0) rel(i, i - W + 1, S2);
            }
            for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) {
                i = y * W + x; if (!mask[i]) continue;
                if (x === W - 1 || y === H - 1) d[i] = Math.min(d[i], 1);
                if (x < W - 1) rel(i, i + 1, 1); if (y < H - 1) rel(i, i + W, 1);
                if (x < W - 1 && y < H - 1) rel(i, i + W + 1, S2); if (x > 0 && y < H - 1) rel(i, i + W - 1, S2);
            }
            return d;
        }

        // breadth-first distance over 4-connected open cells (4-connectivity = the graph of the Poisson problem)
        function bfs4(open, W, H, rootIdx) {
            var N = W * H, g = new Int32Array(N).fill(-1), q = new Int32Array(N), head = 0, tail = 0;
            g[rootIdx] = 0; q[tail++] = rootIdx;
            while (head < tail) {
                var p = q[head++], x = p % W, y = (p / W) | 0, d = g[p] + 1;
                if (x > 0 && open[p - 1] && g[p - 1] < 0) { g[p - 1] = d; q[tail++] = p - 1; }
                if (x < W - 1 && open[p + 1] && g[p + 1] < 0) { g[p + 1] = d; q[tail++] = p + 1; }
                if (y > 0 && open[p - W] && g[p - W] < 0) { g[p - W] = d; q[tail++] = p - W; }
                if (y < H - 1 && open[p + W] && g[p + W] < 0) { g[p + W] = d; q[tail++] = p + W; }
            }
            return { g: g, queue: q, count: tail };
        }

        function nearestIn(mask, W, H, x0, y0) {
            var best = -1, bd = 1e18;
            for (var i = 0; i < W * H; i++) if (mask[i]) { var dx = i % W - x0, dy = ((i / W) | 0) - y0, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
            return best;
        }

        // Source/sink field of both trees for the current obstacles.
        //  trees  {L, R}: vessel masks      edt {L, R}: wall distance of each mask     rootStatic {L, R}: root cell without obstacles
        //  obst: obstacle cells (or null)    Returns s (unit inflow on a disk at the root, minus sinks ~ geodesic^2, zero-sum per tree),
        //  tree (0 left, 1 right, -1 none), open (fluid, not obstacle), root cells and inlet radii.
        function buildSource(trees, edt, rootStatic, obst, W, H) {
            var N = W * H, s = new Float32Array(N), tree = new Int8Array(N).fill(-1), open = new Uint8Array(N);
            var out = { s: s, tree: tree, open: open, root: {}, rr: {} };
            ["L", "R"].forEach(function (side, ti) {
                var m = trees[side], openT = new Uint8Array(N), i;
                for (i = 0; i < N; i++) if (m[i]) { tree[i] = ti; if (!obst || !obst[i]) { openT[i] = 1; open[i] = 1; } }
                var r0 = rootStatic[side];
                out.rr[side] = Math.max(3, 1.6 * edt[side][r0]);
                var r = openT[r0] ? r0 : nearestIn(openT, W, H, r0 % W, (r0 / W) | 0);
                out.root[side] = r;
                if (r < 0) return;                                   // the whole tree is blocked
                var b = bfs4(openT, W, H, r), gmax = 1, k;
                for (k = 0; k < b.count; k++) if (b.g[b.queue[k]] > gmax) gmax = b.g[b.queue[k]];
                var sink = 0;
                for (k = 0; k < b.count; k++) { var c = b.queue[k], w = Math.pow(b.g[c] / gmax, 2); s[c] = -w; sink += w; }
                for (k = 0; k < b.count; k++) s[b.queue[k]] /= sink;       // sinks sum to -1
                var rx = r % W, ry = (r / W) | 0, inlet = [], rr2 = out.rr[side] * out.rr[side];
                for (k = 0; k < b.count; k++) { var c2 = b.queue[k], dx = c2 % W - rx, dy = ((c2 / W) | 0) - ry; if (dx * dx + dy * dy <= rr2) inlet.push(c2); }
                if (!inlet.length) inlet.push(r);
                for (k = 0; k < inlet.length; k++) s[inlet[k]] += 1 / inlet.length;   // inflow sums to +1
            });
            return out;
        }

        // Coarse space of the pressure solve: one unknown per BFS layer (one cell thick) of each tree, split in connected pieces of at most
        // maxMembers cells. Aggregating over layers (not over 2x2 blocks) keeps the coarse operator consistent along thin vessels: the coarse
        // problem is the 1D (tree-shaped) reduction of the pressure problem. Returns the segments, their members and the coarse graph.
        function buildSegments(open, tree, root, W, H, maxMembers) {
            var N = W * H, seg = new Int32Array(N).fill(-1), members = [], start = [0], n = 0;
            ["L", "R"].forEach(function (side, ti) {
                var r = root[side]; if (r < 0) return;
                var openT = new Uint8Array(N), i;
                for (i = 0; i < N; i++) if (open[i] && tree[i] === ti) openT[i] = 1;
                var b = bfs4(openT, W, H, r), g = b.g, q = b.queue, count = b.count, k = 0;
                while (k < count) {
                    var g0 = g[q[k]], layer = [];
                    while (k < count && g[q[k]] === g0) layer.push(q[k++]);
                    for (var a = 0; a < layer.length; a++) {
                        if (seg[layer[a]] >= 0) continue;
                        var comp = [layer[a]], head = 0; seg[layer[a]] = -2;            // -2: queued in this layer
                        while (head < comp.length) {
                            var c = comp[head++], cx = c % W, cy = (c / W) | 0;
                            for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                                if (!dx && !dy) continue;
                                var xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                                var nb = yy * W + xx;
                                if (openT[nb] && g[nb] === g0 && seg[nb] === -1) { seg[nb] = -2; comp.push(nb); }
                            }
                        }
                        for (var s0 = 0; s0 < comp.length; s0 += maxMembers) {
                            var end = Math.min(comp.length, s0 + maxMembers);
                            for (var m = s0; m < end; m++) { seg[comp[m]] = n; members.push(comp[m]); }
                            n++; start.push(members.length);
                        }
                    }
                }
            });
            // coupling: every fine link between two different segments adds one unit of conductance
            var map = {}, i2;
            function link(a, b2) { if (a === b2) return; var lo = a < b2 ? a : b2, hi = a < b2 ? b2 : a, key = lo * 65536 + hi; map[key] = (map[key] || 0) + 1; }
            for (i2 = 0; i2 < N; i2++) {
                var sa = seg[i2]; if (sa < 0) continue;
                if (i2 % W < W - 1 && seg[i2 + 1] >= 0) link(sa, seg[i2 + 1]);
                if (i2 + W < N && seg[i2 + W] >= 0) link(sa, seg[i2 + W]);
            }
            var deg = new Int32Array(n + 1), keys = Object.keys(map), e;
            for (e = 0; e < keys.length; e++) { var kk = +keys[e], lo2 = Math.floor(kk / 65536), hi2 = kk % 65536; deg[lo2]++; deg[hi2]++; }
            var gstart = new Int32Array(n + 1), tot = 0;
            for (i2 = 0; i2 < n; i2++) { gstart[i2] = tot; tot += deg[i2]; } gstart[n] = tot;
            var nbr = new Int32Array(tot), cond = new Float32Array(tot), fill = new Int32Array(n), diag = new Float64Array(n);
            for (e = 0; e < keys.length; e++) {
                var key2 = +keys[e], l = Math.floor(key2 / 65536), h = key2 % 65536, c2 = map[key2];
                nbr[gstart[l] + fill[l]] = h; cond[gstart[l] + fill[l]++] = c2; nbr[gstart[h] + fill[h]] = l; cond[gstart[h] + fill[h]++] = c2; diag[l] += c2; diag[h] += c2;
            }
            // connected components of the coarse graph (to remove the mean of the right-hand side per component)
            var comp2 = new Int32Array(n).fill(-1), nc = 0, st = [];
            for (i2 = 0; i2 < n; i2++) { if (comp2[i2] >= 0) continue; comp2[i2] = nc; st.push(i2);
                while (st.length) { var u = st.pop(); for (var t = gstart[u]; t < gstart[u + 1]; t++) if (comp2[nbr[t]] < 0) { comp2[nbr[t]] = nc; st.push(nbr[t]); } } nc++; }
            return { n: n, seg: seg, members: Int32Array.from(members), start: Int32Array.from(start), gstart: gstart, nbr: nbr, cond: cond, diag: diag, comp: comp2, ncomp: nc };
        }

        // Coarse problem  A pi = b  on the segment graph (graph Laplacian), Jacobi-preconditioned CG, warm-started from x0.
        function solveSegments(G, b, x0, maxIt, tol) {
            var n = G.n, x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n), k, t;
            var sum = new Float64Array(G.ncomp), cnt = new Float64Array(G.ncomp), bb = new Float64Array(n);
            for (k = 0; k < n; k++) { sum[G.comp[k]] += b[k]; cnt[G.comp[k]]++; }
            for (k = 0; k < n; k++) { bb[k] = b[k] - sum[G.comp[k]] / cnt[G.comp[k]]; if (x0) x[k] = x0[k]; }
            function mv(v, out) { for (var a = 0; a < n; a++) { var s = G.diag[a] * v[a]; for (var q = G.gstart[a]; q < G.gstart[a + 1]; q++) s -= G.cond[q] * v[G.nbr[q]]; out[a] = s; } }
            mv(x, Ap);
            var rz = 0, bn = 0;
            for (k = 0; k < n; k++) { r[k] = bb[k] - Ap[k]; z[k] = G.diag[k] > 0 ? r[k] / G.diag[k] : 0; p[k] = z[k]; rz += r[k] * z[k]; bn += bb[k] * bb[k]; }
            for (t = 0; t < (maxIt || 80) && rz > (tol || 1e-18) * Math.max(bn, 1e-30); t++) {
                mv(p, Ap); var pAp = 0; for (k = 0; k < n; k++) pAp += p[k] * Ap[k];
                if (!(pAp > 0)) break;
                var alpha = rz / pAp, rzn = 0;
                for (k = 0; k < n; k++) { x[k] += alpha * p[k]; r[k] -= alpha * Ap[k]; z[k] = G.diag[k] > 0 ? r[k] / G.diag[k] : 0; rzn += r[k] * z[k]; }
                var beta = rzn / rz; rz = rzn; for (k = 0; k < n; k++) p[k] = z[k] + beta * p[k];
            }
            var xm = new Float64Array(G.ncomp), out = new Float32Array(n);
            for (k = 0; k < n; k++) xm[G.comp[k]] += x[k];
            for (k = 0; k < n; k++) out[k] = x[k] - xm[G.comp[k]] / cnt[G.comp[k]];
            return out;
        }

        return { chamfer: chamfer, bfs4: bfs4, nearestIn: nearestIn, buildSource: buildSource, buildSegments: buildSegments, solveSegments: solveSegments };
    })();

    if (typeof document === "undefined") { if (typeof module !== "undefined" && module.exports) module.exports = Core; return; }

    // =====================================================================================================
    // Page code
    // =====================================================================================================
    var canvas = document.getElementById("ns-canvas");
    if (!canvas) return;
    var figure = canvas.parentNode;

    // ---- configuration (tune here)
    var SRC_L = canvas.getAttribute("data-src-left"), SRC_R = canvas.getAttribute("data-src-right");
    var SIM_MAX = 640;                       // longest side of the grid, in cells
    var RES_PARAM = parseFloat(new URLSearchParams(location.search).get("res"));     // ?res=360: coarser grid for slow devices
    if (!isNaN(RES_PARAM)) SIM_MAX = RES_PARAM;
    var K2 = (SIM_MAX / 720) * (SIM_MAX / 720);        // flows and viscosity are tuned on a 720-cell grid
    var BPM_MIN = 40, BPM_MAX = 180, BPM_DEFAULT = 60;
    var PRESSURE_MIN = 0.25, PRESSURE_MAX = 4, PRESSURE_DEFAULT = 1.5;      // scales the inflow of every beat
    var Q_BASE = 350, Q_PEAK = 7000;         // inflow per tree at pressure 1, in cells^2/s (720-cell grid)
    var NU = 30 * K2;                        // kinematic viscosity, cells^2/s
    var JACOBI = 28, DIFFUSE = 6;            // sweeps per step (reduced automatically on slow devices)
    var DYE_RATE = 40, DYE_DECAY = 0.12, DYE_DIFFUSION = 0.06;
    var OBSTACLE_COLOR = [0.69, 0.49, 0.18]; // yellowish ochre-brown
    var OBSTACLE_SIZE = 2;                   // cells
    var SWAP_SIDES = false;                  // true: the leftmost tree of a single image is the right coronary

    // The right tree lags the left one by 0.15 / F seconds, F = 20 * (BPM - 40) / (180 - 40) (F is kept >= 0.6: 40 bpm -> 0.25 s).
    function rightDelay(bpm) { var F = Math.max(20 * (bpm - 40) / (180 - 40), 0.6); return 0.15 / F; }
    function beat(ph) { var s = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0; return s * s; }          // flow during one beat
    function bolus(ph) { var s = ph < 0.2 ? Math.sin(Math.PI * ph / 0.2) : 0; return s * s; }          // dye released at the start of systole

    var note = document.getElementById("ns-note"), status = document.getElementById("ns-status");
    function bail(msg) { figure.className += " fl-nogl"; if (note) note.textContent = msg; }
    function setStatus(msg) { if (status) { status.textContent = msg; status.style.display = msg ? "" : "none"; } }

    var gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) { bail("This browser cannot run the WebGL2 simulation."); return; }

    // ---- 1. masks: one image per tree (an ostium dot marks the root), cropped and laid out side by side
    function loadImage(src, cb) { var im = new Image(); im.onload = function () { cb(im); }; im.onerror = function () { bail("The mask image could not be loaded."); }; im.src = src; }
    function binarize(im) {
        var c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height, b = new Uint8Array(w * h), mx = 0, my = 0, mn = 0;
        for (var i = 0; i < w * h; i++) {
            var r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2];
            if (Math.max(r, g, bl) - Math.min(r, g, bl) > 40) { b[i] = 1; mx += i % w; my += (i / w) | 0; mn++; } else if (r < 128) b[i] = 1;
        }
        return { w: w, h: h, b: b, marker: mn > 20 ? [mx / mn, my / mn] : null };
    }
    function components(img) {
        var w = img.w, h = img.h, lab = new Int32Array(w * h).fill(-1), comps = [], stack = [];
        for (var i = 0; i < w * h; i++) {
            if (!img.b[i] || lab[i] >= 0) continue;
            var id = comps.length, pix = [i]; lab[i] = id; stack.push(i);
            while (stack.length) {
                var p = stack.pop(), x = p % w, y = (p / w) | 0, nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
                for (var k = 0; k < 4; k++) { var q = nb[k]; if (q >= 0 && img.b[q] && lab[q] < 0) { lab[q] = id; pix.push(q); stack.push(q); } }
            }
            comps.push(pix);
        }
        comps.sort(function (a, b) { return b.length - a.length; });
        return comps;
    }
    function bbox(pix, w) {
        var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        pix.forEach(function (p) { var x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
        return { x0: x0, y0: y0, x1: x1, y1: y1 };
    }
    function buildTrees(imgs, sides) {
        var picked = [], pad = 14, gap = 50, totalW = 0, totalH = 0;
        imgs.forEach(function (im, i) { picked.push({ side: sides[i], img: im, pix: components(im)[0] }); });
        picked.forEach(function (t) {
            var bb = bbox(t.pix, t.img.w);
            t.bb = { x0: bb.x0 - pad, y0: bb.y0 - pad, x1: bb.x1 + pad, y1: bb.y1 + pad };
            t.cw = t.bb.x1 - t.bb.x0 + 1; t.ch = t.bb.y1 - t.bb.y0 + 1; totalH = Math.max(totalH, t.ch);
        });
        var xo = 0; picked.forEach(function (t) { t.ox = xo; t.oy = 0; xo += t.cw + gap; }); totalW = xo - gap;
        var s = SIM_MAX / Math.max(totalW, totalH), SW = Math.round(totalW * s), SH = Math.round(totalH * s);
        var out = { W: SW, H: SH, trees: {}, markers: {} };
        picked.forEach(function (t) {
            var src = document.createElement("canvas"); src.width = totalW; src.height = totalH;
            var sx = src.getContext("2d"), id = sx.createImageData(totalW, totalH);
            for (var i = 0; i < totalW * totalH; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = 255; }
            t.pix.forEach(function (p) {
                var x = (p % t.img.w) - t.bb.x0 + t.ox, y = ((p / t.img.w) | 0) - t.bb.y0 + t.oy;
                if (x < 0 || y < 0 || x >= totalW || y >= totalH) return;
                var o = (y * totalW + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = 0;
            });
            sx.putImageData(id, 0, 0);
            var dst = document.createElement("canvas"); dst.width = SW; dst.height = SH;
            var dx = dst.getContext("2d"); dx.imageSmoothingEnabled = true; dx.imageSmoothingQuality = "high";
            dx.fillStyle = "#fff"; dx.fillRect(0, 0, SW, SH); dx.drawImage(src, 0, 0, SW, SH);
            var d = dx.getImageData(0, 0, SW, SH).data, m = new Uint8Array(SW * SH);
            for (var j = 0; j < SW * SH; j++) m[j] = d[j * 4] < 140 ? 1 : 0;
            out.trees[t.side] = m;
            if (t.img.marker) out.markers[t.side] = [(t.img.marker[0] - t.bb.x0 + t.ox) * s, (t.img.marker[1] - t.bb.y0 + t.oy) * s];
        });
        return out;
    }

    // ---- 2. geometry state on the CPU
    var W, H, N, trees, edt = {}, rootStatic = {}, baseMask, obst, G = null, field = null, geoData = null, piPrev = null;
    var SEGW = 1024, SEGH = 8, MEMW = 1024, MEMH = 128, MAXK = 128;      // capacity: 8192 segments, 131072 members

    // geo texture data: R = unit source, G = unused, B = tree id, A = vessel cell. Rows are flipped (texture row 0 = bottom)
    function geoArray(f) {
        var g = new Float32Array(N * 4);
        for (var i = 0; i < N; i++) {
            var x = i % W, y = (i / W) | 0, o = ((H - 1 - y) * W + x) * 4;
            g[o] = f.s[i]; g[o + 2] = f.tree[i] > 0 ? 1 : 0; g[o + 3] = baseMask[i];
        }
        return g;
    }
    function flipU8(arr, v) { var o = new Uint8Array(N); for (var i = 0; i < N; i++) { var x = i % W, y = (i / W) | 0; o[(H - 1 - y) * W + x] = arr[i] ? v : 0; } return o; }
    function texIndex(i) { return (H - 1 - ((i / W) | 0)) * W + (i % W); }
    // segment textures: per cell (segment index + 1, 0 = none), flat member lists (as texture cell indices) and (start, count) per segment
    function segmentArrays(Gs) {
        var idx = new Float32Array(N), mem = new Float32Array(MEMW * MEMH), info = new Float32Array(SEGW * SEGH * 4), i, k;
        for (i = 0; i < N; i++) if (Gs.seg[i] >= 0) idx[texIndex(i)] = Gs.seg[i] + 1;
        for (k = 0; k < Gs.members.length; k++) mem[k] = texIndex(Gs.members[k]);
        for (k = 0; k < Gs.n; k++) { info[k * 4] = Gs.start[k]; info[k * 4 + 1] = Gs.start[k + 1] - Gs.start[k]; }
        return { idx: idx, mem: mem, info: info };
    }
    function computeGeometry() {
        var f = Core.buildSource(trees, edt, rootStatic, obst, W, H);
        var Gs = Core.buildSegments(f.open, f.tree, f.root, W, H, MAXK);
        if (Gs.n > SEGW * SEGH || Gs.members.length > MEMW * MEMH) return null;
        return { f: f, G: Gs };
    }

    // ---- 3. WebGL
    var VS = "#version 300 es\nout vec2 vUv;\nvoid main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }";
    var HEAD = "#version 300 es\nprecision highp float; precision highp sampler2D;\nin vec2 vUv; out vec4 o;\n";
    var COMMON =
        "uniform sampler2D uGeo, uObst; ivec2 SZ;\n" +
        "bool inb(ivec2 c){ return c.x >= 0 && c.y >= 0 && c.x < SZ.x && c.y < SZ.y; }\n" +
        "float fluid(ivec2 c){ if (!inb(c)) return 0.0; return texelFetch(uGeo, c, 0).a * (1.0 - texelFetch(uObst, c, 0).r); }\n" +
        "bool openU(ivec2 c){ return fluid(c) > 0.5 && fluid(c - ivec2(1,0)) > 0.5; }\n" +
        "bool openV(ivec2 c){ return fluid(c) > 0.5 && fluid(c - ivec2(0,1)) > 0.5; }\n";
    var VELFN =
        "uniform sampler2D uVel;\n" +
        "float U(ivec2 c){ return inb(c) ? texelFetch(uVel, c, 0).x : 0.0; }\n" +
        "float Vf(ivec2 c){ return inb(c) ? texelFetch(uVel, c, 0).y : 0.0; }\n";
    function prog(fs) {
        function sh(type, text) { var s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + text); return s; }
        var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
        return { p: p, u: u };
    }

    // advection of the face velocities (semi-Lagrangian, midpoint). u lives at (i, j+0.5), v at (i+0.5, j), in cell units
    var S_ADVECT = HEAD + COMMON + VELFN + "uniform float uDt;\n" +
        "float sU(vec2 p){ vec2 q = vec2(p.x, p.y - 0.5); ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);\n" +
        "  return mix(mix(U(i), U(i + ivec2(1,0)), f.x), mix(U(i + ivec2(0,1)), U(i + ivec2(1,1)), f.x), f.y); }\n" +
        "float sV(vec2 p){ vec2 q = vec2(p.x - 0.5, p.y); ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);\n" +
        "  return mix(mix(Vf(i), Vf(i + ivec2(1,0)), f.x), mix(Vf(i + ivec2(0,1)), Vf(i + ivec2(1,1)), f.x), f.y); }\n" +
        "vec2 at(vec2 p){ return vec2(sU(p), sV(p)); }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy); float nu = 0.0, nv = 0.0;\n" +
        "  if (openU(c)) { vec2 p = vec2(float(c.x), float(c.y) + 0.5); vec2 pm = p - 0.5 * uDt * at(p); nu = sU(p - uDt * at(pm)); }\n" +
        "  if (openV(c)) { vec2 p = vec2(float(c.x) + 0.5, float(c.y)); vec2 pm = p - 0.5 * uDt * at(p); nv = sV(p - uDt * at(pm)); }\n" +
        "  o = vec4(nu, nv, 0.0, 1.0); }";

    // one implicit-diffusion sweep (no-slip: closed faces hold 0)
    var S_DIFFUSE = HEAD + COMMON + "uniform sampler2D uV0, uVk; uniform float uA;\n" +
        "vec2 Vk(ivec2 c){ return inb(c) ? texelFetch(uVk, c, 0).xy : vec2(0.0); }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  vec2 v0 = texelFetch(uV0, c, 0).xy; vec2 sum = Vk(c + ivec2(1,0)) + Vk(c - ivec2(1,0)) + Vk(c + ivec2(0,1)) + Vk(c - ivec2(0,1));\n" +
        "  vec2 v = (v0 + uA * sum) / (1.0 + 4.0 * uA);\n" +
        "  o = vec4(openU(c) ? v.x : 0.0, openV(c) ? v.y : 0.0, 0.0, 1.0); }";

    // right-hand side of the pressure equation:  div u - q s
    var S_DIV = HEAD + COMMON + VELFN + "uniform vec2 uQ;\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  if (fluid(c) < 0.5) { o = vec4(0.0); return; }\n" +
        "  vec4 g = texelFetch(uGeo, c, 0);\n" +
        "  float div = U(c + ivec2(1,0)) - U(c) + Vf(c + ivec2(0,1)) - Vf(c);\n" +
        "  o = vec4(div - (g.b < 0.5 ? uQ.x : uQ.y) * g.r, 0.0, 0.0, 1.0); }";

    var WIN = 26;                            // half-size of the window around each ostium used by the pressure-peak meter
    // sum of the right-hand side over every segment (one texel per segment)
    var S_SEGSUM = HEAD + "uniform sampler2D uRhs, uInfo, uMembers; uniform int uN;\nconst int MAXK = " + MAXK + ";\n" +
        "void main(){ ivec2 f = ivec2(gl_FragCoord.xy); int k = f.y * " + SEGW + " + f.x; if (k >= uN) { o = vec4(0.0); return; }\n" +
        "  vec4 info = texelFetch(uInfo, f, 0); int start = int(info.x + 0.5), cnt = int(info.y + 0.5); ivec2 sz = textureSize(uRhs, 0); float sum = 0.0;\n" +
        "  for (int m = 0; m < MAXK; m++) { if (m >= cnt) break; int idx = start + m;\n" +
        "    int ci = int(texelFetch(uMembers, ivec2(idx % " + MEMW + ", idx / " + MEMW + "), 0).x + 0.5);\n" +
        "    sum += texelFetch(uRhs, ivec2(ci % sz.x, ci / sz.x), 0).x; }\n" +
        "  o = vec4(sum, 0.0, 0.0, 1.0); }";

    // pressure start from the coarse (segment) solution
    var S_PSEG = HEAD + COMMON + "uniform sampler2D uSegIdx, uPi;\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  if (fluid(c) < 0.5) { o = vec4(0.0); return; }\n" +
        "  int k = int(texelFetch(uSegIdx, c, 0).x + 0.5) - 1;\n" +
        "  o = vec4(k >= 0 ? texelFetch(uPi, ivec2(k % " + SEGW + ", k / " + SEGW + "), 0).x : 0.0, 0.0, 0.0, 1.0); }";

    var S_JACOBI = HEAD + COMMON + "uniform sampler2D uP, uRhs;\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  if (fluid(c) < 0.5) { o = vec4(0.0); return; }\n" +
        "  float s = 0.0, n = 0.0; ivec2 d[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));\n" +
        "  for (int k = 0; k < 4; k++) { ivec2 q = c + d[k]; if (fluid(q) > 0.5) { s += texelFetch(uP, q, 0).x; n += 1.0; } }\n" +
        "  o = vec4(n > 0.0 ? (s - texelFetch(uRhs, c, 0).x) / n : 0.0, 0.0, 0.0, 1.0); }";

    var S_GRAD = HEAD + COMMON + VELFN + "uniform sampler2D uP;\n" +
        "float P(ivec2 c){ return texelFetch(uP, c, 0).x; }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  float nu = 0.0, nv = 0.0;\n" +
        "  if (openU(c)) nu = U(c) - (P(c) - P(c - ivec2(1,0)));\n" +
        "  if (openV(c)) nv = Vf(c) - (P(c) - P(c - ivec2(0,1)));\n" +
        "  o = vec4(nu, nv, 0.0, 1.0); }";

    // dye (red channel: left tree, green channel: right tree)
    var S_DYE = HEAD + COMMON + VELFN + "uniform sampler2D uDye; uniform vec2 uInj; uniform float uDt, uDecay, uDiff;\n" +
        "vec2 cv(ivec2 c){ c = clamp(c, ivec2(0), SZ - 1); if (fluid(c) < 0.5) return vec2(0.0); return vec2(0.5 * (U(c) + U(c + ivec2(1,0))), 0.5 * (Vf(c) + Vf(c + ivec2(0,1)))); }\n" +
        "vec2 bil(vec2 p){ vec2 q = p - 0.5; ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);\n" +
        "  return mix(mix(cv(i), cv(i + ivec2(1,0)), f.x), mix(cv(i + ivec2(0,1)), cv(i + ivec2(1,1)), f.x), f.y); }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy); vec4 g = texelFetch(uGeo, c, 0);\n" +
        "  if (fluid(c) < 0.5) { o = vec4(0.0); return; }\n" +
        "  vec2 mid = vec2(c) + 0.5 - 0.5 * uDt * cv(c);\n" +
        "  vec2 d = texture(uDye, (vec2(c) + 0.5 - uDt * bil(mid)) / vec2(SZ)).rg;\n" +
        "  vec2 nb = vec2(0.0); float n = 0.0; ivec2 e[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));\n" +
        "  for (int k = 0; k < 4; k++) { if (fluid(c + e[k]) > 0.5) { nb += texelFetch(uDye, c + e[k], 0).rg; n += 1.0; } }\n" +
        "  d = mix(d, n > 0.0 ? nb / n : d, uDiff) * uDecay;\n" +
        "  if (g.r > 0.0) d += (g.b < 0.5 ? vec2(uInj.x, 0.0) : vec2(0.0, uInj.y));\n" +
        "  o = vec4(d, 0.0, 1.0); }";

    // smoothed pressure per unit time, for display
    var S_PD = HEAD + "uniform sampler2D uP, uPd; uniform float uInvDt, uMixF;\n" +
        "void main(){ ivec2 c = ivec2(gl_FragCoord.xy); o = vec4(mix(texelFetch(uPd, c, 0).x, texelFetch(uP, c, 0).x * uInvDt, uMixF), 0.0, 0.0, 1.0); }";

    // slowly decaying peak of |pressure| around each ostium (2x1 target), used to scale the pressure view
    var S_PEAK = HEAD + COMMON + "uniform sampler2D uPd, uPrev; uniform vec4 uRoot; uniform vec2 uRad;\nconst int WIN = " + WIN + ";\n" +
        "void main(){ SZ = textureSize(uGeo, 0); int t = int(gl_FragCoord.x); vec2 rc = t == 0 ? uRoot.xy : uRoot.zw; float rad = (t == 0 ? uRad.x : uRad.y) * 1.6; float m = 0.0;\n" +
        "  for (int dy = -WIN; dy <= WIN; dy++) for (int dx = -WIN; dx <= WIN; dx++) {\n" +
        "    if (float(dx * dx + dy * dy) > rad * rad) continue;\n" +
        "    ivec2 c = ivec2(rc) + ivec2(dx, dy); if (fluid(c) < 0.5) continue;\n" +
        "    m = max(m, abs(texelFetch(uPd, c, 0).x)); }\n" +
        "  o = vec4(max(m, texelFetch(uPrev, ivec2(t, 0), 0).x * 0.996), 0.0, 0.0, 1.0); }";

    var S_SHOW = HEAD + "uniform sampler2D uDye, uMask, uGeo, uObst, uPd, uPeak; uniform vec2 uBeat; uniform vec3 uObstCol; uniform int uView;\n" +
        "vec3 pcol(float v){ vec3 base = vec3(0.2, 0.19, 0.3), neg = vec3(0.18, 0.45, 0.95), p0 = vec3(1.0, 0.45, 0.1), p1 = vec3(1.0, 0.92, 0.45);\n" +
        "  if (v < 0.0) return mix(base, neg, clamp(-v, 0.0, 1.0));\n" +
        "  return mix(mix(base, p0, clamp(v * 1.6, 0.0, 1.0)), p1, clamp((v - 0.55) * 2.2, 0.0, 1.0)); }\n" +
        "void main(){\n" +
        "  vec2 uv = vUv; ivec2 sz = textureSize(uGeo, 0); ivec2 c = clamp(ivec2(uv * vec2(sz)), ivec2(0), sz - 1);\n" +
        "  float b = texelFetch(uGeo, c, 0).b < 0.5 ? uBeat.x : uBeat.y;\n" +
        "  float m = smoothstep(0.35, 0.65, texture(uMask, uv).r);\n" +
        "  vec3 bg = vec3(0.07, 0.063, 0.11), vessel = vec3(0.16, 0.15, 0.22), col;\n" +
        "  if (uView == 0) {\n" +
        "    vec2 d = texture(uDye, uv).rg;\n" +
        "    vec3 cL = vec3(0.25, 0.62, 1.0), cR = vec3(1.0, 0.28, 0.33);\n" +
        "    vec3 glow = cL * (1.0 - exp(-1.2 * d.r)) + cR * (1.0 - exp(-1.2 * d.g));\n" +
        "    glow += vec3(1.0) * smoothstep(2.5, 7.0, d.r + d.g) * 0.2;\n" +
        "    glow *= 0.8 + 0.35 * b;\n" +
        "    col = bg + m * (vessel + 0.06 * b - bg) + m * glow * 1.1;\n" +
        "  } else {\n" +
        "    float scale = max(max(texelFetch(uPeak, ivec2(0, 0), 0).x, texelFetch(uPeak, ivec2(1, 0), 0).x), 1e-6);\n" +
        "    col = bg + m * (pcol(texture(uPd, uv).r / scale) - bg);\n" +
        "  }\n" +
        "  float ob = texelFetch(uObst, c, 0).r;\n" +
        "  col = mix(col, uObstCol * (0.9 + 0.1 * b), ob);\n" +
        "  o = vec4(col, 1.0); }";

    var progs = {}, TEX = {}, pool, pres, dye, pd, peak, rhsRT, segE, vao, cur, piData = new Float32Array(SEGW * SEGH), readBuf = new Float32Array(SEGW * SEGH * 4);
    function makeTex(w, h, internal, format, type, filter, data) {
        var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
        return t;
    }
    function makeRT(w, h, half, linear) {
        var tex = half ? makeTex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, linear ? gl.LINEAR : gl.NEAREST) : makeTex(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
        var fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex: tex, fbo: fbo, w: w, h: h };
    }
    function makePair(w, h, half, linear) { var a = makeRT(w, h, half, linear), b = makeRT(w, h, half, linear); return { a: a, b: b, swap: function () { var t = this.a; this.a = this.b; this.b = t; } }; }
    function use(pg) { gl.useProgram(pg.p); return pg; }
    function bindTex(pg, name, unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(pg.u[name], unit); }
    function drawTo(rt, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fbo : null); gl.viewport(0, 0, rt ? rt.w : w, rt ? rt.h : h); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    function geoUnits(pg) { bindTex(pg, "uGeo", 0, TEX.geo); bindTex(pg, "uObst", 1, TEX.obst); }

    var rootUniform = [0, 0, 0, 0], radUniform = [3, 3];
    function setRoots(f) {
        ["L", "R"].forEach(function (side, i) {
            var r = f.root[side];
            if (r >= 0) { rootUniform[i * 2] = (r % W) + 0.5; rootUniform[i * 2 + 1] = (H - 1 - ((r / W) | 0)) + 0.5; }
            radUniform[i] = f.rr[side];
        });
    }
    function makeR32(w, h, data) { return makeTex(w, h, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, data); }
    function uploadR32(tex, w, h, data) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, data); }
    function uploadSegments() {
        var a = segmentArrays(G);
        uploadR32(TEX.segIdx, W, H, a.idx); uploadR32(TEX.members, MEMW, MEMH, a.mem);
        gl.bindTexture(gl.TEXTURE_2D, TEX.info); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SEGW, SEGH, gl.RGBA, gl.FLOAT, a.info);
        piPrev = null;
    }

    function setupGL() {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        TEX.geo = makeTex(W, H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, geoData);
        var a = segmentArrays(G);
        TEX.segIdx = makeR32(W, H, a.idx); TEX.members = makeR32(MEMW, MEMH, a.mem); TEX.pi = makeR32(SEGW, SEGH, null);
        TEX.info = makeTex(SEGW, SEGH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, a.info);
        TEX.obst = makeTex(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, flipU8(obst, 255));
        TEX.mask = makeTex(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, flipU8(baseMask, 255));
        progs.advect = prog(S_ADVECT); progs.diffuse = prog(S_DIFFUSE); progs.div = prog(S_DIV); progs.segsum = prog(S_SEGSUM); progs.pseg = prog(S_PSEG);
        progs.jacobi = prog(S_JACOBI); progs.grad = prog(S_GRAD); progs.dye = prog(S_DYE); progs.pd = prog(S_PD); progs.peak = prog(S_PEAK); progs.show = prog(S_SHOW);
        pool = [makeRT(W, H), makeRT(W, H), makeRT(W, H)]; cur = pool[0];
        pres = makePair(W, H); rhsRT = makeRT(W, H); segE = makeRT(SEGW, SEGH);
        dye = makePair(W, H, true, true); pd = makePair(W, H, true, true); peak = makePair(2, 1);
        vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        canvas.width = W * 2; canvas.height = H * 2; canvas.style.aspectRatio = W + " / " + H;
        resetFlow();
    }
    function clearRT(rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    function resetFlow() {
        pool.forEach(clearRT); [pres.a, pres.b, rhsRT, segE, dye.a, dye.b, pd.a, pd.b, peak.a, peak.b].forEach(clearRT);
        piPrev = null;
        phaseL = 0;
    }
    function uploadObst() { gl.bindTexture(gl.TEXTURE_2D, TEX.obst); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.UNSIGNED_BYTE, flipU8(obst, 255)); }
    function uploadGeo() { gl.bindTexture(gl.TEXTURE_2D, TEX.geo); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, geoData); }

    // ---- 4. one time step
    var bpm = BPM_DEFAULT, pressureKnob = PRESSURE_DEFAULT, view = 0, phaseL = 0, phaseR = 0;
    function step(dt) {
        var q = K2 * pressureKnob, qL = q * (Q_BASE + Q_PEAK * beat(phaseL)), qR = q * (Q_BASE + Q_PEAK * beat(phaseR));
        var pg, i, free = pool.filter(function (r) { return r !== cur; });
        // 1. advect the velocity
        pg = use(progs.advect); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); gl.uniform1f(pg.u.uDt, dt);
        var adv = free[0]; drawTo(adv);
        // 2. viscous diffusion (implicit Jacobi sweeps, no-slip)
        pg = use(progs.diffuse); geoUnits(pg); bindTex(pg, "uV0", 2, adv.tex); gl.uniform1f(pg.u.uA, NU * dt);
        var targets = [free[1], cur], k = adv;
        for (i = 0; i < DIFFUSE; i++) { var out = targets[i % 2]; bindTex(pg, "uVk", 3, k.tex); drawTo(out); k = out; }
        cur = k; free = pool.filter(function (r) { return r !== cur; });
        // 3. right-hand side of the pressure equation
        pg = use(progs.div); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); gl.uniform2f(pg.u.uQ, qL, qR); drawTo(rhsRT);
        // 4. coarse pressure: sum of the residual per tree layer (GPU), small graph solve (CPU), seed the pressure (GPU)
        if (G.n > 0) {
            pg = use(progs.segsum); bindTex(pg, "uRhs", 0, rhsRT.tex); bindTex(pg, "uInfo", 1, TEX.info); bindTex(pg, "uMembers", 2, TEX.members); gl.uniform1i(pg.u.uN, G.n);
            drawTo(segE);
            var rows = Math.ceil(G.n / SEGW);
            gl.bindFramebuffer(gl.FRAMEBUFFER, segE.fbo); gl.readPixels(0, 0, SEGW, rows, gl.RGBA, gl.FLOAT, readBuf);
            var bs = new Float64Array(G.n);
            for (i = 0; i < G.n; i++) bs[i] = -readBuf[i * 4];
            var pi = Core.solveSegments(G, bs, piPrev, 60, 1e-18); piPrev = pi;
            piData.fill(0); piData.set(pi);
            uploadR32(TEX.pi, SEGW, rows, piData.subarray(0, SEGW * rows));
        }
        pg = use(progs.pseg); geoUnits(pg); bindTex(pg, "uSegIdx", 2, TEX.segIdx); bindTex(pg, "uPi", 3, TEX.pi); drawTo(pres.a);
        // 5. local Jacobi sweeps
        pg = use(progs.jacobi); geoUnits(pg); bindTex(pg, "uRhs", 3, rhsRT.tex);
        for (i = 0; i < JACOBI; i++) { bindTex(pg, "uP", 2, pres.a.tex); drawTo(pres.b); pres.swap(); }
        // 6. subtract the pressure gradient on the faces
        pg = use(progs.grad); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); bindTex(pg, "uP", 3, pres.a.tex);
        var nxt = free[0]; drawTo(nxt); cur = nxt;
        // 7. dye
        pg = use(progs.dye); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); bindTex(pg, "uDye", 3, dye.a.tex);
        gl.uniform1f(pg.u.uDt, dt); gl.uniform1f(pg.u.uDecay, Math.exp(-DYE_DECAY * dt)); gl.uniform1f(pg.u.uDiff, DYE_DIFFUSION);
        gl.uniform2f(pg.u.uInj, DYE_RATE * bolus(phaseL) * dt, DYE_RATE * bolus(phaseR) * dt);
        drawTo(dye.b); dye.swap();
        // 8. pressure for display and its peak
        pg = use(progs.pd); bindTex(pg, "uP", 0, pres.a.tex); bindTex(pg, "uPd", 1, pd.a.tex); gl.uniform1f(pg.u.uInvDt, 1 / dt); gl.uniform1f(pg.u.uMixF, 0.15);
        drawTo(pd.b); pd.swap();
        pg = use(progs.peak); geoUnits(pg); bindTex(pg, "uPd", 2, pd.a.tex); bindTex(pg, "uPrev", 3, peak.a.tex);
        gl.uniform4f(pg.u.uRoot, rootUniform[0], rootUniform[1], rootUniform[2], rootUniform[3]); gl.uniform2f(pg.u.uRad, radUniform[0], radUniform[1]);
        drawTo(peak.b); peak.swap();
        // heartbeat
        var period = 60 / bpm; phaseL = (phaseL + dt / period) % 1;
        phaseR = (((phaseL - rightDelay(bpm) / period) % 1) + 1) % 1;
    }
    function show() {
        var pg = use(progs.show); geoUnits(pg);
        bindTex(pg, "uDye", 2, dye.a.tex); bindTex(pg, "uMask", 3, TEX.mask); bindTex(pg, "uPd", 4, pd.a.tex); bindTex(pg, "uPeak", 5, peak.a.tex);
        gl.uniform2f(pg.u.uBeat, beat(phaseL), beat(phaseR)); gl.uniform3f(pg.u.uObstCol, OBSTACLE_COLOR[0], OBSTACLE_COLOR[1], OBSTACLE_COLOR[2]); gl.uniform1i(pg.u.uView, view);
        drawTo(null, canvas.width, canvas.height);
    }

    // ---- 5. obstacles: 2x2 rigid blocks painted with the pointer
    var rebuildTimer = 0, painting = false;
    function paintAt(e) {
        var rect = canvas.getBoundingClientRect();
        var x = Math.floor((e.clientX - rect.left) / rect.width * W) - ((OBSTACLE_SIZE / 2) | 0), y = Math.floor((e.clientY - rect.top) / rect.height * H) - ((OBSTACLE_SIZE / 2) | 0);
        var v = e.shiftKey ? 0 : 1, changed = false;
        for (var dy = 0; dy < OBSTACLE_SIZE; dy++) for (var dx = 0; dx < OBSTACLE_SIZE; dx++) {
            var xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            var i = yy * W + xx;
            if (!baseMask[i] || obst[i] === v) continue;
            obst[i] = v; changed = true;
        }
        if (changed) { uploadObst(); if (!running) show(); scheduleRebuild(); }
    }
    function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildFlowField, 180); }
    function rebuildFlowField() {
        var r = computeGeometry(); if (!r) return;
        field = r.f; G = r.G; geoData = geoArray(field); uploadGeo(); uploadSegments(); setRoots(field); if (!running) show();
    }
    function clearObstacles() { obst.fill(0); uploadObst(); rebuildFlowField(); if (!running) show(); }

    canvas.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        painting = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        paintAt(e);
    });
    canvas.addEventListener("pointermove", function (e) { if (painting) paintAt(e); });
    ["pointerup", "pointercancel"].forEach(function (n) { canvas.addEventListener(n, function () { painting = false; }); });

    // ---- 6. controls and loop
    var $ = function (id) { return document.getElementById(id); };
    var playBtn = $("ns-play"), resetBtn = $("ns-reset"), clearBtn = $("ns-clear"), viewBtn = $("ns-view"), fullBtn = $("ns-full");
    var bpmIn = $("ns-bpm"), bpmVal = $("ns-bpm-val"), presIn = $("ns-pressure"), presVal = $("ns-pressure-val"), legend = $("ns-legend");
    var running = false, userPaused = false, last = 0, raf = 0, frames = 0, accum = 0, adjustments = 0;
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function frame(now) {
        raf = 0; if (!running) return;
        var dt = Math.min((now - last) / 1000, 1 / 30); last = now;
        step(dt); show();
        // slow device: fewer solver sweeps
        if (++frames > 30) { accum += dt; if (frames === 150) { var avg = accum / 120; if (avg > 0.026 && adjustments < 2) { JACOBI = Math.max(10, JACOBI - 10); DIFFUSE = Math.max(2, DIFFUSE - 2); adjustments++; } frames = 0; accum = 0; } }
        raf = requestAnimationFrame(frame);
    }
    function setRunning(r) { running = r; if (playBtn) playBtn.textContent = r ? "Pause" : "Play"; if (r) { last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); } }
    function fit() {
        if (document.fullscreenElement === figure) canvas.style.width = Math.floor(Math.min(window.innerWidth, (window.innerHeight - 170) * W / H)) + "px";
        else canvas.style.width = "";
    }

    if (bpmIn) { bpmIn.min = BPM_MIN; bpmIn.max = BPM_MAX; bpmIn.step = 1; bpmIn.value = bpm; if (bpmVal) bpmVal.textContent = bpm + " bpm";
        bpmIn.addEventListener("input", function () { bpm = parseFloat(bpmIn.value); if (bpmVal) bpmVal.textContent = Math.round(bpm) + " bpm"; }); }
    if (presIn) { presIn.min = PRESSURE_MIN; presIn.max = PRESSURE_MAX; presIn.step = (PRESSURE_MAX - PRESSURE_MIN) / 100; presIn.value = pressureKnob; if (presVal) presVal.textContent = pressureKnob.toFixed(2);
        presIn.addEventListener("input", function () { pressureKnob = parseFloat(presIn.value); if (presVal) presVal.textContent = pressureKnob.toFixed(2); }); }
    if (playBtn) playBtn.addEventListener("click", function () { userPaused = running; setRunning(!running); });
    if (resetBtn) resetBtn.addEventListener("click", function () { resetFlow(); show(); });
    if (clearBtn) clearBtn.addEventListener("click", clearObstacles);
    if (viewBtn) viewBtn.addEventListener("click", function () {
        view = view ? 0 : 1; viewBtn.textContent = view ? "View: Pressure" : "View: Flow"; if (legend) legend.style.display = view ? "" : "none"; if (!running) show();
    });
    if (fullBtn && document.fullscreenEnabled) {
        fullBtn.addEventListener("click", function () { if (document.fullscreenElement) document.exitFullscreen(); else figure.requestFullscreen(); });
        document.addEventListener("fullscreenchange", function () { fullBtn.textContent = document.fullscreenElement === figure ? "Exit full screen" : "Full screen"; fit(); if (TEX.geo) show(); });
        window.addEventListener("resize", fit);
    } else if (fullBtn) fullBtn.style.display = "none";
    if (legend) legend.style.display = "none";

    // ---- 7. start
    function begin(model) {
        trees = model.trees; W = model.W; H = model.H; N = W * H;
        edt.L = Core.chamfer(trees.L, W, H); edt.R = Core.chamfer(trees.R, W, H);
        ["L", "R"].forEach(function (side) {
            var m = trees[side], mk = model.markers[side];
            if (mk) rootStatic[side] = Core.nearestIn(m, W, H, mk[0], mk[1]);
            else { var best = -1, bi = 0; for (var i = 0; i < N; i++) if (m[i] && edt[side][i] > best) { best = edt[side][i]; bi = i; } rootStatic[side] = bi; }
        });
        baseMask = new Uint8Array(N); for (var i = 0; i < N; i++) baseMask[i] = trees.L[i] || trees.R[i] ? 1 : 0;
        obst = new Uint8Array(N);
        var r = computeGeometry();
        if (!r) { bail("The geometry is too large for this simulation."); return; }
        field = r.f; G = r.G; geoData = geoArray(field);
        try { setupGL(); } catch (err) { if (window.console) console.error(err); bail("The simulation could not start on this device."); return; }
        setRoots(field);
        var params = new URLSearchParams(location.search), pre = parseInt(params.get("nssteps"), 10);
        window.__ns = { paint: function (cx, cy) { paintAt({ clientX: cx, clientY: cy, shiftKey: false }); }, view: function (v) { view = v; show(); }, step: function (n) { for (var k = 0; k < n; k++) step(1 / 60); show(); }, segments: G.n };
        if (!isNaN(pre)) { for (var k = 0; k < pre; k++) step(1 / 60); show(); userPaused = true; return; }
        if (reduced) { for (var j = 0; j < 240; j++) step(1 / 60); show(); userPaused = true; return; }
        show();
        if ("IntersectionObserver" in window) {
            new IntersectionObserver(function (e) { if (e[0].isIntersecting && !userPaused) setRunning(true); if (!e[0].isIntersecting) setRunning(false); }, { threshold: 0.3 }).observe(canvas);
        } else setRunning(true);
    }

    if (SRC_L && SRC_R) loadImage(SRC_L, function (a) { loadImage(SRC_R, function (b) { begin(buildTrees([binarize(a), binarize(b)], ["L", "R"])); }); });
    else bail("No mask images configured.");
})(typeof window !== "undefined" ? window : this);
