// Redgifs lookup for the app's own pages. Redgifs' API only answers requests
// from its own website, so the browser cannot ask it directly. This asks on
// the page's behalf and returns just the clip's file addresses and shape.
// It answers only this app's own pages, and only for one clip ID at a time.
const API = "https://api.redgifs.com/v2";
const UA = "triple-view-reddit/1.0 (personal multi-pane viewer)";
let token = null; // { value, exp } kept per Worker instance

async function getToken(force) {
  if (!force && token && token.exp > Date.now()) return token.value;
  const response = await fetch(API + "/auth/temporary", { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error("token " + response.status);
  const data = await response.json();
  if (!data || typeof data.token !== "string") throw new Error("token missing");
  // Temporary tokens last about a day; renew well before that.
  token = { value: data.token, exp: Date.now() + 12 * 3600000 };
  return token.value;
}
function reply(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": cache || "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
export async function redgifs(request, id) {
  if (request.method !== "GET") return reply({ error: "method" }, 405);
  // Browsers mark requests from other sites; refuse those so this is not an open relay.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return reply({ error: "forbidden" }, 403);
  if (!/^[a-z0-9]{3,80}$/.test(id)) return reply({ error: "id" }, 400);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(API + "/gifs/" + id, { headers: { Authorization: "Bearer " + (await getToken(attempt > 0)), "User-Agent": UA } });
      // A token is tied to the address it was issued to; Cloudflare's can change.
      if (response.status === 401 && attempt === 0) continue;
      if (response.status === 404 || response.status === 410) return reply({ gone: true }, 404, "private, max-age=600");
      if (!response.ok) return reply({ error: "redgifs " + response.status }, 502);
      const gif = (await response.json()).gif || {};
      const urls = gif.urls || {};
      const https = (u) => (typeof u === "string" && u.startsWith("https://") ? u : "");
      return reply({ hd: https(urls.hd), sd: https(urls.sd), width: gif.width || 0, height: gif.height || 0, duration: gif.duration || 0, hasAudio: !!gif.hasAudio }, 200, "private, max-age=600");
    }
    return reply({ error: "redgifs 401" }, 502);
  } catch (error) {
    return reply({ error: String(error && error.message || error).slice(0, 100) }, 502);
  }
}
