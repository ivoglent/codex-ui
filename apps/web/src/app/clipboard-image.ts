export function imageFiles(files: Iterable<File>): File[] { return Array.from(files).filter((file) => file.type.startsWith("image/")); }

export function clipboardImageFiles(clipboard: DataTransfer | null): File[] { return imageFiles(clipboard?.files ?? []); }

const MAX_IMAGE_DATA_URL_BYTES = 1_500_000;
const MAX_IMAGE_DIMENSION = 1_600;

/** Optimizes attachments so JSON/base64 stays safely under the WebSocket frame limit. */
export async function readImageDataUrl(file: Blob): Promise<string> {
  const image = await decodeImage(file); let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  for (const quality of [0.82, 0.72, 0.62]) {
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d"); if (!context) throw new Error("This browser cannot optimize the selected image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_IMAGE_DATA_URL_BYTES) return dataUrl;
    scale *= 0.72;
  }
  throw new Error("Image is too large after optimization. Choose a smaller image.");
}

function decodeImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not decode the selected image.")); };
    image.src = url;
  });
}
