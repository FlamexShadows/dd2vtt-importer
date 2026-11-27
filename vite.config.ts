import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/**
 * Path the site is served from. Use "/" for a root domain
 * (Netlify, Vercel, Cloudflare Pages) or "/repo-name/" for GitHub Pages.
 */
function normalizeBase(value: string | undefined): string {
  const trimmed = (value ?? "/").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

const base = normalizeBase(process.env.BASE_PATH);

/**
 * Owlbear Rodeo resolves manifest paths against the site origin, so every
 * path needs the base prefix. This plugin builds manifest.json from
 * extension.manifest.json with the right prefix in dev and in production.
 */
function owlbearManifest(): Plugin {
  const render = () => {
    const manifest = JSON.parse(readFileSync("extension.manifest.json", "utf8"));
    const withBase = (path: string) => base + path.replace(/^\//, "");
    if (manifest.icon) manifest.icon = withBase(manifest.icon);
    if (manifest.background_url) manifest.background_url = withBase(manifest.background_url);
    if (manifest.action) {
      manifest.action.icon = withBase(manifest.action.icon);
      manifest.action.popover = withBase(manifest.action.popover ?? "");
    }
    return JSON.stringify(manifest, null, 2);
  };

  return {
    name: "owlbear-manifest",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] === `${base}manifest.json`) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(render());
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: render() });
    },
  };
}

export default defineConfig({
  base,
  plugins: [owlbearManifest()],
  server: {
    // Owlbear Rodeo loads the dev server from its own origin
    cors: { origin: /^https:\/\/(www\.)?owlbear\.rodeo$/ },
  },
});
