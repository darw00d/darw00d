// Run with: node --test tests/reddit-local.test.js
// Loads the browser data layer with a stand-in window and a fake Reddit.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(fetchImpl) {
  const store = {};
  const window = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    crypto: require("node:crypto").webcrypto,
    location: { href: "https://app.example/", search: "", protocol: "https:", assign() {} },
    history: { replaceState() {} },
    fetch: fetchImpl || (async () => { throw new Error("no network in this test"); }),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    TVConfig: { feeds: [], redditClientId: "" }
  };
  const context = vm.createContext({ window, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval() {}, Promise, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "public", "reddit-local.js"), "utf8"), context);
  return window.TVLocal;
}
// Values from the loaded script belong to another realm, so compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const eq = (actual, expected) => assert.deepStrictEqual(plain(actual), plain(expected));
const preview = (w, h, extra) => Object.assign({ images: [{ source: { url: "https://preview.redd.it/full.jpg?s=1", width: w, height: h }, resolutions: [{ url: "https://preview.redd.it/small.jpg?s=2", width: 320, height: 180 }] }] }, extra);
const post = (data) => ({ kind: "t3", data: Object.assign({ id: "abc123", title: "A post", subreddit: "pics", author: "someone", permalink: "/r/pics/comments/abc123/a_post/" }, data) });

test("feeds: subreddits, lists, custom feeds, labels", () => {
  const L = load();
  const feeds = L.parseFeeds([
    "pics", "r/EarthPorn+CityPorn", "cats, aww  catgifs", "Mine = https://www.reddit.com/user/Some_One/m/cool_feed/",
    "u/someone/m/other", "me/m/private_one", "u/poster", "# a comment", ""
  ].join("\n"));
  eq(feeds.map((f) => f.path), [
    "r/pics", "r/EarthPorn+CityPorn", "r/cats+aww+catgifs", "user/Some_One/m/cool_feed", "user/someone/m/other", "me/m/private_one", "user/poster/submitted"
  ]);
  assert.strictEqual(feeds[3].label, "Mine");
  assert.strictEqual(feeds[2].label, "r/cats + aww + catgifs");
  assert.strictEqual(new Set(feeds.map((f) => f.id)).size, feeds.length);
  assert.throws(() => L.parseFeeds("not a feed!"), /not a subreddit or custom feed/);
});

test("posts: Reddit video with sound plays as HLS", () => {
  const [it] = load().extract(post({ is_video: true, secure_media: { reddit_video: { hls_url: "https://v.redd.it/x/HLSPlaylist.m3u8", fallback_url: "https://v.redd.it/x/DASH_720.mp4", width: 1280, height: 720, duration: 31, is_gif: false, has_audio: true } }, preview: preview(1280, 720) }));
  assert.strictEqual(it.type, "video");
  eq({ ...it.media }, { kind: "hls", url: "https://v.redd.it/x/HLSPlaylist.m3u8", alt: "https://v.redd.it/x/DASH_720.mp4" });
  eq([it.w, it.h, it.duration, it.audio], [1280, 720, 31, true]);
  assert.strictEqual(it.imageUrl, "https://preview.redd.it/small.jpg?s=2");
  assert.strictEqual(it.link, "https://www.reddit.com/r/pics/comments/abc123/a_post/");
});

test("posts: silent Reddit GIF plays as a plain file", () => {
  const [it] = load().extract(post({ is_video: true, media: { reddit_video: { hls_url: "https://v.redd.it/y/HLSPlaylist.m3u8", fallback_url: "https://v.redd.it/y/DASH_480.mp4", width: 480, height: 854, duration: 6, is_gif: true } } }));
  assert.strictEqual(it.type, "gif");
  assert.strictEqual(it.media.kind, "mp4");
  assert.strictEqual(it.audio, false);
});

test("posts: Redgifs, Imgur, images, galleries, crossposts", () => {
  const L = load();
  const [rg] = L.extract(post({ url: "https://www.redgifs.com/watch/SomeClipName", preview: preview(1080, 1920, { reddit_video_preview: { fallback_url: "https://v.redd.it/p/DASH_480.mp4", width: 480, height: 854, duration: 12 } }) }));
  eq({ ...rg.media }, { kind: "redgifs", rg: "someclipname", alt: "https://v.redd.it/p/DASH_480.mp4" });
  const [im] = L.extract(post({ url: "https://i.imgur.com/AbCd123.gifv" }));
  assert.strictEqual(im.media.url, "https://i.imgur.com/AbCd123.mp4");
  const [img] = L.extract(post({ post_hint: "image", url: "https://i.redd.it/abc.jpg", preview: preview(2000, 1000) }));
  eq([img.type, img.media.kind, img.media.url, img.w, img.h], ["image", "img", "https://preview.redd.it/full.jpg?s=1", 2000, 1000]);
  const gallery = L.extract(post({ is_gallery: true, gallery_data: { items: [{ media_id: "a" }, { media_id: "b" }, { media_id: "gone" }] }, media_metadata: {
    a: { status: "valid", e: "Image", s: { u: "https://preview.redd.it/a.jpg?s=1", x: 800, y: 1200 }, p: [] },
    b: { status: "valid", e: "AnimatedImage", s: { mp4: "https://preview.redd.it/b.mp4?s=1", gif: "https://i.redd.it/b.gif", x: 400, y: 400 }, p: [] },
    gone: { status: "failed" } } }));
  eq(gallery.map((g) => [g.id, g.type, g.media.kind]), [["abc123_1", "image", "img"], ["abc123_2", "gif", "mp4"]]);
  const [cross] = L.extract(post({ url: "/r/other/comments/zzz/", crosspost_parent_list: [{ post_hint: "image", url: "https://i.redd.it/orig.png", preview: preview(900, 900) }] }));
  assert.strictEqual(cross.type, "image");
});

test("posts: text, links, pinned and removed posts are skipped", () => {
  const L = load();
  eq(L.extract(post({ is_self: true, url: "https://www.reddit.com/r/pics/comments/abc123/" })), []);
  eq(L.extract(post({ url: "https://example.com/article" })), []);
  eq(L.extract(post({ stickied: true, post_hint: "image", url: "https://i.redd.it/abc.jpg" })), []);
  eq(L.extract(post({ removed_by_category: "moderator", post_hint: "image", url: "https://i.redd.it/abc.jpg" })), []);
  eq(L.extract(post({ post_hint: "image", url: "http://insecure.example/a.jpg" })), []);
});

test("listing: pages, type filter, shuffle, favourites and seen", async () => {
  const calls = [];
  const L = load(async (url) => {
    calls.push(url);
    const u = new URL(url), after = u.searchParams.get("after"), n = after ? 100 : 0;
    const children = Array.from({ length: 100 }, (_, i) => post(Object.assign({ id: "p" + (n + i) }, i % 2 ? { post_hint: "image", url: "https://i.redd.it/" + (n + i) + ".jpg" } : { is_video: true, media: { reddit_video: { hls_url: "https://v.redd.it/" + (n + i) + "/HLSPlaylist.m3u8", fallback_url: "https://v.redd.it/" + (n + i) + "/DASH.mp4", width: 640, height: 360, duration: 20, has_audio: true } } })));
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { after: after ? null : "t3_next", children } }) };
  });
  L.saveSettings({ feedsText: "pics", clientId: "" });
  const feedId = (await L.api("/api/libraries"))[0].id;
  const hot = await L.api("/api/items?sort=hot&startIndex=0&limit=30&parentId=" + feedId);
  assert.strictEqual(hot.items.length, 30);
  assert.match(calls[0], /^https:\/\/www\.reddit\.com\/r\/pics\/hot\.json\?limit=100&raw_json=1$/);
  const images = await L.api("/api/items?sort=hot&type=image&startIndex=90&limit=30");
  assert.ok(images.items.length > 0 && images.items.every((it) => it.type === "image"));
  assert.ok(calls.some((c) => /after=t3_next/.test(c)), "fetches the next page when a filter needs more");
  const mixed = await L.api("/api/items?sort=hot&type=video,image&startIndex=0&limit=30");
  assert.ok(mixed.items.some((it) => it.type === "video") && mixed.items.some((it) => it.type === "image"));
  await assert.rejects(L.api("/api/items?sort=hot&type=video,audio"), /Invalid media type/);
  const a = await L.api("/api/items?sort=random&seed=seed-one-1&startIndex=0&limit=20");
  const b = await L.api("/api/items?sort=random&seed=seed-two-2&startIndex=0&limit=20");
  assert.notDeepStrictEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
  eq((await L.api("/api/items?sort=random&seed=seed-one-1&startIndex=0&limit=20")).items.map((i) => i.id), a.items.map((i) => i.id));
  const id = a.items[0].id;
  eq({ ...(await L.api("/api/items/" + id + "/favourite", { method: "PUT", body: { isFavourite: true } })) }, { id, isFavourite: true });
  eq((await L.api("/api/items?favourites=true&sort=hot")).items.map((i) => i.id), [id]);
  L.markSeen(id);
  const unseen = await L.api("/api/items?sort=random&seed=seed-one-1&unplayed=true&startIndex=0&limit=100");
  assert.ok(!unseen.items.some((i) => i.id === id));
});
