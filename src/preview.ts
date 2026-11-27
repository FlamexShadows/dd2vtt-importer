import type { Point, UvttData } from "./uvtt";

export interface PreviewLayers {
  walls: boolean;
  objectWalls: boolean;
  doors: boolean;
  lights: boolean;
}

const COLORS = {
  wall: "#ff3b6b",
  object: "#c084fc",
  doorClosed: "#ff9f1c",
  doorOpen: "#2ec4b6",
  light: "#ffd54f",
};

async function loadThumbnail(blob: Blob, width: number): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { resizeWidth: width, resizeQuality: "medium" });
  } catch {
    return await createImageBitmap(blob);
  }
}

/** Draws the map with its walls, doors and lights on a canvas */
export class Preview {
  private data: UvttData | null = null;
  private bitmap: ImageBitmap | null = null;

  constructor(private canvas: HTMLCanvasElement) {}

  async load(data: UvttData, image: Blob | null): Promise<void> {
    this.bitmap?.close();
    this.bitmap = null;
    this.data = data;
    if (image) {
      try {
        this.bitmap = await loadThumbnail(image, 640);
      } catch {
        this.bitmap = null;
      }
    }
  }

  /** A small map-only image for the scene list, or null without an image */
  async thumbnail(): Promise<Blob | null> {
    if (!this.bitmap) return null;
    const c = document.createElement("canvas");
    const ratio = this.bitmap.height / this.bitmap.width;
    c.width = 400;
    c.height = Math.max(1, Math.round(400 * ratio));
    c.getContext("2d")?.drawImage(this.bitmap, 0, 0, c.width, c.height);
    return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
  }

  draw(layers: PreviewLayers): void {
    const data = this.data;
    if (!data) return;
    const { map_size: size, map_origin: origin } = data.resolution;
    const cssWidth = this.canvas.clientWidth || 320;
    const cssHeight = Math.round(cssWidth * (size.y / size.x));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);

    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    if (this.bitmap) {
      ctx.drawImage(this.bitmap, 0, 0, cssWidth, cssHeight);
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.fillRect(0, 0, cssWidth, cssHeight);
    } else {
      ctx.fillStyle = "#1e1e24";
      ctx.fillRect(0, 0, cssWidth, cssHeight);
    }

    const sx = cssWidth / size.x;
    const sy = cssHeight / size.y;
    const map = (p: Point) => [(p.x - origin.x) * sx, (p.y - origin.y) * sy] as const;
    const stroke = (lines: Point[][], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const line of lines) {
        line.forEach((p, i) => {
          const [x, y] = map(p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      }
      ctx.stroke();
    };

    if (layers.walls) stroke(data.line_of_sight, COLORS.wall);
    if (layers.objectWalls) stroke(data.objects_line_of_sight, COLORS.object);
    if (layers.doors) {
      stroke(data.portals.filter((d) => d.closed).map((d) => d.bounds), COLORS.doorClosed);
      stroke(data.portals.filter((d) => !d.closed).map((d) => d.bounds), COLORS.doorOpen);
    }
    if (layers.lights) {
      for (const light of data.lights) {
        const [x, y] = map(light.position);
        const r = Math.max(2, light.range * sx);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, "rgba(255, 213, 79, 0.35)");
        gradient.addColorStop(1, "rgba(255, 213, 79, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.light;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

export const PREVIEW_COLORS = COLORS;
