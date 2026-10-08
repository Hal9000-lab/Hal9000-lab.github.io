/* Two linked slice views (axial by S index, sagittal by R index) with point placing, markers and balls.
 *
 * Voxel coordinates (i, j, k) = (R, A, S) index, centre of voxel (0,0,0) at meta.origin_ras, 0.5 mm spacing:
 *   ras = origin + spacing * (i, j, k)
 * Axial   slice k: picture column c = (nR-1) - i, row r = (nA-1) - j   (patient right on the left of the picture, anterior on top)
 * Sagittal slice i: picture column c = (nA-1) - j, row r = (nS-1) - k  (anterior on the left, superior on top)
 */
(function (root) {
    "use strict";

    var SIDE_COLOR = { R: "#ff6b4a", L: "#4aa8ff" };

    function Viewer(host, opts) {
        opts = opts || {};
        this.host = host;
        this.onChange = opts.onChange || function () {};
        this.onSlice = opts.onSlice || function () {};
        this.meta = null;
        this.source = null;
        this.slice = { axial: 0, sagittal: 0 };
        this.points = { R: null, L: null };         // voxel coordinates [i, j, k]
        this.mode = null;                           // "R" | "L" | null (not placing)
        this.locked = false;                        // true after submitting: no more placing
        this.mouseSides = false;                    // mouse: left button places LEFT, right button places RIGHT
        this.zoom = 1; this.pan = { axial: [0, 0], sagittal: [0, 0] };
        this.reveal = null;                         // {gt:{R,L}, models:[{name,color,R,L}]} in voxel coordinates
        this.balls = null;                          // {R:[i,j,k], L:[...], radius}  (tutorial)
        this.cache = {};
        this.readOnly = !!opts.readOnly;
        this.scrolls = 0;
        this._build();
        this._loop = this._loop.bind(this);
        this._raf = requestAnimationFrame(this._loop);
    }

    Viewer.prototype._build = function () {
        var self = this;
        this.host.innerHTML = "";
        this.panes = {};
        ["axial", "sagittal"].forEach(function (plane) {
            var pane = document.createElement("div"); pane.className = "vw-pane vw-" + plane;
            var title = document.createElement("div"); title.className = "vw-title";
            title.textContent = plane === "axial" ? "Axial (scroll S)" : "Sagittal (scroll R)";
            var wrap = document.createElement("div"); wrap.className = "vw-canvas-wrap";
            var cv = document.createElement("canvas"); cv.tabIndex = 0; cv.className = "vw-canvas";
            var edges = document.createElement("div"); edges.className = "vw-edges";
            var labs = plane === "axial" ? ["A", "P", "R", "L"] : ["S", "I", "A", "P"];
            edges.innerHTML = '<span class="e-t">' + labs[0] + '</span><span class="e-b">' + labs[1] + '</span><span class="e-l">' + labs[2] + '</span><span class="e-r">' + labs[3] + '</span>';
            wrap.appendChild(cv); wrap.appendChild(edges);
            var row = document.createElement("div"); row.className = "vw-slider";
            var rng = document.createElement("input"); rng.type = "range"; rng.min = 0; rng.max = 0; rng.value = 0; rng.setAttribute("aria-label", plane + " slice");
            var lab = document.createElement("span"); lab.className = "vw-idx";
            row.appendChild(rng); row.appendChild(lab);
            pane.appendChild(title); pane.appendChild(wrap); pane.appendChild(row);
            self.host.appendChild(pane);
            self.panes[plane] = { pane: pane, cv: cv, ctx: cv.getContext("2d"), rng: rng, lab: lab, wrap: wrap };
            rng.addEventListener("input", function () { self.setSlice(plane, +rng.value, true); });
            cv.addEventListener("wheel", function (e) { e.preventDefault(); self.setSlice(plane, self.slice[plane] + (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 5 : 1), true); }, { passive: false });
            cv.addEventListener("keydown", function (e) {
                var d = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, PageUp: -5, PageDown: 5 }[e.key];
                if (d) { e.preventDefault(); self.setSlice(plane, self.slice[plane] + d, true); }
            });
            self._pointer(plane);
        });
        window.addEventListener("resize", function () { self._resize(); });
    };

    Viewer.prototype._pointer = function (plane) {
        var self = this, p = this.panes[plane], down = null;
        p.cv.addEventListener("contextmenu", function (e) { if (self.mouseSides && !self.readOnly) e.preventDefault(); });
        p.cv.addEventListener("pointerdown", function (e) {
            try { p.cv.setPointerCapture(e.pointerId); } catch (err) {} p.cv.focus({ preventScroll: true });
            down = { x: e.clientX, y: e.clientY, px: self.pan[plane][0], py: self.pan[plane][1], moved: false };
        });
        p.cv.addEventListener("pointermove", function (e) {
            if (!down) return;
            var dx = e.clientX - down.x, dy = e.clientY - down.y;
            if (!down.moved && Math.hypot(dx, dy) > 5) down.moved = true;
            if (down.moved && self.zoom > 1) { self.pan[plane] = [down.px + dx, down.py + dy]; self._clampPan(plane); }
        });
        p.cv.addEventListener("pointerup", function (e) {
            var d = down; down = null;
            if (!d || d.moved || self.readOnly || self.locked || !self.meta) return;
            // mouse with "buttons" option: left button = LEFT ostium, right button = RIGHT ostium; otherwise (touch, pen, option off) the selected button
            var side = (self.mouseSides && e.pointerType === "mouse") ? (e.button === 2 ? "R" : e.button === 0 ? "L" : null) : self.mode;
            if (!side) return;
            var r = p.cv.getBoundingClientRect(), t = self._toImage(plane, e.clientX - r.left, e.clientY - r.top);
            self._place(plane, t[0], t[1], side);
        });
    };

    Viewer.prototype._dims = function (plane) {
        var s = this.meta.shape_ijk;                     // nR, nA, nS
        return plane === "axial" ? { w: s[0], h: s[1], n: s[2] } : { w: s[1], h: s[2], n: s[0] };
    };

    Viewer.prototype._fit = function (plane) {
        var d = this._dims(plane), p = this.panes[plane], cssW = p.cv.clientWidth, cssH = p.cv.clientHeight;
        var base = Math.min(cssW / d.w, cssH / d.h);
        var s = base * this.zoom;
        return { s: s, ox: (cssW - d.w * s) / 2 + this.pan[plane][0], oy: (cssH - d.h * s) / 2 + this.pan[plane][1], d: d };
    };

    Viewer.prototype._clampPan = function (plane) {
        var f = this._fit(plane), p = this.panes[plane], lim = [Math.max(0, (f.d.w * f.s - p.cv.clientWidth) / 2 + 40), Math.max(0, (f.d.h * f.s - p.cv.clientHeight) / 2 + 40)];
        this.pan[plane][0] = Math.max(-lim[0], Math.min(lim[0], this.pan[plane][0]));
        this.pan[plane][1] = Math.max(-lim[1], Math.min(lim[1], this.pan[plane][1]));
    };

    // css pixel -> continuous picture pixel
    Viewer.prototype._toImage = function (plane, x, y) { var f = this._fit(plane); return [(x - f.ox) / f.s, (y - f.oy) / f.s]; };

    // picture pixel (continuous, pixel centres at +0.5) <-> voxel coordinates for a given slice
    Viewer.prototype.voxelFromImage = function (plane, xi, yi) {
        var s = this.meta.shape_ijk, a = xi - 0.5, b = yi - 0.5;
        if (plane === "axial") return [(s[0] - 1) - a, (s[1] - 1) - b, this.slice.axial];
        return [this.slice.sagittal, (s[1] - 1) - a, (s[2] - 1) - b];
    };
    Viewer.prototype.imageFromVoxel = function (plane, v) {
        var s = this.meta.shape_ijk;
        return plane === "axial" ? [(s[0] - 1) - v[0] + 0.5, (s[1] - 1) - v[1] + 0.5] : [(s[1] - 1) - v[1] + 0.5, (s[2] - 1) - v[2] + 0.5];
    };

    Viewer.prototype._place = function (plane, xi, yi, side) {
        var d = this._dims(plane);
        if (xi < 0 || yi < 0 || xi > d.w || yi > d.h) return;
        side = side || this.mode;
        var v = this.voxelFromImage(plane, xi, yi);
        this.points[side] = v;
        // the other view jumps to the plane through the new point, so that it can be refined there
        if (plane === "axial") this.setSlice("sagittal", Math.round(v[0]));
        else this.setSlice("axial", Math.round(v[2]));
        this.onChange(side, v);
    };

    Viewer.prototype.setSlice = function (plane, idx, fromUser) {
        if (!this.meta) return;
        var n = this._dims(plane).n;
        idx = Math.max(0, Math.min(n - 1, Math.round(idx)));
        if (fromUser && idx !== this.slice[plane]) this.scrolls++;
        this.slice[plane] = idx;
        var p = this.panes[plane]; p.rng.value = idx; p.lab.textContent = (idx + 1) + " / " + n;
        this._ensure(plane, idx);
        this.onSlice(plane, idx);
    };

    Viewer.prototype._ensure = function (plane, idx) {
        var self = this, key = plane + idx;
        for (var d = 0; d <= 3; d++) [idx - d, idx + d].forEach(function (q) {
            var n = self._dims(plane).n; if (q < 0 || q >= n) return;
            var kk = plane + q + "@" + self.meta.token;
            if (!self.cache[kk]) {
                self.cache[kk] = "loading";
                self.source.slice(self.meta, plane, q).then(function (img) { self.cache[kk] = img; }, function () { self.cache[kk] = "error"; });
            }
        });
        return key;
    };

    Viewer.prototype.load = function (source, meta, opts) {
        opts = opts || {};
        this.source = source; this.meta = meta; this.cache = {};
        this.points = { R: null, L: null }; this.reveal = null; this.balls = null; this.mode = null; this.scrolls = 0;
        this.zoom = 1; this.pan = { axial: [0, 0], sagittal: [0, 0] };
        var s = meta.shape_ijk;
        this.panes.axial.rng.max = s[2] - 1; this.panes.sagittal.rng.max = s[0] - 1;
        this._resize();
        var c = opts.start || [s[0] / 2, s[1] / 2, s[2] / 2];
        this.setSlice("axial", c[2]); this.setSlice("sagittal", c[0]);
    };

    Viewer.prototype.setLocked = function (b) { this.locked = !!b; };
    Viewer.prototype.setMode = function (m) { this.mode = m; this.host.classList.toggle("placing", !!m); this.host.dataset.mode = m || ""; };
    Viewer.prototype.setZoom = function (z) { this.zoom = z; if (z <= 1) this.pan = { axial: [0, 0], sagittal: [0, 0] }; this._clampPan("axial"); this._clampPan("sagittal"); };
    Viewer.prototype.setReveal = function (rv) { this.reveal = rv; };
    Viewer.prototype.setBalls = function (b) { this.balls = b; };
    Viewer.prototype.clearPoint = function (side) { this.points[side] = null; this.onChange(side, null); };

    Viewer.prototype.goTo = function (v) { this.setSlice("axial", Math.round(v[2])); this.setSlice("sagittal", Math.round(v[0])); };

    // RAS (mm) <-> voxel
    Viewer.prototype.rasToVoxel = function (r) { var o = this.meta.origin_ras, sp = this.meta.spacing_mm; return [(r[0] - o[0]) / sp, (r[1] - o[1]) / sp, (r[2] - o[2]) / sp]; };
    Viewer.prototype.voxelToRas = function (v) { var o = this.meta.origin_ras, sp = this.meta.spacing_mm; return [o[0] + v[0] * sp, o[1] + v[1] * sp, o[2] + v[2] * sp]; };

    Viewer.prototype._resize = function () {
        var self = this;
        ["axial", "sagittal"].forEach(function (plane) {
            var p = self.panes[plane], dpr = window.devicePixelRatio || 1;
            var w = p.wrap.clientWidth, h = p.wrap.clientHeight;
            if (!w || !h) return;
            p.cv.style.width = w + "px"; p.cv.style.height = h + "px";
            p.cv.width = Math.round(w * dpr); p.cv.height = Math.round(h * dpr);
        });
    };

    Viewer.prototype._loop = function (t) {
        this._raf = requestAnimationFrame(this._loop);
        if (!this.meta) return;
        var el = this.host; if (!el.offsetParent && !el.getClientRects().length) return;
        if (this.panes.axial.cv.width !== Math.round(this.panes.axial.wrap.clientWidth * (window.devicePixelRatio || 1))) this._resize();
        this._draw("axial", t / 1000); this._draw("sagittal", t / 1000);
    };

    Viewer.prototype._draw = function (plane, t) {
        var p = this.panes[plane], ctx = p.ctx, dpr = window.devicePixelRatio || 1, f = this._fit(plane);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, p.cv.clientWidth, p.cv.clientHeight);
        var img = this.cache[plane + this.slice[plane] + "@" + this.meta.token];
        if (img && img !== "loading" && img !== "error") { ctx.imageSmoothingEnabled = true; ctx.drawImage(img, f.ox, f.oy, f.d.w * f.s, f.d.h * f.s); }
        else { ctx.fillStyle = "#888"; ctx.font = "13px sans-serif"; ctx.fillText(img === "error" ? "slice not available" : "loading…", 12, 20); }
        var sl = this.slice[plane], self = this;
        var dist = function (v) { return Math.abs(plane === "axial" ? v[2] - sl : v[0] - sl); };       // distance of a point from the slice, in voxels
        var scr = function (v) { var q = self.imageFromVoxel(plane, v); return [f.ox + q[0] * f.s, f.oy + q[1] * f.s]; };
        var mmPx = f.s / this.meta.spacing_mm * 0 + f.s * (1 / 1);                                       // css pixels per voxel
        // tutorial balls
        if (this.balls) ["R", "L"].forEach(function (sd) {
            var b = self.balls[sd]; if (!b) return;
            var dz = dist(b) * self.meta.spacing_mm, rr = self.balls.radius;
            if (dz > rr) return;
            var rad = Math.sqrt(rr * rr - dz * dz) / self.meta.spacing_mm * f.s, c = scr(b);
            ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(rad, 2), 0, 6.2832);
            ctx.fillStyle = sd === "R" ? "rgba(255,107,74,0.45)" : "rgba(74,168,255,0.45)"; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = SIDE_COLOR[sd]; ctx.stroke();
            ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.fillText(sd, c[0] + rad + 4, c[1] - rad - 2);
        });
        // revealed ground truth and models: ground truth first (large, fast blink), models above it (small, slow blink)
        if (this.reveal) {
            var gt = this.reveal.gt;
            ["R", "L"].forEach(function (sd) {
                var v = gt[sd]; if (!v) return; var d = dist(v), c = scr(v);
                var a = 0.3 + 0.7 * Math.abs(Math.sin(t * Math.PI * 1.6));
                var near = d <= 2;
                ctx.globalAlpha = near ? a : (d <= 10 ? 0.25 : 0);
                if (ctx.globalAlpha > 0) {
                    ctx.beginPath(); ctx.arc(c[0], c[1], near ? 9 : 6, 0, 6.2832); ctx.fillStyle = "#2ee66b"; ctx.fill();
                    ctx.lineWidth = 2; ctx.strokeStyle = "#0b5a24"; ctx.stroke();
                }
                ctx.globalAlpha = 1;
            });
            this.reveal.models.forEach(function (m, mi) {
                ["R", "L"].forEach(function (sd) {
                    var v = m[sd]; if (!v) return; var d = dist(v), c = scr(v);
                    var a = 0.05 + 0.95 * Math.pow(0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 4.2 + mi * 1.3), 6);      // period 4.2 s, visible about a quarter of the time
                    var near = d <= 2;
                    ctx.globalAlpha = near ? a : (d <= 10 ? 0.3 : 0);
                    if (ctx.globalAlpha > 0) {
                        ctx.beginPath(); ctx.arc(c[0], c[1], near ? 3.5 : 2.5, 0, 6.2832); ctx.fillStyle = m.color; ctx.fill();
                        ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                });
            });
        }
        // the user's points: thin cross tilted by 45 degrees (about 1 cm across) with a dot in the middle (larger than the models' dots, no border), on top of everything
        ["R", "L"].forEach(function (sd) {
            var v = self.points[sd]; if (!v) return;
            var d = dist(v), c = scr(v), col = SIDE_COLOR[sd];
            if (d > 8) return;
            var on = d <= 0.75, h = 19 / Math.SQRT2;
            ctx.save();
            ctx.globalAlpha = on ? 1 : 0.4;
            ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 2;
            ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.lineCap = "butt";
            ctx.beginPath(); ctx.moveTo(c[0] - h, c[1] - h); ctx.lineTo(c[0] + h, c[1] + h); ctx.moveTo(c[0] - h, c[1] + h); ctx.lineTo(c[0] + h, c[1] - h); ctx.stroke();
            ctx.shadowBlur = 0; ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(c[0], c[1], on ? 5 : 3.5, 0, 6.2832); ctx.fill();
            ctx.restore();
            if (on) { ctx.fillStyle = col; ctx.font = "bold 12px sans-serif"; ctx.fillText(sd, c[0] + h + 3, c[1] - h); }
        });
    };

    Viewer.prototype.destroy = function () { cancelAnimationFrame(this._raf); };

    root.OstiaViewer = Viewer;
})(window);
