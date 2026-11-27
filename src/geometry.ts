import type { Point, UvttData } from "./uvtt";

/** Owlbear Rodeo places one grid cell at 150 scene units in a new scene */
export const DEFAULT_SCENE_DPI = 150;

/**
 * Describes how Universal VTT grid coordinates map into an Owlbear Rodeo scene.
 *
 * Drawings (walls, doors) store points in "local" space and carry the frame's
 * position, rotation and scale, so Owlbear Rodeo and Dynamic Fog place them
 * with the same transform as the map image.
 */
export interface Frame {
  /** World position of local (0, 0) */
  position: Point;
  /** Rotation in degrees */
  rotation: number;
  scale: Point;
  /** Local units per grid cell on each axis */
  cell: Point;
  /** Local offset subtracted after scaling (the image grid offset) */
  offset: Point;
  /** Universal VTT map origin in grid cells */
  origin: Point;
}

/** Minimal shape of an Owlbear Rodeo Image item used for alignment */
export interface MapImageLike {
  position: Point;
  rotation: number;
  scale: Point;
  image: { width: number; height: number };
  grid: { dpi: number; offset: Point };
}

/** Frame for a brand new scene where the map sits at (0, 0) */
export function frameForNewScene(data: UvttData, sceneDpi = DEFAULT_SCENE_DPI): Frame {
  return {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    cell: { x: sceneDpi, y: sceneDpi },
    offset: { x: 0, y: 0 },
    origin: data.resolution.map_origin,
  };
}

/**
 * Frame aligned to a map image already in the scene.
 * Uses the image's pixel size, so walls line up even when the uploaded
 * image has a different resolution than the Universal VTT export.
 */
export function frameForImage(data: UvttData, map: MapImageLike, sceneDpi: number): Frame {
  const k = sceneDpi / map.grid.dpi;
  const size = data.resolution.map_size;
  return {
    position: { ...map.position },
    rotation: map.rotation,
    scale: { ...map.scale },
    cell: {
      x: (map.image.width / size.x) * k,
      y: (map.image.height / size.y) * k,
    },
    offset: { x: map.grid.offset.x * k, y: map.grid.offset.y * k },
    origin: data.resolution.map_origin,
  };
}

/** Grid coordinates to local drawing coordinates */
export function toLocal(frame: Frame, p: Point): Point {
  return {
    x: (p.x - frame.origin.x) * frame.cell.x - frame.offset.x,
    y: (p.y - frame.origin.y) * frame.cell.y - frame.offset.y,
  };
}

/** Local drawing coordinates to world coordinates */
export function localToWorld(frame: Frame, p: Point): Point {
  const sx = p.x * frame.scale.x;
  const sy = p.y * frame.scale.y;
  const r = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    x: frame.position.x + sx * cos - sy * sin,
    y: frame.position.y + sx * sin + sy * cos,
  };
}

/** Grid coordinates to world coordinates */
export function toWorld(frame: Frame, p: Point): Point {
  return localToWorld(frame, toLocal(frame, p));
}

/** World units covered by one grid cell (average of both axes) */
export function worldCellSize(frame: Frame): number {
  return (
    (Math.abs(frame.cell.x * frame.scale.x) + Math.abs(frame.cell.y * frame.scale.y)) / 2
  );
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
