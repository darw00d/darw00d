// Serves the app's files (public/) and the Redgifs lookup at /api/redgifs/<id>.
import { redgifs } from "./redgifs.js";

export default {
  async fetch(request, env) {
    const m = /^\/api\/redgifs\/([^/]+)$/.exec(new URL(request.url).pathname);
    if (m) return redgifs(request, decodeURIComponent(m[1]));
    return env.ASSETS.fetch(request);
  }
};
