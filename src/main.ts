import "./style.css";
import OBR, { type Theme } from "@owlbear-rodeo/sdk";
import { base64ToBlob, UPLOAD_LIMITS } from "./image";
import { importAsNewScene, importOntoSelectedMap, removeImportedItems, type ImportSettings } from "./importer";
import type { LightType } from "./items";
import { Preview } from "./preview";
import { parseUvtt, type UvttData } from "./uvtt";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  drop: $<HTMLLabelElement>("drop"),
  dropTitle: $<HTMLSpanElement>("drop-title"),
  file: $<HTMLInputElement>("file"),
  details: $<HTMLElement>("details"),
  preview: $<HTMLCanvasElement>("preview"),
  stats: $<HTMLParagraphElement>("stats"),
  sceneName: $<HTMLInputElement>("scene-name"),
  walls: $<HTMLInputElement>("opt-walls"),
  objects: $<HTMLInputElement>("opt-objects"),
  doors: $<HTMLInputElement>("opt-doors"),
  lights: $<HTMLInputElement>("opt-lights"),
  lightType: $<HTMLSelectElement>("light-type"),
  soft: $<HTMLInputElement>("opt-soft"),
  fog: $<HTMLInputElement>("opt-fog"),
  limit: $<HTMLSelectElement>("limit"),
  gridScale: $<HTMLInputElement>("grid-scale"),
  btnNew: $<HTMLButtonElement>("btn-new"),
  btnAttach: $<HTMLButtonElement>("btn-attach"),
  btnRemove: $<HTMLButtonElement>("btn-remove"),
  status: $<HTMLParagraphElement>("status"),
  hint: $<HTMLParagraphElement>("hint"),
};

const preview = new Preview(ui.preview);
const inOwlbear = window.self !== window.top;

let data: UvttData | null = null;
let image: Blob | null = null;
let fileName = "";
let isGM = false;
let busy = false;

for (const [key, limit] of Object.entries(UPLOAD_LIMITS)) {
  ui.limit.add(new Option(limit.label, key));
}

function setStatus(message: string, kind: "info" | "error" | "ok" = "info") {
  ui.status.textContent = message;
  ui.status.className = `status small ${kind === "info" ? "" : kind}`;
}

function refreshButtons() {
  const ready = inOwlbear && isGM && !busy && data !== null;
  ui.btnNew.disabled = !ready || image === null;
  ui.btnAttach.disabled = !ready;
  ui.btnRemove.disabled = !inOwlbear || !isGM || busy;
}

function layers() {
  return {
    walls: ui.walls.checked,
    objectWalls: ui.objects.checked,
    doors: ui.doors.checked,
    lights: ui.lights.checked,
  };
}

function setCount(input: HTMLInputElement, countId: string, count: number) {
  $(countId).textContent = `(${count})`;
  input.disabled = count === 0;
  input.checked = count > 0;
  input.parentElement?.classList.toggle("empty", count === 0);
}

async function loadFile(file: File) {
  busy = true;
  refreshButtons();
  setStatus(`Reading ${file.name}...`);
  ui.dropTitle.textContent = file.name;
  try {
    const parsed = parseUvtt(await file.text());
    image = parsed.image ? await base64ToBlob(parsed.image) : null;
    // Free the large base64 string; the decoded blob replaces it
    parsed.image = "";
    data = parsed;
    fileName = file.name;

    const { map_size, pixels_per_grid } = parsed.resolution;
    ui.sceneName.value = file.name.replace(/\.[^.]+$/, "").slice(0, 60);
    setCount(ui.walls, "count-walls", parsed.line_of_sight.length);
    setCount(ui.objects, "count-objects", parsed.objects_line_of_sight.length);
    setCount(ui.doors, "count-doors", parsed.portals.length);
    setCount(ui.lights, "count-lights", parsed.lights.length);
    // Open maps without walls or doors look black under filled fog
    ui.fog.checked =
      parsed.line_of_sight.length + parsed.objects_line_of_sight.length + parsed.portals.length > 0;
    ui.stats.textContent =
      `${map_size.x} x ${map_size.y} cells, ${pixels_per_grid} px per cell` +
      (image ? "" : ", no embedded image");

    ui.details.hidden = false;
    await preview.load(parsed, image);
    preview.draw(layers());
    setStatus(
      inOwlbear
        ? image
          ? "Ready. Create a new scene, or select a map in this scene and add to it."
          : "This file has no image. Select your map in the scene, then click \"Add to selected map\"."
        : "Preview only. Open this extension inside Owlbear Rodeo to import."
    );
  } catch (error) {
    data = null;
    image = null;
    ui.details.hidden = true;
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy = false;
    refreshButtons();
  }
}

function settings(): ImportSettings {
  return {
    sceneName: ui.sceneName.value.trim() || "Imported map",
    sourceName: fileName,
    items: {
      walls: ui.walls.checked,
      objectWalls: ui.objects.checked,
      doors: ui.doors.checked,
      lights: ui.lights.checked,
      lightType: ui.lightType.value as LightType,
      softLights: ui.soft.checked,
      strokeWidth: 5,
    },
    fogFilled: ui.fog.checked,
    gridScale: ui.gridScale.value,
    limit: UPLOAD_LIMITS[ui.limit.value] ?? UPLOAD_LIMITS.standard,
    thumbnail: null,
  };
}

function summary(r: { walls: number; doors: number; lights: number }) {
  return `${r.walls} walls, ${r.doors} doors, ${r.lights} lights`;
}

async function run(task: () => Promise<string>) {
  if (busy) return;
  busy = true;
  refreshButtons();
  try {
    setStatus(await task(), "ok");
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    busy = false;
    refreshButtons();
  }
}

ui.btnNew.addEventListener("click", () =>
  run(async () => {
    if (!data) throw new Error("Choose a file first.");
    const s = settings();
    s.thumbnail = await preview.thumbnail();
    const result = await importAsNewScene(data, image, s, setStatus);
    return `Scene "${s.sceneName}" uploaded with ${summary(result)}. Open it from the Scenes menu.`;
  })
);

ui.btnAttach.addEventListener("click", () =>
  run(async () => {
    if (!data) throw new Error("Choose a file first.");
    const result = await importOntoSelectedMap(data, settings(), setStatus);
    return `Added ${summary(result)} to the map.`;
  })
);

ui.btnRemove.addEventListener("click", () =>
  run(async () => {
    const removed = await removeImportedItems();
    return removed > 0
      ? `Removed ${removed} imported items from this scene.`
      : "No imported items in this scene.";
  })
);

for (const input of [ui.walls, ui.objects, ui.doors, ui.lights]) {
  input.addEventListener("change", () => preview.draw(layers()));
}

ui.file.addEventListener("change", () => {
  const file = ui.file.files?.[0];
  if (file) void loadFile(file);
  ui.file.value = "";
});

ui.drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  ui.drop.classList.add("over");
});
ui.drop.addEventListener("dragleave", () => ui.drop.classList.remove("over"));
ui.drop.addEventListener("drop", (event) => {
  event.preventDefault();
  ui.drop.classList.remove("over");
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
});

window.addEventListener("resize", () => {
  if (data) preview.draw(layers());
});

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.mode = theme.mode;
  root.style.setProperty("--bg", theme.background.default);
  root.style.setProperty("--paper", theme.background.paper);
  root.style.setProperty("--text", theme.text.primary);
  root.style.setProperty("--text-2", theme.text.secondary);
  root.style.setProperty("--text-3", theme.text.disabled);
  root.style.setProperty("--primary", theme.primary.main);
  root.style.setProperty("--primary-text", theme.primary.contrastText);
}

if (inOwlbear) {
  OBR.onReady(async () => {
    applyTheme(await OBR.theme.getTheme());
    OBR.theme.onChange(applyTheme);

    const updateRole = (role: string) => {
      isGM = role === "GM";
      ui.hint.textContent = isGM
        ? "Walls, doors and lights need the Dynamic Fog extension."
        : "Only the GM can import maps.";
      refreshButtons();
    };
    updateRole(await OBR.player.getRole());
    OBR.player.onChange((player) => updateRole(player.role));
  });
} else {
  document.body.classList.add("standalone");
  ui.hint.textContent = "Preview mode. Add this extension to Owlbear Rodeo to import.";
}

refreshButtons();
