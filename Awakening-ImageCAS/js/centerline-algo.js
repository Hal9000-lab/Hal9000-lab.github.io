// Simplified 2D version of the centerline tracking, on a synthetic vessel tree.
// Pure functions (no DOM): build() returns everything the animation needs.
(function (root) {
    "use strict";

    var W = 200, H = 130;
    var INF = 1e9;
    var SQ2 = Math.SQRT2;

    // Synthetic "segmentation mask": an aortic root plus two coronary trees, in grid units.
    var AORTA = { x: 100, y: 26, r: 17 };
    var TREE = [
        // [x, y, radius] polylines, radius interpolated along each segment
        [[85, 34, 3.6], [70, 46, 3.4], [58, 64, 3.0], [52, 88, 2.6], [56, 116, 2.0]],
        [[58, 64, 2.6], [38, 76, 2.2], [22, 98, 1.7]],
        [[115, 33, 4.4], [128, 43, 4.2], [134, 50, 3.6]],
        [[134, 50, 3.6], [150, 64, 3.0], [158, 90, 2.6], [152, 118, 1.9]],
        [[134, 50, 3.2], [152, 48, 2.8], [172, 58, 2.2], [184, 82, 1.8]],
        [[152, 68, 2.2], [170, 76, 1.8], [182, 98, 1.5]]
    ];
    // ostia: where each tree leaves the aorta (on the aortic wall)
    var OSTIA = [
        { side: "R", toward: [85, 34] },
        { side: "L", toward: [115, 33] }
    ];

    var MIN_BRANCH = 9;      // a new branch must add at least this length (grid units)
    var MAX_BRANCHES = 16;

    function distToSegment(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay;
        var l2 = dx * dx + dy * dy;
        var t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        var cx = ax + t * dx, cy = ay + t * dy;
        return { d: Math.hypot(px - cx, py - cy), t: t };
    }

    function rasterize() {
        var mask = new Uint8Array(W * H);
        var aorta = new Uint8Array(W * H);
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                var px = x + 0.5, py = y + 0.5;
                var i = y * W + x;
                if (Math.hypot(px - AORTA.x, py - AORTA.y) <= AORTA.r) {
                    mask[i] = 1; aorta[i] = 1; continue;
                }
                for (var k = 0; k < TREE.length && !mask[i]; k++) {
                    var pl = TREE[k];
                    for (var s = 0; s < pl.length - 1; s++) {
                        var a = pl[s], b = pl[s + 1];
                        var q = distToSegment(px, py, a[0], a[1], b[0], b[1]);
                        if (q.d <= a[2] + (b[2] - a[2]) * q.t) { mask[i] = 1; break; }
                    }
                }
            }
        }
        return { mask: mask, aorta: aorta };
    }

    // distance of every mask pixel to the nearest pixel outside the mask (two-pass chamfer)
    function wallDistance(mask) {
        var d = new Float32Array(W * H);
        var x, y, i;
        for (i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
        function relax(i, j, w) { if (d[j] + w < d[i]) d[i] = d[j] + w; }
        for (y = 0; y < H; y++) {
            for (x = 0; x < W; x++) {
                i = y * W + x;
                if (!mask[i]) continue;
                if (x === 0 || y === 0) d[i] = 1;
                if (x > 0) relax(i, i - 1, 1);
                if (y > 0) relax(i, i - W, 1);
                if (x > 0 && y > 0) relax(i, i - W - 1, SQ2);
                if (x < W - 1 && y > 0) relax(i, i - W + 1, SQ2);
            }
        }
        for (y = H - 1; y >= 0; y--) {
            for (x = W - 1; x >= 0; x--) {
                i = y * W + x;
                if (!mask[i]) continue;
                if (x === W - 1 || y === H - 1) d[i] = Math.min(d[i], 1);
                if (x < W - 1) relax(i, i + 1, 1);
                if (y < H - 1) relax(i, i + W, 1);
                if (x < W - 1 && y < H - 1) relax(i, i + W + 1, SQ2);
                if (x > 0 && y < H - 1) relax(i, i + W - 1, SQ2);
            }
        }
        return d;
    }

    // minimal binary heap
    function Heap() { this.k = []; this.v = []; }
    Heap.prototype.push = function (key, val) {
        var k = this.k, v = this.v, i = k.length;
        k.push(key); v.push(val);
        while (i > 0) {
            var p = (i - 1) >> 1;
            if (k[p] <= key) break;
            k[i] = k[p]; v[i] = v[p]; i = p;
        }
        k[i] = key; v[i] = val;
    };
    Heap.prototype.pop = function () {
        var k = this.k, v = this.v;
        var topK = k[0], topV = v[0];
        var lastK = k.pop(), lastV = v.pop();
        var n = k.length;
        if (n) {
            var i = 0;
            for (;;) {
                var c = 2 * i + 1;
                if (c >= n) break;
                if (c + 1 < n && k[c + 1] < k[c]) c++;
                if (k[c] >= lastK) break;
                k[i] = k[c]; v[i] = v[c]; i = c;
            }
            k[i] = lastK; v[i] = lastV;
        }
        return { key: topK, val: topV };
    };
    Heap.prototype.size = function () { return this.k.length; };

    // cost is low in the middle of a vessel and rises steeply towards the wall,
    // so that minimal paths are both short and central
    function stepCost(d) { return 1 + 40 * Math.exp(-0.9 * d); }

    // minimal-cost fronts from both ostia at once; each pixel remembers its parent and side
    function geodesicFronts(vessel, wall, sources) {
        var N = W * H;
        var geo = new Float64Array(N).fill(INF);
        var parent = new Int32Array(N).fill(-1);
        var side = new Int8Array(N).fill(-1);
        var heap = new Heap();
        sources.forEach(function (s, si) {
            geo[s] = 0; side[s] = si; heap.push(0, s);
        });
        var nx = [1, -1, 0, 0, 1, 1, -1, -1], ny = [0, 0, 1, -1, 1, -1, 1, -1];
        while (heap.size()) {
            var top = heap.pop();
            var u = top.val;
            if (top.key > geo[u]) continue;
            var ux = u % W, uy = (u / W) | 0;
            for (var n = 0; n < 8; n++) {
                var vx = ux + nx[n], vy = uy + ny[n];
                if (vx < 0 || vy < 0 || vx >= W || vy >= H) continue;
                var v = vy * W + vx;
                if (!vessel[v]) continue;
                var len = n < 4 ? 1 : SQ2;
                var nd = geo[u] + len * 0.5 * (stepCost(wall[u]) + stepCost(wall[v]));
                if (nd < geo[v]) { geo[v] = nd; parent[v] = u; side[v] = side[u]; heap.push(nd, v); }
            }
        }
        return { geo: geo, parent: parent, side: side };
    }

    function coverDisk(covered, cx, cy, r) {
        var r2 = r * r;
        for (var y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) {
            for (var x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
                if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) covered[y * W + x] = 1;
            }
        }
    }

    // repeatedly trace the minimal path to the farthest uncovered pixel; keep it if it adds enough length
    function growTree(vessel, wall, fr, sources) {
        var N = W * H;
        var covered = new Uint8Array(N);
        sources.forEach(function (s) {
            coverDisk(covered, s % W, (s / W) | 0, Math.max(wall[s], 2) + 1);
        });
        var branches = [];
        var discarded = 0;
        for (var it = 0; it < MAX_BRANCHES * 4 && branches.length < MAX_BRANCHES; it++) {
            var best = -1, bestG = -1;
            for (var i = 0; i < N; i++) {
                if (vessel[i] && !covered[i] && fr.geo[i] < INF && fr.geo[i] > bestG) { bestG = fr.geo[i]; best = i; }
            }
            if (best < 0) break;
            var path = [best], p = best;
            while (fr.parent[p] >= 0 && !covered[fr.parent[p]]) { p = fr.parent[p]; path.push(p); }
            var attach = fr.parent[p];            // first already-covered pixel (or -1 at a source)
            if (attach >= 0) path.push(attach);
            var added = 0;
            for (var k = 1; k < path.length; k++) {
                var a = path[k - 1], b = path[k];
                added += (a % W !== b % W && ((a / W) | 0) !== ((b / W) | 0)) ? SQ2 : 1;
            }
            if (added < MIN_BRANCH) {
                coverDisk(covered, best % W, (best / W) | 0, Math.max(wall[best], 2) + 1.5);
                discarded++;
                continue;
            }
            path.forEach(function (q) {
                coverDisk(covered, q % W, (q / W) | 0, wall[q] + 1);
            });
            branches.push({ pix: path, side: fr.side[best] });
        }
        return { branches: branches, discarded: discarded };
    }

    function smooth(pts, iters) {
        for (var it = 0; it < iters; it++) {
            var out = pts.map(function (p, i) {
                var s = [0, 0, 0], c = 0;
                for (var j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) {
                    s[0] += pts[j][0]; s[1] += pts[j][1]; s[2] += pts[j][2]; c++;
                }
                return [s[0] / c, s[1] / c, s[2] / c];
            });
            out[0] = pts[0]; out[out.length - 1] = pts[pts.length - 1];
            pts = out;
        }
        return pts;
    }

    function polyLength(pts) {
        var l = 0;
        for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        return l;
    }

    function build() {
        var r = rasterize();
        var wall = wallDistance(r.mask);
        var vessel = new Uint8Array(W * H);
        for (var i = 0; i < vessel.length; i++) vessel[i] = r.mask[i] && !r.aorta[i] ? 1 : 0;

        // ostium markers on the aortic wall, and the nearest vessel pixel as the start of the fronts
        var ostia = OSTIA.map(function (o) {
            var dx = o.toward[0] - AORTA.x, dy = o.toward[1] - AORTA.y, l = Math.hypot(dx, dy);
            var pos = [AORTA.x + dx / l * AORTA.r, AORTA.y + dy / l * AORTA.r];
            var bestI = -1, bestD = INF;
            for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
                var j = y * W + x;
                if (!vessel[j]) continue;
                var d = Math.hypot(x + 0.5 - pos[0], y + 0.5 - pos[1]);
                if (d < bestD) { bestD = d; bestI = j; }
            }
            return { side: o.side, pos: pos, src: bestI };
        });
        var sources = ostia.map(function (o) { return o.src; });

        var fr = geodesicFronts(vessel, wall, sources);
        var maxGeo = 0;
        for (i = 0; i < fr.geo.length; i++) if (fr.geo[i] < INF && fr.geo[i] > maxGeo) maxGeo = fr.geo[i];

        var grown = growTree(vessel, wall, fr, sources);

        // smooth each branch and snap its end to the existing tree (nearest earlier vertex or ostium)
        var vertices = ostia.map(function (o, si) { return { x: o.pos[0], y: o.pos[1], ref: { root: si } }; });
        var branches = grown.branches.map(function (b, bi) {
            var pts = b.pix.map(function (q) { return [q % W + 0.5, ((q / W) | 0) + 0.5, wall[q]]; });
            pts = smooth(pts, 2);
            var last = pts[pts.length - 1];
            var near = null, nd = INF;
            vertices.forEach(function (v) {
                var d = Math.hypot(v.x - last[0], v.y - last[1]);
                if (d < nd) { nd = d; near = v; }
            });
            pts[pts.length - 1] = [near.x, near.y, last[2]];
            var br = { pts: pts, side: ostia[b.side].side, attach: near.ref, length: polyLength(pts) };
            pts.forEach(function (p, pi) { vertices.push({ x: p[0], y: p[1], ref: { branch: bi, idx: pi } }); });
            return br;
        });

        return {
            W: W, H: H, mask: r.mask, aorta: r.aorta, vessel: vessel, wall: wall,
            geo: fr.geo, side: fr.side, maxGeo: maxGeo, ostia: ostia,
            branches: branches, discarded: grown.discarded, aortaCircle: AORTA
        };
    }

    var api = { build: build, W: W, H: H, INF: INF };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.CenterlineAlgo = api;
})(typeof window !== "undefined" ? window : this);
