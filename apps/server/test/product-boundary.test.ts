import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forbiddenBrowserMethods } from "../src/security-boundary/methods.js";
describe("browser product boundary", () => { it("does not allowlist command, process, filesystem, terminal, or Git methods", () => { const source = readFileSync(new URL("../src/websocket/hub.ts", import.meta.url), "utf8"); const allowlist = source.slice(source.indexOf("const allowedMethods"), source.indexOf("]);", source.indexOf("const allowedMethods"))); for (const method of forbiddenBrowserMethods) expect(allowlist).not.toContain(`\"${method}\"`); expect(allowlist.toLowerCase()).not.toContain("git/"); }); });
