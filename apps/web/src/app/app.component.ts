import { Component, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import { ConnectionService } from "./connection.service";
import { TimelineStore } from "./timeline.store";
import { DraftStore } from "./draft.store";
import { buildChatItems } from "./chat-presenter";
import { createId } from "./id";

@Component({ selector: "codex-root", standalone: true, imports: [CommonModule, FormsModule], templateUrl: "./app.component.html" })
export class AppComponent {
  private loadedProjectId = "";
  readonly connection = inject(ConnectionService);
  readonly store = inject(TimelineStore);
  readonly drafts = inject(DraftStore);
  readonly threads = signal<any[]>([]);
  readonly selectedThread = signal<any>(null);
  readonly projectId = signal(localStorage.getItem("codex.project") ?? "");
  readonly draft = signal("");
  readonly sending = signal(false);
  readonly error = signal("");
  readonly effort = signal(localStorage.getItem("codex.effort") ?? "medium");
  readonly execution = signal(localStorage.getItem("codex.execution") ?? "normal");
  readonly answers = signal<Record<string, Record<string, string[]>>>({});
  readonly elicitationContent = signal<Record<string, string>>({});
  readonly projects = computed(() => this.connection.snapshot()?.projects ?? []);
  readonly timeline = computed(() => this.store.events().filter((event) => !this.selectedThread() || JSON.stringify(event.params).includes(this.selectedThread().id)));
  readonly chat = computed(() => buildChatItems(this.selectedThread(), this.timeline()));
  readonly active = computed(() => {
    const status = this.selectedThread()?.status?.type ?? this.selectedThread()?.status;
    const turnEvents = this.timeline().filter((event) => event.method === "turn/started" || event.method === "turn/completed");
    const last = turnEvents.at(-1)?.method;
    return last === "turn/started" || (!last && (status === "active" || status === "inProgress"));
  });

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (!id || this.loadedProjectId === id || !this.projects().some((project: any) => project.id === id)) return;
      this.loadedProjectId = id;
      void this.refreshThreads();
    });
  }

  selectProject(id: string) {
    this.projectId.set(id);
    localStorage.setItem("codex.project", id);
    this.selectedThread.set(null);
    this.threads.set([]);
    this.loadedProjectId = "";
  }

  async refreshThreads() {
    const project = this.projects().find((item: any) => item.id === this.projectId()) ?? this.projects()[0];
    if (!project) return;
    this.projectId.set(project.id);
    localStorage.setItem("codex.project", project.id);
    try {
      const result = await this.connection.rpc("thread/list", { cwd: project.root, limit: 100, archived: false, sortKey: "updated_at", sortDirection: "desc" });
      this.threads.set(result.data ?? []);
      const id = localStorage.getItem(`codex.thread.${project.id}`);
      const restored = this.threads().find((thread) => thread.id === id);
      if (restored) await this.selectThread(restored);
    } catch (error) { this.showError(error); }
  }

  async selectThread(thread: any) {
    if (!thread) return;
    this.selectedThread.set(thread);
    localStorage.setItem(`codex.thread.${this.projectId()}`, thread.id);
    this.draft.set(await this.drafts.get(thread.id));
    try {
      const result = await this.connection.rpc("thread/resume", { threadId: thread.id });
      if (result.thread) this.selectedThread.set(result.thread);
    } catch (error) { this.showError(error); }
  }

  selectThreadById(id: string) { const thread = this.threads().find((item) => item.id === id); if (thread) void this.selectThread(thread); }

  async newThread() {
    const project = this.projects().find((item: any) => item.id === this.projectId());
    if (!project) return;
    try {
      const result = await this.connection.rpc("thread/start", { cwd: project.root, ...this.threadDefaults(project) });
      this.selectedThread.set(result.thread);
      localStorage.setItem(`codex.thread.${project.id}`, result.thread.id);
      this.threads.update((threads) => [result.thread, ...threads]);
    } catch (error) { this.showError(error); }
  }

  updateDraft(value: string) {
    this.draft.set(value);
    void this.drafts.set(this.selectedThread()?.id ?? `project:${this.projectId()}`, value);
  }

  async send() {
    const text = this.draft().trim();
    if (!text) return;
    this.sending.set(true);
    try {
      if (!this.selectedThread()) await this.newThread();
      const thread = this.selectedThread();
      if (!thread) return;
      this.appendLocalUserMessage(text);
      await this.connection.rpc("turn/start", { threadId: thread.id, input: [{ type: "text", text, text_elements: [] }], effort: this.effort(), ...this.executionOverrides() });
      this.updateDraft("");
    } catch (error) { this.showError(error); }
    finally { this.sending.set(false); }
  }

  steer() {
    const thread = this.selectedThread(); const text = this.draft().trim();
    if (!thread || !text) return;
    this.appendLocalUserMessage(text);
    void this.connection.rpc("turn/steer", { threadId: thread.id, input: [{ type: "text", text, text_elements: [] }] }).then(() => this.updateDraft("")).catch((error) => this.showError(error));
  }

  stop() { const thread = this.selectedThread(); if (thread) void this.connection.rpc("turn/interrupt", { threadId: thread.id }).catch((error) => this.showError(error)); }
  onComposerKeydown(event: KeyboardEvent) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.active() ? this.steer() : void this.send(); } }
  openCode() { const project = this.projects().find((item: any) => item.id === this.projectId()); if (project) window.open(project.codeServerUrl, "_blank", "noopener"); }
  setAnswer(requestKey: string, questionId: string, value: string) { this.answers.update((all) => ({ ...all, [requestKey]: { ...(all[requestKey] ?? {}), [questionId]: [value] } })); }
  submitAnswers(request: any) { this.connection.resolve(request.requestKey, { answers: this.answers()[request.requestKey] ?? {} }); }
  setElicitation(requestKey: string, value: string) { this.elicitationContent.update((all) => ({ ...all, [requestKey]: value })); }
  submitElicitation(request: any) { try { this.connection.resolve(request.requestKey, { action: "accept", content: JSON.parse(this.elicitationContent()[request.requestKey] || "{}"), _meta: null }); } catch { this.error.set("Elicitation response must be valid JSON"); } }
  approve(request: any, decision: string) { const method = request.method as string; let result: any = { decision }; if (method === "item/tool/requestUserInput") result = { answers: {} }; else if (method === "mcpServer/elicitation/request") result = { action: decision === "acceptForSession" ? "accept" : decision, content: null, _meta: null }; else if (method === "item/permissions/requestApproval") result = { permissions: decision.startsWith("accept") ? { network: request.params?.permissions?.network, fileSystem: request.params?.permissions?.fileSystem } : {}, scope: decision === "acceptForSession" ? "session" : "turn" }; else if (method === "item/tool/call") result = { contentItems: [], success: decision.startsWith("accept") }; this.connection.resolve(request.requestKey, result); }
  persistSetting(key: string, value: string) { localStorage.setItem(`codex.${key}`, value); }
  formatThread(thread: any) { return thread.name || thread.preview || `Session ${String(thread.id).slice(0, 8)}`; }
  detail(value: unknown) { return typeof value === "string" ? value : JSON.stringify(value, null, 2); }
  private threadDefaults(project: any) { return { approvalPolicy: project.defaults?.approvalPolicy, model: project.defaults?.model }; }
  private executionOverrides() { if (this.execution() === "safe") return { approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }; if (this.execution() === "unrestricted") return { approvalPolicy: "on-request", sandboxPolicy: { type: "dangerFullAccess" } }; return { approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }; }
  private appendLocalUserMessage(text: string) { const thread = this.selectedThread(); if (!thread) return; const turn = { id: `local-turn-${createId()}`, status: "inProgress", error: null, items: [{ id: `local-${createId()}`, type: "userMessage", content: [{ type: "text", text, text_elements: [] }] }] }; this.selectedThread.set({ ...thread, turns: [...(thread.turns ?? []), turn] }); }
  private showError(error: unknown) { this.error.set(error instanceof Error ? error.message : String(error)); }
}
