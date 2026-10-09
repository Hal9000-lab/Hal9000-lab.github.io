/* People cards of the landing page. Everything is configured by the data attributes of each .person (empty = not shown):
 *   data-titles   comma separated badges after the name (M.Sc., Ph.D., Prof.)
 *   data-start / data-end   years or dates. A real end date makes the card an EX card; the value "today" means "still here" (shown as "start - today", not EX).
 *   data-ex       makes the card EX even without an end date
 *   data-foil     finish of the card (the frame of a normal card, the whole card of an EX one): silver | holo | glitter | gold | metal, or two layered: gold+holo (automatic order) or glitter>gold (glitter below, gold above),
 *                 e.g. gold+holo (default: the rule of its group, see frameFinish / exFinish below)
 *   data-orcid (id), data-scholar (user id), data-github (user name), data-web (full url)
 * Cards tilt lightly towards the pointer; EX cards get a foil finish (shared/foil/foil.js). The pointer is tracked on a fixed wrapper (.slot), not on the
 * tilting card (a rotating card moves under the pointer and flickers its enter/leave events), and the animation loop stops by itself when the card is at rest. */
(function () {
    "use strict";
    var ICON = {
        orcid: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#a6ce39"/><path fill="#fff" d="M8.4 6.1a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0zM6.7 8.2h1.6v9.6H6.7zM10.1 8.2h3.4c3.2 0 4.8 2 4.8 4.8s-1.7 4.8-4.8 4.8h-3.4zm1.6 1.4v6.8h1.7c2.4 0 3.2-1.6 3.2-3.4s-.9-3.4-3.2-3.4z"/></svg>',
        scholar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M12 3 1 9l11 6 9-4.9V17h2V9z"/><path fill="#356ac3" d="M5 13.2v4c0 1.7 3.1 3.3 7 3.3s7-1.6 7-3.3v-4l-7 3.8z"/></svg>',
        github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
        web: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.6 4 5.9 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-5.9-4-9.5s1.4-6.9 4-9.5z"/></svg>'
    };
    var FINISHES = ["silver", "holo", "glitter", "gold", "metal", "metaltex"];
    var REST = { x: 0.32, y: 0.28 };                                  // where the "light" sits when nobody is pointing at a card
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
    function link(href, icon, label) { return '<a target="_blank" rel="noopener" href="' + esc(href) + '" title="' + label + '">' + ICON[icon] + label + "</a>"; }
    // finish of the frame of a normal card, from its group: PhD students silver (oldest active start year) or metal, postdocs gold (with Prof.) or glitter, chairs holo
    function isEx(c) { var e = (c.dataset.end || "").trim().toLowerCase(); return ("ex" in c.dataset) || (e && e !== "today"); }
    function year(c) { var m = /\d{4}/.exec(c.dataset.start || ""); return m ? +m[0] : 9999; }
    var oldestPhd = 9999;
    Array.prototype.forEach.call(document.querySelectorAll('.people[data-group="phd"] .person'), function (c) { if (!isEx(c)) oldestPhd = Math.min(oldestPhd, year(c)); });
    function validFinish(v) { v = (v || "").trim(); var parts = v.split(/[+>]/); return v && parts.length <= 2 && parts.every(function (m) { return FINISHES.indexOf(m) >= 0; }) ? v : ""; }
    function frameFinish(card) {
        var g = card.closest(".people").dataset.group, prof = /prof/i.test(card.dataset.titles || "");
        if (g === "phd") return year(card) === oldestPhd ? "silver" : "metal";
        if (g === "postdoc") return prof ? "glitter>gold" : "glitter";            // with Prof.: glitter below, gold colour and shine above; without: plain glitter
        if (g === "chair") return "silver+holo";                                   // holo = complete silver below, rainbow above
        return "silver";
    }
    // finish of the whole body of an EX card: PhD students silver; postdocs plain glitter, or glitter below gold with the Prof. title; chairs glitter + rainbow
    function exFinish(card) {
        var g = card.closest(".people").dataset.group, prof = /prof/i.test(card.dataset.titles || "");
        if (g === "postdoc") return prof ? "glitter>gold" : "glitter";
        if (g === "chair") return "glitter+holo";
        return "silver";
    }
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    Array.prototype.forEach.call(document.querySelectorAll(".person"), function (card) {
        var d = card.dataset, start = (d.start || "").trim(), end = (d.end || "").trim(), today = end.toLowerCase() === "today";
        var isEx = ("ex" in d) || (end && !today);

        // slot: a fixed wrapper that receives the pointer, the card inside it is the one that tilts
        var slot = document.createElement("div"); slot.className = "slot";
        card.parentNode.insertBefore(slot, card); slot.appendChild(card);

        var name = card.querySelector("h3"), tags = (d.titles || "").split(",").map(function (t) { return t.trim(); }).filter(Boolean);
        if (name && tags.length) {                                    // small rounded badges under the name, like the badges of a readme
            var row = document.createElement("div"); row.className = "titles";
            tags.forEach(function (t) { var s = document.createElement("span"); s.className = "tag t-" + t.toLowerCase().replace(/[^a-z]/g, ""); s.textContent = t; row.appendChild(s); });
            name.parentNode.insertBefore(row, name.nextSibling);
        }
        if (isEx) { card.classList.add("ex"); var b = document.createElement("span"); b.className = "ex-badge"; b.textContent = "EX"; card.appendChild(b); }
        if (start || end) {
            var p = document.createElement("p"); p.className = "dates";
            var e = today ? "today" : end;
            p.textContent = start && e ? start + " – " + e : e ? "until " + e : "since " + start;
            card.appendChild(p);
        }
        var html = "";
        if (d.orcid) html += link("https://orcid.org/" + d.orcid, "orcid", "ORCID");
        if (d.scholar) html += link("https://scholar.google.com/citations?hl=en&user=" + d.scholar, "scholar", "Scholar");
        if (d.github) html += link("https://github.com/" + d.github, "github", "GitHub");
        if (d.web) html += link(d.web, "web", "Website");
        if (html) { var l = document.createElement("div"); l.className = "links"; l.innerHTML = html; card.appendChild(l); }

        var foil = null;
        if (!isEx && window.HalFoil) {                                 // normal card: metallic frame
            foil = window.HalFoil.attach(card, validFinish(d.foil) || frameFinish(card), { frame: 7, radius: 12 });      // data-foil overrides the finish chosen by the group
            if (foil.ok) foil.draw(REST.x, REST.y, 0, 0);
        } else if (isEx && window.HalFoil) {
            var mode = validFinish(d.foil) || exFinish(card);
            foil = window.HalFoil.attach(card, mode);
            if (foil.ok) foil.draw(REST.x, REST.y, 0, 0);
        }
        if (reduced) return;

        // pointer state, eased every frame; the loop runs only while something moves
        var tx = 0.5, ty = 0.5, cx = 0.5, cy = 0.5, target = 0, cur = 0, raf = 0, last = 0, hovering = false;
        function frame(now) {
            raf = 0;
            var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
            var k = 1 - Math.pow(0.0006, dt);                         // frame-rate independent easing (about 0.2 per frame at 60 fps)
            if (sway) { tx = 0.5 + 0.36 * Math.sin(now / 1000 * 0.9 + phase); ty = 0.5 + 0.36 * Math.sin(now / 1000 * 0.62 + phase * 1.7); target = 1; }
            cx += (tx - cx) * k; cy += (ty - cy) * k; cur += (target - cur) * k;
            card.style.transform = "perspective(700px) rotateX(" + ((0.5 - cy) * 12 * cur).toFixed(2) + "deg) rotateY(" + ((cx - 0.5) * 12 * cur).toFixed(2) + "deg) scale(" + (1 + 0.025 * cur).toFixed(4) + ")";
            if (foil && foil.ok) foil.draw(REST.x + (cx - REST.x) * cur, REST.y + (cy - REST.y) * cur, cur, now / 1000);
            var settled = !sway && !hovering && cur < 0.003 && Math.abs(cx - 0.5) < 0.003 && Math.abs(cy - 0.5) < 0.003;
            if (settled) { card.style.transform = ""; if (foil && foil.ok) foil.draw(REST.x, REST.y, 0, now / 1000); return; }
            raf = requestAnimationFrame(frame);
        }
        function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
        function setPointer(e) { var r = slot.getBoundingClientRect(); tx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); ty = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); }
        function leave() { if (sway) return; hovering = false; target = 0; tx = 0.5; ty = 0.5; kick(); }
        // touch screens have no hover: the visible cards slowly rock by themselves, as if a pointer were gliding over them
        var sway = false, phase = Math.random() * 6.28;
        if (window.matchMedia && matchMedia("(hover: none)").matches && "IntersectionObserver" in window) {
            new IntersectionObserver(function (en) { sway = en[0].isIntersecting; if (sway) kick(); else leave(); }, { threshold: 0.2 }).observe(slot);
        }
        slot.addEventListener("pointerenter", function (e) { if (e.pointerType === "touch") return; hovering = true; target = 1; setPointer(e); kick(); });
        slot.addEventListener("pointermove", function (e) { if (e.pointerType === "touch") return; if (!hovering) { hovering = true; target = 1; } setPointer(e); kick(); });
        slot.addEventListener("pointerleave", leave);
        slot.addEventListener("pointercancel", leave);
        window.addEventListener("blur", leave);
        document.addEventListener("visibilitychange", function () { if (document.hidden) leave(); });
    });
})();
