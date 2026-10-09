/* Ostia Challenge: screens and game flow. */
(function () {
    "use strict";
    var CFG = window.OSTIA_CONFIG, S = window.OstiaStats, api = window.OstiaApi.create();
    var $ = function (id) { return document.getElementById(id); };
    var state = { init: null, session: null, seq: [], idx: 0, results: [], placed: { R: false, L: false }, submitted: false, t0: 0, tut: 0, nick: "", filter: null, mine: false, msScored: 0 };
    var viewer, tutViewer;
    var TUT_TEXT = [
        "<b>The aortic root.</b> Scroll the axial view (left) until you see the bright circle of the <b>aorta</b>. Near its base it widens into three bulges, the <b>sinuses of Valsalva</b>.",
        "<b>The right coronary ostium.</b> The right coronary artery starts from the <b>right-front</b> sinus. In the axial view it is a small bright notch on the aortic wall, on the left of the picture (the patient's right).",
        "<b>The left coronary ostium.</b> The left main artery leaves the <b>left</b> sinus, usually a bit higher than the right one. Check it in the sagittal view as well: a tube leaving the wall confirms the opening."
    ];

    /* ---------------------------------------------------------------- helpers */
    function show(name) {
        clearTimeout(landing.t); clearTimeout(board.t);                      // pending refreshes of another screen must not pull us back
        ["landing", "tutorial", "case", "final", "board"].forEach(function (s) { $("screen-" + s).hidden = s !== name; });
        window.scrollTo(0, 0);
    }
    function err(msg) { var e = $("error-msg"); e.textContent = msg; e.hidden = !msg; }
    function fmt(x) { return isFinite(x) ? x.toFixed(2) : "-"; }
    function getCookie(n) { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : ""; }
    function setCookie(n, v, sec) { document.cookie = n + "=" + encodeURIComponent(v) + "; max-age=" + sec + "; path=/; SameSite=Lax"; }
    function clientId() {
        var id = ""; try { id = localStorage.getItem("ostia_client") || ""; } catch (e) {}
        if (!id) { id = "c" + Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem("ostia_client", id); } catch (e) {} }
        return id;
    }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function cooldownLeft() { var t = +getCookie("ostia_cooldown"); return t > Date.now() ? Math.ceil((t - Date.now()) / 1000) : 0; }
    function mmss(s) { return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
    function fmtTime(sec) { if (sec === null || sec === undefined || !isFinite(sec)) return "-"; sec = Math.round(sec); return sec < 60 ? sec + " s" : Math.floor(sec / 60) + " min " + ("0" + (sec % 60)).slice(-2) + " s"; }

    function drawOrient(canvas, v) {
        if (!v.meta) return;
        var s = v.meta.shape_ijk;
        window.OstiaOrient.draw(canvas, { fi: v.slice.sagittal / (s[0] - 1), fk: v.slice.axial / (s[2] - 1) });
    }

    /* ---------------------------------------------------------------- landing */
    function landing() {
        show("landing");
        $("nickname").value = lsGet("ostia_nick") || "";
        $("demo-msg").hidden = !(state.init && state.init.demo);
        var left = cooldownLeft();
        $("cooldown-msg").hidden = !left;
        ["btn-start", "btn-tutorial"].forEach(function (id) { $(id).disabled = !!left; });
        if (left) {
            $("cooldown-msg").textContent = "Thanks for playing! You can try again in " + mmss(left) + ". Meanwhile, have a look at the leaderboard.";
            clearTimeout(landing.t); landing.t = setTimeout(function () { if (!$("screen-landing").hidden) landing(); }, 1000);
        }
    }

    /* ---------------------------------------------------------------- tutorial */
    function tutorial(i) {
        state.tut = i; show("tutorial");
        var toks = state.init.tutorial;
        if (!toks.length) { start(); return; }
        $("tut-step").textContent = (i + 1) + " / " + toks.length;
        $("tut-text").innerHTML = TUT_TEXT[i % TUT_TEXT.length];
        $("tut-next").textContent = i + 1 < toks.length ? "Next →" : "Start the challenge →";
        api.meta(toks[i]).then(function (meta) {
            tutViewer.load(api.source, meta);
            var gt = meta.ground_truth_ras || { R: [0, 0, 0], L: [0, 0, 0] };
            tutViewer.setBalls({ R: tutViewer.rasToVoxel(gt.R), L: tutViewer.rasToVoxel(gt.L), radius: 3 });
            tutViewer._gt = { R: tutViewer.rasToVoxel(gt.R), L: tutViewer.rasToVoxel(gt.L) };
            tutViewer.goTo(tutViewer._gt[i === 2 ? "L" : "R"]);
        }, function () { err("Could not load the tutorial images."); });
    }

    /* ---------------------------------------------------------------- challenge */
    function start() {
        err("");
        var nick = $("nickname").value.trim(); state.nick = nick; lsSet("ostia_nick", nick);
        $("btn-start").disabled = true;
        api.start({ client: clientId(), nickname: nick }).then(function (r) {
            state.session = r.session; state.seq = r.cases; state.idx = 0; state.results = []; state.msScored = 0;
            lsSet("ostia_tutorial_done", "1");
            openCase();
        }, function (e) {
            if (e.data && e.data.cooldown) { setCookie("ostia_cooldown", Date.now() + e.data.cooldown * 1000, e.data.cooldown); landing(); }
            else { err("Could not start: " + e.message); }
            $("btn-start").disabled = false;
        });
    }

    function openCase() {
        var c = state.seq[state.idx];
        show("case");
        $("case-n").textContent = (state.idx + 1) + " / " + state.seq.length;
        var k = $("case-kind"); k.textContent = c.kind === "alcapa" ? "special scan" : "scored"; k.className = "chip" + (c.kind === "alcapa" ? " special" : "");
        $("progress-bar").style.width = (state.idx / state.seq.length * 100) + "%";
        ["place-panel", "reveal-panel", "thanks-panel", "running"].forEach(function (id) { $(id).hidden = id !== "place-panel"; });
        $("running").hidden = true;
        state.placed = { R: false, L: false }; state.submitted = false; viewer.setLocked(false);
        updatePlaceUI();
        api.meta(c.token).then(function (meta) {
            viewer.load(api.source, meta);
            viewer.setMode("R"); updatePlaceUI();
            $("zoom").value = 1; viewer.setZoom(1); $("zoom-hint").hidden = true;
            state.t0 = Date.now();
            drawOrient($("orient"), viewer);
        }, function () { err("Could not load this scan."); });
    }

    function updatePlaceUI() {
        var m = viewer.mode;
        $("btn-r").classList.toggle("active", m === "R"); $("btn-l").classList.toggle("active", m === "L");
        $("btn-r").classList.toggle("done", state.placed.R); $("btn-l").classList.toggle("done", state.placed.L);
        $("btn-submit").disabled = !(state.placed.R && state.placed.L) || state.submitted;
        $("place-hint").textContent = state.submitted ? "" : viewer.mouseSides ? "Left click = LEFT ostium, right click = RIGHT ostium. Click again to move a point; refine in the other view." :
            !state.placed.R ? "Click on the right ostium in either view. Then refine it in the other view." :
            !state.placed.L ? "Now click on the left ostium." : "You can move a point by selecting its button and clicking again. Submit when ready.";
    }

    function onPoint(side, v) {
        state.placed[side] = !!v;
        if (side === "R" && v && !state.placed.L) viewer.setMode("L");
        updatePlaceUI();
    }

    function submit() {
        if (state.submitted) return;
        state.submitted = true; viewer.setMode(null); viewer.setLocked(true); updatePlaceUI();
        var c = state.seq[state.idx], pts = { R: viewer.voxelToRas(viewer.points.R), L: viewer.voxelToRas(viewer.points.L) };
        api.submit({ session: state.session, token: c.token, points: pts, ms: Date.now() - state.t0, scrolls: viewer.scrolls }).then(function (res) {
            $("place-panel").hidden = true;
            if (res.kind === "alcapa") { $("thanks-panel").hidden = false; return; }
            var vx = function (r) { return viewer.rasToVoxel(r); };
            viewer.setReveal({ gt: { R: vx(res.reveal.gt.R), L: vx(res.reveal.gt.L) }, models: res.reveal.models.map(function (m) { return { name: m.name, color: m.color, R: vx(m.R), L: vx(m.L) }; }) });
            state.results.push({ user: res.reveal.user, models: res.reveal.models }); state.msScored += Date.now() - state.t0;
            viewer.goTo(vx(res.reveal.gt.R));
            renderReveal(res.reveal);
        }, function (e) { err("Could not submit: " + e.message); state.submitted = false; updatePlaceUI(); });
    }

    function renderReveal(rv) {
        $("reveal-panel").hidden = false;
        var lg = '<span><i class="gt"></i>Expert reference</span><span><i style="background:' + "#ff6b4a" + '"></i>You (R)</span><span><i style="background:#4aa8ff"></i>You (L)</span>';
        rv.models.forEach(function (m) { lg += '<span><i class="md" style="background:' + m.color + '"></i>' + m.name + "</span>"; });
        $("legend").innerHTML = lg;
        var t = '<div class="scroll"><table class="t"><thead><tr><th>This case</th><th>Right (mm)</th><th>Left (mm)</th></tr></thead><tbody>' +
            '<tr class="you"><td>You</td><td>' + fmt(rv.user.R) + "</td><td>" + fmt(rv.user.L) + "</td></tr>";
        rv.models.forEach(function (m) { t += '<tr class="model" style="--c:' + m.color + '"><td>' + m.name + "</td><td>" + fmt(m.err.R) + "</td><td>" + fmt(m.err.L) + "</td></tr>"; });
        $("case-table").innerHTML = t + "</tbody></table></div>";
        renderRunning("running", false);
    }

    // running statistics (user and each model) over the scored cases done so far
    function seriesFor(name) {
        return state.results.map(function (r) {
            if (name === "You") return r.user;
            var m = r.models.filter(function (x) { return x.name === name; })[0]; return m.err;
        });
    }
    function statRow(label, errs, cls, color) {
        var st = S.sideStats(errs), cell = function (s) { return "<td>" + fmt(s.mean) + "</td><td>" + fmt(s.median) + "</td><td>" + fmt(s.min) + "</td><td>" + fmt(s.max) + "</td>"; };
        return '<tr class="' + cls + '"' + (color ? ' style="--c:' + color + '"' : "") + "><td>" + label + "</td>" + cell(st.R) + cell(st.L) + cell(st.both) + "</tr>";
    }
    function renderRunning(elId, final) {
        var el = $(elId); el.hidden = false;
        var models = state.results[0].models;
        var h = "<h3>" + (final ? "All 12 scored cases" : "So far: " + state.results.length + " scored case" + (state.results.length > 1 ? "s" : "")) + " (error in mm)</h3>" +
            '<div class="scroll"><table class="t"><thead><tr><th></th><th class="grp" colspan="4">Right</th><th class="grp" colspan="4">Left</th><th class="grp" colspan="4">Both</th></tr><tr><th></th>' +
            "<th>mean</th><th>median</th><th>min</th><th>max</th>".repeat(3) + "</tr></thead><tbody>" + statRow("You", seriesFor("You"), "you");
        models.forEach(function (m) { h += statRow(m.name, seriesFor(m.name), "model", m.color); });
        el.innerHTML = h + "</tbody></table></div>";
        return el;
    }

    function nextCase() {
        err("");
        state.idx++;
        if (state.idx >= state.seq.length) return finalScreen();
        openCase();
    }

    /* ---------------------------------------------------------------- final + leaderboard */
    function finalScreen() {
        show("final");
        $("progress-bar") && ($("progress-bar").style.width = "100%");
        var el = renderRunning("final-table", true), n = state.results.length;
        var tp = document.createElement("p"); tp.className = "notice";
        tp.textContent = "Your time on the images: " + fmtTime(state.msScored / 1000) + " in total, " + fmtTime(state.msScored / 1000 / Math.max(1, n)) + " per case (the review after each case is not counted). The models take about 36 to 56 s per volume. Times do not influence the ranking.";
        el.appendChild(tp);
        $("final-nick").value = state.nick || lsGet("ostia_nick") || "";
        $("btn-save").disabled = false; $("save-msg").textContent = "";
    }

    function save() {
        $("btn-save").disabled = true;
        var nick = $("final-nick").value.trim(); lsSet("ostia_nick", nick);
        api.finish({ session: state.session, nickname: nick }).then(function (r) {
            var cd = r.cooldown || CFG.COOLDOWN_SECONDS;
            setCookie("ostia_cooldown", Date.now() + cd * 1000, cd);
            addMine(r.nickname || nick || "anonymous", r.time);
            state.filter = null; state.mine = false;
            board();
        }, function (e) {
            $("save-msg").textContent = "Could not save: " + e.message; $("btn-save").disabled = false;
        });
    }

    // the trials saved from this browser are remembered, to highlight them and to filter "Only me"
    function mineSet() { try { return JSON.parse(lsGet("ostia_mine") || "[]"); } catch (e) { return []; } }
    function addMine(nick, time) { var m = mineSet(); m.push(nick.toLowerCase() + "|" + time); lsSet("ostia_mine", JSON.stringify(m.slice(-200))); }

    function board() {
        show("board");
        var left = cooldownLeft(), cd = $("board-cooldown");
        cd.hidden = !left;
        if (left) { cd.textContent = "You can play again in " + mmss(left) + "."; clearTimeout(board.t); board.t = setTimeout(function () { if (!$("screen-board").hidden) board(); }, 1000); }
        $("board-all").classList.toggle("active", !state.mine); $("board-me").classList.toggle("active", state.mine);
        var fl = $("board-filter"); fl.hidden = !state.filter;
        if (state.filter) { fl.innerHTML = "Showing the trials of <b></b> (and the models)."; fl.querySelector("b").textContent = state.filter; var x = document.createElement("a"); x.textContent = "show everyone"; x.addEventListener("click", function () { state.filter = null; board(); }); fl.appendChild(x); }
        var mine = mineSet();
        // "Everyone / Only me" only makes sense for someone who saved a trial under a real nickname on this browser
        var named = mine.some(function (k) { return k.split("|")[0] !== "anonymous"; });
        document.querySelector(".seg").hidden = !named;
        if (!named) { state.mine = false; $("board-all").classList.add("active"); $("board-me").classList.remove("active"); }
        api.leaderboard().then(function (lb) {
            var DEV = "\u00a7\u00a7_\u00a7\u00a7", now = Date.now();           // the developer test nickname (exactly this) is shown for 5 minutes only
            lb.trials = lb.trials.filter(function (t) { return t.nickname !== DEV || now - t.time <= 300000; });
            var rows = lb.trials.map(function (t) { return { kind: "user", nickname: t.nickname, trial: t.trial, time: t.time, both: t.stats.both, R: t.stats.R, L: t.stats.L, tTotal: t.time_total, tCase: t.time_case }; });
            lb.models.forEach(function (m) { rows.push({ kind: "model", nickname: m.name, color: m.color, both: m.stats.both, R: m.stats.R, L: m.stats.L, tTotal: m.time_total, tCase: m.time_case }); });
            var ranked = S.rank(rows);
            var h = '<div class="scroll"><table class="t"><thead><tr><th>#</th><th>Name</th><th>Trial</th><th>Date</th><th>Right median</th><th>Right mean</th><th>Left median</th><th>Left mean</th><th>Total median</th><th>Total mean</th><th>min</th><th>max</th><th>Total time</th><th>Time per case</th></tr></thead><tbody>';
            ranked.forEach(function (r, i) {
                var isMine = r.kind === "user" && mine.indexOf(r.nickname.toLowerCase() + "|" + r.time) >= 0;
                if (state.filter && !(r.kind === "model" || r.nickname === state.filter)) return;
                if (state.mine && !(r.kind === "model" || isMine)) return;
                var date = r.time ? new Date(r.time).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
                var name = r.kind === "model" ? r.nickname + '<span class="tag">model</span>' : '<a class="nick" data-n="' + encodeURIComponent(r.nickname) + '">' + r.nickname.replace(/</g, "&lt;") + "</a>";
                h += '<tr class="' + (r.kind === "model" ? "model" : isMine ? "mine" : "") + '"' + (r.color ? ' style="--c:' + r.color + '"' : "") + "><td>" + (i + 1) + "</td><td>" + name + "</td><td>" + (r.trial || "") + "</td><td>" + date +
                    "</td><td>" + fmt(r.R.median) + "</td><td>" + fmt(r.R.mean) + "</td><td>" + fmt(r.L.median) + "</td><td>" + fmt(r.L.mean) + "</td><td><b>" + fmt(r.both.median) + "</b></td><td>" + fmt(r.both.mean) + "</td><td>" + fmt(r.both.min) + "</td><td>" + fmt(r.both.max) + "</td><td>" + fmtTime(r.tTotal) + "</td><td>" + fmtTime(r.tCase) + "</td></tr>";
            });
            $("board-table").innerHTML = h + "</tbody></table></div>";
            Array.prototype.forEach.call($("board-table").querySelectorAll("a.nick"), function (a) {
                a.addEventListener("click", function () { state.filter = decodeURIComponent(a.dataset.n); board(); });
            });
        }, function () { $("board-table").textContent = "The leaderboard is not available right now."; });
    }

    /* ---------------------------------------------------------------- wiring */
    // the reserved developer nickname: a red warning as a repellent (it is saved anyway; its leaderboard rows vanish after 5 minutes)
    function guardNick(inputId) {
        var inp = $(inputId), w = document.createElement("div");
        w.className = "nick-warn"; w.hidden = true; w.setAttribute("role", "alert");
        w.textContent = "\u26a0 Reserved nickname, please do not use it: your results will not be saved.";
        inp.parentNode.parentNode.insertBefore(w, inp.parentNode.nextSibling);
        var chk = function () { w.hidden = inp.value.trim() !== "\u00a7\u00a7_\u00a7\u00a7"; };
        inp.addEventListener("input", chk); chk();
    }

    function wire() {
        guardNick("nickname"); guardNick("final-nick");
        viewer = new window.OstiaViewer($("viewer"), { onChange: onPoint, onSlice: function () { drawOrient($("orient"), viewer); } });
        tutViewer = new window.OstiaViewer($("viewer-tut"), { readOnly: true, onSlice: function () { drawOrient($("orient-tut"), tutViewer); } });
        $("btn-start").addEventListener("click", function () {
            if (lsGet("ostia_tutorial_done")) start(); else { tutorial(0); }
        });
        $("btn-tutorial").addEventListener("click", function () { tutorial(0); });
        $("btn-board").addEventListener("click", function () { state.filter = null; state.mine = false; board(); });
        $("board-home").addEventListener("click", landing);
        $("board-all").addEventListener("click", function () { state.mine = false; state.filter = null; board(); });
        $("board-me").addEventListener("click", function () { state.mine = true; state.filter = null; board(); });
        $("tut-skip").addEventListener("click", function () { lsSet("ostia_tutorial_done", "1"); landing(); });
        $("tut-next").addEventListener("click", function () {
            if (state.tut + 1 < state.init.tutorial.length) tutorial(state.tut + 1); else { lsSet("ostia_tutorial_done", "1"); start(); }
        });
        $("tut-r").addEventListener("click", function () { tutViewer._gt && tutViewer.goTo(tutViewer._gt.R); });
        $("tut-l").addEventListener("click", function () { tutViewer._gt && tutViewer.goTo(tutViewer._gt.L); });
        $("btn-r").addEventListener("click", function () { viewer.setMode("R"); updatePlaceUI(); });
        $("btn-l").addEventListener("click", function () { viewer.setMode("L"); updatePlaceUI(); });
        $("btn-clear").addEventListener("click", function () { viewer.clearPoint("R"); viewer.clearPoint("L"); viewer.setMode("R"); updatePlaceUI(); });
        $("zoom").addEventListener("input", function () { viewer.setZoom(+$("zoom").value); $("zoom-hint").hidden = +$("zoom").value <= 1; });
        $("btn-submit").addEventListener("click", submit);
        var om = $("opt-mouse"), applyMouse = function () { viewer.mouseSides = om.checked; $("viewer").parentNode.parentNode.classList.toggle("mouse-buttons", om.checked); $("place-panel").classList.toggle("mouse-buttons", om.checked); lsSet("ostia_mouse", om.checked ? "1" : "0"); updatePlaceUI(); };
        om.checked = lsGet("ostia_mouse") !== "0"; om.addEventListener("change", applyMouse); applyMouse();
        $("btn-next").addEventListener("click", nextCase);
        $("btn-next2").addEventListener("click", nextCase);
        $("jump-r").addEventListener("click", function () { viewer.reveal && viewer.goTo(viewer.reveal.gt.R); });
        $("jump-l").addEventListener("click", function () { viewer.reveal && viewer.goTo(viewer.reveal.gt.L); });
        $("btn-save").addEventListener("click", save);
    }

    wire();
    api.init().then(function (r) { state.init = r; landing(); }, function (e) { err("The challenge is not reachable right now. " + e.message); });
    window.__ostia = { state: state, api: api, get viewer() { return viewer; } };      // test hook
})();
