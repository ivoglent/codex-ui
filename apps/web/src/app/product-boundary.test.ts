import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
describe("product boundary", () => { it("does not expose forbidden navigation", () => { const html = readFileSync(fileURLToPath(new URL("app.component.html", import.meta.url)), "utf8"); expect(html).not.toMatch(/>\s*(Terminal|Git|Files|Search)\s*</i); }); });
