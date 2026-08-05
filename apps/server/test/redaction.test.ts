import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../src/observability/redaction.js";
describe("redaction", () => { it("redacts common secret fields and stderr assignments", () => { expect(redactText("Authorization: bearer-value")).not.toContain("bearer-value"); expect(redactValue({ apiKey: "abc", nested: { password: "def", safe: 1 } })).toEqual({ apiKey: "[REDACTED]", nested: { password: "[REDACTED]", safe: 1 } }); }); });
