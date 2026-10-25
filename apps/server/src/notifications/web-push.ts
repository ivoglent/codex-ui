import { createCipheriv, createECDH, createHmac, createPrivateKey, createSign, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";

export interface WebPushSubscription { endpoint: string; keys: { p256dh: string; auth: string }; }
export interface WebPushConfig { enabled: boolean; publicKey: string | null; subject?: string; privateKey?: string; subscriptionsPath: string; }
type VapidCredentials = { publicKey: string; privateKey: string; subject: string };

export function webPushConfig(env: NodeJS.ProcessEnv, defaultPath: string): WebPushConfig {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = env.WEB_PUSH_VAPID_SUBJECT?.trim();
  const configured = [publicKey, privateKey, subject].filter(Boolean).length;
  if (configured && configured !== 3) throw new Error("WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT must be set together");
  if (subject && !/^(mailto:|https:)/.test(subject)) throw new Error("WEB_PUSH_VAPID_SUBJECT must be a mailto: or https: URL");
  if (publicKey && (!isBase64Url(publicKey) || fromBase64Url(publicKey).length !== 65)) throw new Error("WEB_PUSH_VAPID_PUBLIC_KEY must be a base64url P-256 public key");
  if (privateKey && (!isBase64Url(privateKey) || fromBase64Url(privateKey).length !== 32)) throw new Error("WEB_PUSH_VAPID_PRIVATE_KEY must be a base64url P-256 private key");
  return { enabled: configured === 3, publicKey: publicKey ?? null, subject, privateKey, subscriptionsPath: env.WEB_PUSH_SUBSCRIPTIONS_PATH?.trim() || defaultPath };
}

export class WebPushSubscriptionStore {
  private subscriptions = new Map<string, WebPushSubscription>();
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (Array.isArray(parsed)) for (const entry of parsed) { const subscription = parseSubscription(entry); if (subscription) this.subscriptions.set(subscription.endpoint, subscription); }
    } catch (error: any) { if (error?.code !== "ENOENT") throw new Error(`Cannot read web push subscriptions: ${error instanceof Error ? error.message : String(error)}`); }
  }
  async save(subscription: WebPushSubscription): Promise<void> { this.subscriptions.set(subscription.endpoint, subscription); await this.persist(); }
  async remove(endpoint: string): Promise<void> { if (this.subscriptions.delete(endpoint)) await this.persist(); }
  list(): WebPushSubscription[] { return [...this.subscriptions.values()]; }
  private async persist(): Promise<void> { await mkdir(dirname(this.path), { recursive: true }); const temporary = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`; await writeFile(temporary, JSON.stringify(this.list()), { mode: 0o600 }); await rename(temporary, this.path); }
}

export function parseSubscription(value: unknown): WebPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof candidate.endpoint !== "string" || !isHttpsUrl(candidate.endpoint) || typeof candidate.keys?.p256dh !== "string" || typeof candidate.keys.auth !== "string" || !isBase64Url(candidate.keys.p256dh) || !isBase64Url(candidate.keys.auth)) return null;
  if (fromBase64Url(candidate.keys.p256dh).length !== 65 || fromBase64Url(candidate.keys.auth).length < 16) return null;
  return { endpoint: candidate.endpoint, keys: { p256dh: candidate.keys.p256dh, auth: candidate.keys.auth } };
}

export async function sendWebPush(config: VapidCredentials, subscription: WebPushSubscription, payload: unknown): Promise<{ status: number }> {
  const endpoint = new URL(subscription.endpoint);
  const audience = endpoint.origin;
  const jwt = vapidJwt(config, audience);
  const encrypted = encryptPayload(subscription, JSON.stringify(payload));
  const secure = endpoint.protocol === "https:";
  return new Promise((resolve, reject) => {
    const options: RequestOptions | HttpsRequestOptions = { method: "POST", hostname: endpoint.hostname, port: endpoint.port || (secure ? 443 : 80), path: endpoint.pathname + endpoint.search, headers: { authorization: `vapid t=${jwt}, k=${config.publicKey}`, "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "300", "content-length": encrypted.length } };
    const request = (secure ? httpsRequest : httpRequest)(options, (response) => { response.resume(); response.on("end", () => resolve({ status: response.statusCode ?? 0 })); });
    request.setTimeout(5_000, () => request.destroy(new Error("Web Push request timed out")));
    request.once("error", reject); request.end(encrypted);
  });
}

function vapidJwt(config: VapidCredentials, audience: string): string {
  const header = toBase64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64Url(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: config.subject })));
  const publicBytes = fromBase64Url(config.publicKey);
  const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: config.privateKey, x: toBase64Url(publicBytes.subarray(1, 33)), y: toBase64Url(publicBytes.subarray(33, 65)) }, format: "jwk" });
  const signer = createSign("SHA256"); signer.update(`${header}.${claims}`); signer.end();
  return `${header}.${claims}.${toBase64Url(signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }))}`;
}

function encryptPayload(subscription: WebPushSubscription, text: string): Buffer {
  const userPublicKey = fromBase64Url(subscription.keys.p256dh); const auth = fromBase64Url(subscription.keys.auth);
  const local = createECDH("prime256v1"); local.generateKeys(); const localPublicKey = local.getPublicKey();
  const sharedSecret = local.computeSecret(userPublicKey);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), userPublicKey, localPublicKey]);
  const ikm = hkdf(sharedSecret, auth, info, 32); const salt = randomBytes(16);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16); const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce); const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.concat([salt, Buffer.from([0, 0, 16, 0, localPublicKey.length]), localPublicKey]);
  return Buffer.concat([header, encrypted]);
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer { const prk = createHmac("sha256", salt).update(ikm).digest(); let previous = Buffer.alloc(0); const output: Buffer[] = []; let outputLength = 0; for (let index = 1; outputLength < length; index++) { previous = createHmac("sha256", prk).update(Buffer.concat([previous, info, Buffer.from([index])])).digest(); output.push(previous); outputLength += previous.length; } return Buffer.concat(output).subarray(0, length); }
function toBase64Url(value: Buffer): string { return value.toString("base64url"); }
function fromBase64Url(value: string): Buffer { return Buffer.from(value, "base64url"); }
function isBase64Url(value: string): boolean { return /^[A-Za-z0-9_-]+$/.test(value); }
function isHttpsUrl(value: string): boolean { try { return new URL(value).protocol === "https:"; } catch { return false; } }
