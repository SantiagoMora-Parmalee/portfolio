// Fracture field for the hero of every page in the fracture look.
// Home: five project shards. Project pages: one shard with the page's clip.
// A sheet of glass cells behind the project shards. Every cell refracts one of
// the hero clips, mirrored and rotated, and shows it a little in the past: the
// further a cell is from the break point, the older its frame. Ripples leave
// the break point every few seconds and pull the cells they cross back to
// "now". Pointing at a project slows the field and syncs that project's cells.
// The clips themselves are never drawn over: the canvas sits behind them.
// With reduced motion the field is drawn once from the thumbnails.
(function () {
  var hero = document.querySelector('.fx-hero');
  if (!hero) return;
  var canvas = hero.querySelector('.fx-field');
  var stage = hero.querySelector('.fx-stage');
  var textBox = hero.querySelector('.fx-text');
  var shards = Array.prototype.slice.call(stage.querySelectorAll('.shard'));
  var ctx = canvas.getContext('2d');
  if (!ctx || !shards.length) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CYAN = '#45e4ff', PINK = '#ff4f9e';
  var TINTS = ['#ffffff', '#ffd9ec', '#d3f8ff', '#e4dcff', '#ffe3d2', '#ffc2de', '#b9f1ff'];
  var SEED = 20261111;      // change this number for a different break pattern
  var FW = 256, FH = 144;   // size of the stored frames
  var STEP = 0.125;         // seconds between stored frames
  var KEEP = 26;            // frames kept per clip (about 3 seconds of history)

  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- clip history ----------
  var canFilter = typeof ctx.filter === 'string';
  var BOOST = 'brightness(1.5) saturate(1.7) contrast(1.05)';
  function small() { var c = document.createElement('canvas'); c.width = FW; c.height = FH; return c; }
  function stillFrom(clip, src) {
    if (!src) return;
    var img = new Image();
    img.onload = function () {
      var c = small(), x = c.getContext('2d');
      if (canFilter) x.filter = BOOST;
      x.drawImage(img, 0, 0, FW, FH);
      clip.still = c; clip.stillPat = null; dirty = true;
    };
    img.src = src;
  }
  function source(video) { return { video: video, still: null, stillPat: null, ring: [], pats: [], head: -1, filled: 0 }; }
  var clips = shards.map(function (s) {
    var v = s.querySelector('video'), img = s.querySelector('img');
    var clip = source(v);
    stillFrom(clip, v ? v.getAttribute('poster') : img && img.getAttribute('src'));
    return clip;
  });
  // A project page has one shard, so the glass also refracts stills from the
  // rest of that page's work.
  if (shards.length < 3) {
    var seen = {}, pool = [];
    Array.prototype.forEach.call(document.querySelectorAll('.slide video[poster], .slide img'), function (el) {
      var src = el.getAttribute('poster') || el.getAttribute('src');
      if (src && !seen[src]) { seen[src] = 1; pool.push(src); }
    });
    for (var e = 0; e < 4 && pool.length; e++) {
      var extra = source(null);
      stillFrom(extra, pool.splice(Math.floor(pool.length * e / 4) % pool.length, 1)[0]);
      clips.push(extra);
    }
  }
  // Reading a video frame is quick on a GPU and slow without one. If frames
  // start taking too long, "lite" reads one clip per step instead of all five.
  var lite = false, turnOf = 0;
  function capture() {
    turnOf = (turnOf + 1) % clips.length;
    clips.forEach(function (clip, n) {
      if (lite && n !== turnOf) return;
      var v = clip.video;
      if (!v || v.readyState < 2 || v.paused) return;
      clip.head = (clip.head + 1) % KEEP;
      var c = clip.ring[clip.head] || (clip.ring[clip.head] = small());
      var x = c.getContext('2d');
      x.globalCompositeOperation = 'source-over';
      try { x.drawImage(v, 0, 0, FW, FH); } catch (e) { return; }
      x.globalCompositeOperation = 'lighter';      // cheap exposure boost
      x.drawImage(c, 0, 0);
      clip.pats[clip.head] = null;
      if (clip.filled < KEEP) clip.filled++;
    });
  }
  // The frame a cell should show, as a fill pattern (filling a path with a
  // pattern is far cheaper than clipping to the path and drawing the image).
  function slotOf(clip, delay) {
    if (!clip.filled) return -1;
    var back = Math.min(clip.filled - 1, Math.round(delay / STEP));
    return (clip.head - back + KEEP * 4) % KEEP;
  }
  function patternOf(clip, slot) {
    if (slot < 0 || !clip.ring[slot]) {
      if (!clip.still) return null;
      return clip.stillPat || (clip.stillPat = ctx.createPattern(clip.still, 'repeat'));
    }
    return clip.pats[slot] || (clip.pats[slot] = ctx.createPattern(clip.ring[slot], 'repeat'));
  }
  function canvasOf(clip, slot) { return slot < 0 ? clip.still : (clip.ring[slot] || clip.still); }

  // ---------- geometry ----------
  var W = 0, H = 0, scale = 1, cells = [], bits = [], origin = { x: 0, y: 0 }, maxD = 1, keepOff = -1e9;

  function cut(poly, ax, ay, bx, by) {            // keep the side nearer to a than to b
    var mx = (ax + bx) / 2, my = (ay + by) / 2, nx = bx - ax, ny = by - ay, out = [];
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      var dp = (p[0] - mx) * nx + (p[1] - my) * ny, dq = (q[0] - mx) * nx + (q[1] - my) * ny;
      if (dp <= 0) out.push(p);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        var t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  }
  function roundedPath(pts, k) {
    var p = new Path2D(), n = pts.length;
    function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    var m0 = mid(pts[n - 1], pts[0]);
    p.moveTo(m0[0], m0[1]);
    for (var i = 0; i < n; i++) {
      var a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
      var m = mid(b, c);
      var r = Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1])) * 0.5 * k;
      p.arcTo(b[0], b[1], m[0], m[1], r);
    }
    p.closePath();
    return p;
  }

  function build() {
    var box = canvas.getBoundingClientRect();
    W = Math.max(1, box.width); H = Math.max(1, box.height);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(dpr, Math.sqrt(1.7e6 / (W * H)));   // cap the pixel count
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);

    var sb = stage.getBoundingClientRect();
    var st = { x: sb.left - box.left, y: sb.top - box.top, w: sb.width, h: sb.height };
    var tb = textBox.getBoundingClientRect();
    var stacked = tb.bottom - box.top <= st.y + 4;        // phone layout: text above the stage
    // layout boxes, not getBoundingClientRect: the shards may still be flying in
    var centres = shards.map(function (s) {
      return { x: st.x + s.offsetLeft + s.offsetWidth / 2, y: st.y + s.offsetTop + s.offsetHeight / 2 };
    });
    // break point, as fractions of the stage (data-origin / data-origin-stacked
    // on .fx-stage). Home default: the gap between the two rows of shards.
    var at = ((stacked ? stage.dataset.originStacked : stage.dataset.origin) || (stacked ? '0.5 0.205' : '0.5 0.545')).split(' ');
    origin = { x: st.x + st.w * parseFloat(at[0]), y: st.y + st.h * parseFloat(at[1]) };
    maxD = Math.max(
      Math.hypot(origin.x, origin.y), Math.hypot(W - origin.x, origin.y),
      Math.hypot(origin.x, H - origin.y), Math.hypot(W - origin.x, H - origin.y));

    var rand = rng(SEED);
    // sites in rings around the break point, so the cells read as an impact:
    // splinters in the middle, long plates further out
    var sites = [];
    var ring = Math.max(34, Math.min(st.w, st.h) * 0.06), count = 5, turn = rand() * 6.283;
    while (ring < maxD * 1.25) {
      for (var k = 0; k < count; k++) {
        var ang = turn + (k + (rand() - 0.5) * 0.7) * 6.283 / count;
        var rad = ring * (1 + (rand() - 0.5) * 0.36);
        var sx = origin.x + Math.cos(ang) * rad, sy = origin.y + Math.sin(ang) * rad;
        if (sx > -140 && sx < W + 140 && sy > -140 && sy < H + 140) sites.push([sx, sy]);
      }
      ring *= 1.42; count = Math.round(count * 1.22 + 1.6); turn += 0.7 + rand();
    }
    var textEdge = stacked ? 0 : tb.right - box.left;
    keepOff = stacked ? -1e9 : textEdge + 14;        // splinters stay off the words

    cells = [];
    var pad = 60;
    sites.forEach(function (s, si) {
      var poly = [[-pad, -pad], [W + pad, -pad], [W + pad, H + pad], [-pad, H + pad]];
      for (var j = 0; j < sites.length && poly.length; j++) {
        if (j !== si) poly = cut(poly, s[0], s[1], sites[j][0], sites[j][1]);
      }
      if (poly.length < 3) return;
      var cx = 0, cy = 0;
      poly.forEach(function (p) { cx += p[0]; cy += p[1]; });
      cx /= poly.length; cy /= poly.length;
      var d = Math.hypot(cx - origin.x, cy - origin.y), dn = d / maxD;
      var R = 0;
      var local = poly.map(function (p) {
        var lx = p[0] - cx, ly = p[1] - cy;
        R = Math.max(R, Math.hypot(lx, ly));
        return [lx, ly];
      });
      var best = 0, bd = Infinity;
      centres.forEach(function (c, i) {
        var q = Math.hypot(c.x - cx, c.y - cy);
        if (q < bd) { bd = q; best = i; }
      });
      if (rand() < 0.22) best = Math.floor(rand() * shards.length);
      if (clips.length > shards.length && rand() < 0.5) best = shards.length + Math.floor(rand() * (clips.length - shards.length));
      // quiet behind the words, full strength over the stage
      var side = stacked ? smooth(st.y - st.w * 0.3, st.y + st.w * 0.02, cy - R * 0.5)
                         : smooth(textEdge - 30, st.x + st.w * 0.05, cx - R * 0.5);
      var fadeOut = 1 - smooth(H * 0.9, H * 1.0, cy);
      var dirx = d ? (cx - origin.x) / d : 0, diry = d ? (cy - origin.y) / d : 0;
      cells.push({
        cx: cx, cy: cy, R: R, dn: dn, d: d, dirx: dirx, diry: diry,
        path: roundedPath(local, rand() < 0.15 ? lerp(0.5, 0.95, rand()) : lerp(0.04, 0.3, rand())),
        shrink: lerp(0.9, 0.83, smooth(0, 0.7, dn)) - rand() * 0.05,
        clip: best,
        alpha: lerp(0.07, 1, side) * fadeOut,
        wash: lerp(0.78, 0.12, smooth(0.03, 0.55, dn)) + (rand() - 0.5) * 0.12,
        delay: clamp(dn * 3.4 + rand() * 0.5, 0, (KEEP - 1) * STEP),
        tint: TINTS[Math.floor(rand() * TINTS.length)],
        texRot: rand() * Math.PI * 2, flip: rand() < 0.5 ? -1 : 1,
        zoom: lerp(1.05, 2.1, rand()), ox: rand() - 0.5, oy: rand() - 0.5,
        amp: lerp(2, 9, rand()) * (0.5 + dn), speed: lerp(0.18, 0.5, rand()), phase: rand() * 6.283,
        spin: (rand() - 0.5) * 0.05, depth: (rand() - 0.5) * 2, m: null, roseC: null, roseSlot: -2, rosePat: null,
        rose: false, hot: 0
      });
    });
    // two kaleidoscope cells: the biggest ones in the middle distance
    cells.forEach(function (c) {
      var hgt = c.R * 2 * c.zoom, wid = hgt * FW / FH;
      c.m = new DOMMatrix().rotateSelf(c.texRot * 180 / Math.PI).scaleSelf(c.flip, 1)
        .translateSelf(-wid / 2 + c.ox * (c.zoom - 1) * c.R, -hgt / 2 + c.oy * (c.zoom - 1) * c.R)
        .scaleSelf(wid / FW, hgt / FH);
    });
    var covered = shards.map(function (s) {
      return { l: st.x + s.offsetLeft, t: st.y + s.offsetTop, r: st.x + s.offsetLeft + s.offsetWidth, b: st.y + s.offsetTop + s.offsetHeight };
    });
    cells.filter(function (c) {
      if (c.dn < 0.15 || c.dn > 0.7 || c.alpha < 0.9) return false;
      if (c.cx < c.R * 0.8 || c.cx > W - c.R * 0.8 || c.cy < 130 + c.R * 0.5 || c.cy > H - 40 - c.R * 0.8) return false;
      return !covered.some(function (b) {      // its middle has to be in the open, not under a project
        return c.cx > b.l - c.R * 0.35 && c.cx < b.r + c.R * 0.35 && c.cy > b.t - c.R * 0.35 && c.cy < b.b + c.R * 0.35;
      });
    }).sort(function (a, b) { return b.R - a.R; }).slice(0, 3)
      .forEach(function (c) { c.rose = true; c.wash = Math.min(c.wash, 0.1); });

    // loose splinters near the break point
    bits = [];
    for (var b = 0; b < 16; b++) {
      var ang = rand() * 6.283, size = lerp(6, 20, rand());
      bits.push({
        ang: ang, base: lerp(0.03, 0.2, rand()) * maxD, size: size, rot: rand() * 6.283,
        speed: lerp(0.15, 0.4, rand()), phase: rand() * 6.283, tint: b % 3 === 0 ? CYAN : b % 3 === 1 ? PINK : '#fff',
        a: rand() * 2.1, b: 2.1 + rand() * 2.1
      });
    }
    cutRims();
    dirty = true;
  }

  // ---------- the glass piece under each project ----------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function cutRims() {
    var rand = rng(SEED + 7);
    var boxes = shards.map(function (s) {
      return { left: s.offsetLeft, top: s.offsetTop, right: s.offsetLeft + s.offsetWidth, bottom: s.offsetTop + s.offsetHeight };
    });
    shards.forEach(function (s, i) {
      var w = s.offsetWidth, h = s.offsetHeight;
      if (!w || !h) return;
      // how far this piece may reach on each side before it could cover a neighbour
      var me = boxes[i], room = { t: 999, r: 999, b: 999, l: 999 };
      boxes.forEach(function (o, j) {
        if (j === i) return;
        var overX = o.left < me.right && o.right > me.left, overY = o.top < me.bottom && o.bottom > me.top;
        if (overY && o.left >= me.right - 2) room.r = Math.min(room.r, o.left - me.right);
        if (overY && o.right <= me.left + 2) room.l = Math.min(room.l, me.left - o.right);
        if (overX && o.top >= me.bottom - 2) room.b = Math.min(room.b, o.top - me.bottom);
        if (overX && o.bottom <= me.top + 2) room.t = Math.min(room.t, me.top - o.bottom);
      });
      var big = clamp(w * 0.13, 22, 66);
      function reach(side) { return clamp(room[side] * 0.42, 6, big); }
      var T = reach('t'), Rr = reach('r'), B = reach('b'), L = reach('l');
      function out(m) { return m * (rand() < 0.3 ? lerp(0.85, 1, rand()) : lerp(0.18, 0.6, rand())); }
      var pts = [
        [-out(L), -out(T)], [w * lerp(0.25, 0.7, rand()), -out(T)], [w + out(Rr), -out(T)],
        [w + out(Rr), h * lerp(0.3, 0.7, rand())], [w + out(Rr), h + out(B)],
        [w * lerp(0.3, 0.75, rand()), h + out(B)], [-out(L), h + out(B)],
        [-out(L), h * lerp(0.3, 0.7, rand())]
      ];
      var m = big + 8;   // the svg and the glass overhang the shard by this much
      var glass = s.querySelector('.shard-glass'), svg = s.querySelector('.shard-rim');
      if (!glass) {
        glass = document.createElement('span'); glass.className = 'shard-glass'; glass.setAttribute('aria-hidden', 'true');
        svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'shard-rim'); svg.setAttribute('aria-hidden', 'true');
        ['c', 'p', 'w'].forEach(function (k) {
          var pg = document.createElementNS(SVGNS, 'polygon'); pg.setAttribute('class', k); svg.appendChild(pg);
        });
        s.insertBefore(svg, s.firstChild); s.insertBefore(glass, s.firstChild);
        s.classList.add('has-rim');
      }
      [glass, svg].forEach(function (el) {
        el.style.left = -m + 'px'; el.style.top = -m + 'px';
        el.style.width = (w + 2 * m) + 'px'; el.style.height = (h + 2 * m) + 'px';
      });
      var shifted = pts.map(function (p) { return [(p[0] + m).toFixed(1), (p[1] + m).toFixed(1)]; });
      glass.style.clipPath = 'polygon(' + shifted.map(function (p) { return p[0] + 'px ' + p[1] + 'px'; }).join(',') + ')';
      svg.setAttribute('viewBox', '0 0 ' + (w + 2 * m) + ' ' + (h + 2 * m));
      var str = shifted.map(function (p) { return p.join(','); }).join(' ');
      Array.prototype.forEach.call(svg.querySelectorAll('polygon'), function (pg) { pg.setAttribute('points', str); });
    });
  }

  // ---------- drawing ----------
  var dirty = true, tField = 0, last = 0, lastCap = 0, born = 0, timeScale = 1, hot = -1, cost = 0, ticks = 0;
  var px = 0, py = 0, tx = 0, ty = 0;
  var RIPPLE_EVERY = 7, RIPPLE_LEN = 2.6;

  // A kaleidoscope cell: twelve mirrored wedges of one frame, painted into a
  // small canvas of its own whenever its frame changes.
  function rosePattern(c, clip, slot) {
    var size = Math.min(360, Math.ceil(c.R * 2.2));
    if (!c.roseC) { c.roseC = document.createElement('canvas'); c.roseC.width = c.roseC.height = size; }
    if (c.roseSlot !== slot || !c.rosePat) {
      var f = canvasOf(clip, slot);
      if (!f) return null;
      var x = c.roseC.getContext('2d'), L = size / 2, a = Math.PI / 6;
      x.setTransform(1, 0, 0, 1, L, L);
      for (var k = 0; k < 12; k++) {
        x.save();
        x.rotate((k % 2 ? k + 1 : k) * a);
        if (k % 2) x.scale(1, -1);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(L * 1.2, -0.6); x.lineTo(L * 1.2 * Math.cos(a), L * 1.2 * Math.sin(a) + 0.6); x.closePath();
        x.clip();
        x.drawImage(f, -L * 0.15, -L * 0.25, L * 1.5, L * 0.85);
        x.restore();
      }
      c.rosePat = ctx.createPattern(c.roseC, 'no-repeat'); c.roseSlot = slot;
    }
    var k2 = c.R * 2.2 / size;
    c.rosePat.setTransform(new DOMMatrix().rotateSelf((tField * 0.12 + c.texRot) * 180 / Math.PI).scaleSelf(k2, k2).translateSelf(-size / 2, -size / 2));
    return c.rosePat;
  }

  function draw(now) {
    var intro = reduce ? 1 : clamp((now - born) / 1300, 0, 1);
    var open = 1 - Math.pow(1 - intro, 4);                    // glass opening up after the break
    var rp = ((tField % RIPPLE_EVERY) / RIPPLE_LEN);          // 0..1 while a ripple is travelling
    var rippleR = rp < 1 && !reduce ? rp * maxD * 0.9 : -1;

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Cells never overlap, so they are painted in passes and everything that
    // shares a colour goes to the GPU as one path: tints, then the refracted
    // footage (one fill per cell), then the white wash, then the fringes.
    var tints = {}, washes = {}, edges = {}, live = [];
    function batch(set, key) { return set[key] || (set[key] = new Path2D()); }
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.alpha < 0.02) continue;
      c.hot += ((hot === c.clip ? 1 : 0) - c.hot) * 0.14;
      var near = rippleR < 0 ? 0 : Math.max(0, 1 - Math.abs(c.d - rippleR) / (maxD * 0.09)) * (1 - rp);
      var sway = Math.sin(tField * c.speed + c.phase) * c.amp * open;
      var burst = (1 - open) * -c.d * 0.12;
      var x = c.cx + c.dirx * (sway + burst + near * 7) + px * c.depth * 12;
      var y = c.cy + c.diry * (sway + burst + near * 7) + py * c.depth * 12;
      var th = Math.sin(tField * c.speed * 0.7 + c.phase) * c.spin * open;
      var s = lerp(1.005, c.shrink, open), co = Math.cos(th) * s, si = Math.sin(th) * s;
      var m = new DOMMatrix([co, si, -si, co, x, y]);
      var dim = hot >= 0 ? lerp(0.55, 1, c.hot) : 1;
      var a = Math.round(c.alpha * dim * 12) / 12;
      c.fm = m; c.fa = a; c.fdelay = c.delay * (1 - c.hot) * (1 - near);
      live.push(c);
      batch(tints, c.tint + '|' + a).addPath(c.path, m);
      var wash = clamp(c.wash * (1 - c.hot * 0.8) + near * 0.5 + (1 - open), 0, 1);
      var w = Math.round(a * wash * 12) / 12;
      if (w > 0) batch(washes, w).addPath(c.path, m);
      batch(edges, Math.max(1, Math.round(c.alpha * 4)) / 4).addPath(c.path, m);
    }
    var key;
    for (key in tints) {
      ctx.globalAlpha = +key.split('|')[1]; ctx.fillStyle = key.split('|')[0]; ctx.fill(tints[key]);
    }
    for (i = 0; i < live.length; i++) {
      c = live[i];
      var clip = clips[c.clip], slot = slotOf(clip, c.fdelay), pat;
      if (c.rose) pat = rosePattern(c, clip, slot);
      else { pat = patternOf(clip, slot); if (pat) pat.setTransform(c.m); }
      if (!pat) continue;
      m = c.fm;
      ctx.setTransform(m.a * scale, m.b * scale, m.c * scale, m.d * scale, m.e * scale, m.f * scale);
      ctx.fillStyle = pat;
      if (c.rose) { ctx.globalAlpha = c.fa; ctx.fill(c.path); continue; }
      // glass glows by default; a pointed-at project's cells show its true footage
      if (c.hot > 0.02) { ctx.globalAlpha = c.fa * c.hot; ctx.fill(c.path); }
      ctx.globalAlpha = c.fa;
      ctx.globalCompositeOperation = 'screen';
      ctx.fill(c.path);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#fff';
    for (key in washes) { ctx.globalAlpha = +key; ctx.fill(washes[key]); }
    // colour fringes on the edges of the glass
    ctx.lineJoin = 'round';
    for (key in edges) {
      ctx.globalAlpha = +key * open;
      if (+key > 0.25) {
        ctx.lineWidth = 2.2;
        ctx.translate(-1.6, -0.8); ctx.strokeStyle = CYAN; ctx.stroke(edges[key]);
        ctx.translate(3.2, 1.6); ctx.strokeStyle = PINK; ctx.stroke(edges[key]);
        ctx.translate(-1.6, -0.8);
      }
      ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke(edges[key]);
    }
    ctx.globalAlpha = 1;

    // the white-hot break point
    ctx.globalCompositeOperation = 'lighter';
    var glowR = maxD * lerp(0.5, 0.2, open);
    var g = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, glowR);
    g.addColorStop(0, 'rgba(255,255,255,' + lerp(1, 0.85, open) + ')');
    g.addColorStop(0.35, 'rgba(214,244,255,0.32)');
    g.addColorStop(1, 'rgba(255,79,158,0)');
    ctx.fillStyle = g;
    ctx.fillRect(origin.x - glowR, origin.y - glowR, glowR * 2, glowR * 2);

    // ripples of time leaving the break point
    if (rippleR > 0) {
      ctx.lineWidth = 3;
      ctx.globalAlpha = (1 - rp) * 0.9;
      ctx.strokeStyle = CYAN; ctx.beginPath(); ctx.arc(origin.x - 2, origin.y, rippleR, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = PINK; ctx.beginPath(); ctx.arc(origin.x + 2, origin.y, rippleR * 0.985, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(origin.x, origin.y, rippleR * 0.992, 0, 6.283); ctx.stroke();
    }

    // splinters: they drift out and are pulled back
    for (var b = 0; b < bits.length; b++) {
      var q = bits[b];
      var dist = (q.base + Math.sin(tField * q.speed + q.phase) * maxD * 0.03) * open;
      var bx = origin.x + Math.cos(q.ang) * dist + px * 18;
      if (bx < keepOff) continue;
      ctx.save();
      ctx.translate(bx, origin.y + Math.sin(q.ang) * dist + py * 18);
      ctx.rotate(q.rot + tField * q.speed * 0.6);
      ctx.globalAlpha = 0.85 * open;
      ctx.fillStyle = q.tint;
      ctx.beginPath();
      ctx.moveTo(q.size, 0);
      ctx.lineTo(Math.cos(q.a) * q.size * 0.7, Math.sin(q.a) * q.size * 0.7);
      ctx.lineTo(Math.cos(q.b) * q.size, Math.sin(q.b) * q.size);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // ---------- loop ----------
  var visible = true, raf = 0;
  function tick(now) {
    raf = 0;
    if (!born) born = now;
    var dt = Math.min(0.1, (now - (last || now)) / 1000);
    if (!reduce) {
      if (dt < 0.03 && last) { schedule(); return; }          // about 30 frames a second is plenty
      last = now;
      timeScale += ((hot >= 0 ? 0.18 : 1) - timeScale) * 0.08;
      tField += dt * timeScale;
      px += (tx - px) * 0.06; py += (ty - py) * 0.06;
      var t0 = performance.now();
      if (now - lastCap >= STEP * 1000) { lastCap = now; capture(); }
      draw(now);
      cost += (performance.now() - t0 - cost) * 0.08;
      if (!lite && ++ticks > 45 && cost > 20) lite = true;
      schedule();
    } else if (dirty) {
      dirty = false; tField = 3.2; draw(now);
    }
  }
  function schedule() { if (!raf && visible && !document.hidden) raf = window.requestAnimationFrame(tick); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) { last = 0; schedule(); } }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () { last = 0; schedule(); });

  var resizeTimer = 0;
  function rebuild() { build(); if (reduce) { dirty = true; } schedule(); }
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(rebuild, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(rebuild);
  window.addEventListener('load', rebuild);

  if (!reduce) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
    });
    hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; });
    shards.forEach(function (s, i) {
      function on() { hot = i; } function off() { if (hot === i) hot = -1; }
      s.addEventListener('pointerenter', on); s.addEventListener('pointerleave', off);
      s.addEventListener('focus', on); s.addEventListener('blur', off);
    });
  }
  // site.js gives clips native controls under reduced motion; here the whole
  // shard is the link, and controls would sit on top of the clip
  if (reduce) clips.forEach(function (c) { if (c.video) c.video.removeAttribute('controls'); });
  // thumbnails arrive after the first build; in reduced motion that needs a redraw
  if (reduce) setInterval(function () { if (dirty) schedule(); }, 400);

  build();
  schedule();
})();
