import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readVersionStatus } from "../src/system/version.js";

const originalExec = process.env.CODEX_EXECUTABLE;
const originalVersion = process.env.APP_VERSION;
const originalCommit = process.env.APP_COMMIT;

const setEnv = (version: string | undefined, commit: string | undefined, executable?: string) => {
  if (version === undefined) delete process.env.APP_VERSION; else process.env.APP_VERSION = version;
  if (commit === undefined) delete process.env.APP_COMMIT; else process.env.APP_COMMIT = commit;
  if (executable === undefined) delete process.env.CODEX_EXECUTABLE; else process.env.CODEX_EXECUTABLE = executable;
};

describe("readVersionStatus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    setEnv(originalVersion, originalCommit, originalExec);
  });

  it("prefers APP_VERSION env over package.json fallback", async () => {
    setEnv("v1.2.3", "deadbeef", "echo");
    const status = await readVersionStatus();
    expect(status.application).toBe("v1.2.3");
    expect(status.commit).toBe("deadbeef");
    expect(status.codex).not.toBeNull();
  });

  it("falls back to package.json when APP_VERSION is unset", async () => {
    setEnv(undefined, undefined, "echo");
    const status = await readVersionStatus();
    expect(status.application).toMatch(/^\d+\.\d+\.\d+/);
    expect(status.commit).toBeNull();
  });

  it("trims whitespace from APP_VERSION", async () => {
    setEnv("  v1.2.3  ", undefined, "echo");
    const status = await readVersionStatus();
    expect(status.application).toBe("v1.2.3");
  });

  it("returns a graceful error when codex --version fails", async () => {
    setEnv("v1.2.3", "deadbeef", "/nonexistent/codex-binary");
    const status = await readVersionStatus();
    expect(status.application).toBe("v1.2.3");
    expect(status.codex).toBeNull();
    expect(status.compatible).toBe(false);
    expect(status.error).toBe("Codex version unavailable");
  });
});
