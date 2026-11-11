// Clips: every clip shows its thumbnail and length until it plays. Clips play
// while at least half visible and pause when scrolled away; click to pause.
// Reels: prev/next buttons and a "2 / 6" counter for each horizontal feed.
// Jump bar: highlights the section you are reading on project pages.
// With reduced motion, nothing autoplays and clips get native controls.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- clips ----------
  var loops = Array.prototype.slice.call(document.querySelectorAll('video.loop'));
  function play(v) {
    if (v.preload === 'none') v.preload = 'auto';
    var p = v.play(); if (p && p.catch) p.catch(function () {});
  }
  loops.forEach(function (v) {
    v.muted = true;
    v.setAttribute('playsinline', '');
    var box = v.parentElement;
    var badge = document.createElement('span');
    badge.className = 'play-badge';
    badge.textContent = v.dataset.len || 'Play';
    box.appendChild(badge);
    v.addEventListener('playing', function () { box.classList.add('is-playing'); });
    ['pause', 'emptied', 'ended'].forEach(function (ev) {
      v.addEventListener(ev, function () { box.classList.remove('is-playing'); });
    });
    if (reduce) { v.setAttribute('controls', ''); badge.remove(); return; }
    v.addEventListener('click', function (e) {
      if (v.closest('a')) return;
      if (v.paused) { v.dataset.userPaused = ''; play(v); }
      else { v.pause(); v.dataset.userPaused = '1'; }
    });
  });
  if (!reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { if (v.dataset.userPaused !== '1') play(v); }
        else if (!v.paused) v.pause();
      });
    }, { threshold: 0.5 });
    loops.forEach(function (v) { io.observe(v); });
  }

  // ---------- reels ----------
  document.querySelectorAll('[data-reel]').forEach(function (reel) {
    var track = reel.querySelector('.reel-track');
    var slides = Array.prototype.slice.call(track.children);
    var prev = reel.querySelector('[data-prev]');
    var next = reel.querySelector('[data-next]');
    var count = reel.querySelector('.count');
    function current() {
      var left = track.getBoundingClientRect().left + parseFloat(getComputedStyle(track).paddingLeft);
      var best = 0, dist = Infinity;
      slides.forEach(function (s, i) {
        var d = Math.abs(s.getBoundingClientRect().left - left);
        if (d < dist) { dist = d; best = i; }
      });
      return best;
    }
    function update() {
      var i = current();
      var atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      if (count) count.textContent = (atEnd ? slides.length : i + 1) + ' / ' + slides.length;
      if (prev) prev.disabled = track.scrollLeft <= 4;
      if (next) next.disabled = atEnd;
    }
    function go(dir) {
      var i = Math.max(0, Math.min(slides.length - 1, current() + dir));
      var left = slides[i].offsetLeft - parseFloat(getComputedStyle(track).paddingLeft);
      track.scrollTo({ left: left, behavior: reduce ? 'auto' : 'smooth' });
    }
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
    track.addEventListener('scroll', function () { window.requestAnimationFrame(update); }, { passive: true });
    window.addEventListener('resize', update);
    update();
  });

  // ---------- jump bar scrollspy ----------
  var jump = document.querySelector('.jump-inner');
  if (jump && 'IntersectionObserver' in window) {
    var links = Array.prototype.slice.call(jump.querySelectorAll('a[href^="#"]'));
    var map = {};
    links.forEach(function (a) { var s = document.getElementById(a.getAttribute('href').slice(1)); if (s) map[s.id] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.removeAttribute('aria-current'); });
        var a = map[e.target.id];
        if (a) {
          a.setAttribute('aria-current', 'true');
          var r = a.getBoundingClientRect(), jr = jump.getBoundingClientRect();
          if (r.left < jr.left || r.right > jr.right) jump.scrollTo({ left: a.offsetLeft - 12, behavior: 'smooth' });
        }
      });
    }, { rootMargin: '-35% 0px -60% 0px' });
    Object.keys(map).forEach(function (id) { spy.observe(document.getElementById(id)); });
  }

  // ---------- lightbox ----------
  var dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.innerHTML = '<div class="lb-bar"><span class="lb-cap"></span><button type="button" class="lb-close">Close</button></div><img alt="">';
  document.body.appendChild(dlg);
  var dlgImg = dlg.querySelector('img');
  var dlgCap = dlg.querySelector('.lb-cap');
  dlg.querySelector('.lb-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  document.querySelectorAll('button.zoom').forEach(function (b) {
    b.addEventListener('click', function () {
      var img = b.querySelector('img');
      if (!img || typeof dlg.showModal !== 'function') return;
      dlgImg.src = img.currentSrc || img.src;
      dlgImg.alt = img.alt;
      var cap = b.parentElement.querySelector('.cap');
      dlgCap.textContent = cap ? cap.textContent : img.alt;
      dlg.showModal();
    });
  });
})();
