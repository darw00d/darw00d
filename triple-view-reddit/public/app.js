(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }
  var STORE = "redditview.v1";
  var DESKTOP_STORE = "redditview.desktop.v1";
  var PB = window.TVPlayback || null;
  var MEDIA = window.TVMedia || null, connectingMedia = false;
  var DESKTOP = !!(PB && PB.profile && PB.profile.desktop);
  // 1–12 panes on every device (three by default).
  var MAX_PANES = 12, DEFAULT_PANES = 3;
  var IC = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    next: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M5 5v14l10-7zM17 5h3v14h-3z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    heart: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    repeat: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
    sound: '<svg class="sound-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14"/></svg>',
    main: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="13" height="13" rx="1.5"/><path d="M19.5 8.5h1.5v12.5H8.5v-1.5"/></svg>',
    mute: '<svg class="mute-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6"/></svg>'
  };

  // ---------- helpers ----------
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) {
      var v = attrs[k];
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k === "text") e.textContent = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0; s = Math.floor(s);
    var hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    return (hh ? hh + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
  }
  var toastT;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 2800);
  }
  function lsRead(key) { try { return JSON.parse(localStorage.getItem(key)) || null; } catch (e) { return null; } }
  // Desktop keeps its own history. The legacy Safari key is only read (never written)
  // the first time, when no desktop session exists yet.
  function lsGet() {
    if (!DESKTOP) return lsRead(STORE);
    var own = lsRead(DESKTOP_STORE);
    if (own) return own;
    var legacy = lsRead(STORE);
    return legacy && typeof legacy === "object" ? legacy : null;
  }
  function lsSet(v) { try { localStorage.setItem(DESKTOP ? DESKTOP_STORE : STORE, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function validVolume(x) { return typeof x === "number" && isFinite(x) && x >= 0 && x <= 1 ? x : 1; }
  function validCount(x) { var n = Number(x); return Number.isInteger(n) && n >= 1 && n <= MAX_PANES ? n : DEFAULT_PANES; }

  var authed = false;
  var LOCAL = window.TVLocal;
  // The app's data requests run in this browser (reddit-local.js) and go
  // straight to Reddit.
  function api(path, opts) {
    return LOCAL.api(path, opts || {}).catch(function (error) {
      if (error && error.code === "CONNECTION_REQUIRED" && MEDIA && authed) MEDIA.needed();
      throw error;
    });
  }

  // ---------- views ----------
  function show(id) {
    ["boot", "unsupported", "setup", "app"].forEach(function (v) { $("#view-" + v).hidden = v !== id; });
  }
  var PLAYABLE = !!PB;

  // ---------- modal manager ----------
  var modal = null;
  function openModal(el, opener, onClose) {
    if (modal) closeModal();
    var bd = $("#sheet-backdrop"); bd.hidden = false; el.hidden = false;
    var app = $("#view-app"); app.setAttribute("inert", "");
    function key(e) {
      if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
      if (e.key !== "Tab") return;
      var f = Array.prototype.filter.call(el.querySelectorAll("button,input,select,[href],[tabindex]:not([tabindex='-1'])"), function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", key);
    modal = { el: el, opener: opener, key: key, onClose: onClose };
    var x = el.querySelector("[data-close]"); (el.querySelector("input[type=search]") && matchMedia("(pointer:fine)").matches ? el.querySelector("input[type=search]") : x).focus();
  }
  function closeModal() {
    if (!modal) return;
    var m = modal; modal = null;
    document.removeEventListener("keydown", m.key);
    m.el.hidden = true; $("#sheet-backdrop").hidden = true; $("#view-app").removeAttribute("inert");
    if (m.onClose) m.onClose();
    if (m.opener && m.opener.focus && document.contains(m.opener)) m.opener.focus();
  }
  $("#sheet-backdrop").addEventListener("click", closeModal);
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", closeModal); });

  // ---------- set-up ----------
  // There is no sign-in wall: the app opens as soon as one feed is set up.
  function boot() { enterConnectedApp(); }
  $("#btn-feeds").addEventListener("click", function () { requireMediaConnection(); });

  // ---------- panes ----------
  var feeds = [], panes = [], active = 0, built = false, statusTimer, hideTimers = [], lastTaps = [0, 0, 0], renderTimer = null, paneCount = DEFAULT_PANES;
  var wasPlaying = null;
  function eachPane(fn) { feeds.forEach(function (_, i) { fn(i); }); }
  var mixAudio = false, audible = [true, false, false];
  var audioCycle = false, cycleSeconds = 20, cycleTimer = null;
  var wakeLock = null, wakePending = false, wakeEpoch = 0, wakeBlocked = false;
  var favouritePending = new Set(), favouriteRevision = 0;

  // Each pane holds one <video> and one <img>. f.video is a small facade over
  // whichever is showing, so the rest of the player treats a still image like
  // a video that lasts holdSeconds.
  var holdSeconds = 12, coverFit = true;
  function mediaFacade(f) {
    var v = f.real;
    return {
      get paused() { return f.still ? !f.still.playing : v.paused; },
      get ended() { return f.still ? f.still.ended : v.ended; },
      get currentTime() { return f.still ? f.still.t : v.currentTime; },
      set currentTime(x) {
        if (!f.still) { v.currentTime = x; return; }
        f.still.t = Math.max(0, Math.min(holdSeconds, Number(x) || 0)); f.still.ended = false;
      },
      get duration() { return f.still ? holdSeconds : v.duration; },
      get loop() { return f.loop; },
      set loop(x) { f.loop = !!x; v.loop = f.loop || !!f.autoLoop; },
      get muted() { return v.muted; }, set muted(x) { v.muted = x; },
      get volume() { return v.volume; }, set volume(x) { v.volume = x; },
      get readyState() { return f.still ? (f.still.ready ? 4 : 0) : v.readyState; },
      play: function () {
        if (!f.still) return v.play();
        var s = f.still;
        if (s.ended) { s.t = 0; s.ended = false; }
        if (!s.playing) { s.playing = true; s.last = Date.now(); onVideoEvent(f, "play"); if (s.ready) onVideoEvent(f, "playing"); }
        return Promise.resolve();
      },
      pause: function () {
        if (!f.still) { v.pause(); return; }
        if (f.still.playing) { f.still.playing = false; onVideoEvent(f, "pause"); }
      }
    };
  }
  function newFeed() {
    var v = document.createElement("video");
    v.muted = true; v.setAttribute("muted", ""); v.playsInline = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.preload = "metadata"; v.controls = false; v.loop = false; v.disablePictureInPicture = true;
    v.setAttribute("x-webkit-airplay", "allow");
    var img = document.createElement("img");
    img.alt = ""; img.decoding = "async"; img.draggable = false; img.hidden = true;
    var bg = h("div", { class: "bg", "aria-hidden": "true" });
    var f = { real: v, img: img, bg: bg, node: h("div", { class: "media" }, [bg, v, img]), still: null, loop: false, autoLoop: false, item: null, token: 0, error: null, needsResume: false, reload: false, started: false, pending: null, seeking: false, lastSave: 0, volume: 1, controller: null };
    f.video = mediaFacade(f);
    ["play", "playing", "pause", "waiting", "canplay", "timeupdate", "durationchange", "loadedmetadata", "ended", "error", "seeked"].forEach(function (ev) {
      v.addEventListener(ev, function () { if (!f.still) onVideoEvent(f, ev); });
    });
    img.addEventListener("load", function () {
      var s = f.still; if (!s || s.ready) return;
      s.ready = true; s.last = Date.now();
      onVideoEvent(f, "loadedmetadata"); onVideoEvent(f, "canplay");
      if (s.playing) onVideoEvent(f, "playing");
    });
    img.addEventListener("error", function () { if (f.still && !f.still.ready) onVideoEvent(f, "error"); });
    return f;
  }
  function showStill(f, url) {
    f.still = { t: f.pending || 0, playing: false, ended: false, ready: false, last: 0 };
    f.pending = null;
    f.real.hidden = true; f.img.hidden = false; f.img.src = url;
  }
  function clearStill(f) {
    f.still = null;
    f.img.hidden = true; f.img.removeAttribute("src"); f.real.hidden = false;
  }
  // One shared clock moves every showing image along.
  setInterval(function () {
    var now = Date.now();
    feeds.forEach(function (f) {
      var s = f.still; if (!s || !s.playing) return;
      var dt = (now - s.last) / 1000; s.last = now;
      if (!s.ready || document.hidden || dt > 2 || dt < 0) return;
      s.t += dt;
      if (s.t < holdSeconds) return;
      if (f.loop) { s.t = 0; return; }
      s.t = holdSeconds; s.playing = false; s.ended = true;
      onVideoEvent(f, "ended");
    });
  }, 250);
  function idx(f) { return feeds.indexOf(f); }

  function onVideoEvent(f, ev) {
    if (!f.item) return;
    var i = idx(f), v = f.video;
    if (i < 0 || !panes[i]) return;
    if (ev === "loadedmetadata") {
      if (!f.still && f.pending != null) { try { v.currentTime = Math.min(f.pending, Math.max(0, (v.duration || f.pending) - 2)); } catch (e) {} f.pending = null; }
      // A clip shorter than the hold time repeats until it has had that long.
      if (!f.still && isFinite(v.duration) && v.duration > 0 && v.duration < holdSeconds) { f.autoLoop = true; f.real.loop = true; }
      noteSize(f);
    } else if (ev === "error") {
      // hls.js reports its own failures after trying to recover.
      if (!f.still && f.srcKind === "hls" && !PB.profile.native) return;
      if (!f.still && useAlt(f)) return;
      var c = !f.still && f.real.error && f.real.error.code;
      f.error = f.still ? "This image could not be loaded. It may have been removed." :
        c === 2 ? "Network error while loading this post." : c === 3 ? "This post's video could not be decoded." :
          "This post's media could not be opened. It may have been removed, or this browser cannot play its format.";
      panes[i].el.classList.remove("buffering");
    } else if (ev === "playing" || ev === "play") {
      f.needsResume = false; f.error = null;
      if (ev === "playing") {
        f.failStreak = 0; panes[i].el.classList.remove("buffering");
        if (!f.started) { f.started = true; f.shownAt = Date.now(); LOCAL.markSeen(f.item.id); }
      }
    } else if (ev === "waiting") {
      panes[i].el.classList.add("buffering");
    } else if (ev === "canplay") {
      panes[i].el.classList.remove("buffering");
    } else if (ev === "pause") {
      persist();
    } else if (ev === "ended") {
      // Native loop normally seeks without firing "ended"; keep a fallback.
      if ((v.loop || f.autoLoop && !heldLongEnough(f)) && !document.hidden) {
        try { v.currentTime = 0; playFeed(i); }
        catch (e) { f.needsResume = true; }
      } else if (!document.hidden) advanceFeed(f);
      persist();
    } else if (ev === "timeupdate") {
      var now = Date.now(); if (now - f.lastSave > 3000) { f.lastSave = now; persist(); }
      // When a repeating short clip wraps round after its hold time, move on.
      var t = f.real.currentTime, wrapped = t + 0.3 < (f.lastT || 0);
      f.lastT = t;
      if (wrapped && f.autoLoop && !f.loop && !f.seeking && !document.hidden && heldLongEnough(f)) advanceFeed(f);
    }
    renderPane(i);
    if (["play", "playing", "pause", "ended", "error"].indexOf(ev) >= 0) updateWakeLock();
  }
  function heldLongEnough(f) { return !!f.shownAt && Date.now() - f.shownAt >= holdSeconds * 1000 - 400; }
  // Record the real picture size once known, so the layout can fit it.
  function noteSize(f) {
    var w = f.still ? f.img.naturalWidth : f.real.videoWidth, hh = f.still ? f.img.naturalHeight : f.real.videoHeight;
    if (!(w > 0 && hh > 0) || !f.item) return;
    var before = itemAspect(f.item);
    f.item.w = w; f.item.h = hh;
    if (!before || Math.abs(Math.log(before / itemAspect(f.item))) > 0.04) { persist(); smartCheck(idx(f)); }
  }

  async function advanceFeed(f) {
    if (f.advance || !f.item || f.video.loop || !authed || document.hidden) return;
    var job = { token: f.token };
    f.advance = job; f.error = null; f.shuffleFailed = false;
    renderPane(idx(f));
    function current() {
      return f.advance === job && f.token === job.token && feeds.indexOf(f) >= 0 &&
        !!f.item && !f.video.loop && authed && !document.hidden;
    }
    try {
      // Walk the selected feed/filter snapshot, independent of later picker changes.
      while (current()) {
        var q = f.shuffle;
        if (!q) q = f.shuffle = { seed: uuid(), start: 0, total: null, items: [] };
        if (!q.items.length) {
          if (q.total !== null && q.start >= q.total) {
            q.seed = uuid(); q.start = 0; q.total = null;
          }
          var page = await api(shuffleQuery(f, q));
          if (!current()) return;
          if (f.shuffle !== q) continue; // Favourites changed during the request.
          if (!page || !Array.isArray(page.items) || !page.items.length)
            throw new Error("No posts match this selection.");
          q.items = page.items.slice(); q.total = page.total; q.start += 100;
        }
        var next = takeNext(f, q);
        // Don't immediately replay the finished post, or show one that another
        // pane is showing, unless the selection is too small to avoid it.
        if (next.id === f.item.id && q.total > 1) continue;
        if (q.total > feeds.length * 2 && feeds.some(function (o) { return o !== f && o.item && o.item.id === next.id; })) continue;
        if (!current()) return;
        loadItem(idx(f), next, 0, true, false);
        f.fromShuffle = true; // eligible for automatic skipping if it cannot play
        return;
      }
    } catch (e) {
      if (current()) {
        f.shuffleFailed = true;
        f.error = "Could not load the next post: " + e.message;
        renderPane(idx(f));
      }
    } finally {
      if (f.advance === job) {
        f.advance = null;
        var i = idx(f); if (i >= 0) renderPane(i);
      }
      updateWakeLock();
    }
  }

  // Prefer, from the next few shuffled posts, one whose shape suits this
  // pane's frame, so frames stay filled without the layout having to move.
  // A post is only ever passed over twice, so everything still gets shown.
  // Smart fit shapes the frames around the posts instead, so it looks less far.
  function takeNext(f, q) {
    var i = idx(f), best = 0, span = Math.min(layout === "smart" ? 3 : 8, q.items.length);
    var r = i >= 0 && panes[i] && !panes[i].el.classList.contains("fs") ? panes[i].el.getBoundingClientRect() : null;
    if (r && r.width > 20 && r.height > 20 && feeds.length > 1 && !((q.items[0]._passed || 0) >= 2)) {
      var cell = r.width / r.height, bestScore = Infinity;
      for (var k = 0; k < span; k++) {
        var a = itemAspect(q.items[k]);
        var score = (a ? Math.abs(Math.log(a / cell)) : 0.3) + k * 0.05;
        if (score < bestScore) { bestScore = score; best = k; }
      }
    }
    for (var p = 0; p < best; p++) q.items[p]._passed = (q.items[p]._passed || 0) + 1;
    var next = q.items.splice(best, 1)[0];
    delete next._passed;
    return next;
  }

  function libraryScope(value) {
    value = value || {};
    return {
      parentId: typeof value.parentId === "string" ? value.parentId.slice(0, 128) : "",
      search: typeof value.search === "string" ? value.search.slice(0, 200) : "",
      type: ["video", "gif", "image"].indexOf(value.type) >= 0 ? value.type : "",
      favourites: value.favourites === true,
      unplayed: value.unplayed === true
    };
  }
  function scopeQuery(scope) {
    var path = "";
    ["parentId", "search", "type"].forEach(function (key) {
      if (scope[key]) path += "&" + key + "=" + encodeURIComponent(scope[key]);
    });
    if (scope.favourites) path += "&favourites=true";
    if (scope.unplayed) path += "&unplayed=true";
    return path;
  }
  function shuffleQuery(f, q) {
    return "/api/items?sort=random&seed=" + encodeURIComponent(q.seed) + "&startIndex=" + q.start + "&limit=100" + scopeQuery(libraryScope(f.scope));
  }

  function nextVideo(i) {
    var f = feeds[i];
    if (!f || !f.item || f.advance || !authed || document.hidden) return;
    // An explicit skip leaves repeat mode and uses the same continuous queue.
    f.video.loop = false;
    persist();
    return advanceFeed(f);
  }

  function attachSource(f, src) {
    var tok = f.token;
    f.srcKind = src.kind;
    if (src.kind === "img") { showStill(f, src.url); return; }
    f.controller = PB.attach(f.real, src.url, {
      hls: src.kind === "hls",
      onError: function (message) {
        if (f.token !== tok || !f.item) return;
        if (useAlt(f)) return;
        f.error = message || "This post could not be loaded.";
        var n = idx(f); if (n >= 0) { panes[n].el.classList.remove("buffering"); renderPane(n); } updateWakeLock();
      },
      onBlocked: function () { if (f.token !== tok) return; f.needsResume = true; var n = idx(f); if (n >= 0) renderPane(n); }
    });
  }
  // Some posts have a second, plainer copy (Reddit's own silent preview).
  function useAlt(f) {
    if (!f.alt || !f.item) return false;
    var url = f.alt; f.alt = "";
    destroyController(f);
    attachSource(f, { kind: "mp4", url: url });
    if (f.autoplay && !document.hidden) playFeed(idx(f));
    return true;
  }
  function loadItem(i, item, pos, autoplay, loop, scope) {
    var f = feeds[i], v = f.video;
    f.advance = null; f.shuffleFailed = false;
    if (scope !== undefined) { f.scope = libraryScope(scope); f.shuffle = null; }
    // Repeat belongs to this post, not its pane. Retries keep it; replacements
    // start with repeat off unless restoring an explicitly saved preference.
    var keepLoop = typeof loop === "boolean" ? loop : !!(f.item && f.item.id === item.id && v.loop);
    f.token++; f.item = item; f.error = null; f.pending = pos > 0 ? pos : null; f.needsResume = false; f.reload = false;
    f.fromShuffle = false; f.started = false; f.autoLoop = false; f.shownAt = 0; f.lastT = 0; f.alt = ""; f.srcKind = "";
    f.autoplay = !!autoplay; f.wantPlay = false; f.resolving = false;
    clearTimeout(f.skipTimer); f.skipTimer = null;
    var tok = f.token;
    destroyController(f); clearStill(f);
    v.loop = keepLoop;
    // A soft, blurred copy of the thumbnail sits behind the picture, so any
    // space the picture does not cover is never plain black.
    f.bg.style.backgroundImage = /^https:\/\//.test(item.imageUrl || "") ? "url(\"" + item.imageUrl.replace(/["\\\n]/g, "") + "\")" : "";
    if (!PLAYABLE) {
      f.error = "This browser's video player is unavailable. Use a current browser.";
      renderPane(i); persist(); return;
    }
    f.real.muted = !audioEnabled(i) || (DESKTOP && f.volume === 0);
    if (DESKTOP) f.real.volume = f.volume;
    function ready(src) {
      f.resolving = false; f.alt = src.alt || "";
      if (src.w > 0 && src.h > 0) { item.w = src.w; item.h = src.h; }
      if (src.duration > 0) item.duration = src.duration;
      if (typeof src.audio === "boolean") item.audio = src.audio;
      attachSource(f, src);
      var n = idx(f);
      if (autoplay || f.wantPlay) { f.wantPlay = false; if (n >= 0) { panes[n].el.classList.add("buffering"); playFeed(n); } }
      else if (n >= 0) panes[n].el.classList.remove("buffering");
    }
    function failed(error) {
      if (f.token !== tok || !f.item) return;
      f.resolving = false;
      f.error = error && error.message || "This post could not be loaded.";
      var n = idx(f); if (n >= 0) { panes[n].el.classList.remove("buffering"); renderPane(n); }
      updateWakeLock();
    }
    var now = null, bad = null;
    try { now = LOCAL.resolveSync(item); } catch (error) { bad = error; }
    if (bad) failed(bad);
    else if (now) ready(now); // no lookup needed: play() stays inside the tap that asked for it
    else {
      // Redgifs links are looked up when the clip is about to play.
      f.resolving = true; f.wantPlay = !!autoplay;
      panes[i].el.classList.add("buffering");
      LOCAL.resolve(item).then(function (src) {
        if (f.token !== tok || !f.item) return;
        var want = f.wantPlay; autoplay = want;
        ready(src);
        var n = idx(f); if (n >= 0) { renderPane(n); smartCheck(n); }
        persist();
      }, failed);
    }
    renderPane(i); persist(); smartCheck(i);
  }
  // Callers bump f.token first so media events fired by teardown are ignored.
  function destroyController(f) {
    var c = f.controller; f.controller = null;
    if (c) { try { c.destroy(); } catch (e) { /* already released */ } }
  }
  function unloadFeed(f) {
    f.token++; f.advance = null; f.resolving = false;
    clearTimeout(f.skipTimer); f.skipTimer = null;
    destroyController(f); clearStill(f);
    f.autoLoop = false; f.real.pause(); f.real.removeAttribute("src"); f.real.load();
  }
  function clearFeed(i) {
    var f = feeds[i];
    f.shuffle = null; f.shuffleFailed = false;
    unloadFeed(f);
    f.item = null; f.error = null; f.pending = null; f.needsResume = false;
    f.bg.style.backgroundImage = "";
    audible[i] = false; f.real.muted = true;
    f.video.loop = false;
    panes[i].el.classList.remove("show", "fs", "buffering");
    renderPane(i); persist();
    updateWakeLock(); smartCheck(i, true);
  }
  function retry(i) {
    var f = feeds[i]; if (!f.item) return;
    if (f.shuffleFailed) { advanceFeed(f); return; }
    loadItem(i, f.item, f.video.currentTime || 0, true);
  }
  function toggleLoop(i) {
    var f = feeds[i];
    if (!f.item) return;
    f.video.loop = !f.video.loop;
    if (f.video.loop) {
      f.advance = null;
      if (f.shuffleFailed) { f.shuffleFailed = false; f.error = null; }
    }
    renderPane(i); persist();
  }
  // Exchange two panes' posts; their audio settings move with them.
  function swapFeeds(i, j) {
    if (i === j || !feeds[i] || !feeds[j]) return;
    var a = feeds[i], b = feeds[j];
    feeds[i] = b; feeds[j] = a;
    panes[i].stage.appendChild(b.node); panes[j].stage.appendChild(a.node);
    var x = audible[i]; audible[i] = audible[j]; audible[j] = x;
    if (active === i) active = j; else if (active === j) active = i;
    applyAudio(); eachPane(renderPane); persist(); smartCheck(i, true);
  }
  function swapPanes(i) {
    if (feeds.length < 2) return;
    var j = (i + 1) % feeds.length, a = feeds[i], b = feeds[j];
    feeds[i] = b; feeds[j] = a;
    panes[i].stage.appendChild(b.node); panes[j].stage.appendChild(a.node);
    applyAudio();
    eachPane(renderPane); persist(); smartCheck(i, true);
    showControls(j); toast("Swapped panes " + (i + 1) + " and " + (j + 1));
  }

  // Synchronous: no awaits before play().
  function playFeed(i) {
    var f = feeds[i]; if (!f || !f.item) return;
    if (f.shuffleFailed || (f.video.ended && !f.video.loop)) { advanceFeed(f); return; }
    if (f.reload || f.error) { loadItem(i, f.item, f.video.currentTime || f.pending || 0, true); return; }
    if (f.resolving) { f.wantPlay = true; return; } // plays once the media address is known
    var tok = f.token;
    var p = f.controller ? f.controller.play() : f.video.play();
    if (p && p.catch) p.catch(function (e) { if (f.token === tok && idx(f) >= 0 && !f.error && e && e.name === "NotAllowedError") { f.needsResume = true; renderPane(idx(f)); } });
  }
  function setActive(i) {
    // must remain synchronous inside the user gesture
    active = i;
    if (mixAudio) audible[i] = true;
    applyAudio();
    var f = feeds[i];
    if (f.item && !f.error) playFeed(i);
    eachPane(renderPane); persist();
  }

  function audioEnabled(i) {
    return mixAudio ? !!audible[i] : i === active;
  }
  function applyAudio() {
    // Mute unwanted panes first, then enable the selected ones synchronously.
    // Desktop: each feed keeps its own level; 0 is silent and mute never alters the level.
    feeds.forEach(function (f, i) { if (DESKTOP) f.video.volume = f.volume; if (!f.item || !audioEnabled(i) || (DESKTOP && f.volume === 0)) f.video.muted = true; });
    feeds.forEach(function (f, i) { if (f.item && audioEnabled(i) && !(DESKTOP && f.volume === 0)) f.video.muted = false; });
  }
  function setVolume(f, value) {
    f.volume = validVolume(value); applyAudio();
    var i = idx(f); if (i >= 0) renderPane(i);
    persist();
  }
  function renderAudioControls() {
    $("#btn-mix-audio").setAttribute("aria-pressed", String(mixAudio));
    $("#btn-audio-all").hidden = !mixAudio;
    $("#btn-audio-none").hidden = !mixAudio;
    $("#btn-audio-cycle").setAttribute("aria-pressed", String(audioCycle));
    $("#audio-cycle-seconds").value = cycleSeconds;
    $("#audio-hint").textContent = audioCycle ? "Audio cycles every " + cycleSeconds + "s" :
      mixAudio ? "Tap speakers to mix audio" : "One audible pane";
  }
  function refreshAudio() {
    applyAudio(); renderAudioControls();
    eachPane(renderPane); persist();
  }
  function setMixAudio(on) {
    audioCycle = false; scheduleAudioCycle();
    if (on && !mixAudio) audible = feeds.map(function (_, i) { return i === active; });
    if (!on && mixAudio && (!audible[active] || !feeds[active].item)) {
      var first = feeds.findIndex(function (f, i) { return f.item && audible[i]; });
      if (first >= 0) active = first;
    }
    mixAudio = !!on;
    refreshAudio();
  }
  function togglePaneAudio(i) {
    if (!feeds[i].item) return;
    lastTaps[i] = 0;
    eachPane(hideControls);
    if (!mixAudio) { setActive(i); return; }
    audible[i] = !audible[i];
    if (audible[i]) active = i;
    applyAudio();
    if (audible[i]) playFeed(i);
    refreshAudio();
  }
  function setAllAudio(on) {
    audioCycle = false; scheduleAudioCycle();
    mixAudio = true;
    audible = feeds.map(function (f) { return !!(on && f.item); });
    applyAudio();
    if (on) feeds.forEach(function (f, i) { if (f.item) playFeed(i); });
    refreshAudio();
  }
  function restoreAudioState(saved) {
    mixAudio = !!(saved && saved.mixAudio === true);
    audible = feeds.map(function (_, i) {
      return mixAudio && Array.isArray(saved.audible) ? saved.audible[i] === true : i === active;
    });
    renderAudioControls();
  }

  function scheduleAudioCycle() {
    clearInterval(cycleTimer); cycleTimer = null;
    if (audioCycle && authed && !document.hidden)
      cycleTimer = setInterval(cycleAudio, cycleSeconds * 1000);
  }
  function cycleAudio() {
    if (!audioCycle || !authed || document.hidden) return;
    for (var step = 1; step <= feeds.length; step++) {
      var i = (active + step) % feeds.length, f = feeds[i];
      if (f.item && f.item.audio !== false && !f.still && !f.video.paused && !f.video.ended && !f.error) {
        active = i; mixAudio = false;
        refreshAudio(); return;
      }
    }
  }
  function setAudioCycle(on) {
    audioCycle = !!on;
    if (audioCycle) {
      mixAudio = false;
      var f = feeds[active];
      if (!f || !f.item || f.video.paused || f.video.ended || f.error) {
        var first = feeds.findIndex(function (feed) {
          return feed.item && !feed.video.paused && !feed.video.ended && !feed.error;
        });
        if (first >= 0) active = first;
      }
    }
    scheduleAudioCycle(); refreshAudio();
  }
  function setCycleSeconds(value) {
    var seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
      toast("Choose an audio interval from 1 to 3600 seconds.");
      $("#audio-cycle-seconds").value = cycleSeconds; return false;
    }
    cycleSeconds = seconds; scheduleAudioCycle(); renderAudioControls(); persist();
    return true;
  }
  function restorePlaybackSettings(saved) {
    var seconds = Number(saved && saved.cycleSeconds);
    cycleSeconds = Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 20;
    audioCycle = !!(saved && saved.audioCycle === true);
    if (audioCycle) mixAudio = false;
    renderAudioControls();
  }

  function wantsWakeLock() {
    return authed && !document.hidden && feeds.some(function (f) {
      return f.item && (!!f.advance || (!f.video.paused && !f.video.ended && !f.error));
    });
  }
  function renderWakeStatus() {
    var el = $("#wake-status");
    el.textContent = wakeLock ? "Screen wake lock active while watching." :
      (!navigator.wakeLock ? "This browser does not support keeping the screen awake." :
        wakeBlocked ? "Screen wake lock unavailable. Your device may still dim or sleep." :
          "Screen wake lock is requested automatically during playback.");
  }
  function updateWakeLock() {
    renderWakeStatus();
    if (!wantsWakeLock()) {
      wakeEpoch++;
      var old = wakeLock; wakeLock = null;
      if (old) old.release().catch(function () {});
      renderWakeStatus(); return;
    }
    if (!navigator.wakeLock || wakeLock || wakePending) return;
    wakePending = true;
    var epoch = wakeEpoch;
    navigator.wakeLock.request("screen").then(function (lock) {
      if (epoch !== wakeEpoch || !wantsWakeLock()) { return lock.release(); }
      wakeLock = lock; wakeBlocked = false;
      lock.addEventListener("release", function () {
        if (wakeLock === lock) { wakeLock = null; wakeBlocked = wantsWakeLock(); renderWakeStatus(); }
      });
    }).catch(function () { wakeBlocked = true; }).finally(function () {
      wakePending = false; renderWakeStatus();
      if (epoch !== wakeEpoch && wantsWakeLock()) updateWakeLock();
    });
  }

  function updateFavouriteButton(button, item) {
    var pending = favouritePending.has(item.id);
    var label = (item.isFavourite ? "Remove from" : "Add to") + " favourites";
    button.setAttribute("aria-pressed", String(!!item.isFavourite));
    button.setAttribute("aria-label", label + ": " + item.name);
    button.setAttribute("title", label);
    button.setAttribute("aria-busy", String(pending));
    button.disabled = pending;
  }
  function refreshFavouriteButtons() {
    eachPane(renderPane);
    document.querySelectorAll("[data-favourite-id]").forEach(function (button) {
      var item = L.items.find(function (it) { return it.id === button.dataset.favouriteId; });
      if (item) updateFavouriteButton(button, item);
    });
  }
  function applyFavouriteState(id, value) {
    feeds.forEach(function (f) { if (f.item && f.item.id === id) f.item.isFavourite = value; });
    L.items.forEach(function (it) { if (it.id === id) it.isFavourite = value; });
    refreshFavouriteButtons(); persist();
  }
  function toggleFavourite(item) {
    if (!item || favouritePending.has(item.id)) return Promise.resolve();
    var id = item.id, wanted = !item.isFavourite;
    favouritePending.add(id); favouriteRevision++;
    refreshFavouriteButtons();
    return api("/api/items/" + encodeURIComponent(id) + "/favourite", {
      method: "PUT", body: { isFavourite: wanted, item: item }
    }).then(function (state) {
      if (!state || state.id !== id || state.isFavourite !== wanted) throw new Error("The change was not saved.");
      favouriteRevision++;
      feeds.forEach(function (f) { if (f.scope && f.scope.favourites) f.shuffle = null; });
      item.isFavourite = state.isFavourite;
      applyFavouriteState(id, state.isFavourite);
      toast(wanted ? "Saved to favourites" : "Removed from favourites");
      if (L.favourites) {
        if (L.sort === "random") { L.seed = uuid(); L.start = 0; }
        else if (!wanted && L.items.length === 1) L.start = Math.max(0, L.start - L.limit);
        if (!$("#sheet").hidden) loadItems();
      }
    }).catch(function (error) {
      toast("Could not update favourite: " + error.message);
    }).finally(function () {
      favouritePending.delete(id); refreshFavouriteButtons();
    });
  }

  function showControls(i) {
    var el = panes[i].el; el.classList.add("show"); clearTimeout(hideTimers[i]);
    hideTimers[i] = setTimeout(function () { el.classList.remove("show"); }, 3000);
  }
  function hideControls(i) { clearTimeout(hideTimers[i]); panes[i].el.classList.remove("show"); }
  function toggleFs(i) {
    var el = panes[i].el, on = !el.classList.contains("fs");
    eachPane(function (k) {
      panes[k].el.classList.remove("fs");
      panes[k].fsBtn.setAttribute("aria-pressed", "false");
    });
    if (on) el.classList.add("fs");
    panes[i].fsBtn.setAttribute("aria-pressed", String(on));
    showControls(i); renderPane(i);
  }

  // Fullscreen the document, never a video: iOS must keep every pane inline.
  // CSS fill mode remains active if the browser has no Fullscreen API.
  var immersive = false, nativeImmersive = false;
  // iOS can resize its visual viewport independently of the layout viewport
  // when browser bars collapse, the phone rotates, or standalone mode opens.
  function syncPlayerViewport() {
    if (built && typeof screenAspect === "function") {
      // Re-fit the layout when the video area changes shape noticeably:
      // rotating, entering or leaving fill mode, or resizing the window.
      var sa = screenAspect();
      if (!lastOrient || Math.abs(Math.log(sa / lastOrient)) > 0.18) { lastOrient = sa; if (layout !== "grid") { layoutPanes(); eachPane(renderPane); return; } }
      markEdges();
    }
    var viewport = window.visualViewport;
    var style = document.documentElement.style;
    style.setProperty("--player-height", (viewport && viewport.height || window.innerHeight) + "px");
    style.setProperty("--player-width", (viewport && viewport.width || window.innerWidth) + "px");
    style.setProperty("--player-top", (viewport && viewport.offsetTop || 0) + "px");
    style.setProperty("--player-left", (viewport && viewport.offsetLeft || 0) + "px");
  }
  var viewportFrame;
  function schedulePlayerViewport() {
    cancelAnimationFrame(viewportFrame);
    viewportFrame = requestAnimationFrame(syncPlayerViewport);
  }
  window.addEventListener("resize", schedulePlayerViewport);
  window.addEventListener("orientationchange", function () {
    schedulePlayerViewport();
    setTimeout(schedulePlayerViewport, 250);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", schedulePlayerViewport);
    window.visualViewport.addEventListener("scroll", schedulePlayerViewport);
  }
  syncPlayerViewport();
  // iPhone Safari cannot hide its own bars for a web page (only one native
  // video can go full screen). Launching from the Home Screen removes them.
  var standalone = !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches));
  var fullscreenTipShown = false;
  function fullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fillScreen(on) {
    immersive = on;
    $("#view-app").classList.toggle("immersive", on);
    $("#btn-fullscreen").setAttribute("aria-pressed", String(on));
    $("#btn-exit-fullscreen").hidden = !on;
    if (typeof renderLayoutCycle === "function" && built) renderLayoutCycle();
    syncPlayerViewport(); setTimeout(syncPlayerViewport, 60);
    var root = document.documentElement;
    if (on) {
      var request = root.requestFullscreen || root.webkitRequestFullscreen;
      if (request) {
        try {
          var entered = request.call(root, { navigationUI: "hide" });
          if (entered && entered.catch) entered.catch(function () {});
        } catch (e) { /* CSS fill remains active */ }
      } else if (PB && PB.profile && PB.profile.ios && !standalone && !fullscreenTipShown) {
        fullscreenTipShown = true;
        toast("For true full screen on iPhone: Share, then Add to Home Screen, and open the app from there.");
      }
    } else if (fullscreenElement()) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { var exited = exit && exit.call(document); if (exited && exited.catch) exited.catch(function () {}); } catch (e) {}
    }
    setTimeout(syncPlayerViewport, 300);
  }
  $("#btn-fullscreen").addEventListener("click", function (e) { e.stopPropagation(); fillScreen(!immersive); });
  $("#btn-exit-fullscreen").addEventListener("click", function (e) { e.stopPropagation(); fillScreen(false); });
  function onFullscreenChange() {
    if (fullscreenElement()) nativeImmersive = true;
    else if (nativeImmersive) { nativeImmersive = false; fillScreen(false); }
    schedulePlayerViewport();
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || modal) return;
    var expanded = panes.findIndex(function (p) { return p.el.classList.contains("fs"); });
    if (expanded >= 0) toggleFs(expanded);
    else if (immersive) fillScreen(false);
  });

  // ---------- post info ----------
  var info = null; // { feed, itemId }
  function openInfo(i, opener) {
    var f = feeds[i]; if (!f || !f.item) return;
    var me = { feed: f, itemId: f.item.id }, it = f.item;
    var body = $("#info-body"); body.textContent = "";
    body.appendChild(h("p", { class: "info-name", text: it.name }));
    var tags = h("div");
    [it.seriesName, it.author ? "u/" + it.author : "", { video: "Video", gif: "GIF", image: "Image" }[it.type],
      it.w && it.h ? it.w + " × " + it.h : "", it.duration ? fmt(it.duration) : "", it.nsfw ? "NSFW" : ""].filter(Boolean)
      .forEach(function (t) { tags.appendChild(h("span", { class: "tag", text: String(t) })); });
    body.appendChild(tags);
    if (/^https:\/\/www\.reddit\.com\//.test(it.link || "")) {
      body.appendChild(h("p", {}, [h("a", { class: "chip link-chip", href: it.link, target: "_blank", rel: "noopener noreferrer", text: "Open on Reddit" })]));
    }
    openModal($("#info"), opener, function () { if (info === me) info = null; var n = idx(f); if (n >= 0 && panes[n]) showControls(n); });
    info = me;
  }
  // Dismiss info if its feed was replaced, advanced, removed or the app closed.
  function syncInfo() {
    if (!info) return;
    var f = info.feed, n = feeds.indexOf(f);
    if (n >= 0 && f.item && f.item.id === info.itemId && authed) {
      // Feed moved by a swap: follow it and return focus to its own pane.
      if (modal && modal.el.id === "info" && panes[n]) modal.opener = panes[n].infoBtn;
      return;
    }
    info = null;
    if (modal && modal.el.id === "info") {
      var k = Math.min(Math.max(n, 0), panes.length - 1);
      modal.opener = authed && panes[k] ? panes[k].el : null;
      closeModal();
    }
  }
    function tap(i) {
    var f = feeds[i], now = Date.now();
    if (!f.item) { openLibrary(i, panes[i].el); return; }
    // Only consecutive taps on the same pane count as a double tap.
    lastTaps.forEach(function (_, k) { if (k !== i) lastTaps[k] = 0; });
    var dbl = now - (lastTaps[i] || 0) < 320; lastTaps[i] = dbl ? 0 : now;
    if (dbl) { toggleFs(i); return; }
    if (active !== i || (mixAudio && !audible[i])) {
      eachPane(hideControls);
      setActive(i);
      return;
    }
    if (f.needsResume && f.video.paused) { setActive(i); return; }
    if (panes[i].el.classList.contains("show")) hideControls(i); else showControls(i);
  }

  function buildPane(i) {
    var f = feeds[i];
    var stage = h("div", { class: "stage" });
    stage.appendChild(f.node);
    var el = h("div", { class: "pane", "data-testid": "pane-" + i });
    var stop = function (e) { e.stopPropagation(); };
    var P = { el: el, stage: stage };
    P.empty = h("div", { class: "empty" }, [h("div", { class: "plus", text: "+" }), h("span", { text: "Pane " + (i + 1) + " is empty" }), h("span", { class: "mono", text: "Tap to choose a post" })]);
    P.badge = h("button", { class: "badge", type: "button", html: IC.mute + IC.sound, onclick: function (e) { e.stopPropagation(); togglePaneAudio(idx0(P)); } });
    P.title = h("div", { class: "title-chip", "aria-hidden": "true" });
    P.spin = h("div", { class: "spin" });
    P.resume = h("div", { class: "tapresume" }, [h("span", { text: "Tap to resume" })]);
    P.err = h("div", { class: "err" });
    // controls
    P.seek = h("input", { type: "range", min: "0", max: "1000", value: "0", step: "1", "aria-label": "Seek pane " + (i + 1) });
    P.cur = h("span", { text: "0:00" }); P.dur = h("span", { text: "0:00" });
    P.pp = h("button", { class: "cb main", type: "button" });
    function cb(cls, label, html, fn) { return h("button", { class: "cb " + cls, type: "button", "aria-label": label, html: html, onclick: function (e) { e.stopPropagation(); showControls(idx0(P)); fn(); } }); }
    function idx0(p) { return panes.indexOf(p); }
    var I = function () { return idx0(P); };
    P.pp.addEventListener("click", function (e) {
      e.stopPropagation(); var n = I(), ff = feeds[n]; showControls(n);
      if (ff.video.paused) playFeed(n); else ff.video.pause();
    });
    P.seek.addEventListener("input", function (e) {
      e.stopPropagation(); var n = I(), ff = feeds[n]; ff.seeking = true; showControls(n);
      var d = ff.video.duration || (ff.item && ff.item.duration) || 0;
      try { ff.video.currentTime = d * P.seek.value / 1000; } catch (er) {}
      P.cur.textContent = fmt(d * P.seek.value / 1000);
    });
    P.seek.addEventListener("change", function () { feeds[I()].seeking = false; });
    P.fsBtn = cb("sm", "Toggle full screen for pane " + (i + 1), IC.expand, function () { toggleFs(I()); });
    P.favBtn = cb("sm favourite-button", "Add to favourites", IC.heart, function () { toggleFavourite(feeds[I()].item); });
    P.loopBtn = cb("sm loop-button", "Enable repeat for pane " + (i + 1), IC.repeat, function () { toggleLoop(I()); });
    P.nextBtn = cb("sm next-button", "Next shuffled post in pane " + (i + 1), IC.next, function () { nextVideo(I()); });
    P.nextBtn.title = "Next post";
    P.infoBtn = cb("sm info-button", "Post info for pane " + (i + 1), "i", function () { openInfo(I(), P.infoBtn); });
    P.infoBtn.title = "Post info"; P.infoBtn.style.fontWeight = "700";
    if (DESKTOP) {
      P.vol = h("input", { type: "range", min: "0", max: "100", step: "1", value: "100", "aria-label": "Volume for pane " + (i + 1) });
      P.volOut = h("span", { class: "vol-out", text: "100%" });
      P.vol.addEventListener("input", function (e) {
        e.stopPropagation(); var n = I(); if (n < 0 || !feeds[n]) return;
        setVolume(feeds[n], P.vol.value / 100); showControls(n);
      });
      P.volWrap = h("div", { class: "vol" }, [h("span", { class: "vol-lbl", text: "Vol" }), P.vol, P.volOut]);
    }
    var ctl = h("div", { class: "ctl" }, [
      h("div", { class: "ctl-top" }, [
        P.mainBtn = cb("sm main-button", "Make pane " + (i + 1) + " a main pane", IC.main, function () { makeMain(I()); }),
        P.fsBtn,
        P.favBtn,
        P.loopBtn,
        P.infoBtn,
        cb("sm", "Choose a different post for pane " + (i + 1), "+", function () { openLibrary(I(), P.el); }),
        cb("sm", "Swap pane " + (i + 1) + " with the next pane", IC.swap, function () { swapPanes(I()); }),
        cb("sm", "Remove the post from pane " + (i + 1), IC.remove, function () { clearFeed(I()); })
      ]),
      h("div", { class: "ctl-bottom" }, [
        h("div", { class: "seek" }, [P.cur, P.seek, P.dur]),
        P.volWrap,
        h("div", { class: "row" }, [
          cb("sk", "Back 10 seconds in pane " + (i + 1), "-10", function () { var v = feeds[I()].video; v.currentTime = Math.max(0, v.currentTime - 10); }),
          P.pp,
          P.nextBtn,
          cb("sk", "Forward 10 seconds in pane " + (i + 1), "+10", function () { var v = feeds[I()].video; v.currentTime = Math.min(v.duration || 1e9, v.currentTime + 10); })
        ])
      ])
    ]);
    ["click", "pointerdown", "touchstart", "touchend", "dblclick"].forEach(function (ev) { ctl.addEventListener(ev, stop); });
    P.err.addEventListener("click", stop);
    P.ctl = ctl;
    el.append(stage, P.empty, P.spin, P.badge, P.title, P.resume, ctl, P.err);
    // Swipe left on a pane (touch screens) to skip to its next shuffled post.
    var swipe = null, swallowClick = 0;
    el.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { swipe = null; return; }
      swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    el.addEventListener("touchend", function (e) {
      var s0 = swipe; swipe = null;
      if (!s0 || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - s0.x, dy = e.changedTouches[0].clientY - s0.y;
      if (dx > -60 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - s0.t > 700) return;
      var n = I(); if (n < 0 || !feeds[n].item) return;
      swallowClick = Date.now(); lastTaps[n] = 0;
      if (feeds[n].advance) return;
      toast("Pane " + (n + 1) + ": next post");
      nextVideo(n);
    });
    el.addEventListener("touchcancel", function () { swipe = null; }, { passive: true });
    el.addEventListener("click", function () { if (Date.now() - swallowClick < 600) return; tap(I()); });
    el.addEventListener("dblclick", function (e) { e.preventDefault(); });
    el.tabIndex = 0;
    el.addEventListener("keydown", function (e) {
      if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); tap(I()); }
    });
    $("#panes").appendChild(el);
    return P;
  }

  function renderPane(i) {
    var P = panes[i], f = feeds[i]; if (!P) return;
    syncInfo();
    var has = !!f.item, v = f.video;
    P.nextBtn.disabled = !has || !!f.advance;
    P.nextBtn.setAttribute("aria-busy", String(!!f.advance));
    P.el.classList.toggle("active", active === i);
    P.mainBtn.hidden = !(has && mainCount() > 0 && i >= mainCount());
    P.mainBtn.title = "Make main";
    P.empty.hidden = has; P.title.hidden = !has; P.stage.hidden = !has;
    P.el.classList.toggle("still", has && !!f.still);
    // Fill panes trims the picture to its frame. Where that would cut away
    // close to half of it (or the pane is expanded), show it whole instead.
    var whole = false;
    if (has && coverFit) {
      var pa = itemAspect(f.item), box = P.el.getBoundingClientRect();
      whole = P.el.classList.contains("fs") || feeds.length === 1 || !!(pa && box.height > 0 && Math.abs(Math.log(pa / (box.width / box.height))) > 0.6);
    }
    P.el.classList.toggle("whole", whole);
    var hasAudio = has && audioEnabled(i);
    P.badge.hidden = !has;
    P.badge.setAttribute("aria-pressed", String(hasAudio));
    P.badge.setAttribute("aria-label", mixAudio ? (hasAudio ? "Mute" : "Unmute") + " audio in pane " + (i + 1) : "Use only audio from pane " + (i + 1));
    P.badge.setAttribute("title", P.badge.getAttribute("aria-label"));
    P.el.setAttribute("aria-label", has ? "Pane " + (i + 1) + ": " + f.item.name : "Pane " + (i + 1) + ": empty, opens the picker");
    P.el.setAttribute("role", "button");
    if (has) {
      updateFavouriteButton(P.favBtn, f.item);
      P.loopBtn.setAttribute("aria-pressed", String(!!v.loop));
      P.loopBtn.setAttribute("aria-label", (v.loop ? "Disable" : "Enable") + " repeat for pane " + (i + 1));
      P.loopBtn.setAttribute("title", v.loop ? "Repeat on: click to turn off" : "Keep this post on repeat");
      P.title.textContent = f.item.seriesName ? f.item.seriesName + " - " + f.item.name : f.item.name;
      P.pp.innerHTML = v.paused ? IC.play : IC.pause;
      P.pp.setAttribute("aria-label", (v.paused ? "Play" : "Pause") + " pane " + (i + 1));
      var d = v.duration > 0 && isFinite(v.duration) ? v.duration : (f.item.duration || 0);
      P.dur.textContent = fmt(d);
      if (!f.seeking) { P.cur.textContent = fmt(v.currentTime); P.seek.value = d ? Math.round(v.currentTime / d * 1000) : 0; }
    }
    if (P.vol && has) {
      var pct = Math.round(f.volume * 100);
      P.vol.value = pct; P.vol.setAttribute("aria-valuetext", pct === 0 ? "0%, silent" : pct + "%");
      P.volOut.textContent = pct + "%";
    }
    P.resume.hidden = !(has && f.needsResume && v.paused && !f.error);
    P.err.hidden = !f.error;
    if (f.error) {
      P.err.innerHTML = "";
      P.err.append(h("b", { text: "Could not play" }), h("p", { text: f.error }), h("div", {}, [
        h("button", { class: "chip", type: "button", text: "Retry", onclick: function () { retry(idx(f)); } }),
        h("button", { class: "chip", type: "button", text: "Choose another", onclick: function () { openLibrary(idx(f), this); } }),
        h("button", { class: "chip", type: "button", text: "Swap", onclick: function () { swapPanes(idx(f)); } }),
        h("button", { class: "chip", type: "button", text: "Remove", onclick: function () { clearFeed(idx(f)); } })
      ]));
      maybeAutoSkip(f);
    }
  }

  // Removed and unplayable posts are common on Reddit: when a shuffled post
  // can't play, move on to the next one instead of leaving an error card.
  // After 6 failures in a row the error stays, with Retry.
  var MAX_AUTO_SKIPS = 6;
  function maybeAutoSkip(f) {
    if (!f.item || !f.error || !f.fromShuffle || f.shuffleFailed ||
        f.advance || f.video.loop || f.skipTimer || document.hidden || !authed ||
        (f.failStreak || 0) >= MAX_AUTO_SKIPS) return;
    var token = f.token;
    f.skipTimer = setTimeout(function () {
      f.skipTimer = null;
      if (f.token !== token || !f.item || !f.error || !f.fromShuffle || !authed || document.hidden) return;
      f.failStreak = (f.failStreak || 0) + 1;
      var n = idx(f); if (n < 0) return;
      toast("Pane " + (n + 1) + ": skipped a post that couldn't play");
      advanceFeed(f);
    }, 900);
  }
  function savedPosition(f) {
    return f.pending != null ? f.pending : (Number.isFinite(f.video.currentTime) ? f.video.currentTime : 0);
  }
  function persist() {
    if (!built) return;
    lsSet({ active: active, holdSeconds: holdSeconds, cover: coverFit, mixAudio: mixAudio, audible: feeds.map(function (_, i) { return audioEnabled(i); }), audioCycle: audioCycle, cycleSeconds: cycleSeconds, count: feeds.length, layout: layout, layoutCycle: layoutCycle, layoutCycleMode: layoutCycleMode, collage: layout === "collage" ? collage : undefined, layoutSeconds: layoutSeconds, volumes: DESKTOP ? feeds.map(function (f) { return f.volume; }) : undefined, feeds: feeds.map(function (f) { return f.item ? { item: f.item, position: savedPosition(f), loop: !!f.video.loop, scope: libraryScope(f.scope) } : null; }) });
  }

  function enterConnectedApp(reconnect) {
    if (connectingMedia) return;
    authed = true;
    connectingMedia = true; show("boot");
    MEDIA.ensure(!!reconnect).then(function () {
      if (!authed) return;
      enterApp();
      var note = MEDIA.takeNotice(); if (note) toast(note);
    }).catch(function (error) { if (authed && error.name !== "AbortError") toast("Set-up could not be completed. Reload the page."); })
      .finally(function () { connectingMedia = false; });
  }
  function requireMediaConnection() {
    if (!authed || connectingMedia) return;
    closeModal(); persist(); teardownApp();
    enterConnectedApp(true);
  }
  function enterApp() {
    authed = true; show("app");
    if (!PLAYABLE) toast("This browser's video player is unavailable. Use a current browser.");
    $("#count-tool").hidden = false;
    $("#layout-tool").hidden = false;
    $("#layout-cycle-tool").hidden = false;
    // Phones keep the layout controls behind one button to save toolbar space.
    $("#btn-layout-toggle").hidden = DESKTOP;
    $("#layout-group").hidden = !DESKTOP && $("#btn-layout-toggle").getAttribute("aria-expanded") !== "true";
    document.querySelectorAll("[data-desktop]").forEach(function (n) { n.hidden = !DESKTOP; });
    if (!built) {
      built = true;
      var saved = lsGet();
      paneCount = validCount(saved && saved.count);
      feeds = []; panes = []; lastTaps = [];
      for (var k = 0; k < paneCount; k++) {
        var nf = newFeed();
        nf.volume = validVolume(saved && Array.isArray(saved.volumes) ? saved.volumes[k] : undefined);
        feeds.push(nf); panes.push(buildPane(k));
      }
      layoutPanes();
      active = 0;
      if (saved && Number.isInteger(saved.active) && saved.active >= 0 && saved.active < paneCount) active = saved.active;
      restoreAudioState(saved);
      restorePlaybackSettings(saved);
      var hold = Number(saved && saved.holdSeconds);
      holdSeconds = Number.isInteger(hold) && hold >= 2 && hold <= 600 ? hold : 12;
      coverFit = !(saved && saved.cover === false);
      $("#hold-seconds").value = holdSeconds; $("#btn-cover").setAttribute("aria-pressed", String(coverFit));
      layout = "smart";
      if (saved && validCollage(saved.collage, paneCount)) collage = saved.collage;
      if (saved && LAYOUTS.indexOf(saved.layout) >= 0) layout = saved.layout;
      $("#pane-layout").value = layout; layoutPanes();
      if (saved) {
        var ls = Number(saved.layoutSeconds);
        layoutSeconds = Number.isInteger(ls) && ls >= 5 && ls <= 3600 ? ls : 30;
        layoutCycle = saved.layoutCycle === true;
        layoutCycleMode = ["mains", "collage"].indexOf(saved.layoutCycleMode) >= 0 ? saved.layoutCycleMode : "all";
      }
      renderLayoutCycle();
      var restored = false;
      eachPane(function (i) {
        var s = saved && saved.feeds && saved.feeds[i];
        // Restored panes start playing again where the browser allows it
        // (silent panes always may); any it blocks show Tap to resume.
        if (s && s.item && s.item.id) { loadItem(i, s.item, +s.position || 0, !document.hidden, s.loop === true, s.scope || {}); if (document.hidden) feeds[i].needsResume = true; restored = true; }
        renderPane(i);
      });
      // A first visit starts playing straight away: every pane shuffles across all feeds.
      if (!saved && !restored) fillAllPanes(libraryScope({}), "All feeds");
      clearInterval(renderTimer);
      renderTimer = setInterval(function () { feeds.forEach(function (f, i) { if (f.item && !f.video.paused) renderPane(i); }); }, 500);
    }
    scheduleAudioCycle(); updateWakeLock();
    refreshStatus(); clearInterval(statusTimer); statusTimer = setInterval(refreshStatus, 30000);
  }
  // Grid: columns/rows as CSS variables, one pair for wide/landscape and one
  // for portrait. Three panes keep the original layout (rows in portrait,
  // columns in landscape).
  function layoutPanes() {
    var n = feeds.length, el = $("#panes");
    var cols, pcols;
    if (DESKTOP) { cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 || n === 9 ? 3 : 4; pcols = n <= 3 ? 1 : n <= 8 ? 2 : 3; }
    else { cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4; pcols = n <= 3 ? 1 : n <= 8 ? 2 : 3; }
    el.classList.toggle("grid", DESKTOP);
    el.classList.toggle("grid-m", !DESKTOP);
    el.classList.toggle("cover", coverFit);
    el.style.setProperty("--pc", cols); el.style.setProperty("--pr", Math.ceil(n / cols));
    el.style.setProperty("--pcp", pcols); el.style.setProperty("--prp", Math.ceil(n / pcols));
    el.dataset.count = String(n);
    $("#pane-count").value = String(n);
    applyMosaic();
    markEdges();
  }
  // Mark panes on the screen edges so fill mode can keep their controls clear
  // of the notch, status bar and home indicator. Measured, so it suits any layout.
  function markEdges() {
    var el = $("#panes"), n = panes.length; if (!n || !el) return;
    var box = el.getBoundingClientRect(), tol = 6;
    panes.forEach(function (P) {
      var r = P.el.getBoundingClientRect();
      P.el.classList.toggle("edge-top", r.top - box.top <= tol);
      P.el.classList.toggle("edge-bottom", box.bottom - r.bottom <= tol);
      P.el.classList.toggle("edge-left", r.left - box.left <= tol);
      P.el.classList.toggle("edge-right", box.right - r.right <= tol);
    });
  }

  // ---------- mosaic layouts ----------
  // smart:  frames shaped around what is playing (see "smart fit" below).
  // grid:   equal panes.
  // focus1: pane 1 is large. 2 panes: picture-in-picture. 3-7: a column of
  //         small panes on the right. 8-12: small panes wrap the right side and
  //         bottom (an L). Small cells keep a 16:9 shape on a 16:9 screen.
  // focus2: panes 1 and 2 are large, side by side across the top; the rest
  //         fill one or two rows beneath them.
  var LAYOUTS = ["smart", "grid", "focus1", "focus2", "collage"], layout = "smart", lastMainSlot = 1;
  // ---------- collage (random mosaic) ----------
  // The screen is divided by straight cuts into one frame per pane, on a
  // 48 x 48 grid. One to three "main" frames get most of the space, each a
  // different size; every frame stays a watchable widescreen-ish shape
  // (about 1:1 to 2.8:1) and the frames always fill the whole screen.
  var CG = 48, collage = null, portraitFocus = {}, lastOrient = null;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function shuffleArr(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function splitRect(r, items, sa) {
    if (items.length === 1) return [{ idx: items[0].idx, r: r }];
    var asp = (r.w / r.h) * sa;
    var vertical = asp > 2.1 ? true : asp < 1.3 ? false : Math.random() < 0.5;
    var span = vertical ? r.w : r.h, arr = shuffleArr(items.slice());
    var total = arr.reduce(function (t, it) { return t + it.w; }, 0), cands = [], acc = 0;
    for (var k = 1; k < arr.length; k++) {
      acc += arr[k - 1].w;
      var cut = Math.round(span * acc / total);
      if (cut >= 3 && span - cut >= 3) cands.push({ k: k, cut: cut, bal: Math.abs(acc / total - 0.5) });
    }
    if (!cands.length) return null;
    var minBal = Math.min.apply(null, cands.map(function (c) { return c.bal; }));
    var near = cands.filter(function (c) { return c.bal <= minBal + 0.2; }), pick = near[Math.floor(Math.random() * near.length)];
    var a = vertical ? { x: r.x, y: r.y, w: pick.cut, h: r.h } : { x: r.x, y: r.y, w: r.w, h: pick.cut };
    var b = vertical ? { x: r.x + pick.cut, y: r.y, w: r.w - pick.cut, h: r.h } : { x: r.x, y: r.y + pick.cut, w: r.w, h: r.h - pick.cut };
    var la = splitRect(a, arr.slice(0, pick.k), sa), lb = la && splitRect(b, arr.slice(pick.k), sa);
    return la && lb ? la.concat(lb) : null;
  }
  function screenAspect() {
    var box = $("#panes").getBoundingClientRect();
    return box.width > 50 && box.height > 50 ? box.width / box.height : 16 / 9;
  }
  function orient() { return screenAspect() < 1 ? "p" : "l"; }
  // A picture-in-picture inset kept at 16:9 on any screen shape.
  function pipPlan(w, corner) {
    var sa = screenAspect(), h = Math.max(3, Math.min(CG - 2, Math.round(w * sa * 9 / 16)));
    var top = corner[0] === "t", left = corner[1] === "l";
    var r0 = top ? 1 : CG + 1 - h, c0 = left ? 1 : CG + 1 - w;
    return { n: 2, mains: 1, pip: true, corner: corner, sa: sa, areas: [[1, 1, CG + 1, CG + 1], [r0, c0, r0 + h, c0 + w]] };
  }
  // opts.m fixes the number of mains; opts.best picks the tidiest result
  // instead of a random one (used for Focus layouts on tall screens).
  function genCollage(n, opts) {
    opts = opts || {};
    var sa = screenAspect(), found = [], tall = sa < 1;
    if (n === 2) {
      // Two panes: the main fills the screen with the other inset in a random
      // corner at a random size.
      var w = tall ? 22 + Math.floor(Math.random() * 9) : 10 + Math.floor(Math.random() * 7);
      return pipPlan(opts.best ? (tall ? 26 : 12) : w, opts.best ? "br" : (Math.random() < 0.5 ? "t" : "b") + (Math.random() < 0.5 ? "l" : "r"));
    }
    for (var pass = 0; pass < 2 && !found.length; pass++) {
    var lo = pass ? 0.8 : 1.0; // relax the narrowest shape once if nothing fits
    for (var t = 0; t < (opts.best ? 600 : 400) && found.length < (opts.best ? 40 : 14); t++) {
      var m = opts.m || (n <= 2 ? 1 : n === 3 ? (Math.random() < 0.5 ? 1 : 2) : [1, 2, 2, 3, 3][Math.floor(Math.random() * 5)]);
      if (n === 1) m = 1;
      // With only one small pane left over, the mains need more of the space.
      var mainShare = n === m ? 1 : n - m === 1 && m > 1 ? rnd(0.62, 0.85) : rnd(m === 1 ? 0.42 : 0.5, m === 3 ? 0.78 : 0.7), parts = [], items = [];
      for (var i = 0; i < m; i++) parts.push(rnd(0.6, 1.4));
      var pSum = parts.reduce(function (a, b) { return a + b; }, 0);
      for (i = 0; i < n; i++) items.push({ idx: i, w: i < m ? mainShare * parts[i] / pSum : (1 - mainShare) / (n - m) * rnd(0.85, 1.15) });
      var leaves = splitRect({ x: 0, y: 0, w: CG, h: CG }, items, sa);
      if (!leaves) continue;
      var ok = true, score = 0, mainMin = Infinity, smallMax = 0;
      leaves.forEach(function (l) {
        var asp = (l.r.w / l.r.h) * sa, area = l.r.w * l.r.h, isMain = l.idx < m;
        if (asp < (isMain ? lo + 0.15 : lo) || asp > (isMain ? (pass ? 2.8 : 2.4) : (pass ? 3.3 : 2.8))) ok = false;
        score += Math.abs(Math.log(asp / (16 / 9))) * (isMain ? 2 : 1);
        if (isMain) mainMin = Math.min(mainMin, area); else smallMax = Math.max(smallMax, area);
      });
      if (!ok || (smallMax && mainMin < smallMax * (pass ? 1.25 : 1.6))) continue;
      leaves.sort(function (a, b) { return a.idx - b.idx; });
      found.push({ score: score, plan: { n: n, mains: m, sa: sa, areas: leaves.map(function (l) { return [l.r.y + 1, l.r.x + 1, l.r.y + l.r.h + 1, l.r.x + l.r.w + 1]; }) } });
    }
    }
    if (!found.length) return null;
    found.sort(function (a, b) { return a.score - b.score; });
    if (opts.best) return found[0].plan;
    var pool = found.slice(0, Math.min(5, found.length));
    return pool[Math.floor(Math.random() * pool.length)].plan;
  }
  function validCollage(c, n) {
    // A collage is kept only while the screen keeps roughly the shape it was made for.
    return !!(c && c.n === n && typeof c.sa === "number" && c.sa > 0 && Math.abs(Math.log(screenAspect() / c.sa)) < 0.18 && Number.isInteger(c.mains) && c.mains >= 1 && c.mains <= 3 && Array.isArray(c.areas) && c.areas.length === n &&
      c.areas.every(function (a) { return Array.isArray(a) && a.length === 4 && a.every(function (v) { return Number.isInteger(v) && v >= 1 && v <= CG + 1; }) && a[2] > a[0] && a[3] > a[1]; }));
  }
  function newCollage() { var c = genCollage(feeds.length); if (c) collage = c; return !!c; }
  function fr(n) { var a = []; for (var k = 0; k < n; k++) a.push("1fr"); return a; }
  function spans(total, k) { var out = [], base = Math.floor(total / k), extra = total % k; for (var x = 0; x < k; x++) out.push(base + (x >= k - extra ? 1 : 0)); return out; }
  function mainCount() {
    if (layout === "collage") return feeds.length >= 2 && validCollage(collage, feeds.length) ? collage.mains : 0;
    return layout === "focus1" && feeds.length >= 2 ? 1 : layout === "focus2" && feeds.length >= 3 ? 2 : 0;
  }
  // Small panes always keep a 16:9 cell; where a count can't fill every cell
  // exactly, the spare space is left dark (a corner, or the ends of a centred
  // row) rather than stretching a video.
  var FOCUS2_ROWS = { 1: [1, 3], 2: [1, 3], 3: [1, 3], 4: [1, 4], 5: [1, 5], 6: [1, 6], 7: [2, 4], 8: [2, 4], 9: [2, 5], 10: [2, 5] };
  function mosaicPlan(mode, n) {
    var plan = { cols: [], rows: [], areas: [], pip: -1 }, s;
    if (mode === "smart") {
      if (n < 2) return null;
      if (!smart || smart.n !== n || smart.key !== aspectKey(paneAspects()) || Math.abs(Math.log(screenAspect() / smart.sa)) > 0.02) {
        var fitted = genSmart(); if (fitted) smart = fitted;
      }
      if (!smart || smart.n !== n) return null;
      plan.cols = fr(SG); plan.rows = fr(SG); plan.areas = smart.areas;
      return plan;
    }
    if (mode === "collage" && n >= 2) {
      if (!validCollage(collage, n) && !newCollage()) return mosaicPlan("focus1", n);
      plan.cols = fr(CG); plan.rows = fr(CG); plan.areas = collage.areas;
      if (collage.pip) { plan.pip = 1; plan.corner = collage.corner; }
      return plan;
    }
    var sa0 = screenAspect();
    if ((mode === "focus1" && n >= 2 || mode === "focus2" && n >= 3) && (sa0 < 1.39 || sa0 > 2.3)) {
      // Screens far from widescreen (a phone held upright, or a very wide
      // strip): the fixed Focus layouts would make awkward frames, so use the
      // tidiest arrangement with 1 or 2 mains for this exact shape instead.
      var key = mode + ":" + n + ":" + Math.round(screenAspect() * 20);
      if (!portraitFocus[key]) portraitFocus[key] = genCollage(n, { m: mode === "focus1" ? 1 : 2, best: true });
      var pf = portraitFocus[key];
      if (pf) {
        plan.cols = fr(CG); plan.rows = fr(CG); plan.areas = pf.areas;
        if (pf.pip) { plan.pip = 1; plan.corner = pf.corner; }
        return plan;
      }
    }
    if (mode === "focus1" && n >= 2) {
      s = n - 1;
      if (s === 1) { plan.cols = fr(4); plan.rows = fr(4); plan.areas = [[1, 1, 5, 5], [4, 4, 5, 5]]; plan.pip = 1; return plan; }
      if (s <= 6) {
        // Main on the left, small panes stacked in a column on the right.
        plan.cols = [(s === 2 ? 2 : s - 1) + "fr", "1fr"]; plan.rows = fr(s);
        plan.areas.push([1, 1, s + 1, 2]);
        for (var k = 0; k < s; k++) plan.areas.push([k + 1, 2, k + 2, 3]);
        return plan;
      }
      // Main top-left; small panes down the right side and along the bottom.
      var g = Math.ceil((s + 1) / 2);
      plan.cols = fr(g); plan.rows = fr(g);
      plan.areas.push([1, 1, g, g]);
      for (var r = 1; r < g; r++) plan.areas.push([r, g, r + 1, g + 1]);
      for (var c = 1; c <= s - (g - 1); c++) plan.areas.push([g, c, g + 1, c + 1]);
      return plan;
    }
    if (mode === "focus2" && n >= 3) {
      // Two mains side by side on top; R rows of up to K small panes beneath.
      s = n - 2;
      var R = FOCUS2_ROWS[s][0], K = FOCUS2_ROWS[s][1], left = s;
      plan.cols = fr(2 * K); plan.rows = [(K - R) + "fr"].concat(fr(R));
      plan.areas.push([1, 1, 2, K + 1], [1, K + 1, 2, 2 * K + 1]);
      for (var row = 0; row < R; row++) {
        var count = Math.min(K, left), col = 1 + (K - count); left -= count;
        for (var x = 0; x < count; x++) { plan.areas.push([row + 2, col, row + 3, col + 2]); col += 2; }
      }
      return plan;
    }
    return null;
  }
  // ---------- smart fit ----------
  // Frames are shaped around what is playing. The screen is cut into rows and
  // columns so that each frame is close to its post's own shape (tall posts
  // get tall frames, wide posts wide ones) and the frames always fill the
  // whole screen. What little mismatch remains is trimmed by Fill panes.
  var SG = 96, SMART_MIN = 8, smart = null, smartTimer = null;
  function itemAspect(it) { return it && it.w > 0 && it.h > 0 ? Math.max(0.42, Math.min(2.6, it.w / it.h)) : 0; }
  function paneAspects() {
    var empty = screenAspect() < 1 ? 1 : 16 / 9;
    return feeds.map(function (f) { return itemAspect(f.item) || empty; });
  }
  function aspectKey(list) { return list.map(function (x) { return x.toFixed(2); }).join(","); }
  // Side by side (row) the shapes add up; stacked, their inverses do.
  function treeAspect(node, a) {
    if (node.leaf !== undefined) return a[node.leaf];
    var x = treeAspect(node.a, a), y = treeAspect(node.b, a);
    return node.row ? x + y : 1 / (1 / x + 1 / y);
  }
  function randomTree(list) {
    if (list.length === 1) return { leaf: list[0] };
    var k = 1 + Math.floor(Math.random() * (list.length - 1));
    return { row: Math.random() < 0.5, a: randomTree(list.slice(0, k)), b: randomTree(list.slice(k)) };
  }
  function placeTree(node, r, a, cells) {
    if (node.leaf !== undefined) { cells[node.leaf] = r; return true; }
    var x = treeAspect(node.a, a), y = treeAspect(node.b, a);
    if (node.row) {
      var w = Math.round(r.w * x / (x + y));
      if (w < SMART_MIN || r.w - w < SMART_MIN) return false;
      return placeTree(node.a, { x: r.x, y: r.y, w: w, h: r.h }, a, cells) && placeTree(node.b, { x: r.x + w, y: r.y, w: r.w - w, h: r.h }, a, cells);
    }
    var hh = Math.round(r.h * (1 / x) / (1 / x + 1 / y));
    if (hh < SMART_MIN || r.h - hh < SMART_MIN) return false;
    return placeTree(node.a, { x: r.x, y: r.y, w: r.w, h: hh }, a, cells) && placeTree(node.b, { x: r.x, y: r.y + hh, w: r.w, h: r.h - hh }, a, cells);
  }
  // The same arrangement with one pane taken out, or put back beside any frame.
  function treeWithout(t, leaf) {
    if (t.leaf !== undefined) return t.leaf === leaf ? null : t;
    var a = treeWithout(t.a, leaf), b = treeWithout(t.b, leaf);
    return !a ? b : !b ? a : a === t.a && b === t.b ? t : { row: t.row, a: a, b: b };
  }
  function treeInsertions(t, leaf, out, wrap) {
    [true, false].forEach(function (row) {
      out.push(wrap({ row: row, a: { leaf: leaf }, b: t })); out.push(wrap({ row: row, a: t, b: { leaf: leaf } }));
    });
    if (t.leaf !== undefined) return;
    treeInsertions(t.a, leaf, out, function (sub) { return wrap({ row: t.row, a: sub, b: t.b }); });
    treeInsertions(t.b, leaf, out, function (sub) { return wrap({ row: t.row, a: t.a, b: sub }); });
  }
  // Lower is better: little trimming, no frame much worse than the rest, no tiny frames.
  function scoreSmart(tree, a, sa) {
    var cells = [];
    if (!placeTree(tree, { x: 0, y: 0, w: SG, h: SG }, a, cells)) return null;
    var crop = 0, worst = 0, minArea = 1, n = a.length;
    cells.forEach(function (r, i) {
      var d = Math.abs(Math.log((r.w / r.h) * sa / a[i]));
      crop += d; worst = Math.max(worst, d); minArea = Math.min(minArea, r.w * r.h / (SG * SG));
    });
    return { cells: cells, worst: worst, score: crop / n + worst * 0.5 + Math.max(0, Math.log((0.45 / n) / minArea)) * 0.8 };
  }
  function genSmart() {
    var a = paneAspects(), sa = screenAspect(), n = a.length, best = null;
    // Keep the current arrangement while it still suits what is playing, so
    // frames only shift a little instead of rearranging.
    if (smart && smart.n === n && Math.abs(Math.log(sa / smart.sa)) < 0.1) {
      var kept = scoreSmart(smart.tree, a, sa);
      if (kept && kept.worst < 0.22) best = { tree: smart.tree, s: kept };
      if (!best && n > 2) {
        // Next, try moving just one pane to a new place and leaving the rest.
        var moved = null;
        for (var leaf = 0; leaf < n; leaf++) {
          var cands = [];
          treeInsertions(treeWithout(smart.tree, leaf), leaf, cands, function (x) { return x; });
          cands.forEach(function (tree) {
            var s = scoreSmart(tree, a, sa);
            if (s && (!moved || s.score < moved.s.score)) moved = { tree: tree, s: s };
          });
        }
        if (moved && moved.s.worst < 0.25) best = moved;
      }
    }
    if (!best) {
      var ids = a.map(function (_, i) { return i; });
      for (var t = 0; t < 900; t++) {
        var tree = randomTree(shuffleArr(ids.slice())), s = scoreSmart(tree, a, sa);
        if (s && (!best || s.score < best.s.score)) best = { tree: tree, s: s };
      }
    }
    if (!best) return null;
    return { n: n, sa: sa, tree: best.tree, key: aspectKey(a), areas: best.s.cells.map(function (r) { return [r.y + 1, r.x + 1, r.y + r.h + 1, r.x + r.w + 1]; }) };
  }
  // After a pane's post changes: re-fit the frames only if the new post would
  // be noticeably trimmed in its current frame.
  function smartCheck(i, force) {
    if (!built || layout !== "smart" || feeds.length < 2 || i < 0) return;
    var a = itemAspect(feeds[i] && feeds[i].item), r = panes[i] && panes[i].el.getBoundingClientRect();
    if (!force && a && r && r.height > 0 && !panes[i].el.classList.contains("fs") && Math.abs(Math.log(a / (r.width / r.height))) < 0.2) return;
    clearTimeout(smartTimer);
    smartTimer = setTimeout(function () { if (built && layout === "smart") { layoutPanes(); eachPane(renderPane); } }, 60);
  }
  function applyMosaic() {
    var el = $("#panes"), plan = mosaicPlan(layout, panes.length);
    el.classList.toggle("mosaic", !!plan);
    el.style.gridTemplateColumns = plan ? plan.cols.join(" ") : "";
    el.style.gridTemplateRows = plan ? plan.rows.join(" ") : "";
    panes.forEach(function (P, i) {
      var a = plan && plan.areas[i];
      P.el.style.gridArea = a ? a.join(" / ") : "";
      P.el.classList.toggle("pip", !!plan && plan.pip === i);
      ["tl", "tr", "bl", "br"].forEach(function (c) { P.el.classList.toggle("pip-" + c, !!plan && plan.pip === i && plan.corner === c); });
      P.el.classList.toggle("main-pane", !!plan && i < mainCount());
    });
  }
  function setLayout(value, fromCycle) {
    if (LAYOUTS.indexOf(value) < 0) return;
    if (!fromCycle && layoutCycle && layoutCycleMode === "mains" && value === "grid") { layoutCycle = false; scheduleLayoutCycle(); renderLayoutCycle(); toast("Rotating mains needs a Focus or Collage layout, so it was turned off"); }
    else if (!fromCycle && layoutCycle && layoutCycleMode !== "mains") { layoutCycle = false; scheduleLayoutCycle(); renderLayoutCycle(); toast("Cycle layout turned off"); }
    if (value === "collage" && (!fromCycle || !validCollage(collage, feeds.length))) newCollage();
    layout = value; $("#pane-layout").value = layout;
    layoutPanes(); eachPane(renderPane); persist();
    if (!fromCycle && layout !== "grid" && layout !== "smart" && mainCount() === 0) toast(layout === "focus2" ? "Focus 2 needs at least 3 panes" : layout === "collage" ? "Collage needs at least 2 panes" : "Focus 1 needs at least 2 panes");
    renderLayoutCycle();
  }
  // Move this pane's video into a main (large) position.
  function makeMain(i) {
    var k = mainCount(); if (!k || i < k) return;
    var target = k === 1 ? 0 : (lastMainSlot = (lastMainSlot + 1) % k);
    swapFeeds(i, target); showControls(target);
    toast("Pane " + (i + 1) + " is now main");
  }

  // ---------- cycle layout (desktop) ----------
  // Every few seconds: switch to the next layout that suits the pane count
  // (Focus 1, Focus 2, Grid) and rotate the loaded videos so different ones
  // become main. Videos keep playing; only their positions change.
  var layoutCycle = false, layoutSeconds = 30, layoutTimer = null, layoutCycleMode = "all", mainPtr = 0, layoutHeld = false;
  function cycleLayouts() {
    var n = feeds.length, out = [];
    if (n >= 2) out.push("focus1");
    if (n >= 3) out.push("focus2");
    if (n >= 3) out.push("collage");
    out.push("grid");
    return out;
  }
  // Move every loaded video k places towards pane 1; empty panes stay put.
  function rotateLoaded(k) {
    var pos = []; feeds.forEach(function (f, i) { if (f.item) pos.push(i); });
    var m = pos.length; if (m < 2 || !(k % m)) return;
    var vids = pos.map(function (i) { return feeds[i]; }), aud = pos.map(function (i) { return audible[i]; });
    var activeAt = pos.indexOf(active);
    pos.forEach(function (i, j) {
      var from = (j + k) % m;
      feeds[i] = vids[from]; audible[i] = aud[from];
      panes[i].stage.appendChild(vids[from].node);
    });
    if (activeAt >= 0) active = pos[(activeAt - k % m + m) % m]; // sound stays with its video
  }
  // "Mains only": keep the Focus layout and swap the next videos into the main
  // spot(s). Each new main trades places with one small pane, so the rest of
  // the screen stays still and every video gets a turn.
  function rotateMains() {
    var k = mainCount(); if (!k) return false;
    var smalls = []; feeds.forEach(function (f, i) { if (i >= k && f.item) smalls.push(i); });
    if (!smalls.length) return false;
    for (var slot = 0; slot < k && slot < smalls.length; slot++) {
      var from = smalls[(mainPtr + slot) % smalls.length];
      swapFeeds(slot, from);
    }
    mainPtr = (mainPtr + Math.min(k, smalls.length)) % smalls.length;
    return true;
  }
  function stepLayoutCycle() {
    if (!layoutCycle || layoutHeld || !authed || !built || document.hidden || modal) return;
    if (panes.some(function (P) { return P.el.classList.contains("fs"); })) return; // a pane is expanded
    var loaded = feeds.filter(function (f) { return !!f.item; }).length;
    if (loaded < 2) return;
    if (layoutCycleMode === "mains") {
      if (!rotateMains()) return;
      if (!mixAudio && !audioCycle && feeds[0].item) active = 0;
      applyAudio(); eachPane(renderPane); persist();
      return;
    }
    if (layoutCycleMode === "collage") {
      // A brand-new collage each time, with the next videos as its mains.
      if (feeds.length < 2 || !newCollage()) return;
      layout = "collage";
    } else {
      var list = cycleLayouts(), next = list[(list.indexOf(layout) + 1) % list.length];
      if (next === "collage") newCollage();
      layout = next;
    }
    $("#pane-layout").value = layout;
    var k = mainCount(); if (k) rotateLoaded(k);
    // With one soundtrack, the main video is the one you hear.
    if (k && !mixAudio && !audioCycle && feeds[0].item) active = 0;
    applyAudio(); layoutPanes(); eachPane(renderPane); persist(); renderLayoutCycle();
  }
  function scheduleLayoutCycle() {
    clearInterval(layoutTimer); layoutTimer = null;
    if (layoutCycle && authed && built && !document.hidden) layoutTimer = setInterval(stepLayoutCycle, layoutSeconds * 1000);
  }
  function renderLayoutCycle() {
    if (!layoutCycle) layoutHeld = false;
    $("#btn-layout-cycle").setAttribute("aria-pressed", String(layoutCycle));
    var hold = $("#btn-layout-hold"), fl = $("#btn-hold-float");
    hold.hidden = !layoutCycle; hold.setAttribute("aria-pressed", String(layoutHeld));
    hold.textContent = layoutHeld ? "Resume" : "Hold";
    hold.title = layoutHeld ? "Resume cycling (H)" : "Keep this layout for now (H)";
    fl.hidden = !(layoutCycle && immersive); fl.setAttribute("aria-pressed", String(layoutHeld));
    fl.innerHTML = layoutHeld ? IC.play : IC.pause; fl.title = hold.title; fl.setAttribute("aria-label", hold.title);
    $("#btn-new-collage").hidden = !(layout === "collage" && feeds.length >= 2);
    $("#btn-layout-toggle").textContent = "Layout: " + ({ smart: "Smart", grid: "Grid", focus1: "Focus 1", focus2: "Focus 2", collage: "Collage" }[layout] || "Grid") + (layoutCycle ? (layoutHeld ? " (held)" : " (cycling)") : "");
    $("#layout-cycle-mode").value = layoutCycleMode;
    $("#layout-cycle-seconds").value = layoutSeconds;
    scheduleLayoutCycle();
  }
  function cycleOnMessage() {
    return layoutCycleMode === "mains" ? "Main posts change every " + layoutSeconds + "s" : layoutCycleMode === "collage" ? "A new collage every " + layoutSeconds + "s" : "Layouts change every " + layoutSeconds + "s";
  }
  // Hold keeps the current layout and videos where they are until resumed.
  function toggleHold() {
    if (!layoutCycle) return;
    layoutHeld = !layoutHeld; renderLayoutCycle();
    toast(layoutHeld ? "Holding this layout. Press Resume or H to continue" : "Cycling resumed");
  }
  $("#btn-layout-hold").addEventListener("click", toggleHold);
  $("#btn-layout-toggle").addEventListener("click", function () {
    var open = this.getAttribute("aria-expanded") !== "true";
    this.setAttribute("aria-expanded", String(open));
    $("#layout-group").hidden = !open;
  });
  $("#btn-hold-float").addEventListener("click", function (e) { e.stopPropagation(); toggleHold(); });
  document.addEventListener("keydown", function (e) {
    if ((e.key !== "h" && e.key !== "H") || e.ctrlKey || e.metaKey || e.altKey || modal || !authed) return;
    var t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (layoutCycle) { e.preventDefault(); toggleHold(); }
  });
  $("#btn-new-collage").addEventListener("click", function () {
    if (!newCollage()) return;
    var k = mainCount(); if (k) rotateLoaded(k);
    if (k && !mixAudio && !audioCycle && feeds[0].item) active = 0;
    applyAudio(); layoutPanes(); eachPane(renderPane); persist();
  });
  $("#btn-layout-cycle").addEventListener("click", function () {
    layoutCycle = !layoutCycle;
    layoutHeld = false;
    if (layoutCycle && layoutCycleMode === "mains" && !mainCount()) setLayout(feeds.length >= 2 ? "focus1" : "grid", true);
    renderLayoutCycle(); persist();
    toast(layoutCycle ? cycleOnMessage() : "Cycle off");
    if (layoutCycle) stepLayoutCycle();
  });
  $("#layout-cycle-mode").addEventListener("change", function () {
    layoutCycleMode = ["mains", "collage"].indexOf(this.value) >= 0 ? this.value : "all";
    if (layoutCycle && layoutCycleMode === "mains" && !mainCount()) setLayout(feeds.length >= 2 ? "focus1" : "grid", true);
    renderLayoutCycle(); persist();
    if (layoutCycle) toast(cycleOnMessage());
  });
  $("#layout-cycle-seconds").addEventListener("change", function () {
    var v = Number(this.value);
    if (!Number.isInteger(v) || v < 5 || v > 3600) { toast("Choose a layout interval from 5 to 3600 seconds."); this.value = layoutSeconds; return; }
    layoutSeconds = v; renderLayoutCycle(); persist();
  });
  function setPaneCount(n) {
    n = Number(n);
    if (!built || !Number.isInteger(n) || n < 1 || n > MAX_PANES || n === feeds.length) { if (built) $("#pane-count").value = String(feeds.length); return; }
    if (n < feeds.length) {
      var loaded = feeds.slice(n).filter(function (f) { return !!f.item; }).length;
      if (loaded && !window.confirm("Showing " + n + " pane" + (n > 1 ? "s" : "") + " will stop the " + loaded + " loaded post" + (loaded > 1 ? "s" : "") + " in the removed pane" + (loaded > 1 ? "s" : "") + ". Continue?")) {
        $("#pane-count").value = String(feeds.length); return;
      }
      for (var i = feeds.length - 1; i >= n; i--) {
        var f = feeds[i];
        f.shuffle = null; unloadFeed(f); f.item = null;
        clearTimeout(hideTimers[i]); panes[i].el.remove();
        feeds.pop(); panes.pop(); audible.pop(); lastTaps.length = Math.min(lastTaps.length, n); hideTimers.length = Math.min(hideTimers.length, n);
      }
      if (active >= n) active = Math.max(0, feeds.findIndex(function (x) { return x.item; }));
      if (mixAudio && !audible.some(function (a, k) { return a && feeds[k].item; }) && feeds[active].item) audible[active] = true;
      if (!feeds.some(function (x) { return x.item && !x.video.paused; })) $("#resume-banner").hidden = true;
      if (wasPlaying) wasPlaying.length = n;
    } else {
      for (var k = feeds.length; k < n; k++) {
        var nf = newFeed(); feeds.push(nf); audible.push(false); panes.push(buildPane(k));
      }
    }
    layoutPanes(); scheduleAudioCycle(); refreshAudio(); updateWakeLock(); syncInfo();
  }
  (function () {
    var sel = $("#pane-count"); sel.innerHTML = "";
    for (var k = 1; k <= MAX_PANES; k++) sel.appendChild(h("option", { value: String(k), text: String(k) }));
    sel.value = String(DEFAULT_PANES);
  })();
  $("#pane-count").addEventListener("change", function () { setPaneCount(this.value); });
  $("#pane-layout").addEventListener("change", function () { setLayout(this.value); });
  function teardownApp() {
    if (immersive) fillScreen(false);
    clearInterval(statusTimer);
    clearInterval(cycleTimer); cycleTimer = null;
    clearInterval(layoutTimer); layoutTimer = null;
    updateWakeLock();
    if (!built) return;
    clearInterval(renderTimer); renderTimer = null;
    hideTimers.forEach(clearTimeout); hideTimers = []; lastTaps = [];
    $("#resume-banner").hidden = true; wasPlaying = null;
    feeds.forEach(unloadFeed);
    $("#panes").innerHTML = ""; built = false; feeds = []; panes = []; smart = null; syncInfo();
    L.libs = null;
  }

  // ---------- status ----------
  var lastStatus = null, lastToast = null;
  function refreshStatus() {
    api("/api/status").then(function (s) { lastStatus = { ok: !!s.connected, name: s.serverName, msg: s.message }; }).catch(function (e) {
      if (!authed) return; lastStatus = { ok: false, name: null, msg: e.message };
    }).then(renderStatus);
  }
  function renderStatus() {
    if (!lastStatus) return;
    var d = $("#btn-status .dot"); d.dataset.state = lastStatus.ok ? "ok" : "bad";
    $("#status-text").textContent = lastStatus.ok ? (lastStatus.name || "Connected") : "Reddit problem";
    var full = lastStatus.ok ? "Connected" : "Reddit: " + (lastStatus.msg || "not reachable");
    $("#btn-status").title = full; $("#btn-status").setAttribute("aria-label", "Reddit status. " + full);
    if (!lastStatus.ok && lastStatus.msg !== lastToast) { lastToast = lastStatus.msg; toast(full); } else if (lastStatus.ok) lastToast = null;
  }
  function openHelp(opener) {
    var s = $("#help-status"), st = lastStatus;
    s.className = "notice " + (st ? (st.ok ? "good" : "bad") : "");
    s.textContent = st ? (st.ok ? (st.name || "Reddit") + (st.msg ? ". " + st.msg : ".") : "The last Reddit request failed: " + (st.msg || "unknown error")) : "Checking connection";
    var conn = LOCAL.status();
    $("#help-session").textContent = conn.feeds + " feed" + (conn.feeds === 1 ? "" : "s") + " \u00b7 Reddit access: " + conn.access + " \u00b7 " + LOCAL.seenCount() + " posts seen";
    renderDiagnostics();
    refreshStatus();
    openModal($("#help"), opener);
  }
  // ---------- Reddit error log ----------
  function diagnosticLine(d) {
    return d.time + "  GET " + d.endpoint + "  " + (d.status === "network" ? "network error" : d.status === "timeout" ? "timed out" : "HTTP " + d.status) +
      "  access: " + d.access + "  requests in flight " + d.requestsInFlight + "  attempt " + d.attempt + (d.retried ? " (retried)" : " (gave up)") +
      (d.body ? "\n    Reddit said: " + d.body.replace(/\s+/g, " ").slice(0, 300) : "");
  }
  function renderDiagnostics() {
    var list = LOCAL.diagnostics(), box = $("#diag-list");
    $("#diag-count").textContent = list.length ? list.length + " recorded" : "none";
    box.textContent = list.length ? list.map(diagnosticLine).join("\n") : "No Reddit errors recorded on this device.";
    $("#diag-copy").disabled = $("#diag-clear").disabled = !list.length;
  }
  $("#diag-copy").addEventListener("click", function () {
    var text = LOCAL.diagnostics().map(diagnosticLine).join("\n");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast("Error log copied"); }, function () {
      var r = document.createRange(); r.selectNodeContents($("#diag-list")); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Select and copy the highlighted log");
    });
  });
  $("#diag-clear").addEventListener("click", function () { LOCAL.clearDiagnostics(); renderDiagnostics(); });
  LOCAL.onDiagnostic(function () { if (!$("#help").hidden) renderDiagnostics(); });
  $("#btn-help").addEventListener("click", function () { openHelp(this); });
  $("#btn-status").addEventListener("click", function () { openHelp(this); });

  // ---------- global controls ----------
  $("#btn-mix-audio").addEventListener("click", function () { setMixAudio(!mixAudio); });
  $("#btn-audio-cycle").addEventListener("click", function () { setAudioCycle(!audioCycle); });
  $("#audio-cycle-seconds").addEventListener("change", function () { setCycleSeconds(this.value); });
  $("#btn-audio-all").addEventListener("click", function () { setAllAudio(true); });
  $("#btn-audio-none").addEventListener("click", function () { setAllAudio(false); });
  $("#btn-playall").addEventListener("click", function () {
    applyAudio();
    feeds.forEach(function (f, i) { if (f.item) playFeed(i); });
  });
  // Stop and unload every pane; the pane count and audio settings are kept.
  $("#btn-clear-all").addEventListener("click", function () {
    var loaded = feeds.filter(function (f) { return !!f.item; }).length;
    if (!loaded) { toast("Nothing is loaded"); return; }
    if (!window.confirm("Stop and unload all " + loaded + " pane" + (loaded > 1 ? "s" : "") + "?")) return;
    eachPane(function (i) { clearTimeout(feeds[i].skipTimer); feeds[i].skipTimer = null; if (feeds[i].item) clearFeed(i); });
    if (immersive) fillScreen(false);
    eachPane(function (i) { if (panes[i]) panes[i].fsBtn.setAttribute("aria-pressed", "false"); });
    $("#resume-banner").hidden = true; wasPlaying = null;
    if (!mixAudio) active = 0;
    refreshAudio(); updateWakeLock(); syncInfo();
    toast("All panes stopped");
  });
  $("#btn-pauseall").addEventListener("click", function () { feeds.forEach(function (f) { f.advance = null; if (f.item) f.video.pause(); }); });
  $("#hold-seconds").addEventListener("change", function () {
    var v = Number(this.value);
    if (!Number.isInteger(v) || v < 2 || v > 600) { toast("Choose a hold time from 2 to 600 seconds."); this.value = holdSeconds; return; }
    holdSeconds = v; persist();
    // Clips already playing pick up the new hold time.
    feeds.forEach(function (f) {
      if (!f.item || f.still) return;
      var d = f.real.duration;
      f.autoLoop = isFinite(d) && d > 0 && d < holdSeconds; f.real.loop = f.loop || f.autoLoop;
    });
  });
  $("#btn-cover").addEventListener("click", function () {
    coverFit = !coverFit; this.setAttribute("aria-pressed", String(coverFit));
    $("#panes").classList.toggle("cover", coverFit); persist();
    toast(coverFit ? "Panes are filled edge to edge" : "The whole picture is shown");
  });

  // ---------- background / resume ----------
  document.addEventListener("visibilitychange", function () {
    if (!built) return;
    scheduleAudioCycle(); scheduleLayoutCycle(); updateWakeLock();
    if (document.hidden) {
      wasPlaying = feeds.map(function (f) { return !!f.item && (!f.video.paused || !!f.advance); });
      feeds.forEach(function (f) { f.advance = null; if (f.item) { if (!f.video.paused) f.video.pause(); f.needsResume = true; } });
      persist();
      if (wasPlaying.some(Boolean)) $("#resume-banner").hidden = false;
    }
  });
  window.addEventListener("pagehide", function () {
    if (!built) return;
    persist(); clearInterval(cycleTimer);
    feeds.forEach(function (f) { f.advance = null; f.video.pause(); });
    updateWakeLock();
  });
  document.addEventListener("pointerdown", function () { if (authed && wantsWakeLock()) updateWakeLock(); });
  $("#btn-resume").addEventListener("click", function () {
    $("#resume-banner").hidden = true;
    applyAudio();
    feeds.forEach(function (f, i) {
      if (wasPlaying && wasPlaying[i] && f.item) playFeed(i);
    });
    wasPlaying = null;
  });

  // ---------- picker ----------
  var L = { slot: 0, q: "", type: "", parent: "", sort: "hot", favourites: false, seed: "", items: [], start: 0, limit: 30, total: 0, more: false, req: 0, ctrl: null, libs: null, timer: null, unplayed: false };
  function openLibrary(slot, opener) {
    L.slot = slot; $("#sheet-slot").textContent = slot + 1;
    openModal($("#sheet"), opener);
    if (!L.libs) loadLibs();
    loadItems();
  }
  function loadLibs() {
    api("/api/libraries").then(function (libs) {
      L.libs = libs || [];
      if (L.parent && !L.libs.some(function (l) { return l.id === L.parent; })) { L.parent = ""; L.start = 0; loadItems(); }
      var seg = $("#seg-lib"); seg.innerHTML = "";
      seg.hidden = L.libs.length < 2;
      [{ id: "", name: "All feeds" }].concat(L.libs).forEach(function (l) {
        seg.appendChild(h("button", { type: "button", text: l.name, "aria-pressed": String(L.parent === l.id), onclick: function () {
          L.parent = l.id; L.start = 0;
          if (L.sort === "random") L.seed = uuid();
          seg.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b === this)); }, this);
          loadItems();
        } }));
      });
    }).catch(function () { L.libs = null; $("#seg-lib").hidden = true; });
  }
  function loadItems() {
    var body = $("#lib-body"), my = ++L.req, revision = favouriteRevision;
    if (L.ctrl) L.ctrl.abort(); L.ctrl = window.AbortController ? new AbortController() : null;
    body.innerHTML = ""; body.setAttribute("aria-busy", "true");
    for (var k = 0; k < 8; k++) body.appendChild(h("div", { class: "sk-card" }));
    var qs = "parentId=" + encodeURIComponent(L.parent) + "&search=" + encodeURIComponent(L.q) + "&type=" + encodeURIComponent(L.type) + "&startIndex=" + L.start + "&limit=" + L.limit;
    qs += "&sort=" + encodeURIComponent(L.sort) + "&favourites=" + L.favourites + "&unplayed=" + L.unplayed;
    if (L.sort === "random") qs += "&seed=" + encodeURIComponent(L.seed);
    api("/api/items?" + qs, { signal: L.ctrl && L.ctrl.signal }).then(function (r) {
      if (my !== L.req) return;
      if (revision !== favouriteRevision) { loadItems(); return; }
      body.removeAttribute("aria-busy"); body.innerHTML = "";
      L.items = r.items || [];
      L.items.forEach(function (it) {
        feeds.forEach(function (f) { if (f.item && f.item.id === it.id && !favouritePending.has(it.id)) f.item.isFavourite = it.isFavourite; });
      });
      eachPane(renderPane);
      L.total = r.total || 0; L.more = !!r.more;
      if (!r.items || !r.items.length) {
        var filtered = L.q || L.type || L.favourites || L.unplayed;
        body.appendChild(h("div", { class: "state" }, [h("b", { text: L.favourites ? "No matching favourites" : filtered ? "Nothing matches" : "Nothing to play here" }), h("span", { text: L.favourites ? "Use a post's heart button to save it as a favourite, or clear the other filters." : filtered ? "Try a different search or clear the filters." : "Reddit returned no videos, GIFs or images for this feed." })]));
      } else r.items.forEach(function (it, n) { body.appendChild(itemCard(it, n)); });
      pager();
    }).catch(function (e) {
      if (my !== L.req || (e && e.name === "AbortError")) return;
      body.removeAttribute("aria-busy"); body.innerHTML = "";
      body.appendChild(h("div", { class: "state" }, [h("b", { text: "Could not load posts" }), h("span", { text: e.message }), h("button", { class: "chip", type: "button", text: "Try again", onclick: loadItems }), h("button", { class: "chip", type: "button", text: "Feeds and Reddit access", onclick: function () { requireMediaConnection(); } })]));
      L.total = 0; L.more = false; pager();
    });
  }
  function itemCard(it, n) {
    var th = h("div", { class: "th" });
    if (it.imageUrl) th.style.backgroundImage = "url(\"" + it.imageUrl.replace(/"/g, "%22") + "\")";
    var sub = [it.seriesName, { video: "Video", gif: "GIF", image: "Image" }[it.type], it.duration ? fmt(it.duration) : null].filter(Boolean).join(" · ");
    var b = h("button", { class: "it", type: "button", style: "animation-delay:" + Math.min(n, 12) * 25 + "ms", "aria-label": "Play " + it.name + (it.seriesName ? ", " + it.seriesName : "") + " in pane " + (L.slot + 1), onclick: function () {
      var slot = L.slot; closeModal();
      if (!mixAudio && !feeds[active].item) setActive(slot);
      loadItem(slot, it, 0, true, false, pickerScope());
      showControls(slot);
    } }, [th, h("b", { text: it.name }), h("small", { text: sub })]);
    var favourite = h("button", { class: "favourite-toggle favourite-button", type: "button", "data-favourite-id": it.id, html: IC.heart, onclick: function (e) { e.stopPropagation(); toggleFavourite(it); } });
    updateFavouriteButton(favourite, it);
    return h("div", { class: "it-wrap" }, [b, favourite]);
  }
  function pager() {
    var p = $("#pg-prev"), n = $("#pg-next");
    p.disabled = L.start <= 0; n.disabled = L.start + L.limit >= L.total;
    $("#pg-info").textContent = L.total > L.start ? (L.start + 1) + "-" + Math.min(L.total, L.start + L.limit) + " of " + L.total + (L.more ? "+" : "") : "0 results";
  }
  $("#pg-prev").addEventListener("click", function () { L.start = Math.max(0, L.start - L.limit); loadItems(); $("#lib-body").scrollTop = 0; });
  $("#pg-next").addEventListener("click", function () { L.start += L.limit; loadItems(); $("#lib-body").scrollTop = 0; });
  $("#lib-sort").addEventListener("change", function () {
    L.sort = this.value; L.start = 0;
    if (L.sort === "random") L.seed = uuid();
    $("#lib-shuffle").hidden = L.sort !== "random";
    loadItems();
  });
  // ---------- shuffle into all panes ----------
  // Loads a different random post into every pane from one selection
  // (feed, search, type, favourites). Each pane keeps shuffling within it.
  var LAST_SCOPE = "redditview.lastShuffleScope.v1", filling = false;
  function pickerScope() {
    return libraryScope({ parentId: L.parent, search: L.q, type: L.type, favourites: L.favourites, unplayed: L.unplayed });
  }
  // A short description of a selection, e.g. "Cats · GIFs · Unseen".
  function scopeLabel(scope) {
    var parts = [], lib = scope.parentId && (L.libs || []).find(function (l) { return l.id === scope.parentId; });
    parts.push(scope.parentId ? (lib ? lib.name : "One feed") : "All feeds");
    if (scope.type) parts.push({ video: "Videos", gif: "GIFs", image: "Images" }[scope.type]);
    if (scope.search) parts.push("\u201c" + scope.search + "\u201d");
    if (scope.favourites) parts.push("Favourites");
    if (scope.unplayed) parts.push("Unseen");
    return parts.join(" \u00b7 ");
  }
  function savedShuffle() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LAST_SCOPE)); } catch (e) { saved = null; }
    if (!saved || typeof saved !== "object") return null;
    // Older saves held only the selection; newer ones also keep its label.
    var scope = libraryScope(saved.scope && typeof saved.scope === "object" ? saved.scope : saved);
    return { scope: scope, label: typeof saved.label === "string" && saved.label ? saved.label.slice(0, 200) : scopeLabel(scope) };
  }
  function renderShuffleButton() {
    var saved = savedShuffle(), b = $("#btn-shuffle-all");
    b.textContent = saved ? "Shuffle: " + saved.label : "Shuffle all";
    b.title = saved ? "Load a shuffled post into every pane from: " + saved.label : "Choose a feed or filters, then shuffle every pane";
    b.setAttribute("aria-label", b.title);
  }
  function fillAllPanes(scope, label) {
    if (filling || !authed || !feeds.length) return;
    scope = libraryScope(scope); label = label || scopeLabel(scope);
    try { localStorage.setItem(LAST_SCOPE, JSON.stringify({ scope: scope, label: label })); } catch (e) { /* storage unavailable */ }
    renderShuffleButton();
    filling = true; $("#btn-shuffle-all").disabled = true; $("#lib-fill-all").disabled = true;
    var path = "/api/items?sort=random&seed=" + encodeURIComponent(uuid()) + "&startIndex=0&limit=" + Math.min(100, Math.max(feeds.length * 3, 30));
    path += scopeQuery(scope);
    toast("Shuffling " + feeds.length + " pane" + (feeds.length > 1 ? "s" : "") + ": " + label);
    api(path).then(function (page) {
      var list = page && page.items || [];
      if (!list.length) { toast("No posts match " + label + "."); return; }
      if (!feeds[active] || (!mixAudio && active >= feeds.length)) active = 0;
      applyAudio();
      var spare = { items: list.slice() };
      feeds.forEach(function (f, i) {
        // Different posts per pane where the selection has enough of them.
        // Smart fit then shapes the frames around them; in the other
        // layouts each pane takes a post that suits its frame.
        if (!spare.items.length) spare.items = list.slice();
        loadItem(i, layout === "smart" ? spare.items.shift() : takeNext(f, spare), 0, true, false, scope);
        f.fromShuffle = true; f.failStreak = 0;
      });
      eachPane(renderPane); persist(); updateWakeLock();
      if (list.length < feeds.length) toast("Only " + list.length + " matching post" + (list.length > 1 ? "s" : "") + "; some repeat.");
    }).catch(function (e) {
      toast("Could not shuffle: " + e.message);
    }).finally(function () {
      filling = false; $("#btn-shuffle-all").disabled = false; $("#lib-fill-all").disabled = false;
    });
  }
  $("#lib-fill-all").addEventListener("click", function () {
    var scope = pickerScope(), label = scopeLabel(scope); closeModal(); fillAllPanes(scope, label);
  });
  $("#btn-shuffle-all").addEventListener("click", function () {
    var saved = savedShuffle();
    if (saved) fillAllPanes(saved.scope, saved.label);
    else { toast("Choose a feed or filters, then tap Shuffle into all panes."); openLibrary(active, this); }
  });
  renderShuffleButton();
  $("#lib-shuffle").addEventListener("click", function () {
    L.seed = uuid(); L.start = 0; loadItems();
  });
  $("#lib-unplayed").addEventListener("click", function () {
    L.unplayed = !L.unplayed; L.start = 0;
    if (L.sort === "random") L.seed = uuid();
    this.setAttribute("aria-pressed", String(L.unplayed));
    loadItems();
  });
  $("#lib-favourites").addEventListener("click", function () {
    L.favourites = !L.favourites; L.start = 0;
    if (L.sort === "random") L.seed = uuid();
    this.setAttribute("aria-pressed", String(L.favourites));
    $("#lib-favourites-note").hidden = !L.favourites;
    loadItems();
  });
  $("#lib-search").addEventListener("input", function () {
    clearTimeout(L.timer); var v = this.value.trim();
    L.timer = setTimeout(function () { L.q = v; L.start = 0; loadItems(); }, 300);
  });
  $("#seg-type").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    L.type = b.dataset.type; L.start = 0;
    this.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    loadItems();
  });

  // ---------- misc ----------
  function net() { $("#offline").hidden = navigator.onLine; }
  window.addEventListener("online", function () { net(); if (authed) refreshStatus(); });
  window.addEventListener("offline", net); net();
  document.addEventListener("contextmenu", function (e) { if (e.target.closest && e.target.closest(".pane")) e.preventDefault(); });
  if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  $("#btn-edit-feeds").addEventListener("click", function () { requireMediaConnection(); });
  $("#seen-clear").addEventListener("click", function () { LOCAL.clearSeen(); toast("Seen posts forgotten"); });
  MEDIA.init({ show: show, needed: requireMediaConnection });
  boot();
})();