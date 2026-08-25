import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { URL } from "node:url";

export interface HubProxyResponse { status: number; contentType?: string; body: string; }

/** Sends a same-origin browser request through Gateway using its opaque user cookie. */
export function proxyNotificationHub(baseUrl: string, path: string, accessToken: string, method: "GET" | "POST", body?: string): Promise<HubProxyResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl); const secure = url.protocol === "https:";
    const options: RequestOptions | HttpsRequestOptions = { method, hostname: url.hostname, port: url.port || (secure ? 443 : 80), path: url.pathname + url.search, headers: { accept: "application/json", cookie: `access_token=${accessToken}`, ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) } };
    const request = (secure ? httpsRequest : httpRequest)(options, (response) => {
      let responseBody = ""; response.setEncoding("utf8"); response.on("data", chunk => responseBody += chunk);
      response.on("end", () => resolve({ status: response.statusCode ?? 502, contentType: response.headers["content-type"], body: responseBody }));
    });
    request.setTimeout(5_000, () => request.destroy(new Error("Notification Hub request timed out")));
    request.once("error", reject); request.end(body);
  });
}
