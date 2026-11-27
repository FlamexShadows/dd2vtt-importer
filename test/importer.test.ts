import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import OBR, { isLine, isPath, isShape, Command } from "@owlbear-rodeo/sdk";
import { frameForImage, frameForNewScene, toWorld, worldCellSize } from "../src/geometry";
import { sniffImageType } from "../src/image";
import {
  buildAllItems,
  DYNAMIC_FOG_DOORS_KEY,
  DYNAMIC_FOG_LIGHT_KEY,
  IMPORT_KEY,
  type BuildOptions,
} from "../src/items";
import { parseUvtt, UvttError } from "../src/uvtt";

// Builders read the player ID, which Owlbear Rodeo provides at runtime
(OBR.player as unknown as { messageBus: { userId: string } }).messageBus.userId = "test-user";

const sampleText = readFileSync("samples/sample-dungeon.dd2vtt", "utf8");

const options: BuildOptions = {
  walls: true,
  objectWalls: true,
  doors: true,
  lights: true,
  lightType: "SECONDARY",
  softLights: false,
  strokeWidth: 5,
  importId: "test",
  sourceName: "sample-dungeon.dd2vtt",
};

describe("parseUvtt", () => {
  it("reads the sample file", () => {
    const data = parseUvtt(sampleText);
    expect(data.resolution.pixels_per_grid).toBe(70);
    expect(data.resolution.map_size).toEqual({ x: 12, y: 9 });
    expect(data.line_of_sight).toHaveLength(4);
    expect(data.objects_line_of_sight).toHaveLength(1);
    expect(data.portals).toHaveLength(2);
    expect(data.portals[1].closed).toBe(false);
    expect(data.lights).toHaveLength(2);
    expect(data.image.length).toBeGreaterThan(100);
  });

  it("strips data URL prefixes and duplicate points", () => {
    const data = parseUvtt(
      JSON.stringify({
        resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 4, y: 4 }, pixels_per_grid: 100 },
        line_of_sight: [
          [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }],
          [{ x: 1, y: 1 }],
          [{ x: 1, y: 1 }, { x: "bad", y: 2 }],
        ],
        image: "data:image/png;base64,AAAA",
      })
    );
    expect(data.line_of_sight).toEqual([[{ x: 0, y: 0 }, { x: 2, y: 0 }]]);
    expect(data.objects_line_of_sight).toEqual([]);
    expect(data.image).toBe("AAAA");
  });

  it("rejects files that are not Universal VTT", () => {
    expect(() => parseUvtt("not json")).toThrow(UvttError);
    expect(() => parseUvtt("{}")).toThrow(/resolution/);
    expect(() =>
      parseUvtt(JSON.stringify({ resolution: { map_size: { x: 0, y: 3 }, pixels_per_grid: 70 } }))
    ).toThrow(/invalid/);
  });
});

describe("geometry", () => {
  const data = parseUvtt(sampleText);

  it("puts one grid cell at 150 units in a new scene", () => {
    const frame = frameForNewScene(data);
    expect(toWorld(frame, { x: 2, y: 3 })).toEqual({ x: 300, y: 450 });
    expect(worldCellSize(frame)).toBe(150);
  });

  it("respects a non-zero map origin", () => {
    const shifted = { ...data, resolution: { ...data.resolution, map_origin: { x: 1, y: 1 } } };
    expect(toWorld(frameForNewScene(shifted), { x: 2, y: 3 })).toEqual({ x: 150, y: 300 });
  });

  it("aligns to a resized, moved, scaled and rotated map image", () => {
    // 12 x 9 cell map uploaded at 2x resolution (140 px per cell) with dpi 140
    const map = {
      position: { x: 1000, y: 500 },
      rotation: 90,
      scale: { x: 2, y: 2 },
      image: { width: 1680, height: 1260 },
      grid: { dpi: 140, offset: { x: 0, y: 0 } },
    };
    const frame = frameForImage(data, map, 150);
    expect(frame.cell.x).toBeCloseTo(150);
    expect(frame.cell.y).toBeCloseTo(150);
    expect(worldCellSize(frame)).toBeCloseTo(300);
    // (1, 0) cell -> local (150, 0) -> scaled (300, 0) -> rotated 90 deg (0, 300)
    const p = toWorld(frame, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(800);
  });

  it("handles an image whose grid dpi differs from the export", () => {
    // Image downscaled to 35 px per cell but still marked at 70 dpi
    const map = {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      image: { width: 420, height: 315 },
      grid: { dpi: 70, offset: { x: 0, y: 0 } },
    };
    const frame = frameForImage(data, map, 150);
    // 35 image px per cell at 70 dpi = half a scene cell
    expect(frame.cell.x).toBeCloseTo(75);
  });
});

describe("buildAllItems", () => {
  const data = parseUvtt(sampleText);
  const result = buildAllItems(data, frameForNewScene(data), options);

  it("creates walls, doors and lights", () => {
    expect(result.walls).toBe(5);
    expect(result.doors).toBe(2);
    expect(result.lights).toBe(2);
    expect(result.items).toHaveLength(9);
    for (const item of result.items) {
      expect(item.metadata[IMPORT_KEY]).toEqual({ id: "test", source: "sample-dungeon.dd2vtt" });
    }
  });

  it("draws walls as open paths on the fog layer in scene units", () => {
    const wall = result.items[0];
    expect(isPath(wall)).toBe(true);
    if (!isPath(wall)) return;
    expect(wall.layer).toBe("FOG");
    expect(wall.style.fillOpacity).toBe(0);
    expect(wall.commands[0]).toEqual([Command.MOVE, 900, 450]);
    expect(wall.commands[1]).toEqual([Command.LINE, 900, 150]);
    expect(wall.commands.every((c) => c[0] !== Command.CLOSE)).toBe(true);
  });

  it("writes Dynamic Fog door metadata spanning each door line", () => {
    const doors = result.items.filter(isLine);
    expect(doors).toHaveLength(2);
    const [closed, open] = doors;
    expect(closed.layer).toBe("FOG");
    expect(closed.startPosition).toEqual({ x: 900, y: 450 });
    expect(closed.endPosition).toEqual({ x: 900, y: 600 });
    expect(closed.metadata[DYNAMIC_FOG_DOORS_KEY]).toEqual([
      { open: false, start: { index: 0, distance: 0 }, end: { index: 0, distance: 150 } },
    ]);
    expect((open.metadata[DYNAMIC_FOG_DOORS_KEY] as { open: boolean }[])[0].open).toBe(true);
  });

  it("writes Dynamic Fog light metadata on circle shapes", () => {
    const lights = result.items.filter(isShape);
    expect(lights).toHaveLength(2);
    const light = lights[0];
    expect(light.shapeType).toBe("CIRCLE");
    expect(light.position).toEqual({ x: 450, y: 450 });
    expect(light.metadata[DYNAMIC_FOG_LIGHT_KEY]).toMatchObject({
      attenuationRadius: 600,
      sourceRadius: 0,
      falloff: 0.2,
      lightType: "SECONDARY",
    });
  });

  it("attaches items to the map in attach mode", () => {
    const attached = buildAllItems(data, frameForNewScene(data), { ...options, attachTo: "map-1" });
    expect(attached.items.every((item) => item.attachedTo === "map-1")).toBe(true);
  });

  it("skips layers the user turns off", () => {
    const none = buildAllItems(data, frameForNewScene(data), {
      ...options,
      walls: false,
      objectWalls: false,
      doors: false,
      lights: false,
    });
    expect(none.items).toHaveLength(0);
  });
});

describe("sniffImageType", () => {
  it("detects PNG, JPEG and WebP", () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImageType(webp)).toBe("image/webp");
  });
});
