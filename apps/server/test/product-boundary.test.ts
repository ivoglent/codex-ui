import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forbiddenBrowserMethods } from "../src/security-boundary/methods.js";
describe("browser product boundary", () => {
  const allowlist = () => {
    const source = readFileSync(new URL("../src/websocket/hub.ts", import.meta.url), "utf8");
    return source.slice(source.indexOf("const allowedMethods"), source.indexOf("]);", source.indexOf("const allowedMethods")));
  };

  it("does not allowlist command, process, filesystem, terminal, or Git methods", () => {
    const source = allowlist();
    for (const method of forbiddenBrowserMethods) expect(source).not.toContain(`\"${method}\"`);
    expect(source.toLowerCase()).not.toContain("git/");
  });

  it("permits the minimum account endpoints needed for device-code login", () => {
    const source = allowlist();
    expect(source).toContain('"account/read"');
    expect(source).toContain('"account/login/start"');
    expect(source).toContain('"account/login/cancel"');
  });
});
