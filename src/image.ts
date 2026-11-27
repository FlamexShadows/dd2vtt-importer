/** Detect the image type from its first bytes */
export function sniffImageType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}

/** Decode base64 image data into a typed Blob */
export async function base64ToBlob(b64: string): Promise<Blob> {
  let buffer: ArrayBuffer;
  try {
    const res = await fetch(`data:application/octet-stream;base64,${b64}`);
    buffer = await res.arrayBuffer();
  } catch {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    buffer = bytes.buffer;
  }
  const type = sniffImageType(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
  return new Blob([buffer], { type });
}

export interface UploadLimit {
  label: string;
  /** Maximum file size in bytes, or 0 for no limit */
  maxBytes: number;
  /** Maximum pixel count, or 0 for no limit */
  maxPixels: number;
}

/** Owlbear Rodeo upload limits per plan (2.3 launch notes) */
export const UPLOAD_LIMITS: Record<string, UploadLimit> = {
  standard: { label: "Nestling / Fledgling (25 MB, 67 MP)", maxBytes: 25e6, maxPixels: 67e6 },
  bestling: { label: "Bestling (50 MB, 144 MP)", maxBytes: 50e6, maxPixels: 144e6 },
  none: { label: "Keep original image", maxBytes: 0, maxPixels: 0 },
};

export interface FittedImage {
  blob: Blob;
  width: number;
  height: number;
  /** New width divided by original width */
  scale: number;
  changed: boolean;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  // Safari has no WebP encoder; fall back to JPEG
  const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
  if (!jpeg) throw new Error("The browser failed to encode the map image.");
  return jpeg;
}

/**
 * Shrink the map until it fits the upload limit.
 * Re-encodes to WebP (JPEG on Safari) and downsizes when needed.
 */
export async function fitImage(
  blob: Blob,
  limit: UploadLimit,
  onStatus: (message: string) => void = () => {}
): Promise<FittedImage> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  try {
    let scale = limit.maxPixels > 0 ? Math.min(1, Math.sqrt(limit.maxPixels / (width * height))) : 1;
    const sizeOk = limit.maxBytes === 0 || blob.size <= limit.maxBytes;
    if (scale >= 1 && sizeOk) {
      return { blob, width, height, scale: 1, changed: false };
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      const w = Math.max(1, Math.floor(width * scale));
      const h = Math.max(1, Math.floor(height * scale));
      onStatus(`Compressing map to ${w} x ${h} px...`);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const quality of [0.92, 0.85, 0.75]) {
        const out = await encode(canvas, quality);
        if (limit.maxBytes === 0 || out.size <= limit.maxBytes) {
          canvas.width = 0;
          canvas.height = 0;
          return { blob: out, width: w, height: h, scale: w / width, changed: true };
        }
      }
      canvas.width = 0;
      canvas.height = 0;
      scale *= 0.8;
    }
    throw new Error("The map image stays above the upload limit after compression.");
  } finally {
    bitmap.close();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}
