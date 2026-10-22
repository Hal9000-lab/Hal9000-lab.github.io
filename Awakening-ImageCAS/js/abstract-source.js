/* Shows the abstract from the best source available: the journal, then arXiv, then the text written in index.html.
 * A source is used only once its card in #fast-cards-container holds a real link (no "soon" class): the Paper card a DOI link,
 * the arXiv card an arxiv.org/abs/<id> link. The journal abstract is read from Crossref; the arXiv one from OpenAlex, because the
 * arXiv API does not allow cross-origin requests from a browser. Publishers often do not deposit their abstracts, in which case
 * the next source is tried. If nothing answers, the written abstract stays as it is. */
(function () {
    "use strict";
    var TIMEOUT_MS = 5000;
    var CACHE_KEY = "awakening-abstract-v1";
    var box = document.getElementById("abstract");
    if (!box || !window.fetch) return;

    function cardLink(id) {
        var card = document.getElementById(id);
        if (!card || card.classList.contains("soon")) return null;
        var a = card.querySelector("a[href]");
        return a ? a.href : null;
    }
    function getJSON(url) {
        var ctrl = window.AbortController ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
        return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
            clearTimeout(timer);
            if (!r.ok) throw new Error(url + ": HTTP " + r.status);
            return r.json();
        });
    }
    function clean(text) {
        return text.replace(/\s+/g, " ").trim();
    }

    // journal: Crossref keeps the deposited abstract as JATS XML, one <jats:p> per paragraph
    function fromJournal(href) {
        var m = /10\.\d{4,9}\/[^\s?#]+/.exec(decodeURIComponent(href));
        if (!m) return Promise.reject(new Error("no DOI in " + href));
        return getJSON("https://api.crossref.org/works/" + encodeURIComponent(m[0])).then(function (j) {
            var jats = j && j.message && j.message.abstract;
            if (!jats) throw new Error("no abstract deposited for " + m[0]);
            var doc = new DOMParser().parseFromString("<root>" + jats + "</root>", "text/html");
            var paras = [];
            doc.querySelectorAll("p").forEach(function (p) {
                var t = clean(p.textContent);
                if (t && !/^abstract$/i.test(t)) paras.push(t);
            });
            if (!paras.length) paras = [clean(doc.body.textContent).replace(/^Abstract\s*/i, "")];
            return paras;
        });
    }

    // arXiv, through OpenAlex: the abstract comes as an inverted index (word -> positions)
    function fromArxiv(href) {
        var m = /arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(href);
        if (!m) return Promise.reject(new Error("no arXiv id in " + href));
        return getJSON("https://api.openalex.org/works/doi:10.48550/arXiv." + m[1]).then(function (j) {
            var inv = j && j.abstract_inverted_index;
            if (!inv) throw new Error("no abstract indexed for arXiv " + m[1]);
            var words = [];
            Object.keys(inv).forEach(function (w) {
                inv[w].forEach(function (pos) { words[pos] = w; });
            });
            return [clean(words.join(" "))];
        });
    }

    function show(paras, label) {
        box.querySelectorAll("p").forEach(function (p) { p.remove(); });
        var note = document.createElement("p");
        note.className = "abstract-source";
        note.textContent = "Source: " + label;
        box.appendChild(note);
        paras.forEach(function (t) {
            var p = document.createElement("p");
            p.textContent = t;
            box.appendChild(p);
        });
    }

    var sources = [];
    var journal = cardLink("paper"), arxiv = cardLink("arxiv");
    if (journal) sources.push({ key: journal, label: "journal", load: function () { return fromJournal(journal); } });
    if (arxiv) sources.push({ key: arxiv, label: "arXiv", load: function () { return fromArxiv(arxiv); } });
    if (!sources.length) return;

    try {
        var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (cached && cached.key === sources[0].key && cached.paras) { show(cached.paras, cached.label); return; }
    } catch (e) { /* storage unavailable: just fetch */ }

    (function tryNext(i) {
        if (i >= sources.length) return;
        var s = sources[i];
        s.load().then(function (paras) {
            show(paras, s.label);
            // cached under the best source's key, so a newly linked journal card is never hidden by an older arXiv entry
            try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ key: sources[0].key, label: s.label, paras: paras })); } catch (e) { /* ignore */ }
        }).catch(function (err) {
            if (window.console) console.warn("abstract from " + s.label + " not available: " + err.message);
            tryNext(i + 1);
        });
    })(0);
})();
