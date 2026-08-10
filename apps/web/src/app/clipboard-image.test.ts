import { describe, expect, it } from "vitest";
import { clipboardImageFiles } from "./clipboard-image";

describe("clipboardImageFiles", () => {
  it("keeps only image files from a clipboard paste", () => {
    const image = new File(["image"], "screenshot.png", { type: "image/png" });
    const text = new File(["text"], "notes.txt", { type: "text/plain" });
    expect(clipboardImageFiles({ files: [image, text] } as unknown as DataTransfer)).toEqual([image]);
  });

  it("handles text-only clipboard data without attaching anything", () => {
    expect(clipboardImageFiles(null)).toEqual([]);
  });
});
