import OBR, {
  buildImageUpload,
  buildSceneUpload,
  isImage,
  type Image,
  type Item,
} from "@owlbear-rodeo/sdk";
import { frameForImage, frameForNewScene } from "./geometry";
import { base64ToBlob, fitImage, formatBytes, type UploadLimit } from "./image";
import { buildAllItems, IMPORT_KEY, type BuildOptions, type BuildResult } from "./items";
import type { UvttData } from "./uvtt";

export type ItemOptions = Omit<BuildOptions, "attachTo" | "importId" | "sourceName">;

export interface ImportSettings {
  sceneName: string;
  sourceName: string;
  items: ItemOptions;
  fogFilled: boolean;
  gridScale: string;
  limit: UploadLimit;
  thumbnail: Blob | null;
}

type Status = (message: string) => void;

const BATCH_SIZE = 100;

function newImportId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function extensionFor(type: string): string {
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  return "png";
}

function hasAnyFogItems(result: BuildResult): boolean {
  return result.walls + result.doors + result.lights > 0;
}

/** Upload the map and all walls, doors and lights as a brand new scene */
export async function importAsNewScene(
  data: UvttData,
  image: Blob | null,
  settings: ImportSettings,
  status: Status
): Promise<BuildResult> {
  if (!image && !data.image) {
    throw new Error("This file has no embedded map image. Use \"Add to selected map\" instead.");
  }

  status("Preparing map image...");
  const original = image ?? (await base64ToBlob(data.image));
  const fitted = await fitImage(original, settings.limit, status);
  if (fitted.changed) {
    status(`Map compressed from ${formatBytes(original.size)} to ${formatBytes(fitted.blob.size)}.`);
  }

  // Keep one grid cell equal to one map cell after any downscale
  const dpi = data.resolution.pixels_per_grid * fitted.scale;
  const file = new File([fitted.blob], `${settings.sceneName}.${extensionFor(fitted.blob.type)}`, {
    type: fitted.blob.type,
  });
  const baseMap = buildImageUpload(file)
    .name(settings.sceneName)
    .dpi(dpi)
    .locked(true)
    .build();

  const result = buildAllItems(data, frameForNewScene(data), {
    ...settings.items,
    importId: newImportId(),
    sourceName: settings.sourceName,
  });

  const builder = buildSceneUpload()
    .name(settings.sceneName)
    .baseMap(baseMap)
    .gridType("SQUARE")
    .items(result.items)
    .fogFilled(settings.fogFilled && hasAnyFogItems(result));
  if (settings.gridScale.trim()) builder.gridScale(settings.gridScale.trim());
  if (settings.thumbnail) builder.thumbnail(settings.thumbnail);

  status("Uploading scene to Owlbear Rodeo...");
  await OBR.assets.uploadScenes([builder.build()]);
  return result;
}

async function findTargetMap(): Promise<Image> {
  const selection = (await OBR.player.getSelection()) ?? [];
  if (selection.length > 0) {
    const selected = (await OBR.scene.items.getItems(selection)).filter(isImage);
    const map = selected.find((item) => item.layer === "MAP") ?? selected[0];
    if (map) return map;
  }
  const maps = await OBR.scene.items.getItems(
    (item: Item) => item.layer === "MAP" && isImage(item)
  );
  if (maps.length === 1 && isImage(maps[0])) return maps[0];
  throw new Error(
    maps.length === 0
      ? "No map found. Add the map image to this scene first, then try again."
      : "This scene has several maps. Select the one to align with, then try again."
  );
}

async function addInBatches(items: Item[], status: Status): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    status(`Adding items ${Math.min(i + BATCH_SIZE, items.length)} of ${items.length}...`);
    await OBR.scene.items.addItems(items.slice(i, i + BATCH_SIZE));
  }
}

/**
 * Add walls, doors and lights on top of a map already in the current scene.
 * Items attach to the map, so moving or scaling the map moves them too.
 */
export async function importOntoSelectedMap(
  data: UvttData,
  settings: ImportSettings,
  status: Status
): Promise<BuildResult> {
  if (!(await OBR.scene.isReady())) {
    throw new Error("Open a scene first.");
  }
  const map = await findTargetMap();
  const sceneDpi = await OBR.scene.grid.getDpi();
  const frame = frameForImage(data, map, sceneDpi);

  const result = buildAllItems(data, frame, {
    ...settings.items,
    attachTo: map.id,
    importId: newImportId(),
    sourceName: settings.sourceName,
  });
  if (result.items.length === 0) {
    throw new Error("Nothing to add. Turn on walls, doors or lights.");
  }

  await addInBatches(result.items, status);
  if (settings.fogFilled && hasAnyFogItems(result)) {
    await OBR.scene.fog.setFilled(true);
  }
  return result;
}

/** Delete every item this extension created in the current scene */
export async function removeImportedItems(): Promise<number> {
  if (!(await OBR.scene.isReady())) return 0;
  const items = await OBR.scene.items.getItems((item: Item) => IMPORT_KEY in item.metadata);
  const ids = items.map((item) => item.id);
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    await OBR.scene.items.deleteItems(ids.slice(i, i + BATCH_SIZE));
  }
  return ids.length;
}
