# DD2VTT Importer for Owlbear Rodeo

Import Dungeondraft `.dd2vtt` files (and other Universal VTT exports: `.uvtt`, `.df2vtt`) into Owlbear Rodeo. You get the map, walls, doors and lights, ready for the official Dynamic Fog extension.

## Install

In Owlbear Rodeo, open your profile, click **Add Extension**, and paste:

```
https://flamexshadows.github.io/dd2vtt-importer/manifest.json
```

Then enable DD2VTT Importer and Dynamic Fog in your room.

## What it does

Pick a file in the extension popover. You see a preview of the map with every wall, door and light drawn on top. Then choose one of two actions.

- **Create new scene** uploads the embedded map image as a new scene, with walls, doors and lights placed on it. Grid size matches the export, so one Dungeondraft cell equals one Owlbear Rodeo cell.
- **Add to selected map** adds walls, doors and lights on top of a map already in the current scene. Select the map first. Items attach to the map, so they follow it when you move, scale or rotate it. Use this for files exported without an image, or when you uploaded the map yourself.

A third button removes everything this extension added to the current scene, so you can re-import with other settings.

## How the data maps

| Universal VTT | Owlbear Rodeo |
| --- | --- |
| `image` (base64 PNG/WebP) | Scene base map, image DPI set to `pixels_per_grid` |
| `line_of_sight` | Open paths on the Fog layer. Dynamic Fog turns them into walls |
| `objects_line_of_sight` | Same as walls (pillars, rubble and other sight blockers) |
| `portals` | One line per door on the Fog layer, with Dynamic Fog door metadata. `closed: false` imports as an open door |
| `lights` | Transparent circle shapes with Dynamic Fog light settings. `range` in cells becomes the light radius |

Coordinates convert from grid cells to scene units at 150 units per cell, the Owlbear Rodeo default. `map_origin` is respected.

### Image size limits

Owlbear Rodeo caps uploads by plan: 25 MB and 67 megapixels for Nestling and Fledgling, 50 MB and 144 megapixels for Bestling. Pick your plan under Settings. The extension shrinks or re-encodes the map to WebP (JPEG in Safari) when it goes over, and adjusts the image DPI so the grid still lines up.

## Requirements

- The **Dynamic Fog** extension enabled in your room. Without it, walls show as thin fog lines and lights do nothing.
- GM role in the room.

## Run it locally

You need Node.js 20 or newer.

```bash
npm install
npm run dev
```

In Owlbear Rodeo, open your profile, go to Extensions, choose **Add Custom Extension** and paste:

```
http://localhost:5173/manifest.json
```

Enable the extension in a room. A new icon appears in the top left toolbar. If Chrome asks to allow access to your local network, allow it. If Safari refuses to load a `localhost` extension, test in Chrome, Edge or Firefox.

## Host it

Owlbear Rodeo loads extensions from a public HTTPS URL, and the manifest needs a CORS header. Three free options:

**GitHub Pages.** Push this folder to a GitHub repo. In the repo settings, open Pages and set the source to GitHub Actions. The included workflow tests, builds and deploys on every push to `main`. Your manifest URL becomes `https://<user>.github.io/<repo>/manifest.json`. GitHub Pages sends the CORS header by default.

**Netlify or Cloudflare Pages.** Build command `npm run build`, output folder `dist`. The included `public/_headers` file adds the CORS header. Manifest URL: `https://<your-site>/manifest.json`.

**Any static host.** Run `npm run build` and upload `dist`. Set `BASE_PATH=/sub/folder/` before building when the site lives in a subfolder, and send `Access-Control-Allow-Origin: *` for `manifest.json`.

## Use it

1. Open the extension from the toolbar.
2. Choose or drop a `.dd2vtt` file. Check the preview.
3. Untick anything you want to skip. Open Settings to change light type, fog fill, size limit or grid scale.
4. Click **Create new scene**. Owlbear Rodeo uploads it and opens your scene list.
5. Open the scene. Select a player token and choose **Add Light** from the Dynamic Fog context menu, so the player sees around them.

Light types:

- **Secondary** (default) reveals a torch only once a player light sees it. Best for map lighting.
- **Primary** always cuts through fog, even in rooms nobody has entered.
- **Auxiliary** casts shadows like a primary light but does not trigger secondary lights.

Select the Fog tool to see door handles and light icons. With the Dynamic Fog door tool, click a door to open or close it.

## Known limits

- Dynamic Fog has no window type. Windows import as doors and block sight while closed.
- Dynamic Fog lights have no color or intensity, so those fields are ignored.
- Ambient light and baked lighting from the export are ignored.

## Before you publish

- Change `PLUGIN_ID` in `src/items.ts` to a reverse domain you own.
- Change `author` in `extension.manifest.json`.

## Project layout

```
extension.manifest.json   Manifest template (paths get the base prefix at build)
index.html                Popover page
src/uvtt.ts               Parser and validation for Universal VTT JSON
src/geometry.ts           Grid cell to scene unit conversion
src/items.ts              Builds walls, doors and lights for Dynamic Fog
src/image.ts              Base64 decode and upload size fitting
src/preview.ts            Map preview canvas
src/importer.ts           Owlbear Rodeo calls: scene upload, add items, remove items
src/main.ts               Popover UI
samples/                  Small sample .dd2vtt for testing
test/                     Unit tests (npm test)
```
