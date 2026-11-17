# Triple View Reddit

A private, iPhone-first multi-pane viewer for Reddit: 1–12 panes (three by
default) showing videos, GIFs and images from your subreddits and custom feeds
(multireddits), on iPhone/iPad Safari and desktop Chrome, Edge or Firefox.

It is built from [Triple View](https://github.com/darw00d/Triple-view) and keeps
its interface, layouts, audio controls and hosting. The Emby library is replaced
by Reddit.

Like Triple View it is **self-contained**: plain HTML, CSS and JavaScript with
no server and no build step. The browser talks to Reddit directly. Any static
host can serve the `public/` folder.

## Features

Carried over from Triple View:

- Layouts: Grid, Focus 1, Focus 2, Collage, Make main, Cycle layout with Hold
- 1–12 panes; fill-screen, double-tap to expand, swap panes
- Single audible pane, Mix audio, All audio / Mute all, timed audio cycling,
  per-pane volume on desktop
- Picker with search, sort, type filter, favourites, Shuffle into all panes
- Continuous shuffle per pane using the filters it was chosen with; Next;
  Repeat; swipe left to skip
- Sessions saved across reloads, Resume after backgrounding, screen wake lock
- Installable on the iPhone Home Screen

New for Reddit:

- **Feeds**: one line per feed. A subreddit (`pics`), several joined together
  (`r/EarthPorn+CityPorn` or `cats, aww`), a custom feed
  (`https://www.reddit.com/user/name/m/feed`), or an account's posts (`u/name`).
  Put `Name =` in front to label a feed. Each feed is a filter in the picker;
  **All feeds** mixes them.
- **Videos, GIFs and images**: Reddit-hosted video (with sound), Reddit GIFs,
  Redgifs, Imgur GIFs, images and galleries. Text and link posts are skipped.
  Filter the picker by Videos, GIFs or Images.
- **Smart fit layout** (the default): frames are shaped around what is playing,
  so tall posts get tall frames and wide posts wide ones, and the frames always
  fill the screen. Frames re-fit only when a new post would be noticeably
  trimmed, and then move as little as possible.
- **Fill panes** (on by default): every pane is filled edge to edge, with no
  bars. In the fixed layouts each pane prefers the next post that suits its
  frame. A post that would lose close to half its picture is shown whole
  instead, over a blurred copy of itself, so there is never a plain black gap.
- **Hold**: how long an image stays up. Clips shorter than this repeat until the
  time has passed; longer videos play to the end. Then the pane moves on.
- **Shuffle** mixes hot, new and top posts from each feed and keeps reaching
  further back while you watch. **Unseen** limits it to posts that have not yet
  played on this device.
- Posts whose media has been removed are skipped automatically.
- **Post info** (the i button): title, subreddit, author and a link to the post.

Favourites and seen posts are kept in the browser, not in a Reddit account.

## Reddit access

The Feeds screen has three ways to reach Reddit:

1. **No sign-in** (default). The browser reads Reddit's public pages. Reddit
   limits this to a few requests a minute and sometimes refuses browsers that
   are not signed in; if feeds fail to load, use an app ID.
2. **Reddit app ID.** Public subreddits and public custom feeds, with a much
   higher request limit and no sign-in.
3. **App ID and Sign in with Reddit.** Your own account, so private custom
   feeds work, and **Add my custom feeds** imports them. The sign-in is kept in
   the browser's local storage and sent only to Reddit; **Sign out of Reddit**
   revokes it.

To get an app ID: open <https://www.reddit.com/prefs/apps>, choose **create
app**, select **installed app**, and set the **redirect uri** to the address
shown on the Feeds screen (the app's own address, for example
`https://triple-view-reddit.example.workers.dev/`). The app ID is the short code
under the app's name. There is no secret.

`public/config.js` can pre-fill feeds and the app ID for a fresh device.

## Hosting

The same as Triple View: `wrangler.jsonc` tells Cloudflare Workers to serve
`public/` as static files, and `public/_headers` sets the security headers.

1. In Cloudflare: **Workers & Pages → Create → Import a repository**, pick this
   repository.
2. Set the **root directory** to `triple-view-reddit` and leave the build
   command empty (deploy command `npx wrangler deploy`).
3. Deploy. Every push to the production branch redeploys.
4. Optional but recommended: **Zero Trust → Access → Applications** to put the
   site behind a one-time email code.

For Cloudflare Pages instead: framework preset **None**, build command empty,
root directory `triple-view-reddit`, build output directory `public`.

## Testing locally

```sh
cd public && python3 -m http.server 8080
```

Then open http://localhost:8080. For Sign in with Reddit, the Reddit app's
redirect uri must then be `http://localhost:8080/`.

```sh
node --test tests/reddit-local.test.js
```

checks feed parsing, how posts are turned into playable items, paging, shuffle,
favourites and seen posts against a stand-in for Reddit.

## Files

| File | Purpose |
|---|---|
| `public/index.html` | Page structure |
| `public/app.js` | Player, panes, layouts, audio, picker, shuffle (Triple View's, adapted for images and Smart fit) |
| `public/reddit-local.js` | Everything that talks to Reddit: feeds, optional sign-in, listings, shuffle pool, post-to-media rules, Redgifs lookups, favourites, seen posts, request queue, retries and error log |
| `public/setup.js` | The Feeds screen |
| `public/playback.js` | Player adapter; loads hls.js only for Reddit video with sound on browsers without built-in HLS |
| `public/vendor/hls.min.js` | hls.js 1.7.3 (Apache-2.0) |
| `public/sw.js` | Offline shell cache (never caches Reddit data or media) |
| `public/config.js` | Optional default feeds and app ID |
