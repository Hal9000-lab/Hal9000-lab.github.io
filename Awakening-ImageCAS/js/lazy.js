/* Loads the animation scripts only when their figure is about to be scrolled into view (they, and the images they fetch, are the heavy part of this page).
 * A figure starts loading when it is within MARGIN of the viewport, so it is ready before the visitor gets there. Scripts of one figure load in order,
 * and figures are initialised one after the other (a short pause between them) so that two heavy ones never start in the same moment.
 * Each script initialises itself on load and starts/stops its own animation with its own visibility observer.
 * A spinner replaces the button from the moment a figure is requested until it is ready. An "Explore" button sits over the still-empty canvas of every figure, as a manual fallback: it forces the loading of that figure at once. */
(function () {
    "use strict";
    var MARGIN = "1500px 0px";
    var GAP_MS = 250;
    var GROUPS = [
        { id: "op-figure", scripts: ["ostia-pipeline-demo.js"] },
        { id: "cl-figure", scripts: ["centerline-algo.js", "centerline-demo.js"] },
        { id: "cd-figure", scripts: ["centerline-algo-detailed.js", "centerline-demo-detailed.js"] },
        { id: "fl-figure", scripts: ["flow-sim.js"] },
        { id: "ns-figure", scripts: ["flow-ns.js"] }
    ];
    var queue = [], busy = false;

    function loadScripts(list, done) {
        var i = 0;
        (function next() {
            if (i >= list.length) { done(); return; }
            var s = document.createElement("script");
            s.src = "./js/" + list[i++];
            s.onload = next;
            s.onerror = function () { if (window.console) console.warn("could not load " + s.src); next(); };
            document.body.appendChild(s);
        })();
    }
    function pump() {
        if (busy || !queue.length) return;
        busy = true;
        var g = queue.shift();
        if (g.btn) { g.btn.style.display = "none"; g.ph.classList.add("busy"); }
        loadScripts(g.scripts, function () { dropButton(g); setTimeout(function () { busy = false; pump(); }, GAP_MS); });
    }
    function dropButton(g) { if (g.ph) { g.ph.remove(); g.ph = g.btn = null; } }
    function addButton(g) {                                          // overlay on the empty canvas, centred, removed as soon as the animation is loaded
        var cv = g.el.querySelector("canvas"); if (!cv) return;
        g.ph = document.createElement("div"); g.ph.className = "lazy-ph";
        g.btn = document.createElement("button"); g.btn.type = "button"; g.btn.className = "lazy-btn"; g.btn.textContent = "Explore";
        g.btn.addEventListener("click", function () { request(g); });
        g.spin = document.createElement("div"); g.spin.className = "lazy-spin";
        g.ph.appendChild(g.btn); g.ph.appendChild(g.spin); g.el.insertBefore(g.ph, cv.nextSibling);
        g.ph.style.height = cv.offsetHeight + "px"; g.ph.style.top = cv.offsetTop + "px";
        window.addEventListener("resize", function () { if (g.ph) g.ph.style.height = cv.offsetHeight + "px"; });
    }
    function request(g) { if (g.requested) return; g.requested = true; if (g.btn) { g.btn.style.display = "none"; g.ph.classList.add("busy"); } queue.push(g); pump(); }

    if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                io.unobserve(e.target);
                GROUPS.forEach(function (g) { if (g.el === e.target) request(g); });
            });
        }, { rootMargin: MARGIN });
        GROUPS.forEach(function (g) { g.el = document.getElementById(g.id); if (g.el) { addButton(g); io.observe(g.el); } });
    } else {
        GROUPS.forEach(function (g) { g.el = document.getElementById(g.id); if (g.el) addButton(g); });
        window.addEventListener("load", function () { GROUPS.forEach(request); });     // very old browsers: everything after the page has loaded
    }
})();
