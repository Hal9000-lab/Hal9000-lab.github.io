/* People cards of the landing page: builds the badge, the dates and the links from the data attributes of each .person,
 * and adds the tilt-on-hover effect (EX cards get a metallic sheen that follows the pointer). */
(function () {
    "use strict";
    var ICON = {
        orcid: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#a6ce39"/><path fill="#fff" d="M8.4 6.1a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0zM6.7 8.2h1.6v9.6H6.7zM10.1 8.2h3.4c3.2 0 4.8 2 4.8 4.8s-1.7 4.8-4.8 4.8h-3.4zm1.6 1.4v6.8h1.7c2.4 0 3.2-1.6 3.2-3.4s-.9-3.4-3.2-3.4z"/></svg>',
        scholar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M12 3 1 9l11 6 9-4.9V17h2V9z"/><path fill="#356ac3" d="M5 13.2v4c0 1.7 3.1 3.3 7 3.3s7-1.6 7-3.3v-4l-7 3.8z"/></svg>',
        github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>',
        web: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.6 4 5.9 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-5.9-4-9.5s1.4-6.9 4-9.5z"/></svg>'
    };
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
    function link(href, icon, label) { return '<a target="_blank" rel="noopener" href="' + esc(href) + '" title="' + label + '">' + ICON[icon] + label + "</a>"; }

    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    Array.prototype.forEach.call(document.querySelectorAll(".person"), function (card) {
        var d = card.dataset, start = (d.start || "").trim(), end = (d.end || "").trim();
        if (end || "ex" in d) {
            card.classList.add("ex");
            var badge = document.createElement("span"); badge.className = "ex-badge"; badge.textContent = "EX"; card.appendChild(badge);
        }
        if (start || end) {
            var p = document.createElement("p"); p.className = "dates";
            p.textContent = start && end ? start + " – " + end : end ? "until " + end : "since " + start;
            card.appendChild(p);
        }
        var html = "";
        if (d.orcid) html += link("https://orcid.org/" + d.orcid, "orcid", "ORCID");
        if (d.scholar) html += link("https://scholar.google.com/citations?hl=en&user=" + d.scholar, "scholar", "Scholar");
        if (d.github) html += link("https://github.com/" + d.github, "github", "GitHub");
        if (d.web) html += link(d.web, "web", "Website");
        if (html) { var l = document.createElement("div"); l.className = "links"; l.innerHTML = html; card.appendChild(l); }

        if (reduced) return;
        card.addEventListener("pointermove", function (e) {          // light tilt, as if the card were pressed where the pointer is; the sheen follows the pointer
            var r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
            card.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); card.style.setProperty("--my", (y * 100).toFixed(1) + "%");
            card.style.transform = "perspective(700px) rotateX(" + ((0.5 - y) * 12).toFixed(2) + "deg) rotateY(" + ((x - 0.5) * 12).toFixed(2) + "deg) scale(1.025)";
        });
        card.addEventListener("pointerleave", function () { card.style.transform = ""; });
    });
})();
