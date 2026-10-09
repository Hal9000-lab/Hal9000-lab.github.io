/* Interactive particle sphere with streaks of light, as a background for any element with the attribute  data-particles .
 * Based on the mouse interaction of the "Interactive Particles Hero" pen by VoXelo (https://codepen.io/VoXelo/pen/OPVdmOp), rewritten in
 * plain WebGL (no three.js, no bloom: soft additive sprites stand in for the glow). The particles form a slowly turning sphere in the
 * middle; the pointer pushes them away and turns them gold, then they spring back to the sphere; thin streaks fly towards the viewer.
 * The element keeps its own background colour; the canvas is drawn behind its content. Respects prefers-reduced-motion (still frame). */
(function () {
    "use strict";

    var FOV = 75, CAM_Z = 50;               // camera as in the pen
    var SPHERE_RADIUS = 0.72;               // radius of the sphere, as a fraction of the half height of the view
    var SURFACE_DENSITY = 0.3;              // particles per world unit^2 of the sphere surface
    var SHELL = 0.10;                       // thickness of the shell (fraction of the radius): gives the sphere some depth
    var MAX_PARTICLES = 12000;
    var ROTATION = 0.05, TILT = 0.4;        // turning speed (rad/s) and tilt of the axis (rad)
    var BREATH = 0.03;                      // slight radial wobble of the voxels
    var BASE = [0.20, 0.58, 1.0];            // particle colour (the pen's 0x001f3f is almost black without its bloom pass, so it is brightened here)
    var BASE_RED = [0.80, 0.14, 0.20], SPLIT_BLEND = 0.18, SPLIT_AT = -0.3;   // the sphere is half blue, half red (hemispheres about its turning axis, SPLIT_BLEND = width of the gradient between them, fraction of the radius)
    var GOLD = [1.0, 0.84, 0.0];
    var BRIGHTNESS = 1.0;                   // overall colour gain
    var DISP_REF = 12;                      // displacement (world units) at which the effects below reach full strength
    var DISP_BOOST = 0.7;                   // extra brightness of a displaced sprite: x(1 + boost * displacement)
    var GLOW_SCALE = 5.0, GLOW_GAIN = 0.85; // halo around a displaced sprite: size (x sprite size) and strength, both from the displacement
    var TWINKLE_EVERY = [0.15, 0.6], TWINKLE_TIME = 1.4, TWINKLE_GLOW = 0.9, TWINKLE_BOOST = 0.6, TWINKLE_MAX = 8;   // random sprites twinkle (brighter, halo in their own colour)
    var OPACITY = 0.92;                     // opacity of the sprites (1 = solid squares that hide what is behind them)
    var SIZE = 1.1;                         // sprite size in world units
    var REPEL_RADIUS = 20, REPEL_FORCE = 0.1, SPRING = 0.01, DAMPING = 0.92;
    var WAVE_FREQ = 0.1, WAVE_SPEED = 1.2;
    var STREAK_SPEED = 0.4;                // speed of the streaks, relative to the pen (1 = as in the pen)
    var RED = [0.7, 0.0, 0.05], BLINK_TIME = 0.9, BLINK_EVERY = [1.5, 4.5];   // now and then one sprite blinks dark red once (seconds)
    var N_STREAKS = 30, STREAK_COLOR = [0.53, 0.67, 1.0], STREAK_ALPHA = 0.5;
    var MAX_DPR = 1.5;

    var VS_P = "attribute vec3 position; attribute vec3 color; uniform vec2 uTan; uniform float uPx, uSize, uCam; varying vec3 vColor;" +
        "void main() { float d = uCam - position.z; vColor = color; gl_Position = vec4(position.x / uTan.x, position.y / uTan.y, d * (d / 240.0 - 1.0), d); gl_PointSize = max(1.0, uSize * uPx / d); }";
    var FS_P = "precision mediump float; varying vec3 vColor; uniform float uGain, uAlpha;" +
        "void main() { vec3 rgb = vColor * uGain; gl_FragColor = vec4(rgb * uAlpha, uAlpha); }";     // hard square sprites, as the default points of the pen
    var VS_G = "attribute vec3 position; attribute vec3 color; attribute float glow; uniform vec2 uTan; uniform float uPx, uSize, uCam; varying vec3 vColor; varying float vGlow;" +
        "void main() { float d = uCam - position.z; vColor = color; vGlow = glow; gl_Position = vec4(position.x / uTan.x, position.y / uTan.y, d * (d / 240.0 - 1.0), d); gl_PointSize = max(1.0, uSize * (0.4 + glow) * uPx / d); }";
    var FS_G = "precision mediump float; varying vec3 vColor; varying float vGlow; uniform float uGlowGain;" +
        "void main() { vec2 c = gl_PointCoord * 2.0 - 1.0; float a = 1.0 - clamp(length(c), 0.0, 1.0); a *= a * vGlow; vec3 rgb = vColor * a * uGlowGain; gl_FragColor = vec4(rgb, max(rgb.r, max(rgb.g, rgb.b))); }";
    var VS_L = "attribute vec3 position; uniform vec2 uTan; uniform float uCam; void main() { float d = uCam - position.z; gl_Position = vec4(position.x / uTan.x, position.y / uTan.y, d * (d / 240.0 - 1.0), d); }";
    var FS_L = "precision mediump float; uniform vec4 uColor; void main() { gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a); }";

    function sh(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function program(gl, vs, fs) {
        var p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        return p;
    }

    function start(el) {
        var cv = document.createElement("canvas");
        cv.className = "particles-canvas"; cv.setAttribute("aria-hidden", "true");
        cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;";
        el.insertBefore(cv, el.firstChild);
        var gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: true });
        if (!gl) { cv.remove(); return; }
        var pp, pl, pg;
        try { pp = program(gl, VS_P, FS_P); pl = program(gl, VS_L, FS_L); pg = program(gl, VS_G, FS_G); } catch (e) { if (window.console) console.warn("particles:", e.message); cv.remove(); return; }

        var tanHalf = Math.tan(FOV * Math.PI / 360), aspect = 1, halfW = 1, halfH = 1, pxPerUnit = 1, R = 1;
        var n = 0, orig = null, cur = null, vel = null, pos = null, col = null, base = null, posBuf = gl.createBuffer(), colBuf = gl.createBuffer(), glowBuf = gl.createBuffer(), glw = null;
        var streaks = [], lineBuf = gl.createBuffer(), lineData = new Float32Array(N_STREAKS * 6);
        var mouse = { x: 1e5, y: 1e5 }, reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        function build() {
            var w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
            aspect = w / h; halfH = CAM_Z * tanHalf; halfW = halfH * aspect;
            var rcss = parseFloat(getComputedStyle(el).getPropertyValue("--sphere-radius"));        // optional: sphere radius in css px (so a taller element does not enlarge the sphere)
            R = rcss > 0 ? rcss / (h / 2) * halfH : halfH * SPHERE_RADIUS;
            n = Math.min(MAX_PARTICLES, Math.round(4 * Math.PI * R * R * SURFACE_DENSITY));
            orig = new Float32Array(n * 3); cur = new Float32Array(n * 3); vel = new Float32Array(n * 3); pos = new Float32Array(n * 3); col = new Float32Array(n * 3); base = new Float32Array(n * 3); glw = new Float32Array(n);
            var golden = Math.PI * (3 - Math.sqrt(5));
            for (var i = 0; i < n; i++) {                                   // Fibonacci sphere: even spread over the surface
                var y = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), th = golden * i, rad = R * (1 - SHELL * Math.random());
                orig[i * 3] = Math.cos(th) * rr * rad; orig[i * 3 + 1] = y * rad; orig[i * 3 + 2] = Math.sin(th) * rr * rad;
                cur[i * 3] = orig[i * 3]; cur[i * 3 + 1] = orig[i * 3 + 1]; cur[i * 3 + 2] = orig[i * 3 + 2];
                var sp = Math.min(1, Math.max(0, ((orig[i * 3 + 1] * Math.sin(TILT) + orig[i * 3 + 2] * Math.cos(TILT)) / R - SPLIT_AT - SPLIT_BLEND) / (-2 * SPLIT_BLEND))); sp = sp * sp * (3 - 2 * sp);      // 0 = blue side, 1 = red side
                for (var cc = 0; cc < 3; cc++) base[i * 3 + cc] = BASE[cc] + (BASE_RED[cc] - BASE[cc]) * sp;
                col[i * 3] = base[i * 3]; col[i * 3 + 1] = base[i * 3 + 1]; col[i * 3 + 2] = base[i * 3 + 2];
            }
            var W = 2 * halfW + 30, H = 2 * halfH + 30;
            streaks = [];
            for (var k = 0; k < N_STREAKS; k++) streaks.push({ x: (Math.random() - 0.5) * W, y: (Math.random() - 0.5) * H, z: -150 + Math.random() * 190, len: 5 + Math.random() * 10, speed: (15 + Math.random() * 30) * STREAK_SPEED });
        }
        function resize() {
            var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR), w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr));
            var changed = cv.width !== w || cv.height !== h;
            if (changed) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
            pxPerUnit = cv.height / (2 * tanHalf);
            if (changed || !orig) build();
        }

        el.addEventListener("pointermove", function (e) {
            var r = el.getBoundingClientRect();
            mouse.x = ((e.clientX - r.left) / r.width * 2 - 1) * halfW; mouse.y = -((e.clientY - r.top) / r.height * 2 - 1) * halfH;
        });
        el.addEventListener("pointerleave", function () { mouse.x = mouse.y = 1e5; });

        var blink = null, nextBlink = 2.0, twinkles = [], nextTwinkle = 0.5;
        function step(t) {                                          // one 60 Hz physics step
            var r2 = REPEL_RADIUS * REPEL_RADIUS, ca = Math.cos(t * ROTATION), sa = Math.sin(t * ROTATION), ct = Math.cos(TILT), st = Math.sin(TILT);
            for (var i = 0; i < n; i++) {
                var i3 = i * 3, ox = orig[i3], oy = orig[i3 + 1], oz = orig[i3 + 2];
                var br = 1 + BREATH * Math.sin(ox * WAVE_FREQ + t * WAVE_SPEED);                    // rest position: turn about the tilted axis, with a small radial wobble
                var rx = (ox * ca + oz * sa) * br, rz = (-ox * sa + oz * ca) * br, ry = oy * br;
                var tx = rx, ty = ry * ct - rz * st, tz = ry * st + rz * ct;
                var dx = cur[i3] - mouse.x, dy = cur[i3 + 1] - mouse.y, d2 = dx * dx + dy * dy, near = 0;
                if (d2 < r2) { var dist = Math.sqrt(d2) || 1e-4; near = 1 - dist / REPEL_RADIUS; var f = near * REPEL_FORCE / dist; vel[i3] += dx * f; vel[i3 + 1] += dy * f; }
                vel[i3] += (tx - cur[i3]) * SPRING; vel[i3 + 1] += (ty - cur[i3 + 1]) * SPRING; vel[i3 + 2] += (tz - cur[i3 + 2]) * SPRING;
                vel[i3] *= DAMPING; vel[i3 + 1] *= DAMPING; vel[i3 + 2] *= DAMPING;
                cur[i3] += vel[i3]; cur[i3 + 1] += vel[i3 + 1]; cur[i3 + 2] += vel[i3 + 2];
                pos[i3] = cur[i3]; pos[i3 + 1] = cur[i3 + 1]; pos[i3 + 2] = cur[i3 + 2];
                var ex = tx - cur[i3], ey = ty - cur[i3 + 1], ez = tz - cur[i3 + 2];
                var disp = Math.min(1, Math.sqrt(ex * ex + ey * ey + ez * ez) / DISP_REF);                   // how far the sprite is from its place on the sphere
                glw[i] = disp;
                var depth = (0.35 + 0.65 * Math.min(1, Math.max(0, (cur[i3 + 2] + R) / (2 * R)))) * (1 + DISP_BOOST * disp);   // far side dimmer, displaced sprites brighter
                col[i3] = (base[i3] + (GOLD[0] - base[i3]) * near) * depth; col[i3 + 1] = (base[i3 + 1] + (GOLD[1] - base[i3 + 1]) * near) * depth; col[i3 + 2] = (base[i3 + 2] + (GOLD[2] - base[i3 + 2]) * near) * depth;
            }
            // twinkle: now and then a random sprite gets brighter and a halo of its own colour, and fades back
            if (n && t >= nextTwinkle && twinkles.length < TWINKLE_MAX) {
                var tp = Math.floor(Math.random() * n);
                for (var tt = 0; tt < 20 && cur[tp * 3 + 2] < -R * 0.2; tt++) tp = Math.floor(Math.random() * n);          // prefer the visible side
                twinkles.push({ i: tp, t0: t }); nextTwinkle = t + TWINKLE_EVERY[0] + Math.random() * (TWINKLE_EVERY[1] - TWINKLE_EVERY[0]);
            }
            for (var q = twinkles.length - 1; q >= 0; q--) {
                var tw = twinkles[q], uu = (t - tw.t0) / TWINKLE_TIME;
                if (uu >= 1 || tw.i >= n) { twinkles.splice(q, 1); continue; }
                var env = Math.sin(Math.PI * uu), w3 = tw.i * 3; env *= env;
                var k = 1 + TWINKLE_BOOST * env;
                if (glw[tw.i] < TWINKLE_GLOW * env) glw[tw.i] = TWINKLE_GLOW * env;
                col[w3] *= k; col[w3 + 1] *= k; col[w3 + 2] *= k;
            }
            // one random sprite (on the near side of the sphere, so that it is seen) blinks dark red, once
            if (!blink && t >= nextBlink && n) {
                var pick = Math.floor(Math.random() * n);
                for (var tries = 0; tries < 30 && cur[pick * 3 + 2] < 0; tries++) pick = Math.floor(Math.random() * n);
                blink = { i: pick, t0: t }; nextBlink = t + BLINK_TIME + BLINK_EVERY[0] + Math.random() * (BLINK_EVERY[1] - BLINK_EVERY[0]);
            }
            if (blink) {
                var u = (t - blink.t0) / BLINK_TIME;
                if (u >= 1 || blink.i >= n) blink = null;
                else { var e = Math.sin(Math.PI * u), b3 = blink.i * 3; col[b3] = col[b3] * (1 - e) + RED[0] * e; col[b3 + 1] = col[b3 + 1] * (1 - e) + RED[1] * e; col[b3 + 2] = col[b3 + 2] * (1 - e) + RED[2] * e; }
            }
        }

        function draw(dt) {
            gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);      // nearer squares hide farther ones
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);          // normal (premultiplied) alpha blending: solid-looking sprites
            // halo of the displaced sprites (soft, additive-looking, no depth test), drawn first so the solid squares stay on top
            gl.disable(gl.DEPTH_TEST);
            gl.useProgram(pg);
            gl.uniform2f(gl.getUniformLocation(pg, "uTan"), tanHalf * aspect, tanHalf); gl.uniform1f(gl.getUniformLocation(pg, "uPx"), pxPerUnit);
            gl.uniform1f(gl.getUniformLocation(pg, "uSize"), SIZE * GLOW_SCALE); gl.uniform1f(gl.getUniformLocation(pg, "uCam"), CAM_Z); gl.uniform1f(gl.getUniformLocation(pg, "uGlowGain"), GLOW_GAIN);
            var gp = gl.getAttribLocation(pg, "position"), gc = gl.getAttribLocation(pg, "color"), gg = gl.getAttribLocation(pg, "glow");
            gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(gp); gl.vertexAttribPointer(gp, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(gc); gl.vertexAttribPointer(gc, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf); gl.bufferData(gl.ARRAY_BUFFER, glw, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(gg); gl.vertexAttribPointer(gg, 1, gl.FLOAT, false, 0, 0);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.POINTS, 0, n);
            gl.enable(gl.DEPTH_TEST);
            // particles
            gl.useProgram(pp);
            gl.uniform2f(gl.getUniformLocation(pp, "uTan"), tanHalf * aspect, tanHalf); gl.uniform1f(gl.getUniformLocation(pp, "uPx"), pxPerUnit);
            gl.uniform1f(gl.getUniformLocation(pp, "uSize"), SIZE); gl.uniform1f(gl.getUniformLocation(pp, "uCam"), CAM_Z); gl.uniform1f(gl.getUniformLocation(pp, "uGain"), BRIGHTNESS); gl.uniform1f(gl.getUniformLocation(pp, "uAlpha"), OPACITY);
            var lp = gl.getAttribLocation(pp, "position"), lc = gl.getAttribLocation(pp, "color");
            gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, colBuf); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(lc); gl.vertexAttribPointer(lc, 3, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.POINTS, 0, n);
            // streaks
            for (var k = 0; k < streaks.length; k++) {
                var s = streaks[k]; s.z += s.speed * dt; if (s.z > 42) s.z = -150;
                var o = k * 6; lineData[o] = s.x; lineData[o + 1] = s.y; lineData[o + 2] = s.z; lineData[o + 3] = s.x; lineData[o + 4] = s.y - s.len; lineData[o + 5] = s.z;
            }
            gl.useProgram(pl);
            gl.uniform2f(gl.getUniformLocation(pl, "uTan"), tanHalf * aspect, tanHalf); gl.uniform1f(gl.getUniformLocation(pl, "uCam"), CAM_Z);
            gl.uniform4f(gl.getUniformLocation(pl, "uColor"), STREAK_COLOR[0], STREAK_COLOR[1], STREAK_COLOR[2], STREAK_ALPHA);
            var ll = gl.getAttribLocation(pl, "position");
            gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferData(gl.ARRAY_BUFFER, lineData, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ll); gl.vertexAttribPointer(ll, 3, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.LINES, 0, streaks.length * 2);
        }

        var t = 0, last = 0, acc = 0, raf = 0;
        resize(); step(0); draw(0);
        function frame(now) {
            raf = requestAnimationFrame(frame);
            var dt = Math.min(0.05, (now - last) / 1000); last = now; acc += dt; t += dt;
            resize();
            var steps = 0; while (acc >= 1 / 60 && steps < 3) { step(t); acc -= 1 / 60; steps++; }
            draw(dt);
        }
        if (!reduced) { last = performance.now(); raf = requestAnimationFrame(frame); }
        if (window.ResizeObserver) new ResizeObserver(function () { resize(); step(t); draw(0); }).observe(el);
    }

    function init() { Array.prototype.forEach.call(document.querySelectorAll("[data-particles]"), function (el) { if (!el.querySelector(":scope > canvas.particles-canvas")) start(el); }); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
