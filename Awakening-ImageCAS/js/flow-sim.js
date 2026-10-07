// Pulsatile flow in an unfolded coronary tree, in real time with WebGL2.
//
// Model: incompressible flow in the vessel geometry, driven by a pulsatile inflow at the ostium and drained along the tree.
// The velocity is the solution of the Poisson problem  laplacian(P) = -source  on the vessel mask (solved once, on the CPU, with a
// preconditioned conjugate gradient), scaled at every frame by the heartbeat q(t):  u = -q(t) grad(P) * profile.
// For an irrotational start and prescribed inflow this is the exact solution of the unsteady incompressible Euler equations; a
// Poiseuille-type profile across each vessel (from the distance to the wall) stands in for viscosity. A dye of each colour is then
// advected by this flow on the GPU: semi-Lagrangian advection, injected at each ostium during systole.
(function () {
    "use strict";

    var canvas = document.getElementById("fl-canvas");
    if (!canvas) return;
    var figure = canvas.parentNode;

    // ---- configuration
    var SRC = canvas.getAttribute("data-src");                 // one image with both trees (split automatically)
    var SRC_L = canvas.getAttribute("data-src-left");          // or one image per tree
    var SRC_R = canvas.getAttribute("data-src-right");
    var SIM_MAX = 720;               // longest side of the simulation grid, in voxels
    var RES_TEST = parseFloat(new URLSearchParams(location.search).get("res"));   // ?res=360: coarser grid, for quick checks
    if (!isNaN(RES_TEST)) SIM_MAX = RES_TEST;
    var RES_SCALE = (SIM_MAX / 720) * (SIM_MAX / 720);       // keeps the speed, as a fraction of the domain, constant
    var HEART_PERIOD = 1.0;          // seconds
    var RIGHT_DELAY = 0.25;          // the right tree pulses this much after the left one
    var FLOW_BASE = 350, FLOW_PEAK = 7000;      // inflow, in voxel^2 / s
    var DYE_RATE = 40;               // dye injected at the root during systole, per second
    var DYE_DECAY = 0.12;            // 1 / s
    var DYE_DIFFUSION = 0.06;        // small diffusion of the dye per step
    // optional root positions (the ostia) as "x,y" fractions of the grid, e.g. data-root-left="0.4,0.9"; default = thickest point
    function rootAttr(name) { var v = canvas.getAttribute(name); if (!v) return null; var a = v.split(",").map(parseFloat); return a.length === 2 && !isNaN(a[0]) && !isNaN(a[1]) ? a : null; }
    var ROOTS = { L: rootAttr("data-root-left"), R: rootAttr("data-root-right") };
    var SWAP_SIDES = false;          // true: leftmost tree in the image is the right coronary

    var fallbackNote = document.getElementById("fl-note");
    function bail(msg) {
        figure.className += " fl-nogl";
        if (fallbackNote) fallbackNote.textContent = msg;
    }

    var gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) { bail("This browser cannot run the WebGL2 simulation."); return; }

    // ---- 1. mask: image(s) -> two trees on the simulation grid
    function loadImage(src, cb) {
        var im = new Image();
        im.onload = function () { cb(im); };
        im.onerror = function () { bail("The mask image could not be loaded."); };
        im.src = src;
    }
    // dark pixels are the vessel; a coloured dot, if present, marks the ostium (it counts as vessel too)
    function binarize(im) {
        var c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height, b = new Uint8Array(w * h);
        var mx = 0, my = 0, mn = 0;
        for (var i = 0; i < w * h; i++) {
            var r = d[i * 4], g = d[i * 4 + 1], bl = d[i * 4 + 2];
            if (Math.max(r, g, bl) - Math.min(r, g, bl) > 40) { b[i] = 1; mx += i % w; my += (i / w) | 0; mn++; }
            else if (r < 128) b[i] = 1;
        }
        return { w: w, h: h, b: b, marker: mn > 20 ? [mx / mn, my / mn] : null };
    }
    function components(img) {
        var w = img.w, h = img.h, lab = new Int32Array(w * h).fill(-1), comps = [], stack = [];
        for (var i = 0; i < w * h; i++) {
            if (!img.b[i] || lab[i] >= 0) continue;
            var id = comps.length, pix = [i]; lab[i] = id; stack.push(i);
            while (stack.length) {
                var p = stack.pop(), x = p % w, y = (p / w) | 0;
                var nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
                for (var k = 0; k < 4; k++) { var q = nb[k]; if (q >= 0 && img.b[q] && lab[q] < 0) { lab[q] = id; pix.push(q); stack.push(q); } }
            }
            comps.push(pix);
        }
        comps.sort(function (a, b) { return b.length - a.length; });
        return comps;
    }
    function centroidX(pix, w) { var s = 0; pix.forEach(function (p) { s += p % w; }); return s / pix.length; }
    function bbox(pix, w) {
        var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        pix.forEach(function (p) { var x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
        return { x0: x0, y0: y0, x1: x1, y1: y1 };
    }

    // Each tree is cropped from its image and the crops are laid out side by side at a common scale
    // (the images are assumed to share the same pixel size). Returns { W, H, trees: {L, R}, roots: {L, R} }.
    function buildTrees(imgs, sides) {
        var picked = [];
        if (imgs.length === 1) {
            var w0 = imgs[0].w, comps = components(imgs[0]).slice(0, 2);
            comps.sort(function (a, b) { return centroidX(a, w0) - centroidX(b, w0); });
            // the leftmost tree of the image is drawn as the left coronary (blue), unless swapped
            picked = [{ side: SWAP_SIDES ? "R" : "L", img: imgs[0], pix: comps[0] }, { side: SWAP_SIDES ? "L" : "R", img: imgs[0], pix: comps[1] }];
        } else {
            imgs.forEach(function (im, i) { picked.push({ side: sides[i], img: im, pix: components(im)[0] }); });
        }
        var pad = 14, gap = imgs.length === 1 ? 0 : 50, totalW = 0, totalH = 0;
        picked.forEach(function (t) {
            var bb = bbox(t.pix, t.img.w);
            t.bb = { x0: bb.x0 - pad, y0: bb.y0 - pad, x1: bb.x1 + pad, y1: bb.y1 + pad };
            t.cw = t.bb.x1 - t.bb.x0 + 1; t.ch = t.bb.y1 - t.bb.y0 + 1;
            totalH = Math.max(totalH, t.ch);
        });
        if (imgs.length === 1) {   // one image: keep the original layout, only crop to the union
            var ux0 = Math.min(picked[0].bb.x0, picked[1].bb.x0), ux1 = Math.max(picked[0].bb.x1, picked[1].bb.x1);
            var uy0 = Math.min(picked[0].bb.y0, picked[1].bb.y0), uy1 = Math.max(picked[0].bb.y1, picked[1].bb.y1);
            picked.forEach(function (t) { t.ox = t.bb.x0 - ux0; t.oy = t.bb.y0 - uy0; t.bb.x0 = ux0; t.bb.y0 = uy0; t.cw = ux1 - ux0 + 1; t.ch = uy1 - uy0 + 1; t.ox = 0; t.oy = 0; });
            totalW = ux1 - ux0 + 1; totalH = uy1 - uy0 + 1;
        } else {
            var xo = 0;
            picked.forEach(function (t) { t.ox = xo; t.oy = 0; xo += t.cw + gap; });
            totalW = xo - gap;
        }
        var s = SIM_MAX / Math.max(totalW, totalH);
        var SW = Math.round(totalW * s), SH = Math.round(totalH * s);
        var out = { W: SW, H: SH, trees: {}, roots: {} };
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
            if (t.img.marker) out.roots[t.side] = [(t.img.marker[0] - t.bb.x0 + t.ox) * s, (t.img.marker[1] - t.bb.y0 + t.oy) * s];
        });
        return out;
    }

    // ---- 2. geometry on the CPU: wall distance, root, source/sink shape, and the unit-source pressure
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
    function geodesic(mask, W, H, root) {
        var g = new Float32Array(W * H).fill(-1), q = [root], head = 0; g[root] = 0;
        while (head < q.length) {
            var p = q[head++], x = p % W, y = (p / W) | 0;
            for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                var xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                var n = yy * W + xx;
                if (mask[n] && g[n] < 0) { g[n] = g[p] + (dx && dy ? 1.4142 : 1); q.push(n); }
            }
        }
        return g;
    }

    function prepare(trees, W, H, roots) {
        var N = W * H, mask = new Uint8Array(N), tree = new Float32Array(N).fill(-1), s = new Float32Array(N);
        var info = {};
        ["L", "R"].forEach(function (side, ti) {
            var m = trees[side], d = chamfer(m, W, H), root = -1, best = -1;
            var want = roots && roots[side] ? roots[side] : (ROOTS[side] ? [ROOTS[side][0] * W, ROOTS[side][1] * H] : null);
            if (want) {
                var bd = 1e9;
                for (var i = 0; i < N; i++) if (m[i]) { var dd = Math.hypot(i % W - want[0], ((i / W) | 0) - want[1]); if (dd < bd) { bd = dd; root = i; } }
            } else {
                for (var j = 0; j < N; j++) if (m[j] && d[j] > best) { best = d[j]; root = j; }
            }
            var g = geodesic(m, W, H, root), gmax = 1, n;
            for (n = 0; n < N; n++) if (g[n] > gmax) gmax = g[n];
            var inlet = [], rr = Math.max(3, 1.6 * d[root]), rx0 = root % W, ry0 = (root / W) | 0;
            var sink = 0;
            for (n = 0; n < N; n++) {
                if (!m[n]) continue;
                mask[n] = 1; tree[n] = ti;
                if (Math.hypot(n % W - rx0, ((n / W) | 0) - ry0) <= rr) inlet.push(n);
                var w = Math.pow(g[n] / gmax, 2); s[n] = -w; sink += w;
            }
            for (n = 0; n < N; n++) if (m[n]) s[n] /= sink;                 // sinks sum to -1 over the tree
            inlet.forEach(function (p) { s[p] += 1 / inlet.length; });       // inflow sums to +1
            info[side] = { root: root, radius: d[root] };
        });

        // pressure for the unit source: graph Laplacian A P = s over the fluid voxels (preconditioned conjugate gradient)
        var idx = new Int32Array(N).fill(-1), cells = [];
        for (var i2 = 0; i2 < N; i2++) if (mask[i2]) { idx[i2] = cells.length; cells.push(i2); }
        var M = cells.length, nb = new Int32Array(M * 4), deg = new Float64Array(M);
        cells.forEach(function (p, k) {
            var x = p % W, y = (p / W) | 0, c = 0;
            var cand = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
            for (var q = 0; q < 4; q++) { var o = cand[q] >= 0 && mask[cand[q]] ? idx[cand[q]] : -1; nb[k * 4 + q] = o; if (o >= 0) c++; }
            deg[k] = Math.max(c, 1);
        });
        var b = new Float64Array(M), x = new Float64Array(M), r = new Float64Array(M), z = new Float64Array(M), pv = new Float64Array(M), Ap = new Float64Array(M);
        for (var k = 0; k < M; k++) { b[k] = s[cells[k]]; r[k] = b[k]; z[k] = r[k] / deg[k]; pv[k] = z[k]; }
        var rz = 0, bn = 0; for (k = 0; k < M; k++) { rz += r[k] * z[k]; bn += b[k] * b[k]; }
        for (var it = 0; it < 6000 && rz > 1e-14 * Math.max(bn, 1e-30); it++) {
            var pAp = 0;
            for (k = 0; k < M; k++) {
                var a = 0; for (var q2 = 0; q2 < 4; q2++) { var o2 = nb[k * 4 + q2]; if (o2 >= 0) a += pv[k] - pv[o2]; }
                Ap[k] = a; pAp += pv[k] * a;
            }
            var alpha = rz / pAp, rzNew = 0;
            for (k = 0; k < M; k++) { x[k] += alpha * pv[k]; r[k] -= alpha * Ap[k]; z[k] = r[k] / deg[k]; rzNew += r[k] * z[k]; }
            var beta = rzNew / rz; rz = rzNew;
            for (k = 0; k < M; k++) pv[k] = z[k] + beta * pv[k];
        }
        var P = new Float32Array(N);
        for (k = 0; k < M; k++) P[cells[k]] = x[k];

        // Poiseuille-type profile across the vessel: u ~ 1.5 * (1 - (1 - D/R)^2), R = local vessel radius (largest wall distance nearby)
        var profile = new Float32Array(N).fill(0.05), dAll = new Float32Array(N);
        ["L", "R"].forEach(function (side) { var dd = chamfer(trees[side], W, H); for (var q = 0; q < N; q++) if (trees[side][q]) dAll[q] = dd[q]; });
        for (var pp = 0; pp < N; pp++) {
            if (!mask[pp]) continue;
            var px = pp % W, py = (pp / W) | 0, rad = Math.ceil(dAll[pp]) + 2, Rloc = dAll[pp], m2 = trees[tree[pp] < 0.5 ? "L" : "R"];
            for (var yy2 = Math.max(0, py - rad); yy2 <= Math.min(H - 1, py + rad); yy2++) for (var xx2 = Math.max(0, px - rad); xx2 <= Math.min(W - 1, px + rad); xx2++) {
                var q2 = yy2 * W + xx2;
                if (m2[q2] && dAll[q2] > Rloc) Rloc = dAll[q2];
            }
            var rel = Math.min(dAll[pp] / Math.max(Rloc, 1), 1);
            profile[pp] = Math.max(0.05, 1.5 * (1 - (1 - rel) * (1 - rel)));
        }

        // geo texture: R = unit source, G = unit-source pressure, B = +/- profile (sign = tree: + left, - right), A = fluid
        var geo = new Float32Array(N * 4);
        for (var i3 = 0; i3 < N; i3++) {
            // texture row 0 is the bottom: flip y so that the image is upright
            var xx = i3 % W, yy = (i3 / W) | 0, o3 = ((H - 1 - yy) * W + xx) * 4;
            geo[o3] = s[i3]; geo[o3 + 1] = P[i3]; geo[o3 + 2] = tree[i3] > 0.5 ? -profile[i3] : profile[i3]; geo[o3 + 3] = mask[i3];
        }
        var maskBytes = new Uint8Array(N);
        for (var i4 = 0; i4 < N; i4++) { var x4 = i4 % W, y4 = (i4 / W) | 0; maskBytes[(H - 1 - y4) * W + x4] = mask[i4] ? 255 : 0; }
        return { geo: geo, maskBytes: maskBytes, info: info };
    }

    // ---- 3. WebGL
    var VS = "#version 300 es\nout vec2 vUv;\nvoid main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }";
    var HEAD = "#version 300 es\nprecision highp float; precision highp sampler2D;\nin vec2 vUv; out vec4 o;\n";
    function prog(fs) {
        function sh(type, src) {
            var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        }
        var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
        return { p: p, u: u };
    }

    // dye: velocity u = -q grad(P) * profile (pressure gradient with free-slip walls), semi-Lagrangian advection,
    // a little diffusion, and injection at the ostia during systole
    var P_DYE = HEAD +
        "uniform sampler2D uGeo, uDye; uniform vec2 uQ, uInj; uniform float uDt, uDecay, uDiff;\n" +
        "ivec2 SZ;\n" +
        "float fluid(ivec2 c){ if(c.x<0||c.y<0||c.x>=SZ.x||c.y>=SZ.y) return 0.0; return texelFetch(uGeo,c,0).a; }\n" +
        "float P(ivec2 c, float self){ return fluid(c) > 0.5 ? texelFetch(uGeo, c, 0).g : self; }\n" +
        "vec2 vel(ivec2 c){ c = clamp(c, ivec2(0), SZ - 1); vec4 g = texelFetch(uGeo, c, 0); if (g.a < 0.5) return vec2(0.0);\n" +
        "  vec2 gr = 0.5 * vec2(P(c + ivec2(1,0), g.g) - P(c - ivec2(1,0), g.g), P(c + ivec2(0,1), g.g) - P(c - ivec2(0,1), g.g));\n" +
        "  float q = g.b >= 0.0 ? uQ.x : uQ.y; return -q * abs(g.b) * gr; }\n" +
        "vec2 bil(vec2 p){ vec2 q = p - 0.5; ivec2 i = ivec2(floor(q)); vec2 f = q - vec2(i);\n" +
        "  return mix(mix(vel(i), vel(i + ivec2(1,0)), f.x), mix(vel(i + ivec2(0,1)), vel(i + ivec2(1,1)), f.x), f.y); }\n" +
        "void main(){ SZ = textureSize(uGeo, 0); ivec2 c = ivec2(gl_FragCoord.xy); vec4 g = texelFetch(uGeo, c, 0);\n" +
        "  if (g.a < 0.5) { o = vec4(0.0); return; }\n" +
        "  vec2 mid = vec2(c) + 0.5 - 0.5 * uDt * vel(c);\n" +                       // midpoint backtrace
        "  vec2 pos = (vec2(c) + 0.5 - uDt * bil(mid)) / vec2(SZ);\n" +
        "  vec2 d = texture(uDye, pos).rg;\n" +
        "  vec2 nb = vec2(0.0); float n = 0.0; ivec2 e[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));\n" +
        "  for (int k = 0; k < 4; k++) { if (fluid(c + e[k]) > 0.5) { nb += texelFetch(uDyeN, c + e[k], 0).rg; n += 1.0; } }\n" +
        "  d = mix(d, n > 0.0 ? nb / n : d, uDiff) * uDecay;\n" +
        "  if (g.r > 0.0) d += (g.b >= 0.0 ? vec2(uInj.x, 0.0) : vec2(0.0, uInj.y));\n" +
        "  o = vec4(d, 0.0, 1.0); }";
    P_DYE = P_DYE.replace("uniform sampler2D uGeo, uDye;", "uniform sampler2D uGeo, uDye, uDyeN;");

    var P_SHOW = HEAD +
        "uniform sampler2D uDye, uMask, uGeo; uniform vec2 uBeat;\n" +
        "void main(){\n" +
        "  vec2 uv = vec2(vUv.x, vUv.y);\n" +
        "  float b = texelFetch(uGeo, clamp(ivec2(uv * vec2(textureSize(uGeo, 0))), ivec2(0), textureSize(uGeo, 0) - 1), 0).b >= 0.0 ? uBeat.x : uBeat.y;\n" +
        "  float m = smoothstep(0.35, 0.65, texture(uMask, uv).r);\n" +
        "  vec2 d = texture(uDye, uv).rg;\n" +
        "  vec3 bg = vec3(0.07, 0.063, 0.11), vessel = vec3(0.16, 0.15, 0.22);\n" +
        "  vec3 cL = vec3(0.25, 0.62, 1.0), cR = vec3(1.0, 0.28, 0.33);\n" +
        "  vec3 glow = cL * (1.0 - exp(-1.2 * d.r)) + cR * (1.0 - exp(-1.2 * d.g));\n" +
        "  glow += vec3(1.0) * smoothstep(2.5, 7.0, d.r + d.g) * 0.2;\n" +
        "  glow *= 0.8 + 0.35 * b;\n" +
        "  vec3 col = bg + m * (vessel + 0.06 * b - bg) + m * glow * 1.1;\n" +
        "  o = vec4(col, 1.0); }";

    var W, H, TEX = {}, progs = {}, dye, vao;
    function makeTex(w, h, internal, format, type, filter, data) {
        var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
        return t;
    }
    function makeRT(w, h) {
        var tex = makeTex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
        var fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex: tex, fbo: fbo };
    }
    function use(pg) { gl.useProgram(pg.p); return pg; }
    function bindTex(pg, name, unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(pg.u[name], unit); }
    function drawTo(rt, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fbo : null); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3); }

    var simT = 0;
    function setup(model) {
        var prep = prepare(model.trees, model.W, model.H, model.roots);
        W = model.W; H = model.H;
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        TEX.geo = makeTex(W, H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, prep.geo);
        TEX.mask = makeTex(W, H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, prep.maskBytes);
        progs.dye = prog(P_DYE); progs.show = prog(P_SHOW);
        dye = { a: makeRT(W, H), b: makeRT(W, H), swap: function () { var t = this.a; this.a = this.b; this.b = t; } };
        vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        canvas.width = W * 2; canvas.height = H * 2;
        canvas.style.aspectRatio = W + " / " + H;
        resetDye();
    }
    function resetDye() {
        [dye.a, dye.b].forEach(function (rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); });
        simT = 0;
    }

    // ---- 4. heartbeat and one step
    function beat(t) {
        var ph = ((t / HEART_PERIOD) % 1 + 1) % 1, s = ph < 0.38 ? Math.sin(Math.PI * ph / 0.38) : 0;
        return s * s;
    }
    function bolus(t) {       // dye is released only during the rise of systole, so each beat sends a distinct bolus
        var ph = ((t / HEART_PERIOD) % 1 + 1) % 1, s = ph < 0.2 ? Math.sin(Math.PI * ph / 0.2) : 0;
        return s * s;
    }
    function step(dt) {
        var bL = beat(simT), bR = beat(simT - RIGHT_DELAY);
        var qL = RES_SCALE * (FLOW_BASE + FLOW_PEAK * bL), qR = RES_SCALE * (FLOW_BASE + FLOW_PEAK * bR);
        var pg = use(progs.dye);
        bindTex(pg, "uGeo", 0, TEX.geo); bindTex(pg, "uDye", 1, dye.a.tex); bindTex(pg, "uDyeN", 2, dye.a.tex);
        gl.uniform2f(pg.u.uQ, qL, qR); gl.uniform1f(pg.u.uDt, dt); gl.uniform1f(pg.u.uDecay, Math.exp(-DYE_DECAY * dt)); gl.uniform1f(pg.u.uDiff, DYE_DIFFUSION);
        gl.uniform2f(pg.u.uInj, DYE_RATE * bolus(simT) * dt, DYE_RATE * bolus(simT - RIGHT_DELAY) * dt);
        drawTo(dye.b, W, H); dye.swap();
        simT += dt;
    }
    function show() {
        var pg = use(progs.show); bindTex(pg, "uDye", 0, dye.a.tex); bindTex(pg, "uMask", 1, TEX.mask); bindTex(pg, "uGeo", 2, TEX.geo);
        gl.uniform2f(pg.u.uBeat, beat(simT), beat(simT - RIGHT_DELAY));
        drawTo(null, canvas.width, canvas.height);
    }

    // ---- 5. page logic
    var playBtn = document.getElementById("fl-play"), resetBtn = document.getElementById("fl-reset"), fullBtn = document.getElementById("fl-full");
    var running = false, userPaused = false, last = 0, raf = 0;
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function frame(now) {
        raf = 0; if (!running) return;
        var dt = Math.min((now - last) / 1000, 1 / 30); last = now;
        step(dt); show();
        raf = requestAnimationFrame(frame);
    }
    function setRunning(r) {
        running = r; playBtn.textContent = r ? "Pause" : "Play";
        if (r) { last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); }
    }
    playBtn.addEventListener("click", function () { userPaused = running; setRunning(!running); });
    resetBtn.addEventListener("click", function () { resetDye(); show(); });

    function fit() {
        if (document.fullscreenElement === figure) {
            canvas.style.width = Math.floor(Math.min(window.innerWidth, (window.innerHeight - 90) * W / H)) + "px";
        } else canvas.style.width = "";
    }
    if (fullBtn && document.fullscreenEnabled) {
        fullBtn.addEventListener("click", function () { if (document.fullscreenElement) document.exitFullscreen(); else figure.requestFullscreen(); });
        document.addEventListener("fullscreenchange", function () {
            fullBtn.textContent = document.fullscreenElement === figure ? "Exit full screen" : "Full screen"; fit(); show();
        });
        window.addEventListener("resize", fit);
    } else if (fullBtn) fullBtn.style.display = "none";

    function start(model) {
        try { setup(model); } catch (e) { bail("The simulation could not start on this device."); return; }
        var pre = parseFloat(new URLSearchParams(location.search).get("flow"));
        if (!isNaN(pre)) {
            for (var i = 0; i < pre * 60; i++) step(1 / 60); show(); userPaused = true;
            return;
        }
        if (reduced) { for (var j = 0; j < 8 * 60; j++) step(1 / 60); show(); userPaused = true; return; }
        show();
        if ("IntersectionObserver" in window) {
            new IntersectionObserver(function (e) {
                if (e[0].isIntersecting && !userPaused) setRunning(true);
                if (!e[0].isIntersecting) setRunning(false);
            }, { threshold: 0.3 }).observe(canvas);
        } else setRunning(true);
    }

    if (SRC_L && SRC_R) {
        loadImage(SRC_L, function (a) { loadImage(SRC_R, function (b) { start(buildTrees([binarize(a), binarize(b)], ["L", "R"])); }); });
    } else if (SRC) {
        loadImage(SRC, function (im) { start(buildTrees([binarize(im)])); });
    } else bail("No mask image configured.");
})();
