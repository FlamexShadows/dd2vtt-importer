/**
 * Parser for Universal VTT files (.dd2vtt from Dungeondraft, .df2vtt from
 * DungeonFog, .uvtt from Arkenforge and others).
 *
 * All coordinates in the format are in grid cells, relative to the whole map.
 */

export interface Point {
  x: number;
  y: number;
}

export interface UvttPortal {
  position: Point;
  bounds: [Point, Point];
  rotation: number;
  closed: boolean;
  freestanding: boolean;
}

export interface UvttLight {
  position: Point;
  /** Radius in grid cells */
  range: number;
  intensity: number;
  color: string;
  shadows: boolean;
}

export interface UvttData {
  format: number;
  resolution: {
    map_origin: Point;
    map_size: Point;
    pixels_per_grid: number;
  };
  line_of_sight: Point[][];
  objects_line_of_sight: Point[][];
  portals: UvttPortal[];
  lights: UvttLight[];
  /** Base64 image data without any data URL prefix, or an empty string */
  image: string;
}

export class UvttError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function toPoint(value: unknown): Point | null {
  if (!isRecord(value)) return null;
  const x = toNumber(value.x, NaN);
  const y = toNumber(value.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** Clean a polyline: drop invalid points and consecutive duplicates */
function toPolyline(value: unknown): Point[] | null {
  if (!Array.isArray(value)) return null;
  const out: Point[] = [];
  for (const raw of value) {
    const p = toPoint(raw);
    if (!p) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) {
      continue;
    }
    out.push(p);
  }
  return out.length >= 2 ? out : null;
}

function toPolylines(value: unknown): Point[][] {
  if (!Array.isArray(value)) return [];
  const out: Point[][] = [];
  for (const raw of value) {
    const line = toPolyline(raw);
    if (line) out.push(line);
  }
  return out;
}

function toPortals(value: unknown): UvttPortal[] {
  if (!Array.isArray(value)) return [];
  const out: UvttPortal[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !Array.isArray(raw.bounds) || raw.bounds.length < 2) {
      continue;
    }
    const a = toPoint(raw.bounds[0]);
    const b = toPoint(raw.bounds[raw.bounds.length - 1]);
    if (!a || !b) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    out.push({
      position: toPoint(raw.position) ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      bounds: [a, b],
      rotation: toNumber(raw.rotation, 0),
      closed: raw.closed !== false,
      freestanding: raw.freestanding === true,
    });
  }
  return out;
}

function toLights(value: unknown): UvttLight[] {
  if (!Array.isArray(value)) return [];
  const out: UvttLight[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const position = toPoint(raw.position);
    const range = toNumber(raw.range, 0);
    if (!position || range <= 0) continue;
    out.push({
      position,
      range,
      intensity: toNumber(raw.intensity, 1),
      color: typeof raw.color === "string" ? raw.color : "ffffffff",
      shadows: raw.shadows !== false,
    });
  }
  return out;
}

function cleanBase64(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  let b64 = value;
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma !== -1) {
    b64 = b64.slice(comma + 1);
  }
  // Some exporters wrap the base64 string across lines
  if (/\s/.test(b64.slice(0, 2000))) {
    b64 = b64.replace(/\s+/g, "");
  }
  return b64;
}

export function parseUvtt(text: string): UvttData {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UvttError("This file is not valid JSON. Export it again from your map tool.");
  }
  if (!isRecord(json)) {
    throw new UvttError("This file does not contain Universal VTT data.");
  }

  const resolution = json.resolution;
  if (!isRecord(resolution)) {
    throw new UvttError("Missing \"resolution\" block. This file is not a Universal VTT export.");
  }
  const pixelsPerGrid = toNumber(resolution.pixels_per_grid, 0);
  const mapSize = toPoint(resolution.map_size);
  if (pixelsPerGrid <= 0 || !mapSize || mapSize.x <= 0 || mapSize.y <= 0) {
    throw new UvttError("The grid size or map size in this file is invalid.");
  }

  return {
    format: toNumber(json.format, 0),
    resolution: {
      map_origin: toPoint(resolution.map_origin) ?? { x: 0, y: 0 },
      map_size: mapSize,
      pixels_per_grid: pixelsPerGrid,
    },
    line_of_sight: toPolylines(json.line_of_sight),
    objects_line_of_sight: toPolylines(json.objects_line_of_sight),
    portals: toPortals(json.portals),
    lights: toLights(json.lights),
    image: cleanBase64(json.image),
  };
}
