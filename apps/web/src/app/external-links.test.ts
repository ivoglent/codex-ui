import { describe, expect, it } from "vitest";
import { configureNewTabLink } from "./external-links";

describe("configureNewTabLink", () => {
  it("opens links in a separate browser context without an opener", () => {
    const attributes = new Map<string, string>([["rel", "external noopener"]]);
    configureNewTabLink({
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value)
    });

    expect(attributes.get("target")).toBe("_blank");
    expect(attributes.get("rel")?.split(" ")).toEqual(["external", "noopener", "noreferrer"]);
  });
});
