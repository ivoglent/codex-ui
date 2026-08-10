export function clipboardImageFiles(clipboard: DataTransfer | null): File[] {
  return Array.from(clipboard?.files ?? []).filter((file) => file.type.startsWith("image/"));
}

export function readImageDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the pasted image."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the pasted image."));
    reader.readAsDataURL(file);
  });
}
