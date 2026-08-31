import { describe, expect, test } from "vitest";
import {
  detectTouchDevice,
  isComposerEnter,
  shouldSubmitOnComposerEnter,
} from "./composer-enter";

function keydown(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: "Enter", isComposing: false, shiftKey: false, keyCode: 0, ...overrides } as KeyboardEvent;
}

describe("isComposerEnter", () => {
  test("recognizes a plain Enter keydown", () => {
    expect(isComposerEnter(keydown())).toBe(true);
  });

  test("ignores keys other than Enter", () => {
    expect(isComposerEnter(keydown({ key: "a" }))).toBe(false);
    expect(isComposerEnter(keydown({ key: "Backspace" }))).toBe(false);
    expect(isComposerEnter(keydown({ key: " " }))).toBe(false);
  });

  test("skips IME composition to avoid submitting half-formed text", () => {
    expect(isComposerEnter(keydown({ isComposing: true }))).toBe(false);
    expect(isComposerEnter(keydown({ keyCode: 229 }))).toBe(false);
  });
});

describe("shouldSubmitOnComposerEnter", () => {
  test("submits on Enter without Shift on desktop", () => {
    expect(shouldSubmitOnComposerEnter(false, keydown())).toBe(true);
  });

  test("submits on Shift+Enter only when no Shift modifier is held", () => {
    expect(shouldSubmitOnComposerEnter(false, keydown({ shiftKey: true }))).toBe(false);
  });

  test("never submits on a touch device", () => {
    expect(shouldSubmitOnComposerEnter(true, keydown())).toBe(false);
    expect(shouldSubmitOnComposerEnter(true, keydown({ shiftKey: true }))).toBe(false);
  });

  test("ignores non-Enter keys on both platforms", () => {
    expect(shouldSubmitOnComposerEnter(false, keydown({ key: "Tab" }))).toBe(false);
    expect(shouldSubmitOnComposerEnter(true, keydown({ key: "Tab" }))).toBe(false);
  });

  test("treats IME composition as a newline even on desktop", () => {
    expect(shouldSubmitOnComposerEnter(false, keydown({ isComposing: true }))).toBe(false);
  });
});

describe("detectTouchDevice", () => {
  test("returns true when the (hover: none) media query matches", () => {
    expect(detectTouchDevice({ matches: true } as MediaQueryList)).toBe(true);
  });

  test("returns false when the media query does not match", () => {
    expect(detectTouchDevice({ matches: false } as MediaQueryList)).toBe(false);
  });
});
