/* Carousel of the ostia annotation examples (figure #oc-figure): one image per volume, the left and right ostium on an axial and a sagittal slice.
 * The frames change every STEP_MS; when the visitor moves the slider the image stays still for HOLD_MS, then the carousel goes on.
 * Only the frame on screen and the next one are downloaded, and the carousel stops while the figure is out of view or the tab is hidden.
 * FRAMES is the content of assets/frames/ (a static site cannot list a folder): update it when the frames change. */
(function () {
    "use strict";
    var DIR = "./assets/frames/";
    var STEP_MS = 6000;
    var HOLD_MS = 20000;
    var FRAMES = [
        "000__CAT08__image22.png", "001__ImageCAS__283.png", "002__ASOCA__Diseased_8.png", "003__ImageCAS__83.png", "004__ASOCA__Diseased_11.png",
        "005__ImageCAS__190.png", "006__ImageCAS__214.png", "007__ImageCAS__669.png", "008__ImageCAS__370.png", "009__ImageCAS__923.png",
        "010__ASOCA__Diseased_13.png", "011__ImageCAS__437.png", "012__ImageCAS__735.png", "013__ImageCAS__194.png", "014__CAT08__image10.png",
        "015__ImageCAS__815.png", "016__CAT08__image04.png", "017__ASOCA__Diseased_19.png", "018__ImageCAS__508.png", "019__ImageCAS__887.png",
        "020__CAT08__image08.png", "021__ASOCA__Diseased_5.png", "022__ImageCAS__889.png", "023__CAT08__image16.png", "024__ImageCAS__14.png",
        "025__ImageCAS__804.png", "026__ImageCAS__313.png", "027__ImageCAS__34.png", "028__ImageCAS__69.png", "029__ImageCAS__96.png",
        "030__ASOCA__Normal_10.png", "031__ImageCAS__814.png", "032__ImageCAS__482.png", "033__ImageCAS__937.png", "034__ImageCAS__596.png",
        "035__ImageCAS__200.png", "036__ASOCA__Diseased_16.png", "037__ImageCAS__558.png", "038__ImageCAS__144.png", "039__ImageCAS__507.png",
        "040__CAT08__image11.png", "041__ImageCAS__994.png", "042__CAT08__image05.png", "043__ImageCAS__959.png", "044__ImageCAS__539.png",
        "045__ASOCA__Diseased_2.png", "046__ImageCAS__734.png", "047__ASOCA__Diseased_4.png", "048__ImageCAS__629.png", "049__ImageCAS__119.png",
        "050__CAT08__image09.png", "051__CAT08__image20.png", "052__ImageCAS__765.png", "053__ImageCAS__391.png", "054__ASOCA__Normal_11.png",
        "055__ImageCAS__783.png", "056__ImageCAS__726.png", "057__ImageCAS__332.png", "058__ImageCAS__983.png", "059__ImageCAS__502.png",
        "060__ImageCAS__906.png", "061__CAT08__image07.png", "062__ASOCA__Diseased_12.png", "063__ImageCAS__905.png", "064__ImageCAS__807.png",
        "065__ImageCAS__635.png", "066__ImageCAS__247.png", "067__ImageCAS__898.png", "068__ImageCAS__146.png", "069__ImageCAS__164.png",
        "070__ImageCAS__880.png", "071__ASOCA__Diseased_14.png", "072__ImageCAS__89.png", "073__ASOCA__Normal_3.png", "074__ImageCAS__222.png",
        "075__ImageCAS__401.png", "076__ImageCAS__659.png", "077__ImageCAS__712.png", "078__ImageCAS__174.png", "079__CAT08__image31.png",
        "080__ImageCAS__628.png", "081__ImageCAS__422.png", "082__CAT08__image15.png", "083__ImageCAS__176.png", "084__ImageCAS__88.png",
        "085__ImageCAS__585.png", "086__CAT08__image01.png", "087__ASOCA__Diseased_6.png", "088__ImageCAS__498.png", "089__ImageCAS__967.png",
        "090__ImageCAS__265.png", "091__CAT08__image12.png", "092__ImageCAS__580.png", "093__ImageCAS__897.png", "094__CAT08__image28.png",
        "095__ImageCAS__703.png", "096__ImageCAS__408.png", "097__ASOCA__Diseased_7.png", "098__ImageCAS__564.png", "099__ImageCAS__912.png"
    ];

    var fig = document.getElementById("oc-figure"); if (!fig || !FRAMES.length) return;
    var img = fig.querySelector("img"), slider = fig.querySelector("input[type=range]");
    var index = 0, timer = null, visible = false, pending = null;

    function label(name) {                                           // 000__CAT08__image22.png -> CAT08 image22
        var parts = name.replace(/\.png$/, "").split("__");
        return parts[1] + " " + parts.slice(2).join(" ");
    }
    function preload(i) { var im = new Image(); im.src = DIR + FRAMES[(i + FRAMES.length) % FRAMES.length]; return im; }
    function paint() {                                               // filled part of the slider track
        slider.style.setProperty("--fill", (FRAMES.length > 1 ? 100 * index / (FRAMES.length - 1) : 0) + "%");
    }
    function show(i) {
        index = (i + FRAMES.length) % FRAMES.length;
        slider.value = index; paint();
        var name = FRAMES[index], im = new Image();
        pending = im;                                                // the image is swapped only once it is downloaded (no blank frame)
        im.onload = function () {
            if (pending !== im) return;
            img.src = im.src;
            img.alt = "Left and right ostium landmarks, " + label(name);
            preload(index + 1);
        };
        im.src = DIR + name;
    }
    function schedule(ms) {
        clearTimeout(timer); timer = null;
        if (!visible || document.hidden) return;
        timer = setTimeout(function () { show(index + 1); schedule(STEP_MS); }, ms);
    }

    slider.min = 0; slider.max = FRAMES.length - 1; slider.step = 1;
    slider.addEventListener("input", function () { show(parseInt(slider.value, 10)); schedule(HOLD_MS); });
    document.addEventListener("visibilitychange", function () { schedule(STEP_MS); });

    if ("IntersectionObserver" in window) {
        var started = false;
        new IntersectionObserver(function (entries) {
            visible = entries[entries.length - 1].isIntersecting;
            if (visible && !started) { started = true; show(0); }
            schedule(STEP_MS);
        }, { rootMargin: "300px 0px" }).observe(fig);
    } else {
        visible = true; show(0); schedule(STEP_MS);
    }
})();
