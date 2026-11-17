(function (root) {
  "use strict";
  // Small player adapter. Plain files (MP4, WebM) play natively everywhere.
  // Reddit-hosted videos with sound are HLS: Safari plays that natively, other
  // browsers load hls.js the first time one is needed.
  function detect(nav, native, mediaSource) {
    var ua = nav.userAgent || "", platform = nav.platform || "";
    var ios = /iPad|iPhone|iPod/i.test(ua) || (/Mac/i.test(platform) && nav.maxTouchPoints > 1);
    var mobile = ios || /Android|Mobile/i.test(ua);
    var safari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);
    var mse = false;
    try { mse = !!(mediaSource && mediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')); } catch (_) {}
    // Only Safari's own HLS is used natively; elsewhere hls.js is more dependable.
    return { desktop: !mobile && !safari, ios: ios, native: !!native && (safari || ios || !mse), mse: mse };
  }
  var profile = detect(root.navigator, root.document.createElement("video").canPlayType("application/vnd.apple.mpegurl"), root.MediaSource);

  var library = null;
  function getLibrary() {
    if (root.Hls) return Promise.resolve(root.Hls);
    if (library) return library;
    library = new Promise(function (resolve, reject) {
      var script = root.document.createElement("script"), settled = false;
      var timer = root.setTimeout(function () { finish(new Error("The video engine timed out while loading. Retry this post.")); }, 15000);
      function finish(error) {
        if (settled) return; settled = true;
        root.clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve(root.Hls);
      }
      script.src = "vendor/hls.min.js"; script.async = true;
      script.onload = function () { finish(root.Hls ? null : new Error("The video engine did not load. Retry this post.")); };
      script.onerror = function () { finish(new Error("The video engine could not load. Check your connection and retry.")); };
      root.document.head.appendChild(script);
    }).catch(function (error) { library = null; throw error; });
    return library;
  }
  function safe(url) {
    try { var u = new URL(url, root.location.href); return u.protocol === "https:" || (u.protocol === "http:" && root.location.protocol === "http:"); }
    catch (_) { return false; }
  }

  // options: hls (bool), onError(message), onBlocked()
  function attach(video, url, options) {
    options = options || {};
    var disposed = false, engine = null, timer = null, recovered = false, ready;
    function destroy() {
      if (disposed) return;
      disposed = true;
      root.clearTimeout(timer);
      if (engine) { try { engine.destroy(); } catch (_) {} engine = null; }
      video.pause(); video.removeAttribute("src"); video.load();
    }
    function fail(message) {
      if (disposed) return;
      destroy();
      if (options.onError) options.onError(message);
    }
    if (!safe(url)) {
      ready = Promise.reject(new Error("This post's media address is not a secure web address."));
    } else if (!options.hls || profile.native) {
      // Failures surface through the video element's own error event.
      video.src = url; video.load();
      ready = Promise.resolve();
    } else if (!profile.mse) {
      ready = Promise.reject(new Error("This browser cannot play Reddit-hosted video with sound."));
    } else {
      ready = getLibrary().then(function (Hls) {
        if (disposed) return;
        if (!Hls.isSupported()) throw new Error("This browser cannot play Reddit-hosted video with sound.");
        return new Promise(function (resolve) {
          timer = root.setTimeout(function () { fail("This video took too long to start."); }, 30000);
          engine = new Hls({
            enableWorker: true, maxBufferLength: 12, maxMaxBufferLength: 20, backBufferLength: 10,
            maxBufferSize: 12000000, capLevelToPlayerSize: true,
            xhrSetup: function (xhr, target) {
              if (!safe(target)) throw new Error("Media destination rejected.");
              xhr.withCredentials = false;
            }
          });
          engine.on(Hls.Events.ERROR, function (_event, data) {
            if (disposed || !data.fatal) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
              recovered = true;
              try { engine.recoverMediaError(); return; } catch (_) {}
            }
            fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? "This video could not be loaded. It may have been removed." : "This video could not be decoded.");
          });
          engine.on(Hls.Events.MEDIA_ATTACHED, function () { if (!disposed) engine.loadSource(url); });
          engine.on(Hls.Events.MANIFEST_PARSED, function () { root.clearTimeout(timer); resolve(); });
          engine.attachMedia(video);
        });
      });
    }
    ready.catch(function (error) { fail(error.message || "This post could not start."); });
    function play() {
      if (disposed) return Promise.reject(Object.assign(new Error("Playback cancelled."), { name: "AbortError" }));
      return ready.then(function () {
        if (disposed) throw Object.assign(new Error("Playback cancelled."), { name: "AbortError" });
        return video.play();
      }).catch(function (error) {
        if (!disposed && error && error.name === "NotAllowedError" && options.onBlocked) options.onBlocked();
        throw error;
      });
    }
    return { play: play, destroy: destroy };
  }

  root.TVPlayback = { detect: detect, profile: profile, attach: attach };
})(window);
