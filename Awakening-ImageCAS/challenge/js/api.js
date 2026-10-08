/* Backend adapters. Both expose the same methods:
 *   init()                       -> {tutorial: [token...]}
 *   meta(token)                  -> meta (shape, origin, ...)
 *   source                       -> {slice(meta, plane, idx) -> Promise<image>}
 *   start({client, nickname})    -> {session, cases: [{token, kind}], cooldown}
 *   submit({session, token, points:{R,L} (RAS mm), ms, scrolls}) -> {kind:"scored", reveal:{gt, models:[{name,color,R,L,err}], user:{R,L}}} | {kind:"alcapa"}
 *   finish({session, nickname})  -> {trial, cooldown}
 *   leaderboard()                -> {models:[{name,color,stats}], trials:[{nickname, trial, time, stats}]}
 * stats = {R, L, both} = {n, mean, median, min, max} in mm.  Positions are RAS mm. */
(function (root) {
    "use strict";
    var S = root.OstiaStats, CFG = root.OSTIA_CONFIG;

    function pad(n) { return ("000" + n).slice(-3); }
    function loadImage(url) {
        return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = url; });
    }
    // free hosting may append an ad snippet after the JSON: keep only the outermost {...}
    function parseLoose(txt) {
        try { return JSON.parse(txt); } catch (e) {
            var i = txt.indexOf("{"), j = txt.lastIndexOf("}");
            if (i >= 0 && j > i) return JSON.parse(txt.slice(i, j + 1));
            throw e;
        }
    }
    function getJSON(url, opts) {
        return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }).then(parseLoose);
    }
    function modelStats(truth) {
        var scored = Object.keys(truth.cases).filter(function (t) { return truth.cases[t].role === "scored"; });
        return truth.models.map(function (m) {
            var errs = scored.map(function (t) { return truth.cases[t].models[m.name].err; });
            return { name: m.name, color: m.color, stats: S.sideStats(errs) };
        });
    }

    /* ---------------------------------------------------------------- local (demo or real exported data, no server) */
    function LocalApi() { this.ready = null; this.truth = null; this.base = null; this.sessions = {}; this.phantoms = {}; }
    LocalApi.prototype.init = function () {
        var self = this;
        if (this.ready) return this.ready;
        this.ready = getJSON(CFG.LOCAL_DATA_BASE + "truth.json").then(function (t) {
            self.truth = t; self.base = CFG.LOCAL_DATA_BASE; self.real = true;
        }, function () {
            self.truth = self._demoTruth(); self.real = false;
        }).then(function () {
            self.source = {
                slice: function (meta, plane, idx) {
                    if (self.real) return loadImage(self.base + meta.token + "/" + plane + "/" + pad(idx) + ".png");
                    return Promise.resolve(root.OstiaPhantom.render(self._phantom(meta.token), meta, plane, idx));
                }
            };
            var tut = Object.keys(self.truth.cases).filter(function (t) { return self.truth.cases[t].role === "tutorial"; });
            return { tutorial: tut, demo: !self.real };
        });
        return this.ready;
    };
    LocalApi.prototype._seed = function (token) { var h = 0; for (var i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) >>> 0; return h % 997; };
    LocalApi.prototype._phantom = function (token) { return this.phantoms[token] || (this.phantoms[token] = root.OstiaPhantom.make(this._seed(token))); };
    LocalApi.prototype._demoTruth = function () {
        var self = this, cases = {}, rand = S.rng(5), models = [{ name: "SwinUNETRv2", color: "#e3a21a" }, { name: "nnResUNet", color: "#d94f9a" }, { name: "ResNet50", color: "#38b6c9" }, { name: "ResNet101", color: "#9a7be0" }];
        function add(token, role, ds) {
            var ph = self._phantom(token), e = { role: role, dataset: ds, id: token, gt: { R: ph.gt.R, L: ph.gt.L } };
            if (role === "scored") {
                e.models = {};
                models.forEach(function (m, mi) {
                    var o = { err: {} };
                    ["R", "L"].forEach(function (sd) {
                        var d = ph.gt[sd].map(function (v) { return v + (rand() - 0.5) * (1.6 + mi * 0.5); });
                        o[sd] = d; o.err[sd] = S.euclid(d, ph.gt[sd]);
                    });
                    e.models[m.name] = o;
                });
            }
            cases[token] = e;
        }
        for (var i = 1; i <= 12; i++) add("demo-s" + (i < 10 ? "0" : "") + i, "scored", ["ASOCA", "CAT08", "ImageCAS"][(i - 1) % 3]);
        for (i = 1; i <= 6; i++) add("demo-a0" + i, "alcapa", "ImageALCAPA");
        for (i = 1; i <= 3; i++) add("demo-t" + i, "tutorial", "ImageCAS");
        return { models: models, cases: cases };
    };
    LocalApi.prototype.meta = function (token) {
        var self = this, c = this.truth.cases[token];
        if (this.real) return getJSON(this.base + token + "/meta.json");
        var m = JSON.parse(JSON.stringify(root.OstiaPhantom.META)); m.token = token; m.role = c.role;
        if (c.role === "tutorial") m.ground_truth_ras = c.gt;
        return Promise.resolve(m);
    };
    LocalApi.prototype._list = function (role) { var t = this.truth; return Object.keys(t.cases).filter(function (k) { return t.cases[k].role === role; }); };
    LocalApi.prototype.start = function (o) {
        var rand = S.rng((Date.now() & 0xffffff) ^ 0x5eed);
        var seq = S.buildSequence(this._list("scored"), this._list("alcapa"), rand);
        var id = "L" + Math.floor(rand() * 1e9).toString(36);
        this.sessions[id] = { nickname: o.nickname || "", errors: [], seq: seq, done: {} };
        return Promise.resolve({ session: id, cases: seq, cooldown: 0 });
    };
    LocalApi.prototype.submit = function (o) {
        var c = this.truth.cases[o.token], s = this.sessions[o.session];
        if (!c || !s) return Promise.reject(new Error("unknown session or case"));
        if (c.role === "alcapa") { s.done[o.token] = o.points; return Promise.resolve({ kind: "alcapa" }); }
        var err = { R: S.euclid(o.points.R, c.gt.R), L: S.euclid(o.points.L, c.gt.L) };
        if (!s.done[o.token]) { s.done[o.token] = o.points; s.errors.push(err); }
        var models = this.truth.models.map(function (m) { var mm = c.models[m.name]; return { name: m.name, color: m.color, R: mm.R, L: mm.L, err: mm.err }; });
        return Promise.resolve({ kind: "scored", reveal: { gt: c.gt, models: models, user: err } });
    };
    LocalApi.prototype.finish = function (o) {
        var s = this.sessions[o.session]; if (!s || s.errors.length < 12) return Promise.reject(new Error("not finished"));
        var rows = this._rows(); var nick = (o.nickname || "").trim().slice(0, 24) || "anonymous";
        var trial = rows.filter(function (r) { return r.nickname === nick; }).length + 1;
        rows.push({ nickname: nick, trial: trial, time: Date.now(), stats: S.sideStats(s.errors) });
        try { localStorage.setItem("ostia_local_trials", JSON.stringify(rows)); } catch (e) {}
        return Promise.resolve({ trial: trial, time: rows[rows.length - 1].time, nickname: nick, cooldown: CFG.COOLDOWN_SECONDS });
    };
    LocalApi.prototype._rows = function () { try { return JSON.parse(localStorage.getItem("ostia_local_trials") || "[]"); } catch (e) { return []; } };
    LocalApi.prototype.leaderboard = function () { return Promise.resolve({ models: modelStats(this.truth), trials: this._rows() }); };

    /* ---------------------------------------------------------------- remote (Altervista api.php) */
    function RemoteApi() { this.source = { slice: function (meta, plane, idx) { return loadImage(CFG.DATA_BASE + meta.token + "/" + plane + "/" + pad(idx) + ".png"); } }; }
    RemoteApi.prototype._call = function (action, body) {
        return getJSON(CFG.API_BASE + "?action=" + action, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body || {}) })
            .then(function (j) { if (j.error) { var e = new Error(j.error); e.data = j; throw e; } return j; });
    };
    RemoteApi.prototype.init = function () { return this._call("init"); };
    RemoteApi.prototype.meta = function (token) { return getJSON(CFG.DATA_BASE + token + "/meta.json"); };
    RemoteApi.prototype.start = function (o) { return this._call("start", o); };
    RemoteApi.prototype.submit = function (o) { return this._call("submit", o); };
    RemoteApi.prototype.finish = function (o) { return this._call("finish", o); };
    RemoteApi.prototype.leaderboard = function () { return this._call("leaderboard"); };

    root.OstiaApi = { create: function () { return CFG.MODE === "remote" ? new RemoteApi() : new LocalApi(); } };
})(window);
