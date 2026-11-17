// Triple View Reddit's data layer, running entirely in the browser.
// Every request goes straight from this device to Reddit (and to Redgifs for
// Redgifs posts). Nothing is relayed through a third party.
(function (root) {
  "use strict";
  var SETTINGS_KEY = "redditview.settings.v1";
  var AUTH_KEY = "redditview.auth.v1";
  var DEVICE_KEY = "redditview.device.v1";
  var FAV_KEY = "redditview.favourites.v1";
  var SEEN_KEY = "redditview.seen.v1";
  var DIAG_KEY = "redditview.diagnostics.v1";
  var RG_KEY = "redditview.redgifs.v1";
  var OAUTH_KEY = "redditview.oauth.v1";
  var MAX_FEEDS = 40, MAX_FAVOURITES = 2000, MAX_SEEN = 8000;

  // ---------- errors ----------
  function ApiError(message, status, code, extra) {
    var e = new Error(message);
    e.status = status || 502; e.code = code || "REQUEST_FAILED";
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }
  function required(message) {
    return ApiError(message || "Add at least one subreddit or custom feed to continue.", 428, "CONNECTION_REQUIRED");
  }

  // ---------- storage ----------
  function read(key) { try { return JSON.parse(root.localStorage.getItem(key)); } catch (_) { return null; } }
  function write(key, value) {
    try { if (value == null) root.localStorage.removeItem(key); else root.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage unavailable */ }
  }
  function randomHex(bytes) {
    var a = new Uint8Array(bytes); root.crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function hash32(text) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var deviceId = read(DEVICE_KEY);
  if (typeof deviceId !== "string" || !/^[0-9a-f]{24}$/.test(deviceId)) { deviceId = randomHex(12); write(DEVICE_KEY, deviceId); }

  // ---------- feeds ----------
  // One feed per line. Accepted forms:
  //   pics            r/pics            r/pics+gifs+aww       pics, gifs, aww
  //   u/name/m/feed   https://www.reddit.com/user/name/m/feed/   me/m/feed
  //   u/name          (that account's posts)
  //   My label = r/pics+gifs
  function parseFeed(line) {
    var text = String(line || "").trim(), label = "";
    if (!text || text[0] === "#") return null;
    var eq = text.match(/^([^=]{1,60})=\s*(.+)$/);
    if (eq && !/[\/:?]/.test(eq[1])) { label = eq[1].trim(); text = eq[2].trim(); }
    var original = text;
    text = text.replace(/^https?:\/\/(?:[a-z0-9-]+\.)?reddit\.com/i, "").replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
    var m;
    if ((m = text.match(/^(?:u|user)\/([A-Za-z0-9_-]{1,40})\/m\/([A-Za-z0-9_]{1,60})(?:\/.*)?$/i))) {
      return feed("user/" + m[1] + "/m/" + m[2], label || m[2].replace(/_/g, " "), "multi");
    }
    if ((m = text.match(/^me\/m\/([A-Za-z0-9_]{1,60})(?:\/.*)?$/i))) return feed("me/m/" + m[1], label || m[1].replace(/_/g, " "), "multi");
    if ((m = text.match(/^(?:u|user)\/([A-Za-z0-9_-]{1,40})(?:\/(?:submitted|posts))?$/i))) return feed("user/" + m[1] + "/submitted", label || "u/" + m[1], "user");
    // A list of subreddits: "a+b", "a, b", "r/a r/b".
    var list = text.replace(/(^|[\s,+])\/?r\//gi, "$1").replace(/\/.*$/, "").split(/[\s,+]+/).filter(Boolean);
    if (list.length && list.length <= 100 && list.every(function (s) { return /^[A-Za-z0-9_]{2,40}$/.test(s); })) {
      var auto = list.length > 3 ? "r/" + list[0] + " +" + (list.length - 1) : "r/" + list.join(" + ");
      return feed("r/" + list.join("+"), label || auto, "subs");
    }
    throw ApiError("“" + original.slice(0, 60) + "” is not a subreddit or custom feed. Use a name like pics, r/pics+gifs, or a custom feed address such as reddit.com/user/name/m/feed.", 400, "FEED_INVALID");
  }
  function feed(path, label, kind) { return { id: "f" + hash32(path.toLowerCase()).toString(36), path: path, label: String(label).slice(0, 60), kind: kind }; }
  function parseFeeds(text) {
    var out = [], seen = {};
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var f = parseFeed(line);
      if (f && !seen[f.id]) { seen[f.id] = true; out.push(f); }
    });
    if (out.length > MAX_FEEDS) throw ApiError("Use up to " + MAX_FEEDS + " feeds. Combine subreddits on one line with +.", 400, "FEED_INVALID");
    return out;
  }
  function feedLine(f) {
    var path = f.kind === "user" ? "u/" + f.path.split("/")[1] : f.path.replace(/^user\//, "u/");
    var auto; try { auto = parseFeed(path).label; } catch (_) { auto = ""; }
    return f.label && f.label !== auto ? f.label + " = " + path : path;
  }

  var settings = read(SETTINGS_KEY);
  if (!settings || !Array.isArray(settings.feeds)) {
    settings = { feeds: [], clientId: "" };
    var cfg = root.TVConfig || {};
    try { settings.feeds = parseFeeds((cfg.feeds || []).join("\n")); } catch (_) { settings.feeds = []; }
    settings.clientId = typeof cfg.redditClientId === "string" ? cfg.redditClientId.trim() : "";
  }
  settings.feeds = settings.feeds.filter(function (f) { return f && typeof f.id === "string" && typeof f.path === "string"; });
  settings.clientId = typeof settings.clientId === "string" ? settings.clientId : "";
  // Only "web app" and "personal use script" Reddit apps have a secret. It is
  // kept in this browser only and sent only to Reddit; never put one in config.js.
  settings.clientSecret = typeof settings.clientSecret === "string" ? settings.clientSecret : "";
  function configured() { return settings.feeds.length > 0; }
  function saveSettings(input) {
    var feeds = parseFeeds(input.feedsText);
    if (!feeds.length && !input.allowEmpty) throw ApiError("Add at least one subreddit or custom feed.", 400, "FEED_INVALID");
    var clientId = String(input.clientId || "").trim();
    if (clientId && !/^[A-Za-z0-9_-]{10,40}$/.test(clientId)) throw ApiError("That does not look like a Reddit app ID. It is the short code shown under the app's name on reddit.com/prefs/apps.", 400, "CLIENT_ID");
    var clientSecret = clientId ? String(input.clientSecret || "").trim() : "";
    if (clientSecret && !/^[A-Za-z0-9_-]{16,80}$/.test(clientSecret)) throw ApiError("That does not look like a Reddit app secret. It is the longer code shown next to “secret” when you edit the app on reddit.com/prefs/apps.", 400, "CLIENT_ID");
    if (clientId !== settings.clientId || clientSecret !== settings.clientSecret) { auth = null; write(AUTH_KEY, null); }
    settings = { feeds: feeds, clientId: clientId, clientSecret: clientSecret };
    write(SETTINGS_KEY, settings);
    listings.clear(); randomState.clear();
    lastState = null;
    return status();
  }

  // ---------- diagnostics ----------
  var diagnostics = read(DIAG_KEY);
  if (!Array.isArray(diagnostics)) diagnostics = [];
  var listeners = [];
  function recordDiagnostic(entry) {
    diagnostics.unshift(entry);
    diagnostics.length = Math.min(diagnostics.length, 60);
    write(DIAG_KEY, diagnostics);
    listeners.forEach(function (fn) { try { fn(entry); } catch (_) {} });
  }

  // ---------- Reddit sign-in (optional) ----------
  // Three ways to reach Reddit, chosen by what is set up:
  //   1. no app ID: Reddit's public pages, read without signing in;
  //   2. an app ID: an app-only token (public feeds, higher limits);
  //   3. an app ID and Sign in with Reddit: your own account, so private
  //      custom feeds work. The refresh token stays on this device.
  var auth = read(AUTH_KEY);
  if (!auth || typeof auth !== "object" || auth.clientId !== settings.clientId) auth = null;
  var tokenJob = null;
  function redirectURI() { return new URL("./", root.location.href).href.replace(/[?#].*$/, ""); }
  function basic(clientId) { return "Basic " + root.btoa(clientId + ":" + (clientId === settings.clientId ? settings.clientSecret : "")); }
  async function tokenRequest(params, clientId) {
    var response;
    try {
      response = await root.fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
        headers: { Authorization: basic(clientId), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString()
      });
    } catch (_) {
      throw ApiError("Reddit's sign-in service could not be reached. Check your connection and try again.", 502, "REDDIT_NETWORK", { retryable: true });
    }
    var data = null;
    try { data = await response.json(); } catch (_) { data = null; }
    if (response.status === 401) throw ApiError(settings.clientSecret ? "Reddit did not accept this app ID and secret. Check both against reddit.com/prefs/apps." : "Reddit did not accept this app ID. Check it against reddit.com/prefs/apps. A “web app” or “personal use script” also needs its secret.", 401, "CLIENT_ID");
    if (!response.ok || !data || data.error || !data.access_token) {
      throw ApiError("Reddit sign-in failed" + (data && data.error ? " (" + String(data.error).slice(0, 80) + ")" : " (HTTP " + response.status + ")") + ".", 502, "REDDIT_AUTH", { grantError: data && data.error });
    }
    return data;
  }
  function storeToken(data, mode, clientId, keep) {
    auth = {
      clientId: clientId, mode: mode, access: data.access_token,
      exp: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
      refresh: data.refresh_token || (keep && keep.refresh) || null,
      user: keep && keep.user || ""
    };
    write(AUTH_KEY, auth);
  }
  function accessToken(force) {
    var clientId = settings.clientId;
    if (!clientId) return Promise.resolve(null);
    if (!force && auth && auth.access && auth.exp > Date.now() + 60000) return Promise.resolve(auth.access);
    if (tokenJob) return tokenJob;
    tokenJob = (async function () {
      if (auth && auth.mode === "user" && auth.refresh) {
        try {
          storeToken(await tokenRequest({ grant_type: "refresh_token", refresh_token: auth.refresh }, clientId), "user", clientId, auth);
          return auth.access;
        } catch (error) {
          if (error.code !== "REDDIT_AUTH") throw error;
          // The sign-in was revoked: carry on with app-only access to public feeds.
          auth = null; write(AUTH_KEY, null);
        }
      }
      // An app with a secret asks for app-only access in its own name; an installed app does so per device.
      var grant = settings.clientSecret ? { grant_type: "client_credentials" } : { grant_type: "https://oauth.reddit.com/grants/installed_client", device_id: deviceId };
      storeToken(await tokenRequest(grant, clientId), "app", clientId, null);
      return auth.access;
    })();
    tokenJob.then(function () { tokenJob = null; }, function () { tokenJob = null; });
    return tokenJob;
  }
  function beginSignIn() {
    if (!settings.clientId) throw ApiError("Enter your Reddit app ID first.", 400, "CLIENT_ID");
    var state = randomHex(16);
    write(OAUTH_KEY, { state: state, clientId: settings.clientId, at: Date.now() });
    var url = new URL("https://www.reddit.com/api/v1/authorize");
    url.search = new URLSearchParams({
      client_id: settings.clientId, response_type: "code", state: state, redirect_uri: redirectURI(),
      duration: "permanent", scope: "read identity"
    }).toString();
    root.location.assign(url.href);
  }
  // Called once at start-up: finishes a sign-in if Reddit just sent the browser back here.
  async function completeSignIn() {
    var query = new URLSearchParams(root.location.search);
    if (!query.has("state") || !(query.has("code") || query.has("error"))) return null;
    var pending = read(OAUTH_KEY); write(OAUTH_KEY, null);
    try { root.history.replaceState(null, "", redirectURI()); } catch (_) { /* address stays as it is */ }
    if (!pending || pending.state !== query.get("state") || pending.clientId !== settings.clientId || Date.now() - pending.at > 30 * 60000) {
      return { ok: false, message: "That Reddit sign-in was not started here, or took too long. Try again." };
    }
    if (query.has("error")) {
      return { ok: false, message: query.get("error") === "access_denied" ? "Reddit sign-in was cancelled." : "Reddit sign-in failed (" + String(query.get("error")).slice(0, 60) + ")." };
    }
    try {
      var data = await tokenRequest({ grant_type: "authorization_code", code: query.get("code"), redirect_uri: redirectURI() }, settings.clientId);
      storeToken(data, "user", settings.clientId, null);
      try {
        var me = await redditGet("api/v1/me", {});
        if (me && me.name) { auth.user = String(me.name).slice(0, 40); write(AUTH_KEY, auth); }
      } catch (_) { /* the name is only a label */ }
      listings.clear(); randomState.clear();
      return { ok: true, message: "Signed in to Reddit" + (auth.user ? " as u/" + auth.user : "") + "." };
    } catch (error) {
      return { ok: false, message: error.message + (error.code === "REDDIT_AUTH" ? " Check that the app's redirect address on reddit.com/prefs/apps is exactly " + redirectURI() : "") };
    }
  }
  async function signOut() {
    var old = auth; auth = null; write(AUTH_KEY, null);
    listings.clear(); randomState.clear();
    if (old && old.refresh) {
      try {
        await root.fetch("https://www.reddit.com/api/v1/revoke_token", {
          method: "POST", mode: "cors", credentials: "omit",
          headers: { Authorization: basic(old.clientId), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: old.refresh, token_type_hint: "refresh_token" }).toString()
        });
      } catch (_) { /* already signed out on this device */ }
    }
  }
  async function importMultis() {
    if (!auth || auth.mode !== "user") throw ApiError("Sign in with Reddit to import your custom feeds.", 400);
    var list = await redditGet("api/multi/mine", {});
    return (Array.isArray(list) ? list : []).map(function (m) {
      var d = m && m.data || {}, path = String(d.path || "").replace(/^\/+|\/+$/g, "");
      if (!/^user\/[A-Za-z0-9_-]+\/m\/[A-Za-z0-9_]+$/.test(path)) return null;
      var name = String(d.display_name || d.name || "").trim();
      return (name ? name + " = " : "") + path.replace(/^user\//, "u/");
    }).filter(Boolean);
  }

  // ---------- requests ----------
  // Listing requests go through a small queue so many panes starting together
  // do not trip Reddit's rate limit.
  var CONCURRENCY = 2, GAP = 150;
  var queue = [], running = 0, lastStart = 0, inFlight = 0, lastState = null;
  function pump() {
    if (!queue.length || running >= CONCURRENCY) return;
    var wait = lastStart + GAP - Date.now();
    if (wait > 0) { setTimeout(pump, wait); return; }
    var job = queue.shift();
    running++; lastStart = Date.now();
    Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(function () { running--; pump(); });
    pump();
  }
  function queued(run) { return new Promise(function (resolve, reject) { queue.push({ run: run, resolve: resolve, reject: reject }); pump(); }); }

  async function redditOnce(path, query) {
    var token = await accessToken();
    var url = new URL(token ? "https://oauth.reddit.com/" + path : "https://www.reddit.com/" + path + ".json");
    Object.keys(query).forEach(function (k) { if (query[k] !== undefined && query[k] !== null && query[k] !== "") url.searchParams.set(k, String(query[k])); });
    url.searchParams.set("raw_json", "1");
    inFlight++;
    var timeout = new AbortController(), timer = setTimeout(function () { timeout.abort(); }, 20000), response;
    try {
      try {
        response = await root.fetch(url.href, {
          mode: "cors", credentials: "omit", cache: "no-store", signal: timeout.signal,
          headers: token ? { Authorization: "Bearer " + token } : {}
        });
      } catch (_) {
        var timedOut = timeout.signal.aborted;
        throw ApiError(timedOut ? "Reddit did not answer in time." : token ? "Reddit could not be reached. Check your connection." :
          "Reddit could not be reached without a sign-in from this browser. Check your connection, or add a Reddit app ID under Feeds.",
          502, "REDDIT_NETWORK", { retryable: true, context: { status: timedOut ? "timeout" : "network" } });
      }
      var text = "";
      try { text = await response.text(); } catch (_) { text = ""; }
      var ctx = { status: response.status, body: /^\s*</.test(text) ? "(a web page, not data)" : text.slice(0, 300) };
      if (response.ok) {
        try { return JSON.parse(text); }
        catch (_) { throw ApiError("Reddit returned a web page instead of data. It may be asking this browser to sign in; add a Reddit app ID under Feeds.", 502, "REDDIT_BLOCKED", { context: ctx }); }
      }
      if (response.status === 401 && token) throw ApiError("Reddit sign-in expired.", 401, "REDDIT_TOKEN", { context: ctx });
      if (response.status === 429) {
        var reset = Number(response.headers.get("x-ratelimit-reset")) || Number(response.headers.get("retry-after")) || 10;
        throw ApiError("Reddit is limiting requests from this device. Wait a minute" + (token ? "." : ", or add a Reddit app ID under Feeds for a higher limit."), 429, "REDDIT_LIMIT", { retryable: true, wait: reset, context: ctx });
      }
      if (response.status === 403) {
        throw ApiError(token ? "Reddit refused this feed. It may be private, quarantined or banned" + (auth && auth.mode === "user" ? "." : "; sign in with Reddit under Feeds to open private feeds.") :
          "Reddit blocked this request because this browser is not signed in. Add a Reddit app ID under Feeds.", 403, token ? "REDDIT_FORBIDDEN" : "REDDIT_BLOCKED", { context: ctx });
      }
      if (response.status === 404) throw ApiError("Reddit could not find this feed. Check its name" + (auth && auth.mode === "user" ? "." : "; a private custom feed needs Sign in with Reddit."), 404, "REDDIT_NOT_FOUND", { context: ctx });
      throw ApiError("Reddit returned an error (HTTP " + response.status + ").", 502, "REDDIT_HTTP", { retryable: response.status >= 500, context: ctx });
    } finally { clearTimeout(timer); inFlight--; }
  }
  async function redditGet(path, query) {
    var attempt = 0, refreshed = false;
    for (;;) {
      try {
        var data = await queued(function () { return redditOnce(path, query || {}); });
        lastState = { ok: true, message: "" };
        return data;
      } catch (error) {
        if (error.code === "REDDIT_TOKEN" && !refreshed) {
          refreshed = true;
          try { await accessToken(true); continue; } catch (e) { error = e; }
        }
        var willRetry = !!error.retryable && attempt < 2 && !(error.wait > 20);
        if (error.context) {
          recordDiagnostic({
            time: new Date().toISOString(), endpoint: "/" + path, status: error.context.status, body: error.context.body || "",
            access: settings.clientId ? (auth && auth.mode === "user" ? "signed in" : "app ID") : "no sign-in",
            requestsInFlight: inFlight, attempt: attempt + 1, retried: willRetry
          });
        }
        if (!willRetry) { lastState = { ok: false, message: error.message }; throw error; }
        attempt++;
        await sleep(error.wait ? Math.min(20, error.wait) * 1000 + 300 : Math.min(8000, 700 * Math.pow(2, attempt - 1)) + Math.random() * 400);
      }
    }
  }

  // ---------- turning posts into playable items ----------
  // item: { id, name, type: "video"|"gif"|"image", seriesName: "r/sub", author,
  //         link, duration, w, h, audio, imageUrl, nsfw,
  //         media: { kind: "hls"|"mp4"|"img"|"redgifs", url, alt, rg } }
  function http(url) { return typeof url === "string" && /^https:\/\//i.test(url) ? url : ""; }
  function thumbOf(pv, fallback) {
    if (pv) {
      var list = (pv.resolutions || []).filter(function (r) { return http(r.url); });
      var pick = list.find(function (r) { return r.width >= 320; }) || list[list.length - 1] || pv.source;
      if (pick && http(pick.url)) return pick.url;
    }
    return http(fallback);
  }
  // A still for display: the full image, unless it is far larger than any pane.
  function stillOf(pv, direct) {
    if (pv && pv.source && http(pv.source.url)) {
      if (pv.source.width <= 2600) return pv.source.url;
      var list = (pv.resolutions || []).filter(function (r) { return http(r.url); });
      if (list.length) return list[list.length - 1].url;
      return pv.source.url;
    }
    return http(direct);
  }
  function extract(child) {
    var d = child && child.data;
    if (!d || child.kind !== "t3" || !d.id || d.stickied || d.removed_by_category || d.promoted) return [];
    // A crosspost carries its media on the original post.
    var s = Array.isArray(d.crosspost_parent_list) && d.crosspost_parent_list[0] ? d.crosspost_parent_list[0] : d;
    var id = String(d.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    if (!id) return [];
    var base = {
      name: String(d.title || "Untitled").slice(0, 300), seriesName: "r/" + String(d.subreddit || ""), author: String(d.author || ""),
      link: "https://www.reddit.com" + String(d.permalink || ""), nsfw: !!d.over_18
    };
    function item(suffix, type, media, w, h, duration, audio, thumb) {
      return Object.assign({}, base, {
        id: id + suffix, type: type, media: media, w: Math.round(Number(w) || 0), h: Math.round(Number(h) || 0),
        duration: Number(duration) || 0, audio: !!audio, imageUrl: thumb || "", isFavourite: false
      });
    }
    var pv = s.preview && Array.isArray(s.preview.images) && s.preview.images[0] || null;
    var pvw = pv && pv.source ? pv.source.width : 0, pvh = pv && pv.source ? pv.source.height : 0;
    var thumb = thumbOf(pv, s.thumbnail);
    var url = String(s.url_overridden_by_dest || s.url || "");
    var rv = (s.secure_media && s.secure_media.reddit_video) || (s.media && s.media.reddit_video) || null;
    var rvp = s.preview && s.preview.reddit_video_preview || null;
    var m;

    if (rv && (http(rv.hls_url) || http(rv.fallback_url))) {
      var silent = !!rv.is_gif || rv.has_audio === false || !http(rv.hls_url);
      var media = silent && http(rv.fallback_url) ? { kind: "mp4", url: rv.fallback_url } : { kind: "hls", url: rv.hls_url, alt: http(rv.fallback_url) };
      return [item("", rv.is_gif ? "gif" : "video", media, rv.width || pvw, rv.height || pvh, rv.duration, !silent, thumb)];
    }
    if ((m = /redgifs\.com\/(?:watch|ifr|i)\/([A-Za-z0-9]+)/i.exec(url))) {
      var oe = s.secure_media && s.secure_media.oembed || s.media && s.media.oembed || {};
      var alt = rvp && http(rvp.fallback_url) || "";
      return [item("", "gif", { kind: "redgifs", rg: m[1].toLowerCase(), alt: alt },
        rvp && rvp.width || pvw || oe.width, rvp && rvp.height || pvh || oe.height, rvp && rvp.duration, false, thumb || http(oe.thumbnail_url))];
    }
    if ((m = /^https?:\/\/(?:i\.|m\.|www\.)?imgur\.com\/([A-Za-z0-9]{5,10})\.(?:gifv|mp4|gif)\b/i.exec(url))) {
      return [item("", "gif", { kind: "mp4", url: "https://i.imgur.com/" + m[1] + ".mp4", alt: rvp && http(rvp.fallback_url) || "" }, rvp && rvp.width || pvw, rvp && rvp.height || pvh, rvp && rvp.duration, false, thumb)];
    }
    if (rvp && http(rvp.fallback_url)) {
      return [item("", "gif", { kind: "mp4", url: rvp.fallback_url }, rvp.width || pvw, rvp.height || pvh, rvp.duration, false, thumb)];
    }
    if (s.is_gallery && s.media_metadata && s.gallery_data && Array.isArray(s.gallery_data.items)) {
      var out = [];
      s.gallery_data.items.slice(0, 20).forEach(function (g, n) {
        var meta = s.media_metadata[g.media_id];
        if (!meta || meta.status !== "valid" || !meta.s) return;
        var previews = (meta.p || []).filter(function (p) { return http(p.u); });
        var small = (previews.find(function (p) { return p.x >= 320; }) || previews[previews.length - 1] || {}).u || "";
        var entry = null;
        if (meta.e === "AnimatedImage" && http(meta.s.mp4)) entry = item("_" + (n + 1), "gif", { kind: "mp4", url: meta.s.mp4 }, meta.s.x, meta.s.y, 0, false, small);
        else if (meta.e === "AnimatedImage" && http(meta.s.gif)) entry = item("_" + (n + 1), "gif", { kind: "img", url: meta.s.gif }, meta.s.x, meta.s.y, 0, false, small);
        else if (http(meta.s.u)) {
          var big = meta.s.x > 2600 && previews.length ? previews[previews.length - 1].u : meta.s.u;
          entry = item("_" + (n + 1), "image", { kind: "img", url: big }, meta.s.x, meta.s.y, 0, false, small || big);
        }
        if (entry) { if (s.gallery_data.items.length > 1) entry.name = (base.name + " (" + (n + 1) + "/" + s.gallery_data.items.length + ")").slice(0, 300); out.push(entry); }
      });
      return out;
    }
    var mp4 = pv && pv.variants && pv.variants.mp4 && pv.variants.mp4.source;
    if (mp4 && http(mp4.url)) return [item("", "gif", { kind: "mp4", url: mp4.url }, mp4.width || pvw, mp4.height || pvh, 0, false, thumb)];
    var isImage = s.post_hint === "image" || /\.(?:jpe?g|png|webp|gif)(?:\?.*)?$/i.test(url);
    if (isImage && !s.is_self) {
      var animated = /\.gif(?:\?.*)?$/i.test(url);
      // An animated GIF with no video version must load the original file.
      var still = animated ? http(url) : stillOf(pv, url);
      if (still) return [item("", animated ? "gif" : "image", { kind: "img", url: still }, pvw, pvh, 0, false, thumb || (animated ? "" : still))];
    }
    return [];
  }

  // ---------- listings ----------
  var listings = new Map(), randomState = new Map(), known = new Map();
  function remember(it) {
    if (known.size > 8000) known.delete(known.keys().next().value);
    known.set(it.id, it);
  }
  function getListing(purpose, f, sort, t, q) {
    var key = [purpose, f.id, sort, t || "", q || ""].join("|"), ls = listings.get(key);
    // Browsing starts from a fresh copy after ten minutes; shuffle pools keep growing.
    if (ls && purpose === "b" && Date.now() - ls.at > 600000 && !ls.job) ls = null;
    if (!ls) {
      if (listings.size >= 160) listings.delete(listings.keys().next().value);
      ls = { feed: f, sort: sort, t: t || "", q: q || "", items: [], ids: {}, after: null, done: false, job: null, at: Date.now(), pages: 0 };
      listings.set(key, ls);
    }
    return ls;
  }
  function more(ls) {
    if (ls.done) return Promise.resolve(false);
    if (ls.job) return ls.job;
    var f = ls.feed, path, query = { limit: 100, after: ls.after || undefined };
    if (ls.q && f.kind !== "user") {
      path = f.path + "/search";
      query.q = ls.q; query.restrict_sr = "on"; query.include_over_18 = "on"; query.type = "link";
      query.sort = ls.sort === "new" ? "new" : ls.sort === "top" ? "top" : "relevance"; query.t = ls.t || "all";
    } else if (f.kind === "user") {
      path = f.path; query.sort = ls.sort; if (ls.sort === "top") query.t = ls.t || "all";
    } else {
      path = f.path + "/" + ls.sort; if (ls.sort === "top") query.t = ls.t || "all";
    }
    ls.job = redditGet(path, query).then(function (data) {
      var children = data && data.data && Array.isArray(data.data.children) ? data.data.children : [], added = 0;
      children.forEach(function (child) {
        extract(child).forEach(function (it) {
          if (ls.ids[it.id]) return;
          ls.ids[it.id] = true; ls.items.push(it); remember(it); added++;
        });
      });
      ls.after = data && data.data && data.data.after || null; ls.pages++;
      if (!ls.after || !children.length || ls.pages >= 30) ls.done = true;
      return added > 0;
    });
    ls.job.then(function () { ls.job = null; }, function () { ls.job = null; });
    return ls.job;
  }
  function selectedFeeds(parentId) {
    if (!configured()) throw required();
    var one = parentId && settings.feeds.filter(function (f) { return f.id === parentId; });
    return one && one.length ? one : settings.feeds; // a removed feed falls back to all feeds
  }
  function interleave(lists) {
    var out = [], seen = {}, longest = Math.max.apply(null, lists.map(function (l) { return l.length; }).concat(0));
    for (var i = 0; i < longest; i++) lists.forEach(function (l) {
      if (i < l.length && !seen[l[i].id]) { seen[l[i].id] = true; out.push(l[i]); }
    });
    return out;
  }
  function titleMatch(search) {
    var words = String(search || "").toLowerCase().split(/\s+/).filter(Boolean);
    return function (it) {
      if (!words.length) return true;
      var text = (it.name + " " + it.seriesName).toLowerCase();
      return words.every(function (w) { return text.indexOf(w) >= 0; });
    };
  }
  function rank(list, seed) {
    return list.map(function (it) { return { it: it, r: hash32(seed + "\u0000" + it.id) }; })
      .sort(function (a, b) { return a.r - b.r || (a.it.id < b.it.id ? -1 : 1); })
      .map(function (x) { return x.it; });
  }
  function out(it) { return Object.assign({}, it, { isFavourite: !!favourites[it.id] }); }

  // Shuffle draws on a pool that mixes several orderings of each feed, so it
  // reaches well beyond the current front page. The pool starts with one page
  // per feed and grows in the background while you watch.
  var POOL_SOURCES = [["hot", ""], ["top", "all"], ["top", "year"], ["new", ""], ["top", "month"], ["top", "week"]];
  function poolState(sel) {
    var key = sel.map(function (f) { return f.id; }).join(","), st = randomState.get(key);
    if (!st) { st = { step: 0, last: 0, job: null, first: null }; randomState.set(key, st); }
    return st;
  }
  function poolItems(sel) {
    return interleave(sel.map(function (f) {
      var all = [];
      POOL_SOURCES.forEach(function (src) {
        var ls = listings.get(["r", f.id, src[0], src[1], ""].join("|"));
        if (ls) all = all.concat(ls.items);
      });
      return all;
    }));
  }
  function deepen(sel, st) {
    if (st.job) return st.job;
    var src = POOL_SOURCES[st.step % POOL_SOURCES.length];
    st.step++; st.last = Date.now();
    st.job = Promise.allSettled(sel.map(function (f) { return more(getListing("r", f, src[0], src[1], "")); })).then(function (results) {
      var failure = results.find(function (r) { return r.status === "rejected"; });
      if (failure && results.every(function (r) { return r.status === "rejected"; })) throw failure.reason;
      return results.some(function (r) { return r.status === "fulfilled" && r.value; });
    });
    st.job.then(function () { st.job = null; }, function () { st.job = null; });
    return st.job;
  }

  async function items(o) {
    var sel = selectedFeeds(o.parentId);
    // o.type is one or more of video, gif, image joined by commas; empty means all.
    var kinds = o.type ? o.type.split(",") : null;
    var typeOk = function (it) { return (!kinds || kinds.indexOf(it.type) >= 0) && (!o.unplayed || !seen.has(it.id)); };
    var byTitle = titleMatch(o.search);
    function page(list, moreToCome) {
      return { items: list.slice(o.startIndex, o.startIndex + o.limit).map(out), total: list.length, more: !!moreToCome, startIndex: o.startIndex };
    }
    if (o.favourites) {
      var favs = Object.keys(favourites).map(function (id) { return favourites[id]; }).filter(typeOk).filter(byTitle);
      favs.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      return page(o.sort === "random" ? rank(favs, o.seed) : favs, false);
    }
    if (o.sort === "random") {
      var st = poolState(sel);
      if (!st.first) st.first = deepen(sel, st);
      try { await st.first; } catch (error) { st.first = null; st.step = 0; throw error; }
      var pool = poolItems(sel).filter(typeOk).filter(byTitle);
      // A narrow filter (say, images only) may need more pages before it has enough to shuffle.
      for (var tries = 0; pool.length < 30 && tries < 4 && st.step < POOL_SOURCES.length * 3; tries++) {
        try { await deepen(sel, st); } catch (_) { break; }
        pool = poolItems(sel).filter(typeOk).filter(byTitle);
      }
      // Keep widening the pool in the background, gently.
      if (Date.now() - st.last > 25000 && st.step < POOL_SOURCES.length * 4 && poolItems(sel).length < 5000) deepen(sel, st).catch(function () {});
      return page(rank(pool, o.seed), false);
    }
    var top = /^top-(day|week|month|year|all)$/.exec(o.sort);
    var lists = sel.map(function (f) { return getListing("b", f, top ? "top" : o.sort, top ? top[1] : "", o.search); });
    // Reddit searches subreddits and custom feeds itself; an account's posts are matched by title here.
    var merged, rounds = 0;
    for (;;) {
      merged = interleave(lists.map(function (ls) { return ls.feed.kind === "user" && o.search ? ls.items.filter(byTitle) : ls.items; })).filter(typeOk);
      var open = lists.filter(function (ls) { return !ls.done; });
      if (merged.length > o.startIndex + o.limit || !open.length || rounds >= 5) break;
      var results = await Promise.allSettled(open.map(more));
      if (o.signal && o.signal.aborted) { var abort = new Error("Request cancelled."); abort.name = "AbortError"; throw abort; }
      var failed = results.find(function (r) { return r.status === "rejected"; });
      if (failed && (!merged.length || results.every(function (r) { return r.status === "rejected"; }))) throw failed.reason;
      if (failed) break;
      rounds++;
    }
    return page(merged, lists.some(function (ls) { return !ls.done; }));
  }

  // ---------- favourites and seen posts (kept on this device) ----------
  var favourites = read(FAV_KEY);
  if (!favourites || typeof favourites !== "object" || Array.isArray(favourites)) favourites = {};
  function setFavourite(id, wanted, given) {
    if (wanted) {
      var it = known.get(id) || (given && given.id === id ? given : null) || favourites[id];
      if (!it || !it.media) throw ApiError("This post's details are no longer loaded. Find it in the picker and try again.", 409);
      var keys = Object.keys(favourites);
      if (!favourites[id] && keys.length >= MAX_FAVOURITES) throw ApiError("Favourites are full (" + MAX_FAVOURITES + "). Remove some first.", 409);
      favourites[id] = Object.assign({}, it, { isFavourite: true, savedAt: Date.now() });
    } else delete favourites[id];
    write(FAV_KEY, favourites);
    return { id: id, isFavourite: !!favourites[id] };
  }
  var seenList = read(SEEN_KEY);
  if (!Array.isArray(seenList)) seenList = [];
  var seen = new Set(seenList), seenTimer = null;
  function markSeen(id) {
    if (!id || seen.has(id)) return;
    seen.add(id); seenList.push(id);
    if (seenList.length > MAX_SEEN) { seenList.splice(0, seenList.length - MAX_SEEN).forEach(function (old) { seen.delete(old); }); }
    clearTimeout(seenTimer); seenTimer = setTimeout(function () { write(SEEN_KEY, seenList); }, 1500);
  }
  function clearSeen() { seen = new Set(); seenList = []; write(SEEN_KEY, null); }

  // ---------- media addresses ----------
  // Reddit-hosted media is addressed directly. Redgifs links are short-lived,
  // so each one is looked up when it is about to play.
  var rg = read(RG_KEY), rgJob = null, rgCache = new Map();
  if (!rg || typeof rg.token !== "string" || !(rg.exp > Date.now())) rg = null;
  function rgToken(force) {
    if (!force && rg && rg.exp > Date.now()) return Promise.resolve(rg.token);
    if (rgJob) return rgJob;
    rgJob = root.fetch("https://api.redgifs.com/v2/auth/temporary", { mode: "cors", credentials: "omit", cache: "no-store" }).then(function (response) {
      if (!response.ok) throw ApiError("Redgifs did not issue a viewing token (HTTP " + response.status + ").", 502, "REDGIFS");
      return response.json();
    }).then(function (data) {
      if (!data || typeof data.token !== "string") throw ApiError("Redgifs did not issue a viewing token.", 502, "REDGIFS");
      rg = { token: data.token, exp: Date.now() + 12 * 3600000 }; write(RG_KEY, rg);
      return rg.token;
    });
    rgJob.then(function () { rgJob = null; }, function () { rgJob = null; });
    return rgJob;
  }
  // If Redgifs cannot be reached at all from this browser, stop asking for a
  // while and use Reddit's own previews instead.
  var rgFailures = 0, rgPausedUntil = 0;
  async function rgResolve(id) {
    var cached = rgCache.get(id);
    if (cached && cached.exp > Date.now()) return cached.value;
    if (rgPausedUntil > Date.now()) throw ApiError("Redgifs could not be reached.", 502, "REDGIFS");
    try {
      var value = await rgLookup(id);
      rgFailures = 0;
      return value;
    } catch (error) {
      if (error.code === "REDGIFS" && ++rgFailures >= 3) { rgFailures = 0; rgPausedUntil = Date.now() + 10 * 60000; }
      throw error;
    }
  }
  async function rgLookup(id) {
    for (var attempt = 0; ; attempt++) {
      var token, response;
      try { token = await rgToken(attempt > 0); }
      catch (error) { throw error.code ? error : ApiError("Redgifs could not be reached.", 502, "REDGIFS"); }
      try {
        response = await root.fetch("https://api.redgifs.com/v2/gifs/" + encodeURIComponent(id), {
          mode: "cors", credentials: "omit", cache: "no-store", headers: { Authorization: "Bearer " + token }
        });
      } catch (_) { throw ApiError("Redgifs could not be reached.", 502, "REDGIFS"); }
      if (response.status === 401 && attempt === 0) continue;
      if (response.status === 404 || response.status === 410) throw ApiError("This Redgifs clip has been removed.", 404, "REDGIFS_GONE");
      if (!response.ok) throw ApiError("Redgifs returned an error (HTTP " + response.status + ").", 502, "REDGIFS");
      var data = await response.json(), gif = data && data.gif, urls = gif && gif.urls || {};
      var url = http(urls.hd) || http(urls.sd);
      if (!url) throw ApiError("Redgifs returned no playable file for this clip.", 502, "REDGIFS");
      var value = {
        kind: /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url) ? "img" : "mp4", url: url,
        w: Number(gif.width) || 0, h: Number(gif.height) || 0, duration: Number(gif.duration) || 0, audio: !!gif.hasAudio
      };
      if (rgCache.size > 300) rgCache.delete(rgCache.keys().next().value);
      rgCache.set(id, { value: value, exp: Date.now() + 20 * 60000 });
      return value;
    }
  }
  function validMedia(media) {
    return !!(media && (media.kind === "redgifs" ? /^[a-z0-9]{3,80}$/.test(media.rg || "") : ["hls", "mp4", "img"].indexOf(media.kind) >= 0 && http(media.url)));
  }
  // Returns the source at once when no lookup is needed, so play() can stay
  // inside the tap that asked for it; otherwise null (use resolve()).
  function resolveSync(item) {
    var media = item && item.media;
    if (!validMedia(media)) throw ApiError("This post has no playable media.", 415, "NO_MEDIA");
    if (media.kind === "redgifs") return null;
    return { kind: media.kind, url: media.url, alt: http(media.alt) };
  }
  async function resolve(item) {
    var now = resolveSync(item);
    if (now) return now;
    var media = item.media;
    try {
      var found = await rgResolve(media.rg);
      return { kind: found.kind, url: found.url, alt: http(media.alt), w: found.w, h: found.h, duration: found.duration, audio: found.audio };
    } catch (error) {
      // Reddit keeps its own silent preview of most Redgifs clips.
      if (http(media.alt) && error.code !== "REDGIFS_GONE") return { kind: "mp4", url: media.alt, alt: "" };
      throw error;
    }
  }

  // ---------- status ----------
  function accessLabel() {
    if (!settings.clientId) return "no sign-in";
    return auth && auth.mode === "user" ? (auth.user ? "u/" + auth.user : "signed in") : "app access";
  }
  function status() {
    return {
      connected: configured(), feeds: settings.feeds.length, clientId: settings.clientId, clientSecret: settings.clientSecret,
      signedIn: !!(auth && auth.mode === "user"), userName: auth && auth.mode === "user" && auth.user || "",
      access: accessLabel(), redirectURI: redirectURI()
    };
  }

  // ---------- the app's request router ----------
  function number(value, fallbackValue, max) {
    if (value === null || value === undefined || value === "") return fallbackValue;
    var n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > max) throw ApiError("Invalid pagination.", 400);
    return n;
  }
  var SORTS = ["hot", "new", "rising", "top-day", "top-week", "top-month", "top-year", "top-all", "random"];
  async function api(path, opts) {
    opts = opts || {};
    var url = new URL(path, "https://app.invalid"), p = url.pathname, q = url.searchParams, m;
    if (p === "/api/auth/session") return { authenticated: configured(), configured: true };
    if (p === "/api/status") {
      if (!configured()) return { connected: false, serverName: "Reddit", message: "No feeds set up." };
      var ok = !lastState || lastState.ok;
      return { connected: ok, serverName: "Reddit · " + accessLabel(), message: ok ? settings.feeds.length + " feed" + (settings.feeds.length > 1 ? "s" : "") + ", straight from Reddit to this device" : lastState.message };
    }
    if (p === "/api/libraries") return settings.feeds.map(function (f) { return { id: f.id, name: f.label }; });
    if (p === "/api/items") {
      var type = q.get("type") || "", sort = q.get("sort") || "hot", seed = q.get("seed") || "";
      if (type && !type.split(",").every(function (t) { return ["video", "gif", "image"].indexOf(t) >= 0; })) throw ApiError("Invalid media type.", 400);
      if (SORTS.indexOf(sort) < 0) throw ApiError("Invalid sort order.", 400);
      if (sort === "random" && !/^[a-zA-Z0-9_-]{8,80}$/.test(seed)) throw ApiError("Shuffle needs a valid seed.", 400);
      return items({
        parentId: q.get("parentId") || "", search: (q.get("search") || "").slice(0, 200), type: type,
        startIndex: number(q.get("startIndex"), 0, 10000000), limit: Math.max(1, number(q.get("limit"), 30, 100)),
        sort: sort, favourites: q.get("favourites") === "true", unplayed: q.get("unplayed") === "true", seed: seed, signal: opts.signal
      });
    }
    if ((m = p.match(/^\/api\/items\/([^/]+)\/favourite$/))) {
      var id = decodeURIComponent(m[1]);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw ApiError("Invalid post ID.", 400);
      if (opts.method === "PUT") {
        if (!opts.body || typeof opts.body.isFavourite !== "boolean") throw ApiError("Provide a true or false favourite state.", 400);
        return setFavourite(id, opts.body.isFavourite, opts.body.item);
      }
      return { id: id, isFavourite: !!favourites[id] };
    }
    throw ApiError("Unknown request.", 404);
  }

  root.TVLocal = {
    api: api, resolve: resolve, resolveSync: resolveSync, markSeen: markSeen, clearSeen: clearSeen,
    seenCount: function () { return seen.size; },
    configured: configured, status: status, saveSettings: saveSettings,
    feedsText: function () { return settings.feeds.map(feedLine).join("\n"); },
    parseFeeds: parseFeeds, extract: extract,
    beginSignIn: beginSignIn, completeSignIn: completeSignIn, signOut: signOut, importMultis: importMultis,
    diagnostics: function () { return diagnostics.slice(); },
    clearDiagnostics: function () { diagnostics = []; write(DIAG_KEY, null); },
    onDiagnostic: function (fn) { listeners.push(fn); }
  };
})(window);
