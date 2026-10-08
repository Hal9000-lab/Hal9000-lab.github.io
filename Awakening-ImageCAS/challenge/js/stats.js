/* Pure helpers of the Ostia Challenge: summary statistics, running statistics and the case sequence. Works in the browser and in node. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.OstiaStats = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    function median(v) {
        if (!v.length) return NaN;
        var s = v.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
        return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
    }

    function summary(v) {
        if (!v.length) return { n: 0, mean: NaN, median: NaN, min: NaN, max: NaN };
        var sum = 0, lo = Infinity, hi = -Infinity;
        for (var i = 0; i < v.length; i++) { sum += v[i]; if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i]; }
        return { n: v.length, mean: sum / v.length, median: median(v), min: lo, max: hi };
    }

    // errors: [{R: mm, L: mm}, ...] (one per scored case) -> statistics of the right ostium, the left ostium and both (pooled)
    function sideStats(errors) {
        var r = [], l = [], b = [];
        errors.forEach(function (e) { r.push(e.R); l.push(e.L); b.push(e.R, e.L); });
        return { R: summary(r), L: summary(l), both: summary(b) };
    }

    // deterministic PRNG (mulberry32) so that tests and demo runs are reproducible
    function rng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function shuffle(arr, rand) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor((rand || Math.random)() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    // 12 scored cases shuffled; the last six slots alternate scored / ALCAPA: [s x 9, s, A, s, A, s, A]
    // scored, alcapaPool: arrays of tokens. Returns [{token, kind: "scored" | "alcapa"}, ...]
    function buildSequence(scored, alcapaPool, rand, nAlcapa) {
        nAlcapa = nAlcapa === undefined ? 3 : nAlcapa;
        var s = shuffle(scored, rand), a = shuffle(alcapaPool, rand).slice(0, nAlcapa), out = [], i;
        var head = s.length - nAlcapa;
        for (i = 0; i < head; i++) out.push({ token: s[i], kind: "scored" });
        for (i = 0; i < nAlcapa; i++) { out.push({ token: s[head + i], kind: "scored" }); if (a[i] !== undefined) out.push({ token: a[i], kind: "alcapa" }); }
        return out;
    }

    // leaderboard rows ({both: {median}}), best (lowest pooled median) first; ties by mean then by date
    function rank(rows) {
        return rows.slice().sort(function (x, y) {
            return (x.both.median - y.both.median) || (x.both.mean - y.both.mean) || ((x.time || 0) - (y.time || 0));
        });
    }

    function euclid(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); }

    return { median: median, summary: summary, sideStats: sideStats, rng: rng, shuffle: shuffle, buildSequence: buildSequence, rank: rank, euclid: euclid };
});
