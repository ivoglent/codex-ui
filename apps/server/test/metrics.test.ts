import { describe, expect, it } from "vitest";
import { Metrics } from "../src/observability/metrics.js";
describe("Metrics", () => { it("renders content-free metric labels", () => { const metrics = new Metrics(); metrics.clients = 2; expect(metrics.render()).toContain("codex_control_connected_clients 2"); expect(metrics.render()).not.toContain("threadId"); }); });
