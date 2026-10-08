/* Synthetic "CT" used by the local demo mode (no patient data): a bright aortic root with two small coronary stubs in a lung-like background.
 * Coordinates are RAS mm relative to the centre of the box (+x = patient's right, +y = anterior, +z = superior). */
(function (root) {
    "use strict";
    function hash(a, b, c) { var h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h); }

    function make(seed) {
        var r = function (n) { return hash(seed, n, 1.3); };
        var ao = { x: (r(1) - 0.5) * 8, y: (r(2) - 0.5) * 8 + 4, rad: 12 + r(3) * 3 };
        var rOst = { x: ao.x + ao.rad + 1, y: ao.y + 4 + r(4) * 6, z: -6 + r(5) * 8 };
        var lOst = { x: ao.x - ao.rad * 0.8, y: ao.y - 3 + r(6) * 5, z: 4 + r(7) * 8 };
        function hu(x, y, z) {
            var v = -820 + 8 * (hash(Math.floor(x * 2), Math.floor(y * 2), Math.floor(z * 2)) - 0.5);
            var e = (x * x) / (62 * 62) + ((y - 2) * (y - 2)) / (50 * 50) + (z * z) / (80 * 80);
            if (e < 1) v = 40 + 20 * (1 - e);                                                              // mediastinum / heart
            var lv = Math.pow(x + 24, 2) + Math.pow(y - 10, 2) + Math.pow(z + 22, 2);
            if (lv < 22 * 22) v = 130;                                                                     // ventricle
            var dx = x - ao.x, dy = y - ao.y, rad = ao.rad + (z > -14 && z < 3 ? 3.5 * Math.sin((z + 14) / 17 * Math.PI) : 0);
            if (z > -14 && dx * dx + dy * dy < rad * rad) v = 430;                                          // aortic root and ascending aorta
            [rOst, lOst].forEach(function (o, n) {                                                         // coronary stubs
                var sx = n === 0 ? 1 : -1, t = (x - o.x) * sx;
                if (t > -2 && t < 9 && Math.pow(y - o.y, 2) + Math.pow(z - o.z, 2) < 2.2 * 2.2) v = 380;
            });
            return v + 10 * (hash(x * 3.1, y * 2.7, z * 3.3 + seed) - 0.5);
        }
        return { hu: hu, gt: { R: [rOst.x, rOst.y, rOst.z], L: [lOst.x, lOst.y, lOst.z] } };
    }

    // box of the demo volumes: 112 x 112 x 80 mm at 0.5 mm, centred on (0,0,0)
    var META = { spacing_mm: 0.5, shape_ijk: [224, 224, 160], origin_ras: [-55.75, -55.75, -39.75], window_hu: [-200, 800] };

    function render(ph, meta, plane, idx) {
        var s = meta.shape_ijk, o = meta.origin_ras, sp = meta.spacing_mm;
        var w = plane === "axial" ? s[0] : s[1], h = plane === "axial" ? s[1] : s[2];
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var ctx = cv.getContext("2d"), im = ctx.createImageData(w, h), lo = meta.window_hu[0], hi = meta.window_hu[1];
        for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) {
            var i, j, k;
            if (plane === "axial") { i = s[0] - 1 - c; j = s[1] - 1 - r; k = idx; } else { i = idx; j = s[1] - 1 - c; k = s[2] - 1 - r; }
            var v = ph.hu(o[0] + i * sp, o[1] + j * sp, o[2] + k * sp);
            var g = Math.max(0, Math.min(255, (v - lo) / (hi - lo) * 255)), p = 4 * (r * w + c);
            im.data[p] = im.data[p + 1] = im.data[p + 2] = g; im.data[p + 3] = 255;
        }
        ctx.putImageData(im, 0, 0);
        return cv;
    }
    root.OstiaPhantom = { make: make, META: META, render: render };
})(window);
