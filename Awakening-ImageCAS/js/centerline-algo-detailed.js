// Detailed 2D version of the centerline extraction, on a synthetic vessel tree.
// Follows the real procedure step by step (1 voxel = 0.5 mm):
// dilation, ostium/gap bridging, wall distance, centred cost, two minimal-cost fronts,
// farthest-point tree growing (two passes), tip trimming, Gaussian smoothing, node typing.
// Pure functions (no DOM): build() returns the data of every stage.
(function (root) {
    "use strict";

    var W = 200, H = 130, N = W * H;
    var INF = 1e9, SQ2 = Math.SQRT2;
    var MM = 0.5;                       // mm per voxel

    // parameters (mm converted to voxels)
    var P = 4;                          // cost exponent
    var HIGH = 1000;                    // cost factor of dilation / bridging voxels
    var GAP_MAX = 10 / MM;              // largest gap that is bridged (10 mm)
    var MIN_BRANCH = 5 / MM;            // a branch must add at least 5 mm
    var TRIM = 2 / MM;                  // tip trimming, 2 mm
    var SIGMA = 2 / MM;                 // Gaussian smoothing, sigma = 2 mm
    var CAP = 1.2;                      // second pass: D capped at 1.2 x local radius
    var WIN = 5 / MM;                   // window to estimate the local radius (5 mm)

    // ---- synthetic coronary mask (the aorta is context, not part of the mask)
    var AORTA = { x: 100, y: 26, r: 17 };
    var VESSELS = [
        [[79, 38, 3.6], [68, 47, 3.4], [58, 64, 3.0], [52, 88, 2.6], [56, 116, 2.0]],
        [[58, 64, 2.6], [38, 76, 2.2], [22, 98, 1.7]],
        [[122, 37, 4.4], [128, 43, 4.2], [134, 50, 3.6]],
        [[134, 50, 3.6], [150, 64, 3.0], [158, 90, 2.6], [156, 106, 2.3], [152, 122, 1.9]],
        [[134, 50, 3.2], [152, 48, 2.8], [172, 58, 2.2], [184, 82, 1.8]],
        [[152, 68, 2.2], [170, 76, 1.8], [182, 98, 1.5]],
        [[53, 100, 1.6], [44, 100, 1.4]]                 // short surface irregularity (spur)
    ];
    var BLOBS = [[138, 52, 6.6], [149, 80, 6.5]];                        // bulky bifurcation
    var OSTIA = [
        { side: "R", toward: [79, 38] },
        { side: "L", toward: [122, 37] }
    ];
    // defects: a resampling break (2 voxels) and a short interruption (a severe stenosis)
    var BREAK = { x0: 44, x1: 64, y: 80, half: 0.9 };
    var STENOSIS = { x0: 140, x1: 170, y0: 96, y1: 106 };

    function segDist(px, py, a, b) {
        var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        var t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return { d: Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy), t: t };
    }

    function rasterize() {
        var mask = new Uint8Array(N), aorta = new Uint8Array(N);
        var x, y, i, k, s;
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            var px = x + 0.5, py = y + 0.5;
            i = y * W + x;
            if (Math.hypot(px - AORTA.x, py - AORTA.y) <= AORTA.r) aorta[i] = 1;
            for (k = 0; k < BLOBS.length; k++) {
                if (Math.hypot(px - BLOBS[k][0], py - BLOBS[k][1]) <= BLOBS[k][2]) mask[i] = 1;
            }
            for (k = 0; k < VESSELS.length && !mask[i]; k++) {
                var pl = VESSELS[k];
                for (s = 0; s < pl.length - 1; s++) {
                    var q = segDist(px, py, pl[s], pl[s + 1]);
                    if (q.d <= pl[s][2] + (pl[s + 1][2] - pl[s][2]) * q.t) { mask[i] = 1; break; }
                }
            }
        }
        var breakPix = [], gapPix = [];
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            i = y * W + x;
            if (!mask[i]) continue;
            if (x >= BREAK.x0 && x <= BREAK.x1 && Math.abs(y + 0.5 - BREAK.y) <= BREAK.half) { mask[i] = 0; breakPix.push(i); }
            else if (x >= STENOSIS.x0 && x <= STENOSIS.x1 && y >= STENOSIS.y0 && y <= STENOSIS.y1) { mask[i] = 0; gapPix.push(i); }
        }
        return { mask: mask, aorta: aorta, breakPix: breakPix, gapPix: gapPix };
    }

    function dilate(mask) {
        var out = new Uint8Array(mask), x, y, i, dx, dy;
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            i = y * W + x;
            if (mask[i]) continue;
            for (dy = -1; dy <= 1 && !out[i]; dy++) for (dx = -1; dx <= 1; dx++) {
                var xx = x + dx, yy = y + dy;
                if (xx >= 0 && yy >= 0 && xx < W && yy < H && mask[yy * W + xx]) { out[i] = 1; break; }
            }
        }
        return out;
    }

    function wallDistance(mask) {
        var d = new Float32Array(N), x, y, i;
        for (i = 0; i < N; i++) d[i] = mask[i] ? INF : 0;
        function relax(i, j, w) { if (d[j] + w < d[i]) d[i] = d[j] + w; }
        for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
            i = y * W + x; if (!mask[i]) continue;
            if (x === 0 || y === 0) d[i] = 1;
            if (x > 0) relax(i, i - 1, 1);
            if (y > 0) relax(i, i - W, 1);
            if (x > 0 && y > 0) relax(i, i - W - 1, SQ2);
            if (x < W - 1 && y > 0) relax(i, i - W + 1, SQ2);
        }
        for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) {
            i = y * W + x; if (!mask[i]) continue;
            if (x === W - 1 || y === H - 1) d[i] = Math.min(d[i], 1);
            if (x < W - 1) relax(i, i + 1, 1);
            if (y < H - 1) relax(i, i + W, 1);
            if (x < W - 1 && y < H - 1) relax(i, i + W + 1, SQ2);
            if (x > 0 && y < H - 1) relax(i, i + W - 1, SQ2);
        }
        return d;
    }

    function Heap() { this.k = []; this.v = []; }
    Heap.prototype.push = function (key, val) {
        var k = this.k, v = this.v, i = k.length;
        k.push(key); v.push(val);
        while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
        k[i] = key; v[i] = val;
    };
    Heap.prototype.pop = function () {
        var k = this.k, v = this.v, tk = k[0], tv = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
        if (n) {
            var i = 0;
            for (;;) {
                var c = 2 * i + 1; if (c >= n) break;
                if (c + 1 < n && k[c + 1] < k[c]) c++;
                if (k[c] >= lk) break;
                k[i] = k[c]; v[i] = v[c]; i = c;
            }
            k[i] = lk; v[i] = lv;
        }
        return { key: tk, val: tv };
    };

    var NX = [1, -1, 0, 0, 1, 1, -1, -1], NY = [0, 0, 1, -1, 1, -1, 1, -1];

    // Dijkstra over the domain; cost === null gives unit cost
    function dijkstra(domain, cost, src) {
        var dist = new Float64Array(N).fill(INF), parent = new Int32Array(N).fill(-1);
        var heap = new Heap();
        dist[src] = 0; heap.push(0, src);
        var size = 1;
        while (size > 0) {
            var top = heap.pop(); size--;
            var u = top.val;
            if (top.key > dist[u]) continue;
            var ux = u % W, uy = (u / W) | 0;
            for (var n = 0; n < 8; n++) {
                var vx = ux + NX[n], vy = uy + NY[n];
                if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
                var v = vy * W + vx;
                if (!domain[v]) continue;
                var len = n < 4 ? 1 : SQ2;
                var nd = dist[u] + (cost ? len * 0.5 * (cost[u] + cost[v]) : len);
                if (nd < dist[v]) { dist[v] = nd; parent[v] = u; heap.push(nd, v); size++; }
            }
        }
        return { dist: dist, parent: parent };
    }

    function centredCost(D, extra, cap) {
        var c = new Float64Array(N);
        for (var i = 0; i < N; i++) {
            var d = cap ? Math.min(D[i], cap[i]) : D[i];
            c[i] = Math.pow(d + 0.5, -P) * (extra[i] ? HIGH : 1);
        }
        return c;
    }

    function line(a, b) {      // voxels of the straight segment a -> b (pixel indices)
        var x0 = a % W, y0 = (a / W) | 0, x1 = b % W, y1 = (b / W) | 0, out = [];
        var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy;
        for (;;) {
            out.push(y0 * W + x0);
            if (x0 === x1 && y0 === y1) break;
            var e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
        return out;
    }

    function pixLen(path, k) {
        var a = path[k - 1], b = path[k];
        return (a % W !== b % W && ((a / W) | 0) !== ((b / W) | 0)) ? SQ2 : 1;
    }

    // ---- tree growing: farthest uncovered voxel, minimal path, keep if >= 5 mm outside the covered region
    function growTree(domain, tree, G, pred, D, src) {
        var covered = new Uint8Array(N), inTree = new Uint8Array(N);
        inTree[src] = 1;
        var events = [], pix = tree;
        for (var it = 0; it < 80; it++) {
            var best = -1, bg = -1, i;
            for (var q = 0; q < pix.length; q++) {
                i = pix[q];
                if (!covered[i] && G[i] < INF && G[i] > bg) { bg = G[i]; best = i; }
            }
            if (best < 0) break;
            var path = [best], p = best;
            while (!inTree[p] && pred[p] >= 0) { p = pred[p]; path.push(p); }
            var added = 0;
            for (var k = 1; k < path.length; k++) if (!covered[path[k - 1]]) added += pixLen(path, k);
            var newCov = [];
            for (var pi = 0; pi < path.length; pi++) {
                var c = path[pi], cx = c % W, cy = (c / W) | 0;
                var R = 1.5 * Math.max(D[c], 1) + 2;      // 1.5 r + 1 mm
                for (var y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, Math.ceil(cy + R)); y++) {
                    for (var x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, Math.ceil(cx + R)); x++) {
                        var j = y * W + x;
                        if (covered[j] || !domain[j] || (x - cx) * (x - cx) + (y - cy) * (y - cy) > R * R) continue;
                        // the straight segment to the path must stay inside the mask
                        var ok = true, ln = line(j, c);
                        for (var t = 0; t < ln.length; t++) if (!domain[ln[t]]) { ok = false; break; }
                        if (ok) { covered[j] = 1; newCov.push(j); }
                    }
                }
            }
            var keep = added >= MIN_BRANCH;
            if (keep) path.forEach(function (v) { inTree[v] = 1; });
            events.push({ kind: keep ? "keep" : "discard", tip: best, path: path, added: added, G: G[best], newCov: newCov });
        }
        return { events: events, inTree: inTree };
    }

    function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }

    function build() {
        var r = rasterize();
        var mask0 = r.mask;
        var maskD = dilate(mask0);
        var extra = new Uint8Array(N);      // voxels traversable only at a high cost
        var i, j;
        for (i = 0; i < N; i++) extra[i] = maskD[i] && !mask0[i] ? 1 : 0;
        var dilated = new Uint8Array(extra);
        var D = wallDistance(maskD);

        // ostia: smallest ball reaching the mask
        var domain = new Uint8Array(maskD);
        var ostia = OSTIA.map(function (o) {
            var dx = o.toward[0] - AORTA.x, dy = o.toward[1] - AORTA.y, l = Math.hypot(dx, dy);
            var pos = [AORTA.x + dx / l * AORTA.r, AORTA.y + dy / l * AORTA.r];
            var rb = INF;
            for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
                if (maskD[y * W + x]) rb = Math.min(rb, Math.hypot(x + 0.5 - pos[0], y + 0.5 - pos[1]));
            }
            var ball = [];
            for (var y2 = 0; y2 < H; y2++) for (var x2 = 0; x2 < W; x2++) {
                var k = y2 * W + x2;
                if (!maskD[k] && Math.hypot(x2 + 0.5 - pos[0], y2 + 0.5 - pos[1]) <= rb + 0.7) { ball.push(k); extra[k] = 1; domain[k] = 1; }
            }
            return { side: o.side, pos: pos, radius: rb, ball: ball, src: Math.floor(pos[1]) * W + Math.floor(pos[0]) };
        });
        ostia.forEach(function (o) { if (!domain[o.src]) { domain[o.src] = 1; extra[o.src] = 1; o.ball.push(o.src); } });

        // bridge gaps of at most 10 mm between pieces not reached from the ostia
        function flood() {
            var seen = new Uint8Array(N), stack = [];
            ostia.forEach(function (o) { seen[o.src] = 1; stack.push(o.src); });
            while (stack.length) {
                var u = stack.pop(), ux = u % W, uy = (u / W) | 0;
                for (var n = 0; n < 8; n++) {
                    var vx = ux + NX[n], vy = uy + NY[n];
                    if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
                    var v = vy * W + vx;
                    if (domain[v] && !seen[v]) { seen[v] = 1; stack.push(v); }
                }
            }
            return seen;
        }
        var bridges = [];
        for (var round = 0; round < 6; round++) {
            var reached = flood(), pieces = [], label = new Int32Array(N).fill(-1);
            for (i = 0; i < N; i++) {
                if (!domain[i] || reached[i] || label[i] >= 0) continue;
                var comp = [i], st = [i]; label[i] = pieces.length;
                while (st.length) {
                    var u = st.pop(), ux = u % W, uy = (u / W) | 0;
                    for (var n = 0; n < 8; n++) {
                        var vx = ux + NX[n], vy = uy + NY[n];
                        if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
                        var v = vy * W + vx;
                        if (domain[v] && !reached[v] && label[v] < 0) { label[v] = pieces.length; comp.push(v); st.push(v); }
                    }
                }
                pieces.push(comp);
            }
            if (!pieces.length) break;
            var rp = [];
            for (i = 0; i < N; i++) if (reached[i] && maskD[i]) rp.push(i);
            var joined = false;
            pieces.forEach(function (comp) {
                var bd = INF, ba = -1, bb = -1;
                comp.forEach(function (a) {
                    if (!maskD[a]) return;
                    var ax = a % W, ay = (a / W) | 0;
                    for (var q = 0; q < rp.length; q++) {
                        var b = rp[q], d = Math.hypot(ax - b % W, ay - ((b / W) | 0));
                        if (d < bd) { bd = d; ba = a; bb = b; }
                    }
                });
                if (bd <= GAP_MAX) {
                    var seg = line(ba, bb).filter(function (k) { return !domain[k]; });
                    seg.forEach(function (k) { domain[k] = 1; extra[k] = 1; });
                    bridges.push({ a: ba, b: bb, pix: seg });
                    joined = true;
                }
            });
            if (!joined) break;
        }

        // wall distance is zero on the voxels that were not in the dilated mask
        var cost = centredCost(D, extra, null);

        // two fronts from each ostium: unit cost (geodesic distance G) and centred cost (predecessor map)
        var fronts = ostia.map(function (o) {
            return { unit: dijkstra(domain, null, o.src), centred: dijkstra(domain, cost, o.src) };
        });
        // each voxel belongs to the ostium with the smaller geodesic distance
        var owner = new Int8Array(N).fill(-1);
        for (i = 0; i < N; i++) {
            if (!domain[i]) continue;
            var bestS = -1, bg = INF;
            for (var s = 0; s < ostia.length; s++) if (fronts[s].unit.dist[i] < bg) { bg = fronts[s].unit.dist[i]; bestS = s; }
            if (bestS >= 0) owner[i] = bestS;
        }
        var trees = ostia.map(function (o, s) {
            var list = [];
            for (var q = 0; q < N; q++) if (owner[q] === s && domain[q]) list.push(q);
            return list;
        });

        // pass 1
        var pass1 = ostia.map(function (o, s) {
            return growTree(domain, trees[s], fronts[s].unit.dist, fronts[s].centred.parent, D, o.src);
        });

        // pass 2: D capped at 1.2 x the local vessel radius (median of D over the first-pass tree within 5 mm)
        var cap = new Float32Array(N).fill(INF);
        ostia.forEach(function (o, s) {
            var tv = [];
            for (var q = 0; q < N; q++) if (pass1[s].inTree[q] && q !== o.src) tv.push(q);
            var rloc = tv.map(function (a) {
                var near = [];
                tv.forEach(function (b) {
                    if (Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0)) <= WIN) near.push(D[b]);
                });
                return median(near);
            });
            trees[s].forEach(function (v) {
                var bd = INF, bi = 0;
                for (var q = 0; q < tv.length; q++) {
                    var d = Math.hypot(v % W - tv[q] % W, ((v / W) | 0) - ((tv[q] / W) | 0));
                    if (d < bd) { bd = d; bi = q; }
                }
                cap[v] = CAP * rloc[bi];
            });
        });
        var cost2 = centredCost(D, extra, cap);
        var pass2 = ostia.map(function (o, s) {
            var f2 = dijkstra(domain, cost2, o.src);
            fronts[s].centred2 = f2;
            return growTree(domain, trees[s], fronts[s].unit.dist, f2.parent, D, o.src);
        });

        // ---- branches from the kept paths of the second pass
        var branches = [], owner2 = {};     // pixel -> {b, k}
        var rootRef = ostia.map(function (o, s) { return { root: s }; });
        var order = [];
        pass2.forEach(function (pp, s) {
            pp.events.forEach(function (ev, ei) { if (ev.kind === "keep") order.push({ s: s, ev: ev, ei: ei }); });
        });
        order.forEach(function (o) {
            var path = o.ev.path, joinPix = path[path.length - 1];
            var attach = joinPix === ostia[o.s].src ? rootRef[o.s] : (owner2[joinPix] ? { branch: owner2[joinPix].b, idx: owner2[joinPix].k } : rootRef[o.s]);
            var bi = branches.length;
            path.forEach(function (v, k) { if (!(v in owner2) && k < path.length - 1) owner2[v] = { b: bi, k: k }; });
            branches.push({
                side: ostia[o.s].side, tree: o.s, pix: path, attach: attach,
                raw: path.map(function (v) { return [v % W + 0.5, ((v / W) | 0) + 0.5, D[v]]; })
            });
        });

        // ---- tip trimming: 2 mm from every endpoint, never beyond a bifurcation
        branches.forEach(function (b, bi) {
            var minAttach = b.raw.length - 1;
            branches.forEach(function (c) { if (c.attach.branch === bi) minAttach = Math.min(minAttach, c.attach.idx); });
            var cut = 0, acc = 0;
            while (cut < minAttach - 1 && acc < TRIM) {
                acc += Math.hypot(b.raw[cut + 1][0] - b.raw[cut][0], b.raw[cut + 1][1] - b.raw[cut][1]);
                cut++;
            }
            b.cut = cut;
        });

        // ---- Gaussian smoothing along the arc length, branch after branch (parents first)
        function insideMask(x, y) { var xi = Math.floor(x), yi = Math.floor(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && domain[yi * W + xi]; }
        var maxDisp = 0;
        branches.forEach(function (b, bi) {
            var pts = b.raw.slice(b.cut).map(function (p) { return p.slice(); });
            // the junction is the (already smoothed) point of the parent
            if (b.attach.branch !== undefined) {
                var par = branches[b.attach.branch], pidx = b.attach.idx - par.cut;
                var pp = par.smooth[Math.max(0, pidx)];
                pts[pts.length - 1] = [pp[0], pp[1], pp[2]];
            } else {
                var o = ostia[b.tree];
                pts[pts.length - 1] = [o.pos[0], o.pos[1], pts[pts.length - 1][2]];
            }
            var s = [0];
            for (var k = 1; k < pts.length; k++) s.push(s[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
            var total = s[s.length - 1];
            // point-reflection padding at both ends
            var ext = [];
            for (k = pts.length - 1; k >= 1; k--) {
                if (s[k] > 3 * SIGMA) continue;
                ext.push({ s: -s[k], p: [2 * pts[0][0] - pts[k][0], 2 * pts[0][1] - pts[k][1], 2 * pts[0][2] - pts[k][2]] });
            }
            for (k = 0; k < pts.length; k++) ext.push({ s: s[k], p: pts[k] });
            var last = pts.length - 1;
            for (k = last - 1; k >= 0; k--) {
                if (total - s[k] > 3 * SIGMA) break;
                ext.push({ s: 2 * total - s[k], p: [2 * pts[last][0] - pts[k][0], 2 * pts[last][1] - pts[k][1], 2 * pts[last][2] - pts[k][2]] });
            }
            var sm = pts.map(function (p, kk) {
                var sx = 0, sy = 0, sr = 0, sw = 0;
                ext.forEach(function (e) {
                    var d = e.s - s[kk];
                    if (Math.abs(d) > 3 * SIGMA) return;
                    var w = Math.exp(-d * d / (2 * SIGMA * SIGMA));
                    sx += w * e.p[0]; sy += w * e.p[1]; sr += w * e.p[2]; sw += w;
                });
                var nx = sx / sw, ny = sy / sw;
                // never leave the mask: halve the displacement until inside
                var dx = nx - p[0], dy = ny - p[1], tries = 0;
                while (!insideMask(p[0] + dx, p[1] + dy) && tries < 6) { dx /= 2; dy /= 2; tries++; }
                if (!insideMask(p[0] + dx, p[1] + dy)) { dx = 0; dy = 0; }
                maxDisp = Math.max(maxDisp, Math.hypot(dx, dy));
                return [p[0] + dx, p[1] + dy, sr / sw];
            });
            b.pts = pts;            // trimmed, unsmoothed (junction snapped)
            b.smooth = sm;
        });

        // ---- nodes: ostium, segment, bifurcation, endpoint (by degree)
        var junctions = {};
        branches.forEach(function (b) {
            if (b.attach.branch !== undefined) junctions[b.attach.branch + ":" + Math.max(0, b.attach.idx - branches[b.attach.branch].cut)] = true;
        });
        branches.forEach(function (b, bi) {
            b.types = b.smooth.map(function (p, k) {
                if (k === 0) return "endpoint";
                if (k === b.smooth.length - 1) return b.attach.branch !== undefined ? "bifurcation" : "ostium";
                return junctions[bi + ":" + k] ? "bifurcation" : "segment";
            });
        });

        var maxG = 0;
        fronts.forEach(function (f) { for (var q = 0; q < N; q++) if (f.unit.dist[q] < INF && f.unit.dist[q] > maxG) maxG = f.unit.dist[q]; });

        return {
            W: W, H: H, MM: MM, aortaCircle: AORTA, aorta: r.aorta,
            mask0: mask0, maskD: maskD, dilated: dilated, extra: extra, domain: domain,
            breakPix: r.breakPix, gapPix: r.gapPix, bridges: bridges, ostia: ostia,
            D: D, cost: cost, cap: cap, owner: owner, fronts: fronts, maxG: maxG,
            pass1: pass1, pass2: pass2, branches: branches, maxDisp: maxDisp,
            params: { P: P, SIGMA: SIGMA, CAP: CAP, MIN_BRANCH: MIN_BRANCH, TRIM: TRIM }
        };
    }

    var api = { build: build, W: W, H: H, INF: INF };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.CenterlineAlgoDetailed = api;
})(typeof window !== "undefined" ? window : this);
