// Real-time 2D viscous incompressible flow (WebGL2) inside the unfolded left and right coronary trees.
//
// - The fluid can only move inside the vessel masks (rigid, no-slip walls); the mouse adds 2x2 rigid obstacles.
// - Boundary conditions: the ostium (green dot) is a PRESSURE inlet, P_in(t) = knob * pulse(t), linked to the first cells of the
//   tree through a stiff conductance; every endpoint (red dot) is a resistive outlet, a link to zero pressure whose resistance is
//   proportional to the Poiseuille resistance of the path from the ostium (so the flow divides between the branches by their
//   geometry, and a higher pressure means a higher flow). These links are Robin terms of the pressure equation.
// - Staggered (MAC) grid, semi-Lagrangian advection, implicit viscous diffusion, pressure projection.
// - Long-range pressure: a thin 600-cell tree is far too long for a Jacobi solve (errors with wavelengths of tens of cells never
//   decay and the flow stalls). The pressure is therefore solved in two levels. Coarse level: one unknown per BFS layer of each tree
//   (one cell thick, split in connected pieces), i.e. the 1D tree-shaped reduction of the problem. Every step the GPU sums the
//   divergence residual of each layer, a small graph system (~1-3k unknowns) is solved on the CPU (Jacobi-preconditioned CG,
//   warm-started) and its solution seeds the pressure; Jacobi sweeps on the GPU then smooth the local residual.
// - Views: dye (live flow) or the solver's pressure.
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

        // minimal binary heap (keys: path resistance)
        function Heap() { this.k = []; this.v = []; }
        Heap.prototype.push = function (key, val) {
            var k = this.k, v = this.v, i = k.length; k.push(key); v.push(val);
            while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
            k[i] = key; v[i] = val;
        };
        Heap.prototype.pop = function () {
            var k = this.k, v = this.v, tk = k[0], tv = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
            if (n) { var i = 0; for (;;) { var c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
            return { key: tk, val: tv };
        };
        // Poiseuille resistance of the path from the root to every cell: a step between two cells of a channel of width h = D_a + D_b
        // (D = distance to the wall) has the resistance 12 nu / h^3 (2D plane Poiseuille flow, per unit length and depth)
        function dijkstraRes(open, edtSide, W, H, root, nu) {
            var N = W * H, dist = new Float64Array(N).fill(Infinity), hp = new Heap();
            dist[root] = 0; hp.push(0, root);
            while (hp.k.length) {
                var t = hp.pop(), u = t.val; if (t.key > dist[u]) continue;
                var x = u % W, y = (u / W) | 0, nbs = [x > 0 ? u - 1 : -1, x < W - 1 ? u + 1 : -1, y > 0 ? u - W : -1, y < H - 1 ? u + W : -1];
                for (var q = 0; q < 4; q++) {
                    var nb = nbs[q]; if (nb < 0 || !open[nb]) continue;
                    var h = Math.max(edtSide[u] + edtSide[nb], 1.5), nd = t.key + 12 * nu / (h * h * h);
                    if (nd < dist[nb]) { dist[nb] = nd; hp.push(nd, nb); }
                }
            }
            return dist;
        }

        // Boundary field of both trees for the current obstacles.
        //  trees {L, R}: vessel masks   edt {L, R}: wall distance of each mask   rootStatic {L, R}: ostium cell   epStatic {L, R}: endpoint cells
        //  prm {nu, rho, rhoIn}: viscosity, outlet resistance / mean path resistance, inlet resistance / mean path resistance
        // Returns kappa (conductance of the link of each cell to its reservoir), kind (0 none, 1 inlet disk, 2 outlet patch),
        // tree (0 left, 1 right, -1 none), open (fluid, not obstacle), root cells, endpoint cells and the mean path resistance.
        function buildBoundary(trees, edt, rootStatic, epStatic, obst, W, H, prm) {
            var N = W * H, kappa = new Float32Array(N), kind = new Uint8Array(N), tree = new Int8Array(N).fill(-1), open = new Uint8Array(N);
            var out = { kappa: kappa, kind: kind, tree: tree, open: open, root: {}, rr: {}, endpoints: { L: [], R: [] }, rbar: {} };
            ["L", "R"].forEach(function (side, ti) {
                var m = trees[side], openT = new Uint8Array(N), i;
                for (i = 0; i < N; i++) if (m[i]) { tree[i] = ti; if (!obst || !obst[i]) { openT[i] = 1; open[i] = 1; } }
                var r0 = rootStatic[side], rr = Math.min(Math.max(prm.inletMin || 3, (prm.inletFactor || 1.6) * edt[side][r0]), prm.inletMax || 1e9);
                out.rr[side] = rr;
                var r = openT[r0] ? r0 : nearestIn(openT, W, H, r0 % W, (r0 / W) | 0);
                out.root[side] = r;
                if (r < 0) return;                                           // the whole tree is blocked
                var dist = dijkstraRes(openT, edt[side], W, H, r, prm.nu);
                // endpoints: the given cells (or the nearest reachable open cell); none given: the farthest cell
                var eps = [], used = {}, k;
                (epStatic[side] || []).forEach(function (e0) {
                    var e = -1, bd = 1e9, ex = e0 % W, ey = (e0 / W) | 0;
                    for (var dy = -8; dy <= 8; dy++) for (var dx = -8; dx <= 8; dx++) {
                        var xx = ex + dx, yy = ey + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                        var c = yy * W + xx; if (!openT[c] || !isFinite(dist[c])) continue;
                        var d = dx * dx + dy * dy; if (d < bd) { bd = d; e = c; }
                    }
                    if (e >= 0 && !used[e]) { used[e] = 1; eps.push({ cell: e, radius: Math.max(2.2, 1.2 * edt[side][e0]) }); }
                });
                if (!eps.length) { var far = r, fd = -1; for (i = 0; i < N; i++) if (openT[i] && isFinite(dist[i]) && dist[i] > fd) { fd = dist[i]; far = i; } eps.push({ cell: far, radius: 3 }); }
                var rbar = 0; for (k = 0; k < eps.length; k++) rbar += dist[eps[k].cell]; rbar = Math.max(rbar / eps.length, 1e-9);
                out.rbar[side] = rbar;
                // outlet resistance: rho * mean path resistance, plus a share (balance) of what the endpoint lacks to the farthest path, so that
                // balance = 1 gives every endpoint the same flow (equal perfusion) and balance = 0 the flow set by the geometry alone
                var Rin = prm.rhoIn * rbar, rmax = 0, bal = prm.balance === undefined ? 0 : prm.balance;
                for (k = 0; k < eps.length; k++) rmax = Math.max(rmax, dist[eps[k].cell]);
                eps.forEach(function (ep) {
                    var Rout = prm.rho * rbar + bal * (rmax - dist[ep.cell]);
                    var ex = ep.cell % W, ey = (ep.cell / W) | 0, rad = ep.radius, cells = [];
                    for (var dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (var dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
                        if (dx * dx + dy * dy > rad * rad) continue;
                        var xx = ex + dx, yy = ey + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                        var c = yy * W + xx; if (openT[c] && isFinite(dist[c]) && !kind[c]) cells.push(c);
                    }
                    if (!cells.length) cells.push(ep.cell);
                    for (var q = 0; q < cells.length; q++) { kind[cells[q]] = 2; kappa[cells[q]] = 1 / (Rout * cells.length); }
                    out.endpoints[side].push(ep.cell);
                });
                var rx = r % W, ry = (r / W) | 0, inlet = [], rr2 = rr * rr;
                for (i = 0; i < N; i++) if (openT[i] && isFinite(dist[i])) { var dx2 = i % W - rx, dy2 = ((i / W) | 0) - ry; if (dx2 * dx2 + dy2 * dy2 <= rr2) inlet.push(i); }
                if (!inlet.length) inlet.push(r);
                for (k = 0; k < inlet.length; k++) {
                    var ic = inlet[k], ddx = ic % W - rx, ddy = ((ic / W) | 0) - ry;
                    kind[ic] = (ddx * ddx + ddy * ddy <= 0.3 * rr2) ? 3 : 1;     // 3: core of the inlet, where the dye is released
                    kappa[ic] = 1 / (Rin * inlet.length);
                }
            });
            return out;
        }

        // Coarse space of the pressure solve: one unknown per BFS layer (one cell thick) of each tree, split in connected pieces of at most
        // maxMembers cells. Aggregating over layers (not over 2x2 blocks) keeps the coarse operator consistent along thin vessels: the coarse
        // problem is the 1D (tree-shaped) reduction of the pressure problem. Returns the segments, their members and the coarse graph.
        function buildSegments(open, tree, root, W, H, maxMembers, bnd, edtAll, nu) {
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
            // (also the physical conductance of every link, h^2 / (12 nu): the flux of a channel of width h is h^3 / (12 nu) per unit pressure gradient)
            var map = {}, pmap = {}, i2;
            function link(a, b2, c1, c2) {
                if (a === b2) return; var lo = a < b2 ? a : b2, hi = a < b2 ? b2 : a, key = lo * 65536 + hi;
                var hh = Math.max(edtAll[c1] + edtAll[c2], 1.5);
                map[key] = (map[key] || 0) + 1; pmap[key] = (pmap[key] || 0) + hh * hh / (12 * nu);
            }
            for (i2 = 0; i2 < N; i2++) {
                var sa = seg[i2]; if (sa < 0) continue;
                if (i2 % W < W - 1 && seg[i2 + 1] >= 0) link(sa, seg[i2 + 1], i2, i2 + 1);
                if (i2 + W < N && seg[i2 + W] >= 0) link(sa, seg[i2 + W], i2, i2 + W);
            }
            var deg = new Int32Array(n + 1), keys = Object.keys(map), e;
            for (e = 0; e < keys.length; e++) { var kk = +keys[e], lo2 = Math.floor(kk / 65536), hi2 = kk % 65536; deg[lo2]++; deg[hi2]++; }
            var gstart = new Int32Array(n + 1), tot = 0;
            for (i2 = 0; i2 < n; i2++) { gstart[i2] = tot; tot += deg[i2]; } gstart[n] = tot;
            var nbr = new Int32Array(tot), cond = new Float32Array(tot), pcond = new Float64Array(tot), fill = new Int32Array(n), diag = new Float64Array(n), pdiag = new Float64Array(n);
            for (e = 0; e < keys.length; e++) {
                var key2 = +keys[e], l = Math.floor(key2 / 65536), h = key2 % 65536, c2 = map[key2], pc = pmap[key2];
                pcond[gstart[l] + fill[l]] = pc; pcond[gstart[h] + fill[h]] = pc;
                nbr[gstart[l] + fill[l]] = h; cond[gstart[l] + fill[l]++] = c2; nbr[gstart[h] + fill[h]] = l; cond[gstart[h] + fill[h]++] = c2; diag[l] += c2; diag[h] += c2; pdiag[l] += pc; pdiag[h] += pc;
            }
            // connected components of the coarse graph (to remove the mean of the right-hand side per component)
            var comp2 = new Int32Array(n).fill(-1), nc = 0, st = [];
            for (i2 = 0; i2 < n; i2++) { if (comp2[i2] >= 0) continue; comp2[i2] = nc; st.push(i2);
                while (st.length) { var u = st.pop(); for (var t = gstart[u]; t < gstart[u + 1]; t++) if (comp2[nbr[t]] < 0) { comp2[nbr[t]] = nc; st.push(nbr[t]); } } nc++; }
            // boundary conductance of every segment (sum over its cells), and the tree of each segment
            var kap = new Float64Array(n), kin = new Float64Array(n), kout = new Float64Array(n), segTree = new Int8Array(n);
            for (var sg = 0; sg < n; sg++) {
                segTree[sg] = tree[members[start[sg]]];
                for (var mm = start[sg]; mm < start[sg + 1]; mm++) {
                    var cc = members[mm], kk2 = bnd.kappa[cc]; if (!kk2) continue;
                    kap[sg] += kk2; if (bnd.kind[cc] === 1 || bnd.kind[cc] === 3) kin[sg] += kk2; else kout[sg] += kk2;
                }
            }
            return { n: n, seg: seg, members: Int32Array.from(members), start: Int32Array.from(start), gstart: gstart, nbr: nbr, cond: cond, diag: diag, pcond: pcond, pdiag: pdiag,
                     comp: comp2, ncomp: nc, kappa: kap, kin: kin, kout: kout, segTree: segTree };
        }

        // Coarse problem  (A + diag(extra)) pi = b  on the segment graph (graph Laplacian with unit or physical conductances),
        // Jacobi-preconditioned CG warm-started from x0. Without extra, b is made zero-mean per component (singular Neumann problem).
        function solveSegments(G, b, x0, maxIt, tol, extra, phys) {
            var n = G.n, cond = phys ? G.pcond : G.cond, base = phys ? G.pdiag : G.diag;
            var dg = new Float64Array(n), x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n), bb = new Float64Array(n), k, t;
            for (k = 0; k < n; k++) dg[k] = base[k] + (extra ? extra[k] : 0);
            var sum = new Float64Array(G.ncomp), cnt = new Float64Array(G.ncomp);
            for (k = 0; k < n; k++) { sum[G.comp[k]] += b[k]; cnt[G.comp[k]]++; }
            for (k = 0; k < n; k++) { bb[k] = extra ? b[k] : b[k] - sum[G.comp[k]] / cnt[G.comp[k]]; if (x0) x[k] = x0[k]; }
            function mv(v, out) { for (var a = 0; a < n; a++) { var s = dg[a] * v[a]; for (var q = G.gstart[a]; q < G.gstart[a + 1]; q++) s -= cond[q] * v[G.nbr[q]]; out[a] = s; } }
            mv(x, Ap);
            var rz = 0, bn = 0;
            for (k = 0; k < n; k++) { r[k] = bb[k] - Ap[k]; z[k] = dg[k] > 0 ? r[k] / dg[k] : 0; p[k] = z[k]; rz += r[k] * z[k]; bn += bb[k] * bb[k]; }
            for (t = 0; t < (maxIt || 80) && rz > (tol || 1e-18) * Math.max(bn, 1e-30); t++) {
                mv(p, Ap); var pAp = 0; for (k = 0; k < n; k++) pAp += p[k] * Ap[k];
                if (!(pAp > 0)) break;
                var alpha = rz / pAp, rzn = 0;
                for (k = 0; k < n; k++) { x[k] += alpha * p[k]; r[k] -= alpha * Ap[k]; z[k] = dg[k] > 0 ? r[k] / dg[k] : 0; rzn += r[k] * z[k]; }
                var beta = rzn / rz; rz = rzn; for (k = 0; k < n; k++) p[k] = z[k] + beta * p[k];
            }
            var out = new Float32Array(n);
            if (extra) { for (k = 0; k < n; k++) out[k] = x[k]; return out; }
            var xm = new Float64Array(G.ncomp);
            for (k = 0; k < n; k++) xm[G.comp[k]] += x[k];
            for (k = 0; k < n; k++) out[k] = x[k] - xm[G.comp[k]] / cnt[G.comp[k]];
            return out;
        }

        // Equivalent resistance of each tree from the inlet (pressure 1) to the outlets (pressure 0), on the physical resistor network of
        // the segment graph: used to scale the reference pressure so that the default flow has a sensible speed.
        function equivalentResistance(G) {
            var n = G.n, extra = new Float64Array(n), b = new Float64Array(n), k;
            for (k = 0; k < n; k++) { extra[k] = G.kin[k] + G.kout[k]; b[k] = G.kin[k]; }
            var pi = solveSegments(G, b, null, 20000, 1e-24, extra, true), Q = [0, 0];       // many iterations: with dominant outlet resistances the system is badly conditioned
            for (k = 0; k < n; k++) Q[G.segTree[k]] += G.kin[k] * (1 - pi[k]);
            return { L: Q[0] > 0 ? 1 / Q[0] : Infinity, R: Q[1] > 0 ? 1 / Q[1] : Infinity };
        }

        return { chamfer: chamfer, bfs4: bfs4, nearestIn: nearestIn, dijkstraRes: dijkstraRes, buildBoundary: buildBoundary, buildSegments: buildSegments, solveSegments: solveSegments, equivalentResistance: equivalentResistance };
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
    var K1 = SIM_MAX / 720, K2 = K1 * K1;              // speeds, flows and viscosity are tuned on a 720-cell grid
    var BPM_MIN = 40, BPM_MAX = 180, BPM_DEFAULT = 60;
    var SYSTOLIC_MIN = 80, SYSTOLIC_MAX = 200, SYSTOLIC_DEFAULT = 120;     // blood pressure knob: systolic in mmHg
    var SYSTOLIC_FRACTION = 0.4, PULSE_EDGE = 0.03;                          // the pulse is a step: systolic for 40% of the beat, diastolic for the rest (edges smoothed over 3% of the beat)
    var OUTLET_BACK_RATIO = 0.8;                                            // pressure at the endpoints (outlets) = this * diastolic pressure
    var DIASTOLIC_RATIO = 80 / 120;                                         // diastolic = systolic * this (120/80, 150/100, 90/60 ...)
    // Physical units. The scale (mm per cell) follows from the width of the arteries close to the ostium, the viscosity is that of blood, and
    // the flow is shown SLOWMO times slower than real (real coronary blood crosses the whole tree in well under a second).
    var ARTERY_DIAMETER_MM = 2.5;            // width of the arteries close to the ostium
    var BLOOD_VISCOSITY_MM2_S = 3.3;         // kinematic viscosity of blood: 3.5 mPa s / 1060 kg/m3
    var SLOWMO = 4;                          // animation seconds per real second of flow
    var V_PEAK_MM_S = 250;                   // real speed in the artery near the ostium at the default systolic pressure (typical peak coronary velocity)
    var OUTLET_RESISTANCE = 10;              // outlet (microvascular) resistance / mean resistance of the epicardial paths to the endpoints (it dominates in a real tree; a very high
                                             // value makes the pressure almost uniform, a low one lets the endpoints near the ostium take the flow)
    var INLET_RESISTANCE = 0.05;             // resistance between the ostium pressure and the first cells, same unit (small = stiff)
    var INLET_MIN_RADIUS = 8, INLET_RADIUS_FACTOR = 2.2, INLET_MAX_RADIUS = 14;     // bulky inlet disk around the ostium: radius = clamp(factor * local half-width, min, max), cells at 720
    var PERFUSION_BALANCE = 1.0;             // outlet resistance = OUTLET_RESISTANCE * mean + BALANCE * (longest path - path of this endpoint), from the Dijkstra path resistances:
                                             // 0: the flow divides by the geometry alone, 1: every endpoint gets the same flow, >1: the far endpoints are favoured
    var NU = 30 * K2;                        // kinematic viscosity, cells^2/s (recomputed from the blood viscosity once the scale is known)
    var mmPerCell = 0.14, vPeakCells = 300, hOst = { L: 17, R: 17 };
    var JACOBI = 24, DIFFUSE = 6;            // sweeps per step (reduced automatically on slow devices)
    var DYE_RATE = 240, DYE_BASE = 0.3, DYE_DECAY = 0.06, DYE_DIFFUSION = 0.03, DYE_OUTLET = 0.93;     // the dye leaves through the outlets
    var DYE_GAIN = 7;                        // display sensitivity to small dye amounts: colour = 1 - exp(-gain * dye)
    var PARTICLES_SIDE = 16, PARTICLE_LIFE = 30, PARTICLE_SIZE = 8;   // tracer particles carried by the flow: side^2 of them (0 = none), seconds, pixels
    var PARTICLE_INLET_SHARE = 0.5;          // share of the particles (re)born in the inlet disk; the others are born anywhere in the vessels of their tree
    var PARTICLE_JITTER = 4;                 // random motion of the particles, cells / sqrt(s) at 720: they meet the artery walls and bounce off them
    var NS_VERSION = "v1.7";                // shown at the bottom right of the figure: bump it at every modification of this file
    var BOID_WALL_K = 200, BOID_WALL_RANGE = 8; // wall repulsion on the particles: acceleration K/D^2 (D = distance to the wall, in cells at 720), felt within RANGE
    var PARTICLE_MAX_SPEED = 40;             // cells/s at 720: the particles never move faster than this, so that they can drift across the width of the artery
    var BOID_RADIUS = 18, BOID_SEPARATION = 9;          // boids: neighbourhood and personal-space radius, cells at 720
    var BOID_SEPARATE = 400, BOID_ALIGN = 1.5, BOID_COHESION = 0.25, BOID_TAU = 0.3;      // separation (cells/s^2), alignment and cohesion (1/s), time to follow the flow (s)
    var OBSTACLE_COLOR = [0.69, 0.49, 0.18]; // yellowish ochre-brown
    var OBSTACLE_SIZE = 4;                   // cells (the brush is OBSTACLE_SIZE x OBSTACLE_SIZE)
    var SWAP_SIDES = false;                  // unused with one image per tree

    // The right tree lags the left one by 0.15 / F seconds, F = 20 * (BPM - 40) / (180 - 40) (F is kept >= 0.6: 40 bpm -> 0.25 s).
    function rightDelay(bpm) { var F = Math.max(20 * (bpm - 40) / (180 - 40), 0.6); return 0.15 / F; }
    function beat(ph) {                                                                               // pressure pulse during one beat: 1 = systolic, 0 = diastolic
        var e = PULSE_EDGE, a = Math.min(Math.max(ph / e, 0), 1), b = Math.min(Math.max((ph - SYSTOLIC_FRACTION) / e, 0), 1);
        return a * a * (3 - 2 * a) - b * b * (3 - 2 * b);
    }
    function bolus(ph) { var s = ph < 0.3 ? Math.sin(Math.PI * ph / 0.3) : 0; return s * s; }          // dye released at the start of systole

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
        var d = x.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height, b = new Uint8Array(w * h), red = new Uint8Array(w * h), gx = 0, gy = 0, gn = 0, i;
        for (i = 0; i < w * h; i++) {
            var r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2];
            if (g > 100 && r < 90 && bl < 90 && g > r + 40) { b[i] = 1; gx += i % w; gy += (i / w) | 0; gn++; }           // green: ostium
            else if (r > 140 && g < 90 && bl < 90) { b[i] = 1; red[i] = 1; }                                                // red: endpoint (or ring)
            else if ((bl > 90 && r < 60 && g < 60) || r < 128) b[i] = 1;                                                    // navy ring, vessel
        }
        var marker = gn > 20 ? [gx / gn, gy / gn] : null, lab = new Uint8Array(w * h), endpoints = [], stack = [];
        for (i = 0; i < w * h; i++) {
            if (!red[i] || lab[i]) continue;
            var sx = 0, sy = 0, cn = 0; stack.push(i); lab[i] = 1;
            while (stack.length) {
                var p = stack.pop(), px = p % w, py = (p / w) | 0; sx += px; sy += py; cn++;
                for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                    var xx = px + dx, yy = py + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    var q = yy * w + xx; if (red[q] && !lab[q]) { lab[q] = 1; stack.push(q); }
                }
            }
            var cx = sx / cn, cy = sy / cn;
            if (cn >= 6 && (!marker || Math.hypot(cx - marker[0], cy - marker[1]) > 30)) endpoints.push([cx, cy]);       // not the ostium's ring
        }
        return { w: w, h: h, b: b, marker: marker, endpoints: endpoints };
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
        var out = { W: SW, H: SH, trees: {}, markers: {}, endpoints: {} };
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
            out.endpoints[t.side] = (t.img.endpoints || []).map(function (e) { return [(e[0] - t.bb.x0 + t.ox) * s, (e[1] - t.bb.y0 + t.oy) * s]; });
        });
        return out;
    }

    // ---- 2. geometry state on the CPU
    var W, H, N, trees, edt = {}, edtAll = null, rootStatic = {}, epStatic = {}, baseMask, obst, G = null, field = null, geoData = null, piPrev = null, PU = null, PUt = { L: 1, R: 1 };
    var SEGW = 1024, SEGH = 8, MEMW = 1024, MEMH = 128, MAXK = 128;      // capacity: 8192 segments, 131072 members

    // geo texture data: R = conductance of the link to the reservoir (inlet or outlet), G = kind (1 inlet, 2 outlet), B = tree id, A = vessel cell.
    // Rows are flipped (texture row 0 = bottom)
    function geoArray(f) {
        var g = new Float32Array(N * 4);
        for (var i = 0; i < N; i++) {
            var x = i % W, y = (i / W) | 0, o = ((H - 1 - y) * W + x) * 4;
            g[o] = f.kappa[i]; g[o + 1] = f.kind[i]; g[o + 2] = f.tree[i] > 0 ? 1 : 0; g[o + 3] = baseMask[i];
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
        var f = Core.buildBoundary(trees, edt, rootStatic, epStatic, obst, W, H, { nu: NU, rho: OUTLET_RESISTANCE, rhoIn: INLET_RESISTANCE, inletMin: INLET_MIN_RADIUS * K1, inletFactor: INLET_RADIUS_FACTOR, inletMax: INLET_MAX_RADIUS * K1, balance: PERFUSION_BALANCE });
        var Gs = Core.buildSegments(f.open, f.tree, f.root, W, H, MAXK, f, edtAll, NU);
        if (Gs.n > SEGW * SEGH || Gs.members.length > MEMW * MEMH) return null;
        if (PU === null) {        // pressure units per mmHg of each tree, fixed once on the unobstructed trees: the default systolic pressure gives V_PEAK_MM_S
                                  // (real speed, shown SLOWMO times slower) in an artery of the width it has close to the ostium
            var Req = Core.equivalentResistance(Gs);
            ["L", "R"].forEach(function (side) {
                PUt[side] = isFinite(Req[side]) ? vPeakCells * hOst[side] * Req[side] / (SYSTOLIC_DEFAULT * (1 - OUTLET_BACK_RATIO * DIASTOLIC_RATIO)) : 100;   // peak flow set by (systolic - outlet pressure)
            });
            PU = 0.5 * (PUt.L + PUt.R);
        }
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
    function prog(fs, vsText) {
        function sh(type, text) { var s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + text); return s; }
        var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vsText || VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
        return { p: p, u: u };
    }

    // bilinear sampling of the face velocities at any point. u lives at (i, j+0.5), v at (i+0.5, j), in cell units
    var VELSAMPLE =
        "float sU(vec2 p){ vec2 q = vec2(p.x, p.y - 0.5); ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);\n" +
        "  return mix(mix(U(i), U(i + ivec2(1,0)), f.x), mix(U(i + ivec2(0,1)), U(i + ivec2(1,1)), f.x), f.y); }\n" +
        "float sV(vec2 p){ vec2 q = vec2(p.x - 0.5, p.y); ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);\n" +
        "  return mix(mix(Vf(i), Vf(i + ivec2(1,0)), f.x), mix(Vf(i + ivec2(0,1)), Vf(i + ivec2(1,1)), f.x), f.y); }\n" +
        "vec2 at(vec2 p){ return vec2(sU(p), sV(p)); }\n";
    // advection of the face velocities (semi-Lagrangian, midpoint)
    var S_ADVECT = HEAD + COMMON + VELFN + VELSAMPLE + "uniform float uDt;\n" +
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

    // right-hand side of the pressure equation:  div u - kappa * P_reservoir  (the inlet reservoir is at the applied pressure, the outlets at 0)
    var S_DIV = HEAD + COMMON + VELFN + "uniform vec2 uPin, uPout;\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  if (fluid(c) < 0.5) { o = vec4(0.0); return; }\n" +
        "  vec4 g = texelFetch(uGeo, c, 0);\n" +
        "  float div = U(c + ivec2(1,0)) - U(c) + Vf(c + ivec2(0,1)) - Vf(c);\n" +
        "  float src = g.g < 0.5 ? 0.0 : g.r * (g.g > 1.5 && g.g < 2.5 ? (g.b < 0.5 ? uPout.x : uPout.y) : (g.b < 0.5 ? uPin.x : uPin.y));\n" +
        "  o = vec4(div - src, 0.0, 0.0, 1.0); }";

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

    var S_JACOBI = HEAD + COMMON + "uniform sampler2D uP, uRhs; uniform float uInvDt;\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  if (fluid(c) < 0.5) { o = vec4(0.0); return; }\n" +
        "  float s = 0.0, n = 0.0; ivec2 d[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));\n" +
        "  for (int k = 0; k < 4; k++) { ivec2 q = c + d[k]; if (fluid(q) > 0.5) { s += texelFetch(uP, q, 0).x; n += 1.0; } }\n" +
        "  float den = n + texelFetch(uGeo, c, 0).r * uInvDt;\n" +
        "  o = vec4(den > 0.0 ? (s - texelFetch(uRhs, c, 0).x) / den : 0.0, 0.0, 0.0, 1.0); }";

    var S_GRAD = HEAD + COMMON + VELFN + "uniform sampler2D uP;\n" +
        "float P(ivec2 c){ return texelFetch(uP, c, 0).x; }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy);\n" +
        "  float nu = 0.0, nv = 0.0;\n" +
        "  if (openU(c)) nu = U(c) - (P(c) - P(c - ivec2(1,0)));\n" +
        "  if (openV(c)) nv = Vf(c) - (P(c) - P(c - ivec2(0,1)));\n" +
        "  o = vec4(nu, nv, 0.0, 1.0); }";

    // dye (red channel: left tree, green channel: right tree)
    var S_DYE = HEAD + COMMON + VELFN + "uniform sampler2D uDye; uniform vec2 uInj; uniform float uDt, uDecay, uDiff, uOutlet;\n" +
        "vec2 cv(ivec2 c){ c = clamp(c, ivec2(0), SZ - 1); if (fluid(c) < 0.5) return vec2(0.0); return vec2(0.5 * (U(c) + U(c + ivec2(1,0))), 0.5 * (Vf(c) + Vf(c + ivec2(0,1)))); }\n" +
        "vec2 bil(vec2 p){ vec2 q = p - 0.5; ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);\n" +
        "  return mix(mix(cv(i), cv(i + ivec2(1,0)), f.x), mix(cv(i + ivec2(0,1)), cv(i + ivec2(1,1)), f.x), f.y); }\n" +
        "vec2 dsamp(vec2 p){ vec2 q = p - 0.5; ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);          // bilinear over the fluid cells only: walls do not drain the dye\n" +
        "  float w0 = fluid(i) * (1.0 - f.x) * (1.0 - f.y), w1 = fluid(i + ivec2(1,0)) * f.x * (1.0 - f.y), w2 = fluid(i + ivec2(0,1)) * (1.0 - f.x) * f.y, w3 = fluid(i + ivec2(1,1)) * f.x * f.y;\n" +
        "  float ws = w0 + w1 + w2 + w3; if (ws < 1e-6) return vec2(0.0);\n" +
        "  return (texelFetch(uDye, clamp(i, ivec2(0), SZ - 1), 0).rg * w0 + texelFetch(uDye, clamp(i + ivec2(1,0), ivec2(0), SZ - 1), 0).rg * w1 + texelFetch(uDye, clamp(i + ivec2(0,1), ivec2(0), SZ - 1), 0).rg * w2 + texelFetch(uDye, clamp(i + ivec2(1,1), ivec2(0), SZ - 1), 0).rg * w3) / ws; }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy); vec4 g = texelFetch(uGeo, c, 0);\n" +
        "  if (fluid(c) < 0.5) { o = vec4(0.0); return; }\n" +
        "  vec2 mid = vec2(c) + 0.5 - 0.5 * uDt * cv(c);\n" +
        "  vec2 d = dsamp(vec2(c) + 0.5 - uDt * bil(mid));\n" +
        "  vec2 nb = vec2(0.0); float n = 0.0; ivec2 e[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));\n" +
        "  for (int k = 0; k < 4; k++) { if (fluid(c + e[k]) > 0.5) { nb += texelFetch(uDye, c + e[k], 0).rg; n += 1.0; } }\n" +
        "  d = mix(d, n > 0.0 ? nb / n : d, uDiff) * uDecay;\n" +
        "  if (g.g > 2.5) d += (g.b < 0.5 ? vec2(uInj.x, 0.0) : vec2(0.0, uInj.y));\n" +
        "  if (g.g > 1.5 && g.g < 2.5) d *= uOutlet;\n" +
        "  o = vec4(d, 0.0, 1.0); }";

    // tracer particles: position (cells), tree, age. They are boids: their velocity relaxes towards the flow (time BOID_TAU) and is changed by separation from
    // close neighbours, alignment with the velocity of the neighbours and a little cohesion, so that they spread out instead of clumping on one streamline.
    // They are re-injected in the inlet disk or anywhere in the vessels when they reach an outlet, hit an obstacle or get too old.
    var PS = PARTICLES_SIDE;
    var S_BOID = HEAD + COMMON + VELFN + VELSAMPLE + "uniform sampler2D uPart, uPartV; uniform float uDt, uRadius, uSep, uASep, uAAl, uACoh, uTau, uVmax, uWallK, uWallR, uScale;\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy); vec2 p = texelFetch(uPart, c, 0).xy; vec2 v = texelFetch(uPartV, c, 0).xy; int id = c.y * " + PS + " + c.x;\n" +
        "  vec2 f = at(p); vec2 sep = vec2(0.0), avgV = vec2(0.0), avgP = vec2(0.0); float cnt = 0.0;\n" +
        "  for (int j = 0; j < " + (PS * PS) + "; j++) { if (j == id) continue; ivec2 cj = ivec2(j % " + PS + ", j / " + PS + "); vec2 pj = texelFetch(uPart, cj, 0).xy; vec2 d = p - pj; float dist = length(d);\n" +
        "    if (dist < uRadius && dist > 1e-4) { cnt += 1.0; avgV += texelFetch(uPartV, cj, 0).xy; avgP += pj; if (dist < uSep) sep += (d / dist) * (1.0 - dist / uSep); } }\n" +
        "  vec2 wall = vec2(0.0);\n" +
        "  for (int k = 0; k < 8; k++) { float a = float(k) * 0.785398; vec2 dir = vec2(cos(a), sin(a));\n" +
        "    for (int m = 1; m <= 32; m++) { float r = float(m) * 0.5; if (r > uWallR) break; vec2 q = p + dir * r; ivec2 qi = ivec2(floor(q));\n" +
        "      if (!inb(qi) || texelFetch(uGeo, qi, 0).a < 0.5) { float D = max(r, 0.5) / uScale; wall -= dir * (uWallK / (D * D)); break; } } }\n" +
        "  vec2 acc = sep * uASep + wall * uScale; if (cnt > 0.0) acc += (avgV / cnt - v) * uAAl + (avgP / cnt - p) * uACoh;\n" +
        "  vec2 nv = mix(v, f, 1.0 - exp(-uDt / uTau)) + acc * uDt; float sp = length(nv); if (sp > uVmax) nv *= uVmax / sp;\n" +
        "  o = vec4(nv, 0.0, 1.0); }";
    var S_PART = HEAD + COMMON + VELFN + VELSAMPLE + "uniform sampler2D uPart, uPartV, uCells; uniform float uDt, uTime, uMaxAge, uJitter, uShare; uniform vec4 uRoot; uniform vec2 uRad, uCnt, uOff;\n" +
        "vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }\n" +
        "bool vessel(vec2 p){ ivec2 q = ivec2(floor(p)); return inb(q) && texelFetch(uGeo, q, 0).a > 0.5; }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy); vec4 pt = texelFetch(uPart, c, 0); int id = c.y * " + PS + " + c.x;\n" +
        "  vec2 old = pt.xy; float age = pt.w + uDt; float tree = pt.z; bool dead = age > uMaxAge || pt.x < 0.0; vec2 pos = old;\n" +
        "  if (!dead) {\n" +
        "    vec2 dsp = uDt * texelFetch(uPartV, c, 0).xy + (hash2(vec2(float(id) * 7.3, uTime * 61.0)) - 0.5) * 2.0 * uJitter * sqrt(uDt);\n" +
        "    pos = old + dsp;\n" +
        "    if (!vessel(pos)) {                                   // artery wall: bounce (reflect the displacement)\n" +
        "      bool okX = vessel(vec2(pos.x, old.y)), okY = vessel(vec2(old.x, pos.y));\n" +
        "      if (okX && !okY) pos = vec2(old.x + dsp.x, old.y - dsp.y);\n" +
        "      else if (okY && !okX) pos = vec2(old.x - dsp.x, old.y + dsp.y);\n" +
        "      else pos = old - dsp;\n" +
        "      if (!vessel(pos)) pos = old;\n" +
        "    }\n" +
        "    ivec2 ci = ivec2(floor(pos));\n" +
        "    if (texelFetch(uObst, ci, 0).r > 0.5) dead = true;                       // a drawn obstacle: no bounce, the particle is born again\n" +
        "    else { float kk = texelFetch(uGeo, ci, 0).g; if (kk > 1.5 && kk < 2.5) dead = true; }     // reached an outlet\n" +
        "  }\n" +
        "  if (dead) {\n" +
        "    tree = float(id & 1); vec2 h = hash2(vec2(float(id), uTime)); vec2 h3 = hash2(vec2(float(id) * 3.1 + 9.0, uTime * 1.7 + 3.0));\n" +
        "    float cnt = tree < 0.5 ? uCnt.x : uCnt.y, off = tree < 0.5 ? uOff.x : uOff.y;\n" +
        "    vec2 rc = tree < 0.5 ? uRoot.xy : uRoot.zw; float rad = tree < 0.5 ? uRad.x : uRad.y;\n" +
        "    if (h3.x < uShare || cnt < 1.0) {                                        // in the inlet disk\n" +
        "      float ang = 6.2832 * h.x, rr = rad * sqrt(h.y); pos = rc + rr * vec2(cos(ang), sin(ang));\n" +
        "    } else {                                                                  // anywhere in the vessels of the tree\n" +
        "      int k = int(off + floor(h.x * cnt)); int cc = int(texelFetch(uCells, ivec2(k % " + MEMW + ", k / " + MEMW + "), 0).x + 0.5);\n" +
        "      pos = vec2(float(cc % SZ.x), float(cc / SZ.x)) + vec2(fract(h.x * cnt), h.y);\n" +
        "    }\n" +
        "    if (!vessel(pos) || texelFetch(uObst, ivec2(floor(pos)), 0).r > 0.5) pos = rc;\n" +
        "    age = 0.0;\n" +
        "  }\n" +
        "  o = vec4(pos, tree, age); }";
    var VS_PART = "#version 300 es\nprecision highp float; precision highp sampler2D;\nuniform sampler2D uPart; uniform vec2 uSz; uniform float uSize, uMaxAge, uClock;\nout float vTree; out float vFade;\n" +
        "void main(){ int id = gl_VertexID; vec4 p = texelFetch(uPart, ivec2(id % " + PS + ", id / " + PS + "), 0);\n" +
        "  gl_Position = vec4(p.xy / uSz * 2.0 - 1.0, 0.0, 1.0); gl_PointSize = uSize; vTree = p.z;\n" +
        "  float tw = 0.72 + 0.28 * sin(uClock * (2.2 + float(id % 7) * 0.55) + float(id) * 1.913);\n" +
        "  vFade = smoothstep(0.0, 0.6, p.w) * (1.0 - smoothstep(uMaxAge - 3.0, uMaxAge, p.w)) * tw; }";
    var FS_PART = "#version 300 es\nprecision highp float; in float vTree; in float vFade; out vec4 o;\n" +
        "void main(){ float a = smoothstep(0.5, 0.18, length(gl_PointCoord - 0.5)) * vFade; vec3 col = vTree < 0.5 ? vec3(0.02, 0.17, 0.55) : vec3(0.55, 0.03, 0.09); o = vec4(col * a, a); }";

    // smoothed pressure per unit time, for display
    var S_PD = HEAD + "uniform sampler2D uP, uPd; uniform float uInvDt, uMixF;\n" +
        "void main(){ ivec2 c = ivec2(gl_FragCoord.xy); o = vec4(mix(texelFetch(uPd, c, 0).x, texelFetch(uP, c, 0).x * uInvDt, uMixF), 0.0, 0.0, 1.0); }";

    var S_SHOW = HEAD + "uniform sampler2D uDye, uMask, uGeo, uObst, uPd; uniform vec2 uBeat; uniform vec3 uObstCol; uniform int uView; uniform vec4 uRange; uniform vec2 uPU;\n" +
        "vec3 pseq(float t){ t = clamp(t, 0.0, 1.0); vec3 c0 = vec3(0.20, 0.19, 0.36), c1 = vec3(0.18, 0.45, 0.95), c2 = vec3(1.0, 0.45, 0.10), c3 = vec3(1.0, 0.92, 0.45);\n" +
        "  if (t < 0.33) return mix(c0, c1, t / 0.33); if (t < 0.66) return mix(c1, c2, (t - 0.33) / 0.33); return mix(c2, c3, (t - 0.66) / 0.34); }\n" +
        "void main(){\n" +
        "  vec2 uv = vUv; ivec2 sz = textureSize(uGeo, 0); ivec2 c = clamp(ivec2(uv * vec2(sz)), ivec2(0), sz - 1);\n" +
        "  float b0 = texelFetch(uGeo, c, 0).b; float b = b0 < 0.5 ? uBeat.x : uBeat.y;\n" +
        "  float m = smoothstep(0.35, 0.65, texture(uMask, uv).r);\n" +
        "  vec3 bg = vec3(0.07, 0.063, 0.11), vessel = vec3(0.16, 0.15, 0.22), col;\n" +
        "  float kd = texelFetch(uGeo, c, 0).g; bool isOut = kd > 1.5 && kd < 2.5; vec3 tint = isOut ? vec3(0.75, 0.12, 0.12) : vec3(0.13, 0.55, 0.13); float ta = kd > 0.5 ? 0.42 : 0.0;\n" +
        "  vec3 vesselC = mix(vessel, tint, ta);\n" +
        "  if (uView == 0) {\n" +
        "    vec2 d = texture(uDye, uv).rg;\n" +
        "    vec3 cL = vec3(0.25, 0.62, 1.0), cR = vec3(1.0, 0.28, 0.33);\n" +
        "    vec3 glow = cL * (1.0 - exp(-" + DYE_GAIN.toFixed(2) + " * d.r)) + cR * (1.0 - exp(-" + DYE_GAIN.toFixed(2) + " * d.g));\n" +
        "    glow += vec3(1.0) * smoothstep(1.0, 3.5, d.r + d.g) * 0.25;\n" +
        "    glow *= 0.8 + 0.35 * b;\n" +
        "    col = bg + m * (vesselC + 0.06 * b - bg) + m * glow * 1.1;\n" +
        "  } else {\n" +
        "    float mmHg = texture(uPd, uv).r / (b0 < 0.5 ? uPU.x : uPU.y);\n" +
        "    float tp = b0 < 0.5 ? (mmHg - uRange.x) / max(uRange.y - uRange.x, 1.0) : (mmHg - uRange.z) / max(uRange.w - uRange.z, 1.0);\n" +
        "    vec3 pc = pseq(tp) * (0.9 + 0.1 * cos(clamp(tp, -0.2, 1.2) * 62.83));         // faint iso-pressure bands: they travel along the vessels as the pressure changes\n" +
        "    col = bg + m * (mix(pc, tint, ta * 0.3) - bg);\n" +
        "  }\n" +
        "  float ob = texelFetch(uObst, c, 0).r;\n" +
        "  col = mix(col, uObstCol * (0.9 + 0.1 * b), ob);\n" +
        "  o = vec4(col, 1.0); }";

    var progs = {}, TEX = {}, pool, pres, dye, pd, parts, partsV, simT = 0, partCnt = [0, 0], pRange = [64, 120, 64, 120], rhsRT, segE, vao, cur, piData = new Float32Array(SEGW * SEGH), readBuf = new Float32Array(SEGW * SEGH * 4);
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

    var partRoot = [0, 0, 0, 0], partRad = [8, 8];
    function setRoots(f) {
        ["L", "R"].forEach(function (side, i) {
            var r = f.root[side];
            if (r >= 0) { partRoot[i * 2] = (r % W) + 0.5; partRoot[i * 2 + 1] = (H - 1 - ((r / W) | 0)) + 0.5; }
            partRad[i] = f.rr[side];
        });
    }
    // particles start scattered over the vessels of their tree, with random ages
    function initParticles() {
        if (!PS) return;
        var cells = [[], []], i, n = PS * PS, data = new Float32Array(n * 4);
        for (i = 0; i < N; i++) if (baseMask[i]) cells[trees.L[i] ? 0 : 1].push(i);
        for (i = 0; i < n; i++) {
            var t = i & 1, list = cells[t].length ? cells[t] : cells[1 - t], c = list[(Math.random() * list.length) | 0];
            data[i * 4] = (c % W) + Math.random(); data[i * 4 + 1] = (H - 1 - ((c / W) | 0)) + Math.random(); data[i * 4 + 2] = t; data[i * 4 + 3] = Math.random() * PARTICLE_LIFE;
        }
        [parts.a, parts.b].forEach(function (rt) { gl.bindTexture(gl.TEXTURE_2D, rt.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PS, PS, gl.RGBA, gl.FLOAT, data); });
        [partsV.a, partsV.b].forEach(function (rt) { clearRT(rt); });
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
        // list of the vessel cells of each tree (texture cell indices), for the particles born anywhere in the vessels
        var cl = new Float32Array(MEMW * MEMH), nL = 0, nR = 0, ii;
        for (ii = 0; ii < N; ii++) if (trees.L[ii] && nL < MEMW * MEMH / 2) cl[nL++] = texIndex(ii);
        for (ii = 0; ii < N; ii++) if (trees.R[ii] && !trees.L[ii] && nL + nR < MEMW * MEMH) cl[nL + nR++] = texIndex(ii);
        partCnt = [nL, nR]; TEX.cells = makeR32(MEMW, MEMH, cl);
        TEX.obst = makeTex(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, flipU8(obst, 255));
        TEX.mask = makeTex(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, flipU8(baseMask, 255));
        progs.advect = prog(S_ADVECT); progs.diffuse = prog(S_DIFFUSE); progs.div = prog(S_DIV); progs.segsum = prog(S_SEGSUM); progs.pseg = prog(S_PSEG);
        progs.jacobi = prog(S_JACOBI); progs.grad = prog(S_GRAD); progs.dye = prog(S_DYE); progs.pd = prog(S_PD); progs.show = prog(S_SHOW);
        if (PS) { progs.part = prog(S_PART); progs.boid = prog(S_BOID); progs.partDraw = prog(FS_PART, VS_PART); }
        pool = [makeRT(W, H), makeRT(W, H), makeRT(W, H)]; cur = pool[0];
        pres = makePair(W, H); rhsRT = makeRT(W, H); segE = makeRT(SEGW, SEGH);
        dye = makePair(W, H, true, true); pd = makePair(W, H, true, true); if (PS) { parts = makePair(PS, PS); partsV = makePair(PS, PS); }
        vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        canvas.width = W * 2; canvas.height = H * 2; canvas.style.aspectRatio = W + " / " + H;
        resetFlow();
    }
    function clearRT(rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    function resetFlow() {
        pool.forEach(clearRT); [pres.a, pres.b, rhsRT, segE, dye.a, dye.b, pd.a, pd.b].forEach(clearRT);
        piPrev = null;
        phaseL = 0; simT = 0; initParticles();
    }
    function uploadObst() { gl.bindTexture(gl.TEXTURE_2D, TEX.obst); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.UNSIGNED_BYTE, flipU8(obst, 255)); }
    function uploadGeo() { gl.bindTexture(gl.TEXTURE_2D, TEX.geo); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, geoData); }

    // ---- 4. one time step
    var dbgText = "", dbgEl = document.getElementById("ns-debug");
    var bpm = BPM_DEFAULT, systolic = SYSTOLIC_DEFAULT, view = 0, phaseL = 0, phaseR = 0;
    function diastolic() { return systolic * DIASTOLIC_RATIO; }
    function step(dt) {
        // pressure applied at the ostia: diastolic + (systolic - diastolic) * pulse, in mmHg, times the pressure units per mmHg
        var dia = diastolic(), pL = PUt.L * (dia + (systolic - dia) * beat(phaseL)), pR = PUt.R * (dia + (systolic - dia) * beat(phaseR)), invDt = 1 / dt;
        // colour range of the pressure view: fixed at an absolute scale (endpoint pressure to systolic), so that the pulse is visible as a change of colour
        pRange[0] = pRange[2] = dia * OUTLET_BACK_RATIO; pRange[1] = pRange[3] = systolic;
        var pg, i, free = pool.filter(function (r) { return r !== cur; });
        // 1. advect the velocity
        pg = use(progs.advect); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); gl.uniform1f(pg.u.uDt, dt);
        var adv = free[0]; drawTo(adv);
        // 2. viscous diffusion (implicit Jacobi sweeps, no-slip)
        pg = use(progs.diffuse); geoUnits(pg); bindTex(pg, "uV0", 2, adv.tex); gl.uniform1f(pg.u.uA, NU * dt);
        var targets = [free[1], cur], k = adv;
        for (i = 0; i < DIFFUSE; i++) { var out = targets[i % 2]; bindTex(pg, "uVk", 3, k.tex); drawTo(out); k = out; }
        cur = k; free = pool.filter(function (r) { return r !== cur; });
        // 3. right-hand side of the pressure equation (pressure inlet, resistive outlets)
        pg = use(progs.div); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); gl.uniform2f(pg.u.uPin, pL, pR); gl.uniform2f(pg.u.uPout, PUt.L * dia * OUTLET_BACK_RATIO, PUt.R * dia * OUTLET_BACK_RATIO); drawTo(rhsRT);
        // 4. coarse pressure: sum of the residual per tree layer (GPU), small graph solve (CPU), seed the pressure (GPU)
        if (G.n > 0) {
            pg = use(progs.segsum); bindTex(pg, "uRhs", 0, rhsRT.tex); bindTex(pg, "uInfo", 1, TEX.info); bindTex(pg, "uMembers", 2, TEX.members); gl.uniform1i(pg.u.uN, G.n);
            drawTo(segE);
            var rows = Math.ceil(G.n / SEGW);
            gl.bindFramebuffer(gl.FRAMEBUFFER, segE.fbo); gl.readPixels(0, 0, SEGW, rows, gl.RGBA, gl.FLOAT, readBuf);
            var bs = new Float64Array(G.n), extra = new Float64Array(G.n);
            for (i = 0; i < G.n; i++) { bs[i] = -readBuf[i * 4]; extra[i] = G.kappa[i] * invDt; }
            var pi = Core.solveSegments(G, bs, piPrev, 100, 1e-18, extra, false); piPrev = pi;
            // numbers for the on-screen readout (pressure of the coarse solve, mmHg): at the ostium, mean and minimum over each tree
            var st = [{ r: 0, lo: 1e30, sum: 0, n: 0 }, { r: 0, lo: 1e30, sum: 0, n: 0 }];
            for (i = 0; i < G.n; i++) { var tt = G.segTree[i] === 0 ? 0 : 1, mv = pi[i] * invDt / (tt ? PUt.R : PUt.L); st[tt].sum += mv; st[tt].n++; if (mv < st[tt].lo) st[tt].lo = mv; }
            ["L", "R"].forEach(function (sd, ti) { var sg = G.seg ? G.seg[field.root[sd]] : -1; st[ti].r = sg >= 0 ? pi[sg] * invDt / PUt[sd] : NaN; });
            dbgText = "L: ostium " + st[0].r.toFixed(0) + ", mean " + (st[0].sum / Math.max(st[0].n, 1)).toFixed(0) + ", min " + st[0].lo.toFixed(0) + "  |  R: ostium " + st[1].r.toFixed(0) + ", mean " + (st[1].sum / Math.max(st[1].n, 1)).toFixed(0) + ", min " + st[1].lo.toFixed(0) + " mmHg  |  applied " + (pL / PUt.L).toFixed(0) + "/" + (pR / PUt.R).toFixed(0) + ", endpoints " + (dia * OUTLET_BACK_RATIO).toFixed(0);
            piData.fill(0); piData.set(pi);
            uploadR32(TEX.pi, SEGW, rows, piData.subarray(0, SEGW * rows));
        }
        pg = use(progs.pseg); geoUnits(pg); bindTex(pg, "uSegIdx", 2, TEX.segIdx); bindTex(pg, "uPi", 3, TEX.pi); drawTo(pres.a);
        // 5. local Jacobi sweeps
        pg = use(progs.jacobi); geoUnits(pg); bindTex(pg, "uRhs", 3, rhsRT.tex); gl.uniform1f(pg.u.uInvDt, invDt);
        for (i = 0; i < JACOBI; i++) { bindTex(pg, "uP", 2, pres.a.tex); drawTo(pres.b); pres.swap(); }
        // 6. subtract the pressure gradient on the faces
        pg = use(progs.grad); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); bindTex(pg, "uP", 3, pres.a.tex);
        var nxt = free[0]; drawTo(nxt); cur = nxt;
        // 7. dye
        pg = use(progs.dye); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); bindTex(pg, "uDye", 3, dye.a.tex);
        gl.uniform1f(pg.u.uDt, dt); gl.uniform1f(pg.u.uDecay, Math.exp(-DYE_DECAY * dt)); gl.uniform1f(pg.u.uDiff, DYE_DIFFUSION); gl.uniform1f(pg.u.uOutlet, DYE_OUTLET);
        gl.uniform2f(pg.u.uInj, DYE_RATE * (DYE_BASE + (1 - DYE_BASE) * bolus(phaseL)) * dt, DYE_RATE * (DYE_BASE + (1 - DYE_BASE) * bolus(phaseR)) * dt);
        drawTo(dye.b); dye.swap();
        // 8. pressure for display
        pg = use(progs.pd); bindTex(pg, "uP", 0, pres.a.tex); bindTex(pg, "uPd", 1, pd.a.tex); gl.uniform1f(pg.u.uInvDt, 1 / dt); gl.uniform1f(pg.u.uMixF, 0.15);
        drawTo(pd.b); pd.swap();
        // 9. tracer particles
        if (PS) {
            pg = use(progs.boid); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); bindTex(pg, "uPart", 3, parts.a.tex); bindTex(pg, "uPartV", 4, partsV.a.tex);
            gl.uniform1f(pg.u.uDt, dt); gl.uniform1f(pg.u.uRadius, BOID_RADIUS * K1); gl.uniform1f(pg.u.uSep, BOID_SEPARATION * K1); gl.uniform1f(pg.u.uASep, BOID_SEPARATE * K1);
            gl.uniform1f(pg.u.uAAl, BOID_ALIGN); gl.uniform1f(pg.u.uACoh, BOID_COHESION); gl.uniform1f(pg.u.uTau, BOID_TAU); gl.uniform1f(pg.u.uVmax, PARTICLE_MAX_SPEED * K1); gl.uniform1f(pg.u.uWallK, BOID_WALL_K); gl.uniform1f(pg.u.uWallR, BOID_WALL_RANGE * K1); gl.uniform1f(pg.u.uScale, K1);
            drawTo(partsV.b); partsV.swap();
            pg = use(progs.part); geoUnits(pg); bindTex(pg, "uVel", 2, cur.tex); bindTex(pg, "uPart", 3, parts.a.tex); bindTex(pg, "uCells", 4, TEX.cells); bindTex(pg, "uPartV", 5, partsV.a.tex);
            gl.uniform2f(pg.u.uCnt, partCnt[0], partCnt[1]); gl.uniform2f(pg.u.uOff, 0, partCnt[0]); gl.uniform1f(pg.u.uJitter, PARTICLE_JITTER * K1); gl.uniform1f(pg.u.uShare, PARTICLE_INLET_SHARE);
            gl.uniform1f(pg.u.uDt, dt); gl.uniform1f(pg.u.uTime, simT); gl.uniform1f(pg.u.uMaxAge, PARTICLE_LIFE);
            gl.uniform4f(pg.u.uRoot, partRoot[0], partRoot[1], partRoot[2], partRoot[3]); gl.uniform2f(pg.u.uRad, partRad[0], partRad[1]);
            drawTo(parts.b); parts.swap();
        }
        simT += dt;
        // heartbeat
        var period = 60 / bpm; phaseL = (phaseL + dt / period) % 1;
        phaseR = (((phaseL - rightDelay(bpm) / period) % 1) + 1) % 1;
    }
    function show() {
        var pg = use(progs.show); geoUnits(pg);
        bindTex(pg, "uDye", 2, dye.a.tex); bindTex(pg, "uMask", 3, TEX.mask); bindTex(pg, "uPd", 4, pd.a.tex); gl.uniform4f(pg.u.uRange, pRange[0], pRange[1], pRange[2], pRange[3]); gl.uniform2f(pg.u.uPU, PUt.L, PUt.R);
        gl.uniform2f(pg.u.uBeat, beat(phaseL), beat(phaseR)); gl.uniform3f(pg.u.uObstCol, OBSTACLE_COLOR[0], OBSTACLE_COLOR[1], OBSTACLE_COLOR[2]); gl.uniform1i(pg.u.uView, view);
        drawTo(null, canvas.width, canvas.height);
        if (PS) {                  // particles on top, soft white dots
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            var pp = use(progs.partDraw); bindTex(pp, "uPart", 0, parts.a.tex);
            gl.uniform2f(pp.u.uSz, W, H); gl.uniform1f(pp.u.uSize, PARTICLE_SIZE); gl.uniform1f(pp.u.uMaxAge, PARTICLE_LIFE); gl.uniform1f(pp.u.uClock, performance.now() / 1000);   // wall clock: the particles twinkle even when paused
            gl.drawArrays(gl.POINTS, 0, PS * PS); gl.disable(gl.BLEND);
        }
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
    function bpText() { return Math.round(systolic) + "/" + Math.round(diastolic()) + " mmHg"; }
    var verEl = document.getElementById("ns-version"); if (verEl) verEl.textContent = NS_VERSION;
    function bpUpdate() { if (presVal) presVal.textContent = bpText(); }
    function legendUpdate() { if (legend && legend.firstElementChild && legend.lastElementChild) { legend.firstElementChild.textContent = Math.round(pRange[0]) + " mmHg"; legend.lastElementChild.textContent = Math.round(pRange[1]) + " mmHg"; } }
    var running = false, userPaused = false, last = 0, raf = 0, frames = 0, accum = 0, adjustments = 0;
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function frame(now) {
        raf = 0; if (!running) return;
        var dt = Math.min((now - last) / 1000, 1 / 30); last = now;
        step(dt); show();
        if (view === 1 && (frames & 7) === 0) legendUpdate();
        if (dbgEl && (frames & 15) === 0) dbgEl.textContent = dbgText;
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
    if (presIn) { presIn.min = SYSTOLIC_MIN; presIn.max = SYSTOLIC_MAX; presIn.step = 1; presIn.value = systolic; bpUpdate();
        presIn.addEventListener("input", function () { systolic = parseFloat(presIn.value); bpUpdate(); }); }
    if (playBtn) playBtn.addEventListener("click", function () { userPaused = running; setRunning(!running); });
    if (resetBtn) resetBtn.addEventListener("click", function () { resetFlow(); show(); });
    if (clearBtn) clearBtn.addEventListener("click", clearObstacles);
    if (viewBtn) viewBtn.addEventListener("click", function () {
        view = view ? 0 : 1; viewBtn.textContent = view ? "View: Pressure" : "View: Flow"; if (legend) legend.style.display = view ? "" : "none"; legendUpdate(); if (!running) show();
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
        baseMask = new Uint8Array(N); edtAll = new Float32Array(N);
        for (var i = 0; i < N; i++) { baseMask[i] = trees.L[i] || trees.R[i] ? 1 : 0; edtAll[i] = Math.max(edt.L[i], edt.R[i]); }
        ["L", "R"].forEach(function (side) {
            var seen = {}; epStatic[side] = [];
            (model.endpoints[side] || []).forEach(function (pt) { var c = Core.nearestIn(trees[side], W, H, pt[0], pt[1]); if (c >= 0 && !seen[c]) { seen[c] = 1; epStatic[side].push(c); } });
        });
        obst = new Uint8Array(N);
        // scale: the arteries close to the ostium are ARTERY_DIAMETER_MM wide; viscosity of blood; speeds of the real flow shown SLOWMO times slower
        var hs = [];
        ["L", "R"].forEach(function (side) {
            var b = Core.bfs4(trees[side], W, H, rootStatic[side]), vals = [], k;
            for (k = 0; k < b.count; k++) if (b.g[b.queue[k]] <= 60 * K1) vals.push(edt[side][b.queue[k]]);
            vals.sort(function (x, y) { return x - y; });
            hOst[side] = 2 * (vals.length ? vals[vals.length >> 1] : 4); hs.push(hOst[side]);
        });
        mmPerCell = ARTERY_DIAMETER_MM / (0.5 * (hs[0] + hs[1]));
        NU = BLOOD_VISCOSITY_MM2_S / (SLOWMO * mmPerCell * mmPerCell);
        vPeakCells = V_PEAK_MM_S / (mmPerCell * SLOWMO);
        var r = computeGeometry();
        if (!r) { bail("The geometry is too large for this simulation."); return; }
        field = r.f; G = r.G; geoData = geoArray(field);
        try { setupGL(); } catch (err) { if (window.console) console.error(err); bail("The simulation could not start on this device."); return; }
        setRoots(field);
        var params = new URLSearchParams(location.search), pre = parseInt(params.get("nssteps"), 10);
        window.__ns = {
          paint: function (cx, cy) { paintAt({ clientX: cx, clientY: cy, shiftKey: false }); }, view: function (v) { view = v; show(); }, step: function (n) { for (var k = 0; k < n; k++) step(1 / 60); show(); }, segments: G.n, endpoints: { L: epStatic.L.length, R: epStatic.R.length }, pu: PUt, particles: PS * PS, mmPerCell: mmPerCell, nu: NU, vPeakCells: vPeakCells };
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
