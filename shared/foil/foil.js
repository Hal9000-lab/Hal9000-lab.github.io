/* Foil / holographic card finishes in plain WebGL (no libraries, no camera, no tracking: only the pointer position, or nothing at all).
 * The look is inspired by the shaders of the "pokebox" project (https://github.com/selop/pokebox): a sun-pillar rainbow that shifts with the
 * pointer, a pointer spotlight, Voronoi mosaic cells for glitter and a grainy silver foil. Rewritten from scratch for a flat card.
 *
 *   var f = HalFoil.attach(cardElement, "glitter");     // finishes: silver | holo | glitter | gold | metal | metaltex (texture only, no shine); two can be layered: "a+b" (the one with the lower ORDER goes below) or "a>b" (a below, b above)
 *   var f = HalFoil.attach(cardElement, "gold", { frame: 7 });   // only a frame of 7 css px around the card (like the border of a trading card)
 *   f.draw(px, py, strength, time);                       // px, py in 0..1 (pointer on the card), strength 0..1, time in seconds
 *
 * The overlay canvas is inserted as the first child of the element (z-index 0, under its content) and does not take pointer events.
 * Nothing runs by itself: the caller decides when to draw (the card only animates while it is hovered or settling). */
(function (root) {
    "use strict";
    var MODES = { silver: 0, holo: 1, glitter: 2, gold: 3, metal: 4, metaltex: 5 };
    // when two finishes are layered, the one with the lower number goes below (flat texture and base metals first, rainbow and sparkles on top)
    var ORDER = { metaltex: 0, silver: 1, metal: 2, gold: 3, holo: 4, glitter: 5 };

    var VS = "attribute vec2 p; varying vec2 vUv; void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
    var FS = [
        "precision mediump float;",
        "varying vec2 vUv; uniform vec2 uRes, uPtr; uniform float uTime, uStrength, uMode, uMode2, uFrame, uRadius, uInner, uRing;",
        "float gmetal = 0.0;                                             // 1 while the glitter is drawn as a frame (metallic cells), 0 for the inner whitish glitter",
        "float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
        "vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }",
        "float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }",
        // sun-pillar rainbow (six pastel stops, as in the pokebox shaders)
        "vec3 sun(float t) { float f = fract(t) * 6.0; float b = fract(f); float i = floor(f);",
        "  vec3 c0 = vec3(1.0, 0.46, 0.46), c1 = vec3(1.0, 0.90, 0.38), c2 = vec3(0.58, 1.0, 0.38), c3 = vec3(0.52, 1.0, 0.92), c4 = vec3(0.48, 0.53, 1.0), c5 = vec3(0.74, 0.46, 1.0);",
        "  vec3 a = i < 0.5 ? c0 : i < 1.5 ? c1 : i < 2.5 ? c2 : i < 3.5 ? c3 : i < 4.5 ? c4 : c5;",
        "  vec3 n = i < 0.5 ? c1 : i < 1.5 ? c2 : i < 2.5 ? c3 : i < 3.5 ? c4 : i < 4.5 ? c5 : c0;",
        "  return mix(a, n, b); }",
        "vec3 desat(vec3 c, float s) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(vec3(l), c, s); }",
        // Voronoi: x = id of the nearest cell, y = distance to its point
        "vec2 voro(vec2 uv) { vec2 cell = floor(uv), fr = fract(uv); float md = 10.0, id = 0.0;",
        "  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 nb = vec2(float(i), float(j)); vec2 pt = hash2(cell + nb); vec2 d = nb + pt - fr; float dd = dot(d, d);",
        "    if (dd < md) { md = dd; id = dot(cell + nb, vec2(7.0, 157.0)); } }",
        "  return vec2(id, sqrt(md)); }",
        "vec2 uv, q, ptr; float asp, spot, lit;                          // set in main, used by every finish",
        "vec4 shade(float mode) {",
        "  vec3 col = vec3(0.0); float a = 0.0;",
        "  if (mode < 0.5) {                                              // silver: flat silver foil, bumpy grain, a hint of rainbow",
        "    float g = vnoise(q * 46.0) * 0.6 + vnoise(q * 120.0) * 0.4;",
        "    if (gmetal > 0.5) g = mix(0.5, g, 0.25);                        // a calmer grain on the thin frame",
        "    float band = sin((uv.x + uv.y) * 7.0 - (ptr.x + ptr.y) * 9.0) * 0.5 + 0.5;",
        "    vec3 rb = desat(sun(uv.x * 0.9 - ptr.x * 0.7 + ptr.y * 0.3), 0.25) * (gmetal > 0.5 ? 0.4 : 1.0);",
        "    col = mix(vec3(0.82, 0.85, 0.9), vec3(1.0), band * 0.7) * (0.75 + 0.5 * g) + rb * 0.15;",
        "    a = (0.30 + 0.45 * spot + 0.20 * pow(band, 3.0) * uStrength) * lit;",
        "  } else if (mode < 1.5) {                                       // holo: sun-pillar rainbow sliding with the pointer, spotlight on top",
        "    float t = (uv.x * 0.8 + uv.y * 0.5) * 1.3 - ptr.x * 0.9 - ptr.y * 0.6;",
        "    col = sun(t) * (0.55 + 0.7 * spot);",
        "    a = (0.42 + 0.35 * spot) * lit;",
        "  } else if (mode < 2.5) {                                       // glitter: Voronoi cells, each with its own colour phase, sparkling as the light passes",
        "    vec2 v = voro(q * 17.0); float ph = fract(sin(v.x * 127.1) * 43758.5453);",
        "    vec3 rb = desat(sun(ph + ptr.x * 0.8 - ptr.y * 0.5), 0.55);",
        "    if (gmetal > 0.5) rb = mix(vec3(0.86, 0.89, 0.94) * (0.8 + 0.4 * vnoise(q * 60.0 + ph * 10.0)), desat(rb, 0.7), 0.3);   // on a frame: metallic silver cells with only a hint of colour",
        "    float tw = sin(ph * 40.0 + (ptr.x + ptr.y) * 10.0 + uTime * 1.6 * uStrength);",
        "    float spark = pow(max(tw, 0.0), 14.0);",
        "    float dust = pow(vnoise(q * 90.0 + ph * 20.0), 6.0);",
        "    col = mix(rb * (0.7 + 0.3 * spot), vec3(1.0), spark * (0.4 + 0.6 * spot));",
        "    a = (0.09 + 0.22 * spot + 0.80 * spark * (0.25 + spot) + 0.16 * dust) * lit;",
        "  } else if (mode < 3.5) {                                       // gold: warm gradient with a specular band that follows the pointer",
        "    float s = (uv.x * 0.7 + uv.y * 0.7);",
        "    float spec = pow(0.5 + 0.5 * cos((s - (ptr.x * 0.7 + ptr.y * 0.7)) * 9.0), 8.0);",
        "    vec3 g0 = vec3(0.72, 0.52, 0.10), g1 = vec3(1.0, 0.86, 0.42), g2 = vec3(1.0, 0.97, 0.80);",
        "    col = mix(g0, g1, 0.5 + 0.5 * sin(s * 5.0 + 1.0 - ptr.x * 2.0)); col = mix(col, g2, spec * 0.9);",
        "    a = (0.62 + 0.28 * spec + 0.12 * spot) * (0.75 + 0.25 * lit);",
        "  } else if (mode < 4.5) {                                        // metal: brushed steel, anisotropic streaks and a light band that moves with the pointer",
        "    float br = vnoise(vec2(uv.x * 3.0, uv.y * 220.0)) * 0.7 + vnoise(vec2(uv.x * 9.0, uv.y * 420.0)) * 0.3;",
        "    float band = pow(0.5 + 0.5 * cos((uv.x - ptr.x) * 6.5 + (uv.y - ptr.y) * 2.2), 5.0);",
        "    col = mix(vec3(0.58, 0.62, 0.68), vec3(0.97, 0.98, 1.0), band * 0.8 + br * 0.35);",
        "    a = (0.42 + 0.38 * band + 0.10 * br) * (0.65 + 0.35 * lit);",
        "  } else {                                                        // metaltex: the brushed-steel texture only, no moving light (a base to put another finish on)",
        "    float br = vnoise(vec2(uv.x * 3.0, uv.y * 220.0)) * 0.7 + vnoise(vec2(uv.x * 9.0, uv.y * 420.0)) * 0.3;",
        "    col = mix(vec3(0.46, 0.50, 0.56), vec3(0.80, 0.83, 0.88), br);",
        "    a = 0.80;",
        "  }",
        "  a = clamp(a, 0.0, 0.97);",
        "  return vec4(col * a, a);                                       // premultiplied alpha",
        "}",
        "void main() {",
        "  uv = vUv; asp = uRes.x / uRes.y; q = vec2(uv.x * asp, uv.y);",
        "  ptr = vec2(uPtr.x, 1.0 - uPtr.y);                              // pointer, y up",
        "  spot = 1.0 - smoothstep(0.0, 0.75, length((uv - ptr) * vec2(asp, 1.0))); spot = pow(spot, 1.4);",
        "  lit = 0.35 + 0.65 * uStrength;                                 // a faint finish at rest, full when hovered",
        "  gmetal = (uFrame > 0.0 && uRing < -0.5) ? 1.0 : 0.0;",
        "  vec4 c = shade(uMode);",
        "  if (uMode2 > -0.5) { vec4 d = shade(uMode2) * 0.8; c = d + c * (1.0 - d.a); }       // a second finish layered over the first",
        "  if (uFrame > 0.0) {                                             // frame: a solid metallic ring (rounded box distance); inside it nothing, or the fill finish when a ring finish (uRing) is set",
        "    vec4 fill = c; if (uRing > -0.5) { gmetal = 1.0; c = shade(uRing); }",
        "    vec3 col = c.rgb / max(c.a, 0.001);",
        "    vec2 hp = (uv - 0.5) * uRes; vec2 hb = uRes * 0.5 - vec2(uRadius);",
        "    vec2 dq = abs(hp) - hb; float sd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - uRadius;   // < 0 inside the card",
        "    float ring = smoothstep(-uFrame - 1.0, -uFrame + 1.0, sd) * (1.0 - smoothstep(-1.0, 1.0, sd));",
        "    float edge = 1.0 - smoothstep(0.0, 1.5, abs(sd + uFrame));                                       // thin bright line on the inner edge of the ring",
        "    col = pow(clamp(col, 0.0, 1.0), vec3(1.4)) * 0.95;                                              // deeper tones: the ring has to stand out on a white card",
        "    float a = 0.97 * ring + edge * 0.30; col = mix(col, vec3(1.0), edge * 0.35);",
        "    c = vec4(col * a, a);",
        "    if (uRing > -0.5) c = c + fill * (1.0 - smoothstep(-1.0, 1.0, sd)) * (1.0 - c.a);               // finish of the card under the ring",
        "    if (uInner > 0.0) {                                              // faint whitish glitter inside the card (same context: browsers allow only a few WebGL contexts)",
        "      gmetal = 0.0; vec4 g = shade(2.0); float lum = dot(g.rgb / max(g.a, 0.001), vec3(0.3333)); float ga = g.a * uInner;",
        "      float inside = 1.0 - smoothstep(-1.0, 1.0, sd);",
        "      vec4 inner = vec4(vec3(lum * 0.9) * ga, ga) * inside; c = c + inner * (1.0 - c.a);",
        "    }",
        "  }",
        "  gl_FragColor = c;",
        "}"
    ].join("\n");

    function shader(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }

    function attach(el, mode, opts) {
        opts = opts || {};
        var cv = document.createElement("canvas");
        cv.className = "foil-canvas"; cv.setAttribute("aria-hidden", "true");
        cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;border-radius:inherit;";
        el.insertBefore(cv, el.firstChild);
        var gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
        var none = { draw: function () {}, ok: false };
        if (!gl) { cv.remove(); return none; }
        var prog;
        try {
            prog = gl.createProgram(); gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        } catch (e) { if (window.console) console.warn("foil:", e.message); cv.remove(); return none; }
        gl.useProgram(prog);
        var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        var u = { res: gl.getUniformLocation(prog, "uRes"), ptr: gl.getUniformLocation(prog, "uPtr"), time: gl.getUniformLocation(prog, "uTime"), s: gl.getUniformLocation(prog, "uStrength"), mode: gl.getUniformLocation(prog, "uMode"), mode2: gl.getUniformLocation(prog, "uMode2"), frame: gl.getUniformLocation(prog, "uFrame"), inner: gl.getUniformLocation(prog, "uInner"), ring: gl.getUniformLocation(prog, "uRing"), radius: gl.getUniformLocation(prog, "uRadius") };
        var raw = String(mode), parts = raw.split(/[+>]/).slice(0, 2);
        if (raw.indexOf(">") < 0) parts.sort(function (x, y) { return (ORDER[x] === undefined ? 9 : ORDER[x]) - (ORDER[y] === undefined ? 9 : ORDER[y]); });     // "a+b": automatic order; "a>b": a below, b above, as written
        var m1 = MODES[parts[0]], m2 = parts.length > 1 ? MODES[parts[1]] : undefined;                                  // one finish, or two layered ("gold+glitter")
        gl.uniform1f(u.mode, m1 === undefined ? 0 : m1); gl.uniform1f(u.mode2, m2 === undefined ? -1 : m2);
        gl.uniform1f(u.ring, opts.ring && MODES[opts.ring] !== undefined && opts.frame ? MODES[opts.ring] : -1);       // opts.ring: finish of the frame drawn over the card finish (needs opts.frame)
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        function size() {
            var dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr));
            if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
        }
        return {
            ok: true,
            draw: function (px, py, strength, time) {
                size(); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
                var dpr = cv.width / Math.max(1, el.clientWidth);
                gl.uniform2f(u.res, cv.width, cv.height); gl.uniform2f(u.ptr, px, py); gl.uniform1f(u.s, strength); gl.uniform1f(u.time, time);
                gl.uniform1f(u.frame, (opts.frame || 0) * dpr); gl.uniform1f(u.inner, opts.inner || 0); gl.uniform1f(u.radius, (opts.radius || 12) * dpr);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
        };
    }
    root.HalFoil = { attach: attach, modes: Object.keys(MODES) };
})(window);
