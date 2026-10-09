/* Hal9000 Lab dark smoke background for the top bar (#topbar) and for any element with data-smoke (not a real simulation).
 * A domain-warped value-noise field is drawn at low resolution on a canvas that sits behind the bar content and is
 * scaled up smoothly by the browser. No libraries. Respects prefers-reduced-motion (one still frame) and pauses when the tab is hidden.
 * Tweak the look with the constants below. */
(function () {
    "use strict";

    var BASE = [23, 19, 34];            // the dark colour of the bar
    var SMOKE = [44, 42, 60];           // the slightly lighter colour the swirls fade to (kept close to BASE: subtle)
    var STRENGTH = 0.7;                 // how far the lightest swirls go from BASE towards SMOKE (0..1)
    var CELL = 5;                       // css pixels per drawn pixel (bigger = coarser, cheaper, softer)
    var SCALE = 0.012;                  // spatial frequency of the swirls (per css pixel)
    var SPEED = 0.045;                  // drift speed
    var FPS = 24;

    function hash(ix, iy) {
        var h = ix * 374761393 + iy * 668265263;
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function vnoise(x, y) {
        var ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
        var a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    function fbm(x, y) { return 0.5 * vnoise(x, y) + 0.3 * vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) + 0.2 * vnoise(x * 4.3 + 9.1, y * 4.3 + 3.7); }

    function start(nav) {
        var cv = document.createElement("canvas");
        cv.className = "topbar-smoke"; cv.setAttribute("aria-hidden", "true");
        nav.insertBefore(cv, nav.firstChild);
        var ctx = cv.getContext("2d");
        if (!ctx) return;
        var w = 0, h = 0, img = null, last = 0, raf = 0;
        var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        function resize() {
            var W = Math.max(1, Math.round(nav.clientWidth / CELL)), H = Math.max(1, Math.round(nav.clientHeight / CELL));
            if (W === w && H === h) return;
            w = cv.width = W; h = cv.height = H; img = ctx.createImageData(w, h);
        }
        function draw(t) {
            var d = img.data, s = SCALE * CELL, i = 0, tt = t * SPEED;
            for (var y = 0; y < h; y++) {
                for (var x = 0; x < w; x++) {
                    var px = x * s, py = y * s * 1.6;
                    // two warps give the curling look, the slow drift moves the whole field
                    var qx = fbm(px + tt, py - tt * 0.6), qy = fbm(px - tt * 0.7 + 7.3, py + tt * 0.5 + 2.9);
                    var n = fbm(px + 2.2 * qx + tt * 0.4, py + 2.2 * qy);
                    var k = smooth(Math.min(1, Math.max(0, (n - 0.44) * 3.2))) * STRENGTH;     // only the denser swirls show
                    d[i] = BASE[0] + (SMOKE[0] - BASE[0]) * k;
                    d[i + 1] = BASE[1] + (SMOKE[1] - BASE[1]) * k;
                    d[i + 2] = BASE[2] + (SMOKE[2] - BASE[2]) * k;
                    d[i + 3] = 255; i += 4;
                }
            }
            ctx.putImageData(img, 0, 0);
        }
        function frame(now) {
            raf = requestAnimationFrame(frame);
            if (now - last < 1000 / FPS) return;
            last = now; draw(now / 1000);
        }
        resize();
        draw(((Date.now() % 100000) / 1000) + hash(w, h) * 50);          // different still frame at each load
        if (!reduced) raf = requestAnimationFrame(frame);
        if (window.ResizeObserver) new ResizeObserver(function () { resize(); draw(last / 1000); }).observe(nav);
        else window.addEventListener("resize", function () { resize(); draw(last / 1000); });
    }

    // the top bar, and any element marked with the attribute data-smoke (e.g. the header of the landing page)
    function init() {
        var els = Array.prototype.slice.call(document.querySelectorAll("#topbar, [data-smoke]"));
        els.forEach(function (el) { if (!el.querySelector(":scope > canvas.topbar-smoke")) start(el); });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
