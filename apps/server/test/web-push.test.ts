import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSubscription, webPushConfig, WebPushSubscriptionStore } from "../src/notifications/web-push.js";

const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
const subscription = { endpoint: "https://push.example.test/endpoint", keys: { p256dh: publicKey, auth: Buffer.alloc(16, 3).toString("base64url") } };

describe("web push configuration and subscriptions", () => {
  it("is disabled until all VAPID settings are supplied", () => expect(webPushConfig({}, "/tmp/subscriptions.json")).toMatchObject({ enabled: false, publicKey: null }));
  it("rejects partial VAPID configuration", () => expect(() => webPushConfig({ WEB_PUSH_VAPID_PUBLIC_KEY: publicKey }, "/tmp/subscriptions.json")).toThrow("must be set together"));
  it("persists only valid HTTPS subscriptions", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "web-push-")), "subscriptions.json"); const store = new WebPushSubscriptionStore(path); await store.load();
    expect(parseSubscription(subscription)).toEqual(subscription); expect(parseSubscription({ ...subscription, endpoint: "http://push.example.test" })).toBeNull();
    await store.save(subscription); expect(JSON.parse(await readFile(path, "utf8"))).toEqual([subscription]);
    const restored = new WebPushSubscriptionStore(path); await restored.load(); expect(restored.list()).toEqual([subscription]);
  });
});
