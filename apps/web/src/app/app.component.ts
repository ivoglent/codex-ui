import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import { ConnectionService } from "./connection.service";
import { TimelineStore } from "./timeline.store";
import { DraftStore } from "./draft.store";
import { buildChatItems, ChatItem } from "./chat-presenter";
import { renderMarkdown } from "./markdown";
import { createId } from "./id";

type PrimaryTab = "chat" | "inbox" | "settings";

@Component({ selector: "codex-root", standalone: true, imports: [CommonModule, FormsModule], templateUrl: "./app.component.html" })
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild("timelineViewport") timelineViewport?: ElementRef<HTMLElement>;
  @ViewChild("composerRegion") composerRegion?: ElementRef<HTMLElement>;
  private loadedProjectId = "";
  private resizeObserver?: ResizeObserver;
  private scrollFrame = 0;
  private lastVisibleCount = 0;
  readonly connection = inject(ConnectionService);
  readonly store = inject(TimelineStore);
  readonly drafts = inject(DraftStore);
  readonly threads = signal<any[]>([]);
  readonly selectedThread = signal<any>(null);
  readonly projectId = signal(localStorage.getItem("codex.project") ?? "");
  readonly tab = signal<PrimaryTab>((localStorage.getItem("codex.tab") as PrimaryTab) || "chat");
  readonly draft = signal("");
  readonly sending = signal(false);
  readonly error = signal("");
  readonly effort = signal(localStorage.getItem("codex.effort") ?? "medium");
  readonly execution = signal(localStorage.getItem("codex.execution") ?? "normal");
  readonly answers = signal<Record<string, Record<string, string[]>>>({});
  readonly elicitationContent = signal<Record<string, string>>({});
  readonly followingBottom = signal(true);
  readonly newUpdates = signal(0);
  readonly composerHeight = signal(132);
  readonly sessionMenuOpen = signal(false);
  readonly historyLimit = signal(160);
  readonly projects = computed(() => this.connection.snapshot()?.projects ?? []);
  readonly timeline = computed(() => this.store.events().filter((event) => !this.selectedThread() || JSON.stringify(event.params).includes(this.selectedThread().id)));
  readonly chat = computed(() => buildChatItems(this.selectedThread(), this.timeline()));
  readonly visibleChat = computed(() => this.chat().slice(-this.historyLimit()));
  readonly selectedPending = computed(() => this.connection.pending().filter((request) => !request.params?.threadId || request.params.threadId === this.selectedThread()?.id));
  readonly selectedResolved = computed(() => this.connection.resolvedAttention().filter((request) => !request.params?.threadId || request.params.threadId === this.selectedThread()?.id));
  readonly active = computed(() => {
    const status = this.selectedThread()?.status?.type ?? this.selectedThread()?.status;
    const events = this.timeline().filter((event) => event.method === "turn/started" || event.method === "turn/completed");
    return events.at(-1)?.method === "turn/started" || (!events.length && (status === "active" || status === "inProgress"));
  });
  readonly activity = computed(() => {
    if (this.connection.pending().length) return "Waiting for approval";
    const last = [...this.chat()].reverse().find((item) => item.status === "inProgress");
    if (last?.kind === "command") return `Running ${last.title ?? "command"}`;
    if (last?.kind === "change") return "Updating files";
    if (last?.kind === "plan") return "Working through the plan";
    return this.active() ? "Codex is working…" : "";
  });
  readonly inboxFailures = computed(() => this.threads().filter((thread) => ["failed", "interrupted"].includes(thread.status?.type ?? thread.status)));

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (!id || this.loadedProjectId === id || !this.projects().some((project: any) => project.id === id)) return;
      this.loadedProjectId = id;
      void this.refreshThreads();
    });
    effect(() => {
      const count = this.chat().length + this.connection.pending().length;
      if (count > this.lastVisibleCount && this.lastVisibleCount) {
        if (this.followingBottom()) this.scheduleScroll(false);
        else this.newUpdates.update((value) => value + (count - this.lastVisibleCount));
      }
      this.lastVisibleCount = count;
    });
  }

  ngAfterViewInit() { this.observeComposer(); this.scheduleScroll(false, true); }
  ngOnDestroy() { this.resizeObserver?.disconnect(); cancelAnimationFrame(this.scrollFrame); }
  selectTab(tab: PrimaryTab) { this.tab.set(tab); localStorage.setItem("codex.tab", tab); if (tab === "chat") this.scheduleScroll(false); }

  selectProject(id: string) {
    this.saveScrollPosition(); this.projectId.set(id); localStorage.setItem("codex.project", id);
    this.selectedThread.set(null); this.threads.set([]); this.loadedProjectId = ""; this.newUpdates.set(0);
  }

  async refreshThreads() {
    const project = this.projects().find((item: any) => item.id === this.projectId()) ?? this.projects()[0];
    if (!project) return;
    this.projectId.set(project.id); localStorage.setItem("codex.project", project.id);
    try {
      const result = await this.connection.rpc("thread/list", { cwd: project.root, limit: 100, archived: false, sortKey: "updated_at", sortDirection: "desc" });
      this.threads.set(result.data ?? []);
      const remembered = localStorage.getItem(`codex.thread.${project.id}`);
      const selected = this.threads().find((thread) => thread.id === remembered) ?? this.threads()[0];
      if (selected) await this.selectThread(selected);
    } catch (error) { this.showError(error); }
  }

  async selectThread(thread: any) {
    if (!thread) return;
    this.saveScrollPosition(); this.selectedThread.set(thread); this.historyLimit.set(160); this.lastVisibleCount = 0; this.newUpdates.set(0);
    localStorage.setItem(`codex.thread.${this.projectId()}`, thread.id);
    this.draft.set(await this.drafts.get(thread.id));
    try { const result = await this.connection.rpc("thread/resume", { threadId: thread.id }); if (result.thread) this.selectedThread.set(result.thread); }
    catch (error) { this.showError(error); }
    this.restoreScrollPosition(thread.id);
  }

  selectThreadById(id: string) { const thread = this.threads().find((item) => item.id === id); if (thread) void this.selectThread(thread); }
  async newThread() {
    const project = this.projects().find((item: any) => item.id === this.projectId()); if (!project) return;
    try { const result = await this.connection.rpc("thread/start", { cwd: project.root, ...this.threadDefaults(project) }); this.threads.update((items) => [result.thread, ...items]); await this.selectThread(result.thread); }
    catch (error) { this.showError(error); }
  }

  updateDraft(value: string) { this.draft.set(value); void this.drafts.set(this.selectedThread()?.id ?? `project:${this.projectId()}`, value); }
  autoGrow(target: EventTarget | null) { const element = target as HTMLTextAreaElement; element.style.height = "auto"; element.style.height = `${Math.min(element.scrollHeight, 160)}px`; }
  async send() {
    const text = this.draft().trim(); if (!text || this.sending()) return; this.sending.set(true);
    try { if (!this.selectedThread()) await this.newThread(); const thread = this.selectedThread(); if (!thread) return; this.appendLocalUserMessage(text); this.updateDraft(""); this.followingBottom.set(true); this.scheduleScroll(false); await this.connection.rpc("turn/start", { threadId: thread.id, input: [{ type: "text", text, text_elements: [] }], effort: this.effort(), ...this.executionOverrides() }); }
    catch (error) { this.showError(error); } finally { this.sending.set(false); }
  }
  async steer() { const thread = this.selectedThread(); const text = this.draft().trim(); if (!thread || !text || this.sending()) return; this.sending.set(true); this.appendLocalUserMessage(text); this.updateDraft(""); this.followingBottom.set(true); this.scheduleScroll(false); try { await this.connection.rpc("turn/steer", { threadId: thread.id, input: [{ type: "text", text, text_elements: [] }] }); } catch (error) { this.showError(error); } finally { this.sending.set(false); } }
  stop() { const thread = this.selectedThread(); if (thread) void this.connection.rpc("turn/interrupt", { threadId: thread.id }).catch((error) => this.showError(error)); }
  onComposerKeydown(event: KeyboardEvent) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); this.active() ? void this.steer() : void this.send(); } }
  onTimelineScroll() { const el = this.timelineViewport?.nativeElement; if (!el) return; const near = el.scrollHeight - el.clientHeight - el.scrollTop <= 120; this.followingBottom.set(near); if (near) this.newUpdates.set(0); this.saveScrollPosition(); }
  scrollToLatest() { this.followingBottom.set(true); this.newUpdates.set(0); this.scheduleScroll(!matchMedia("(prefers-reduced-motion: reduce)").matches); }

  openCode(path?: string) { const project = this.projects().find((item: any) => item.id === this.projectId()); if (!project?.codeServerUrl) return; const url = path ? `${project.codeServerUrl.replace(/\/$/, "")}/?folder=${encodeURIComponent(project.root)}&file=${encodeURIComponent(path)}` : project.codeServerUrl; window.open(url, "_blank", "noopener"); }
  setAnswer(requestKey: string, questionId: string, value: string) { this.answers.update((all) => ({ ...all, [requestKey]: { ...(all[requestKey] ?? {}), [questionId]: [value] } })); }
  submitAnswers(request: any) { this.connection.resolve(request.requestKey, { answers: this.answers()[request.requestKey] ?? {} }); }
  setElicitation(requestKey: string, value: string) { this.elicitationContent.update((all) => ({ ...all, [requestKey]: value })); }
  submitElicitation(request: any) { try { this.connection.resolve(request.requestKey, { action: "accept", content: JSON.parse(this.elicitationContent()[request.requestKey] || "{}"), _meta: null }); } catch { this.error.set("The response must be valid JSON."); } }
  approve(request: any, decision: string) { const method = request.method as string; let result: any = { decision }; if (method === "item/tool/requestUserInput") result = { answers: {} }; else if (method === "mcpServer/elicitation/request") result = { action: decision === "acceptForSession" ? "accept" : decision, content: null, _meta: null }; else if (method === "item/permissions/requestApproval") result = { permissions: decision.startsWith("accept") ? { network: request.params?.permissions?.network, fileSystem: request.params?.permissions?.fileSystem } : {}, scope: decision === "acceptForSession" ? "session" : "turn" }; else if (method === "item/tool/call") result = { contentItems: [], success: decision.startsWith("accept") }; this.connection.resolve(request.requestKey, result); }
  async sessionAction(action: string) { const thread = this.selectedThread(); if (!thread) return; this.sessionMenuOpen.set(false); try { if (action === "rename") { const name = prompt("Session name", this.formatThread(thread)); if (name) await this.connection.rpc("thread/name/set", { threadId: thread.id, name }); } else if (action === "goal") { const objective = prompt("Session goal", thread.goal?.objective ?? ""); if (objective) await this.connection.rpc("thread/goal/set", { threadId: thread.id, objective }); } else if (action === "pin") await this.connection.rpc("thread/metadata/update", { threadId: thread.id, isPinned: !thread.isPinned }); else if (action === "fork") { const result = await this.connection.rpc("thread/fork", { threadId: thread.id }); this.threads.update((items) => [result.thread, ...items]); await this.selectThread(result.thread); } else if (action === "compact") await this.connection.rpc("thread/compact/start", { threadId: thread.id }); else if (action === "archive") await this.connection.rpc("thread/archive", { threadId: thread.id }); else if (action === "delete" && confirm("Delete this session? This cannot be undone.")) await this.connection.rpc("thread/delete", { threadId: thread.id }); await this.refreshThreads(); } catch (error) { this.showError(error); } }
  goToAttention(request: any) { this.selectTab("chat"); const threadId = request.params?.threadId; if (threadId) this.selectThreadById(threadId); this.newUpdates.set(1); }
  persistSetting(key: string, value: string) { localStorage.setItem(`codex.${key}`, value); }
  formatThread(thread: any) { const title = thread?.name || thread?.preview || this.firstPrompt(thread) || "Untitled session"; return title.length > 72 ? `${title.slice(0, 69)}…` : title; }
  threadStatus(thread: any) { const status = thread?.status?.type ?? thread?.status ?? "idle"; return status === "inProgress" ? "Running" : status.charAt(0).toUpperCase() + status.slice(1); }
  markdown(value: string) { return renderMarkdown(value); }
  commandSummary(item: ChatItem) { if (item.status === "inProgress") return "Running…"; if (item.meta?.exitCode && item.meta.exitCode !== 0) return `Failed · exit code ${item.meta.exitCode}`; return [item.status === "completed" ? "Completed" : item.status, item.meta?.duration].filter(Boolean).join(" · ") || "View result"; }
  changes(item: ChatItem) { return item.meta?.changes ?? []; }
  changeCounts(item: ChatItem) { const counts: Record<string, number> = {}; for (const change of this.changes(item)) { const type = change.kind ?? change.type ?? "modified"; counts[type] = (counts[type] ?? 0) + 1; } return Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(" · "); }
  changePaths(item: ChatItem) { return this.changes(item).map((change: any) => change.path).filter(Boolean).join("\n"); }
  planSteps(item: ChatItem) { return item.meta?.steps ?? (item.body ? item.body.split("\n").filter(Boolean).map((step) => ({ step, status: "pending" })) : []); }
  planDone(item: ChatItem) { return this.planSteps(item).filter((step: any) => step.status === "completed").length; }
  copy(value: string) { void navigator.clipboard?.writeText(value).catch(() => this.error.set("Could not copy to the clipboard.")); }
  attentionTitle(request: any) { if (request.method === "item/tool/requestUserInput") return "Codex needs input"; if (request.method?.includes("fileChange")) return "Approve file changes"; return "Approval required"; }
  attentionSummary(request: any) { return request.params?.reason || request.params?.message || request.params?.command || request.params?.tool || "Codex needs your decision before it can continue."; }
  resolutionLabel(request: any) { const value = JSON.stringify(request.resolution ?? {}).toLowerCase(); return value.includes("decline") || value.includes("reject") ? "Declined" : value.includes("cancel") ? "Cancelled" : "Approved"; }

  private firstPrompt(thread: any) { for (const turn of thread?.turns ?? []) for (const item of turn.items ?? []) if (item.type === "userMessage") return item.content?.find((part: any) => part.type === "text")?.text; return ""; }
  private threadDefaults(project: any) { return { approvalPolicy: project.defaults?.approvalPolicy, model: project.defaults?.model }; }
  private executionOverrides() { if (this.execution() === "safe") return { approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }; if (this.execution() === "unrestricted") return { approvalPolicy: "on-request", sandboxPolicy: { type: "dangerFullAccess" } }; return { approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }; }
  private appendLocalUserMessage(text: string) { const thread = this.selectedThread(); if (!thread) return; const turn = { id: `local-turn-${createId()}`, status: "inProgress", error: null, items: [{ id: `local-${createId()}`, type: "userMessage", content: [{ type: "text", text, text_elements: [] }] }] }; this.selectedThread.set({ ...thread, turns: [...(thread.turns ?? []), turn] }); }
  private observeComposer() { const element = this.composerRegion?.nativeElement; if (!element) return; this.resizeObserver = new ResizeObserver(([entry]) => this.composerHeight.set(entry.contentRect.height)); this.resizeObserver.observe(element); }
  private scheduleScroll(smooth: boolean, restore = false) { cancelAnimationFrame(this.scrollFrame); this.scrollFrame = requestAnimationFrame(() => { const el = this.timelineViewport?.nativeElement; if (!el) return; if (restore && this.selectedThread()) { this.restoreScrollPosition(this.selectedThread().id); return; } el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" }); }); }
  private saveScrollPosition() { const id = this.selectedThread()?.id; const el = this.timelineViewport?.nativeElement; if (id && el) sessionStorage.setItem(`codex.scroll.${id}`, String(el.scrollTop)); }
  private restoreScrollPosition(id: string) { requestAnimationFrame(() => { const el = this.timelineViewport?.nativeElement; if (!el) return; const saved = sessionStorage.getItem(`codex.scroll.${id}`); el.scrollTop = saved == null ? el.scrollHeight : Number(saved); this.onTimelineScroll(); }); }
  private showError(error: unknown) { this.error.set(error instanceof Error ? error.message : String(error)); }
}
