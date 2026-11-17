(function (root) {
  "use strict";
  // The Feeds screen: which subreddits and custom feeds to show, and how to
  // reach Reddit. Everything entered here stays in this browser.
  var LOCAL = root.TVLocal;
  var waiting = null, callbacks = {}, busy = false, notice = "";
  function $(id) { return root.document.getElementById(id); }
  function message(text, good) {
    var el = $("setup-error");
    el.textContent = text || ""; el.hidden = !text;
    el.className = good ? "notice good" : "form-error";
  }
  function render() {
    var s = LOCAL.status();
    $("setup-redirect").textContent = s.redirectURI;
    $("setup-signin").hidden = s.signedIn;
    $("setup-signout").hidden = !s.signedIn;
    $("setup-import").hidden = !s.signedIn;
    $("setup-cancel").hidden = !LOCAL.configured();
    $("setup-access").textContent = s.signedIn ? "Signed in to Reddit" + (s.userName ? " as u/" + s.userName : "") + ". Private custom feeds are available." :
      s.clientId ? "Using your Reddit app ID without a sign-in: public subreddits and public custom feeds." :
        "No sign-in: this browser tries Reddit's public pages directly, which Reddit often refuses. If feeds fail to load, add a Reddit app ID below.";
  }
  function showForm(text, good) {
    $("setup-feeds").value = LOCAL.feedsText();
    $("setup-client").value = LOCAL.status().clientId;
    $("setup-secret").value = LOCAL.status().clientSecret;
    render(); message(text || "", good);
    // Open the Reddit access section when it is in use or the feeds need it.
    if (LOCAL.status().clientId || (text && !good)) $("setup-more").open = true;
    if (callbacks.show) callbacks.show("setup");
    if (!$("setup-feeds").value) $("setup-feeds").focus();
  }
  function finish() {
    if (!waiting) return;
    var current = waiting; waiting = null;
    current.resolve(LOCAL.status());
  }
  function save() {
    LOCAL.saveSettings({ feedsText: $("setup-feeds").value, clientId: $("setup-client").value, clientSecret: $("setup-secret").value });
    $("setup-feeds").value = LOCAL.feedsText();
  }
  function reset() {
    if (waiting) {
      var reject = waiting.reject; waiting = null;
      var error = new Error("Set-up cancelled."); error.name = "AbortError"; reject(error);
    }
  }
  // Resolves once at least one feed is set up. With edit=true the Feeds
  // screen is always shown, so feeds and Reddit access can be changed.
  function ensure(edit) {
    if (waiting) return waiting.promise;
    var resolve, reject, promise = new Promise(function (yes, no) { resolve = yes; reject = no; });
    waiting = { promise: promise, resolve: resolve, reject: reject };
    var current = waiting;
    (async function () {
      var result = null;
      try { result = await LOCAL.completeSignIn(); } catch (_) { result = null; }
      if (waiting !== current) return;
      if (result) notice = result.message;
      if (result && !result.ok) { showForm(result.message); return; }
      if (!edit && LOCAL.configured()) { finish(); return; }
      showForm(result ? result.message : "", true);
    })();
    return promise;
  }
  $("setup-form").addEventListener("submit", function (event) {
    event.preventDefault(); if (busy || !waiting) return;
    try { save(); } catch (error) { message(error.message); return; }
    finish();
  });
  $("setup-cancel").addEventListener("click", function () { if (!busy && LOCAL.configured()) finish(); });
  $("setup-signin").addEventListener("click", function () {
    if (busy) return;
    try {
      // Save what has been typed so it survives the trip to Reddit and back.
      LOCAL.saveSettings({ feedsText: $("setup-feeds").value, clientId: $("setup-client").value, clientSecret: $("setup-secret").value, allowEmpty: true });
      LOCAL.beginSignIn();
    } catch (error) { message(error.message); }
  });
  $("setup-signout").addEventListener("click", async function () {
    if (busy) return; busy = true;
    try { await LOCAL.signOut(); } finally { busy = false; }
    render(); message("Signed out of Reddit on this device.", true);
  });
  $("setup-import").addEventListener("click", async function () {
    if (busy) return; busy = true; this.disabled = true; message("");
    try {
      var lines = await LOCAL.importMultis();
      var box = $("setup-feeds"), have = box.value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var paths = have.map(function (l) { return l.replace(/^.*=\s*/, "").toLowerCase(); });
      var added = lines.filter(function (l) { return paths.indexOf(l.replace(/^.*=\s*/, "").toLowerCase()) < 0; });
      box.value = have.concat(added).join("\n");
      message(lines.length ? "Added " + added.length + " of your " + lines.length + " custom feed" + (lines.length > 1 ? "s" : "") + ". Save to use them." : "Your Reddit account has no custom feeds.", true);
    } catch (error) { message(error.message); }
    finally { busy = false; this.disabled = false; }
  });
  $("setup-copy").addEventListener("click", function () {
    var text = LOCAL.status().redirectURI;
    (root.navigator.clipboard ? root.navigator.clipboard.writeText(text) : Promise.reject()).then(function () { message("Address copied.", true); }, function () {
      var range = root.document.createRange(); range.selectNodeContents($("setup-redirect"));
      var sel = root.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    });
  });
  root.TVMedia = {
    init: function (options) { callbacks = options || {}; },
    ensure: ensure, reset: reset,
    takeNotice: function () { var text = notice; notice = ""; return text; },
    needed: function () { if (callbacks.needed) callbacks.needed(); }
  };
})(window);
