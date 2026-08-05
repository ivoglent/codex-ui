import { Injectable } from "@angular/core";
@Injectable({ providedIn: "root" })
export class DraftStore {
  private readonly db = new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("codex-control", 1); request.onupgradeneeded = () => request.result.createObjectStore("drafts"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  async get(key: string): Promise<string> { const db = await this.db; return new Promise((resolve, reject) => { const request = db.transaction("drafts").objectStore("drafts").get(key); request.onsuccess = () => resolve(request.result ?? ""); request.onerror = () => reject(request.error); }); }
  async set(key: string, value: string): Promise<void> { const db = await this.db; return new Promise((resolve, reject) => { const request = db.transaction("drafts", "readwrite").objectStore("drafts").put(value, key); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
}
