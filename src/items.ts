import {
  buildLine,
  buildPath,
  buildShape,
  Command,
  type Item,
  type PathCommand,
} from "@owlbear-rodeo/sdk";
import { distance, type Frame, toLocal, toWorld, worldCellSize } from "./geometry";
import type { Point, UvttData } from "./uvtt";

/** Reverse domain ID for this extension. Change it to a domain you own. */
export const PLUGIN_ID = "com.example.dd2vtt-importer";
export const IMPORT_KEY = `${PLUGIN_ID}/import`;

/** Metadata keys read by the official Dynamic Fog extension */
export const DYNAMIC_FOG_DOORS_KEY = "rodeo.owlbear.dynamic-fog/doors";
export const DYNAMIC_FOG_LIGHT_KEY = "rodeo.owlbear.dynamic-fog/light";

export type LightType = "PRIMARY" | "SECONDARY" | "AUXILIARY";

export interface BuildOptions {
  walls: boolean;
  objectWalls: boolean;
  doors: boolean;
  lights: boolean;
  lightType: LightType;
  softLights: boolean;
  /** Stroke width for wall and door drawings in local units */
  strokeWidth: number;
  /** Attach every item to this map item so they move with it */
  attachTo?: string;
  /** Tag written to every item so the import can be removed later */
  importId: string;
  sourceName: string;
}

export interface BuildResult {
  items: Item[];
  walls: number;
  doors: number;
  lights: number;
}

const WALL_COLOR = "#222222";
const DOOR_COLOR = "#ff6b3d";

function tag(options: BuildOptions) {
  return { [IMPORT_KEY]: { id: options.importId, source: options.sourceName } };
}

function polylineCommands(points: Point[]): PathCommand[] {
  const [first, ...rest] = points;
  return [
    [Command.MOVE, first.x, first.y],
    ...rest.map((p) => [Command.LINE, p.x, p.y] as PathCommand),
  ];
}

export function buildWallItems(data: UvttData, frame: Frame, options: BuildOptions): Item[] {
  const lines = [
    ...(options.walls ? data.line_of_sight : []),
    ...(options.objectWalls ? data.objects_line_of_sight : []),
  ];
  return lines.map((line) => {
    const builder = buildPath()
      .name("Wall (dd2vtt)")
      .commands(polylineCommands(line.map((p) => toLocal(frame, p))))
      .fillRule("nonzero")
      .fillOpacity(0)
      .strokeColor(WALL_COLOR)
      .strokeOpacity(1)
      .strokeWidth(options.strokeWidth)
      .position(frame.position)
      .rotation(frame.rotation)
      .scale(frame.scale)
      .layer("FOG")
      .metadata(tag(options));
    if (options.attachTo) {
      builder.attachedTo(options.attachTo).disableAttachmentBehavior(["VISIBLE"]);
    }
    return builder.build();
  });
}

/**
 * Each portal becomes its own line on the fog layer with a single Dynamic Fog
 * door that spans the whole line. A closed door blocks sight like a wall.
 * An open door cuts its span out of any wall it overlaps.
 */
export function buildDoorItems(data: UvttData, frame: Frame, options: BuildOptions): Item[] {
  if (!options.doors) return [];
  return data.portals.map((portal) => {
    const start = toLocal(frame, portal.bounds[0]);
    const end = toLocal(frame, portal.bounds[1]);
    const builder = buildLine()
      .name(portal.closed ? "Door (closed)" : "Door (open)")
      .startPosition(start)
      .endPosition(end)
      .strokeColor(DOOR_COLOR)
      .strokeOpacity(1)
      .strokeWidth(options.strokeWidth)
      .position(frame.position)
      .rotation(frame.rotation)
      .scale(frame.scale)
      .layer("FOG")
      .metadata({
        ...tag(options),
        [DYNAMIC_FOG_DOORS_KEY]: [
          {
            open: !portal.closed,
            start: { index: 0, distance: 0 },
            end: { index: 0, distance: distance(start, end) },
          },
        ],
      });
    if (options.attachTo) {
      builder.attachedTo(options.attachTo).disableAttachmentBehavior(["VISIBLE"]);
    }
    return builder.build();
  });
}

/**
 * Each light becomes an invisible circle shape carrying Dynamic Fog light
 * settings. Select the fog tool in Owlbear Rodeo to see light icons.
 */
export function buildLightItems(data: UvttData, frame: Frame, options: BuildOptions): Item[] {
  if (!options.lights) return [];
  const cell = worldCellSize(frame);
  const hostSize = Math.max(16, cell * 0.4);
  return data.lights.map((light) => {
    const builder = buildShape()
      .name("Light (dd2vtt)")
      .shapeType("CIRCLE")
      .width(hostSize)
      .height(hostSize)
      .fillColor("#ffd54f")
      .fillOpacity(0)
      .strokeColor("#ffd54f")
      .strokeOpacity(0)
      .strokeWidth(0)
      .position(toWorld(frame, light.position))
      .layer("PROP")
      .locked(true)
      .metadata({
        ...tag(options),
        [DYNAMIC_FOG_LIGHT_KEY]: {
          attenuationRadius: light.range * cell,
          sourceRadius: 0,
          falloff: options.softLights ? 1.5 : 0.2,
          innerAngle: 360,
          outerAngle: 360,
          lightType: options.lightType,
        },
      });
    if (options.attachTo) {
      builder.attachedTo(options.attachTo).disableAttachmentBehavior(["VISIBLE", "SCALE"]);
    }
    return builder.build();
  });
}

export function buildAllItems(data: UvttData, frame: Frame, options: BuildOptions): BuildResult {
  const walls = buildWallItems(data, frame, options);
  const doors = buildDoorItems(data, frame, options);
  const lights = buildLightItems(data, frame, options);
  return {
    items: [...walls, ...doors, ...lights],
    walls: walls.length,
    doors: doors.length,
    lights: lights.length,
  };
}
