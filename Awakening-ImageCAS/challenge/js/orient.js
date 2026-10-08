/* Small body figure that shows where the two planes cut the chest: the horizontal line is the axial slice (S index),
 * the vertical line the sagittal slice (R index). Patient's right is on the viewer's left, as in the radiological convention. */
(function (root) {
    "use strict";
    var AX = "#f2c14e", SG = "#4bd0e0";

    function draw(canvas, state) {
        var dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 130, H = canvas.clientHeight || 210;
        if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
        var c = canvas.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
        var cx = W / 2, s = H / 210;
        c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "rgba(220,225,235,0.85)"; c.fillStyle = "rgba(220,225,235,0.12)"; c.lineWidth = 2.2;
        // body
        c.beginPath(); c.arc(cx, 20 * s, 12 * s, 0, 6.2832); c.stroke();                                    // head
        c.beginPath(); c.moveTo(cx, 32 * s); c.lineTo(cx, 38 * s); c.stroke();                                // neck
        c.beginPath(); c.moveTo(cx - 25 * s, 40 * s); c.quadraticCurveTo(cx - 27 * s, 90 * s, cx - 17 * s, 118 * s);
        c.lineTo(cx + 17 * s, 118 * s); c.quadraticCurveTo(cx + 27 * s, 90 * s, cx + 25 * s, 40 * s); c.closePath(); c.fill(); c.stroke();   // torso
        c.beginPath(); c.moveTo(cx - 25 * s, 42 * s); c.lineTo(cx - 44 * s, 96 * s); c.moveTo(cx + 25 * s, 42 * s); c.lineTo(cx + 44 * s, 96 * s); c.stroke();   // arms
        c.beginPath(); c.moveTo(cx - 9 * s, 118 * s); c.lineTo(cx - 13 * s, 196 * s); c.moveTo(cx + 9 * s, 118 * s); c.lineTo(cx + 13 * s, 196 * s); c.stroke();   // legs
        // heart region: the exported box
        var bw = 34 * s, bh = 26 * s, bx = cx - bw / 2 + 3 * s, by = 56 * s;                                 // slightly towards the patient's left
        c.setLineDash([3, 3]); c.lineWidth = 1.2; c.strokeStyle = "rgba(255,255,255,0.7)"; c.strokeRect(bx, by, bw, bh); c.setLineDash([]);
        c.fillStyle = "rgba(220,70,80,0.55)"; c.beginPath(); c.ellipse(bx + bw / 2 + 2 * s, by + bh / 2, 8 * s, 10 * s, 0.3, 0, 6.2832); c.fill();
        if (state && state.fk !== undefined) {
            var y = by + bh - state.fk * bh, x = bx + bw - state.fi * bw;                                    // larger R index -> further to the patient's right = viewer's left
            c.lineWidth = 2; c.strokeStyle = AX; c.beginPath(); c.moveTo(cx - 40 * s, y); c.lineTo(cx + 40 * s, y); c.stroke();
            c.strokeStyle = SG; c.beginPath(); c.moveTo(x, by - 14 * s); c.lineTo(x, by + bh + 14 * s); c.stroke();
        }
        c.fillStyle = "rgba(235,240,250,0.9)"; c.font = "bold " + 11 * s + "px sans-serif";
        c.fillText("R", 6, 112 * s); c.fillText("L", W - 14, 112 * s);
        c.font = 10 * s + "px sans-serif"; c.fillStyle = AX; c.fillText("axial", 4, H - 18); c.fillStyle = SG; c.fillText("sagittal", 4, H - 5);
    }
    root.OstiaOrient = { draw: draw, AXIAL: AX, SAGITTAL: SG };
})(window);
