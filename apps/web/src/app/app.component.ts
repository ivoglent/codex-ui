import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import { ConnectionService } from "./connection.service";
import { TimelineStore } from "./timeline.store";
import { DraftStore } from "./draft.store";
import { buildChatItems, ChatItem } from "./chat-presenter";
import { renderMarkdown } from "./markdown";
import { createId } from "./id";
import { isNearBottom as calculateNearBottom, restoredScrollTop, scrollBehavior } from "./chat-scroll";
import { ALL_SESSIONS_ID, projectForThread, sessionLocation, threadListParams, threadsForProject } from "./session-scope";
import { approvalResult, supportsSessionApproval as canApproveForSession, type ApprovalDecision } from "./approval";
import { filterProjects, groupSessions, projectLabel, sessionTitle } from "./selector-utils";

type PrimaryTab = "chat" | "inbox" | "settings";

@Component({ selector: "codex-root", standalone: true, imports: [CommonModule, FormsModule], templateUrl: "./app.component.html" })
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild("shell") shell?: ElementRef<HTMLElement>;
  @ViewChild("timelineViewport") timelineViewport?: ElementRef<HTMLElement>;
  @ViewChild("timelineContent") timelineContent?: ElementRef<HTMLElement>;
  @ViewChild("bottomSentinel") bottomSentinel?: ElementRef<HTMLElement>;
  @ViewChild("composerRegion") composerRegion?: ElementRef<HTMLElement>;
  @ViewChild("bottomNav") bottomNav?: ElementRef<HTMLElement>;
  @ViewChild("projectTrigger") projectTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild("sessionTrigger") sessionTrigger?: ElementRef<HTMLButtonElement>;
  private loadedProjectId = "";
  private composerResizeObserver?: ResizeObserver;
  private timelineResizeObserver?: ResizeObserver;
  private navResizeObserver?: ResizeObserver;
  private sentinelObserver?: IntersectionObserver;
  private visualViewportListener?: () => void;
  private scrollFrame = 0;
  private lastVisibleCount = 0;
  private userScrollTimer = 0;
  readonly connection = inject(ConnectionService);
  readonly store = inject(TimelineStore);
  readonly drafts = inject(DraftStore);
  readonly threads = signal<any[]>([]);
  readonly selectedThread = signal<any>(null);
  readonly allSessionsId = ALL_SESSIONS_ID;
  readonly projectId = signal(localStorage.getItem("codex.sessionScope") ?? ALL_SESSIONS_ID);
  readonly tab = signal<PrimaryTab>((localStorage.getItem("codex.tab") as PrimaryTab) || "chat");
  readonly draft = signal("");
  readonly sending = signal(false);
  readonly error = signal("");
  readonly effort = signal(localStorage.getItem("codex.effort") ?? "medium");
  readonly execution = signal(localStorage.getItem("codex.execution") ?? "unrestricted");
  readonly answers = signal<Record<string, Record<string, string[]>>>({});
  readonly elicitationContent = signal<Record<string, string>>({});
  readonly isNearBottom = signal(true);
  readonly hasUnseenUpdates = signal(false);
  readonly unseenUpdateCount = signal(0);
  readonly composerHeight = signal(132);
  readonly bottomNavHeight = signal(64);
  readonly sessionMenuOpen = signal(false);
  readonly composerSettingsOpen = signal(false);
  readonly historyLimit = signal(160);
  readonly selectorOpen = signal<"project" | "session" | null>(null);
  readonly selectorQuery = signal("");
  readonly selectorActiveIndex = signal(0);
  readonly includeArchived = signal(false);
  readonly isUserScrolling = signal(false);
  readonly projects = computed(() => this.connection.snapshot()?.projects ?? []);
  readonly filteredProjects = computed(() => filterProjects(this.projects(), this.selectorQuery()));
  readonly filteredThreads = computed(() => { const query = this.selectorQuery().trim().toLocaleLowerCase(); return this.threads().filter((thread) => !query || this.formatThread(thread).toLocaleLowerCase().includes(query)); });
  readonly groupedThreads = computed(() => groupSessions(this.filteredThreads(), this.includeArchived()));
  readonly hasArchivedThreads = computed(() => groupSessions(this.filteredThreads(), true).some((group) => group.name === "Archived"));
  readonly selectedProject = computed(() => this.projects().find((project: any) => project.id === this.projectId()));
  readonly codeProject = computed(() => this.selectedProject() ?? projectForThread(this.projects(), this.selectedThread()));
  readonly canCreateThread = computed(() => Boolean(this.selectedProject()));
  readonly timeline = computed(() => this.store.events().filter((event) => !this.selectedThread() || JSON.stringify(event.params).includes(this.selectedThread().id)));
  readonly chat = computed(() => buildChatItems(this.selectedThread(), this.timeline()));
  readonly meaningfulItemCount = computed(() => this.chat().filter((item) => !item.key.startsWith("delta:") && item.kind !== "reasoning" && item.kind !== "status").length + this.selectedPending().length);
  readonly visibleChat = computed(() => this.chat().slice(-this.historyLimit()));
  readonly selectedPending = computed(() => this.connection.pending().filter((request) => request.params?.threadId === this.selectedThread()?.id));
  readonly activeApproval = computed(() => this.selectedPending()[0] ?? null);
  readonly active = computed(() => {
    const status = this.selectedThread()?.status?.type ?? this.selectedThread()?.status;
    const events = this.timeline().filter((event) => event.method === "turn/started" || event.method === "turn/completed");
    return events.at(-1)?.method === "turn/started" || (!events.length && (status === "active" || status === "inProgress"));
  });
  readonly activity = computed(() => {
    if (this.selectedPending().length) return "Waiting for approval";
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
      if (!id || this.loadedProjectId === id || (id !== ALL_SESSIONS_ID && !this.projects().some((project: any) => project.id === id))) return;
      this.loadedProjectId = id;
      void this.refreshThreads();
    });
    effect(() => {
      const count = this.meaningfulItemCount();
      if (count > this.lastVisibleCount && this.lastVisibleCount) {
        if (this.isNearBottom()) this.scheduleScroll(false);
        else { this.hasUnseenUpdates.set(true); this.unseenUpdateCount.update((value) => value + (count - this.lastVisibleCount)); }
      }
      this.lastVisibleCount = count;
    });
  }

  ngAfterViewInit() { this.observeLayout(); this.scheduleScroll(false, true); }
  ngOnDestroy() { this.composerResizeObserver?.disconnect(); this.timelineResizeObserver?.disconnect(); this.navResizeObserver?.disconnect(); this.sentinelObserver?.disconnect(); if (this.visualViewportListener) visualViewport?.removeEventListener("resize", this.visualViewportListener); cancelAnimationFrame(this.scrollFrame); clearTimeout(this.userScrollTimer); }
  selectTab(tab: PrimaryTab) { this.tab.set(tab); localStorage.setItem("codex.tab", tab); if (tab === "chat") { this.scheduleScroll(false); this.updateNearBottom(); } }

  selectProject(id: string) {
    this.saveScrollPosition(); this.projectId.set(id); localStorage.setItem("codex.sessionScope", id);
    this.selectedThread.set(null); this.threads.set([]); this.loadedProjectId = ""; this.clearUnseenUpdates();
  }

  async refreshThreads() {
    const project = this.selectedProject();
    if (this.projectId() !== ALL_SESSIONS_ID && !project) return;
    try {
      // The app-server cwd filter is exact-match only. Fetch the common list and
      // apply project root-or-descendant ownership consistently in the client.
      const result = await this.connection.rpc("thread/list", threadListParams());
      this.threads.set(threadsForProject(result.data ?? [], project));
      const remembered = localStorage.getItem(`codex.thread.${this.projectId()}`);
      const selected = this.threads().find((thread) => thread.id === remembered) ?? this.threads()[0];
      if (selected) await this.selectThread(selected);
    } catch (error) { this.showError(error); }
  }

  async selectThread(thread: any) {
    if (!thread) return;
    this.saveScrollPosition(); this.selectedThread.set(thread); this.historyLimit.set(160); this.lastVisibleCount = 0; this.clearUnseenUpdates();
    localStorage.setItem(`codex.thread.${this.projectId()}`, thread.id);
    this.draft.set(await this.drafts.get(thread.id));
    try { const result = await this.connection.rpc("thread/resume", { threadId: thread.id }); if (result.thread) this.selectedThread.set(result.thread); }
    catch (error) { this.showError(error); }
    this.restoreScrollPosition(thread.id);
  }

  selectThreadById(id: string) { const thread = this.threads().find((item) => item.id === id); if (thread) void this.selectThread(thread); }
  openSelector(kind: "project" | "session") { if (this.selectorOpen()) return; this.selectorQuery.set(""); this.selectorActiveIndex.set(0); this.selectorOpen.set(kind); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".selector-dialog input")?.focus()); }
  closeSelector(restoreFocus = true) { const kind = this.selectorOpen(); this.selectorOpen.set(null); this.selectorQuery.set(""); if (restoreFocus) requestAnimationFrame(() => (kind === "project" ? this.projectTrigger : this.sessionTrigger)?.nativeElement.focus()); }
  chooseProject(id: string) { this.selectProject(id); this.closeSelector(); }
  chooseThread(thread: any) { void this.selectThread(thread); this.closeSelector(); }
  selectorOptions() { return this.selectorOpen() === "project" ? this.filteredProjects() : this.groupedThreads().flatMap((group) => group.items); }
  onSelectorKeydown(event: KeyboardEvent) { const options = this.selectorOptions(); if (event.key === "Escape") { event.preventDefault(); this.closeSelector(); return; } if (!options.length) return; if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const delta = event.key === "ArrowDown" ? 1 : -1; this.selectorActiveIndex.update((value) => (value + delta + options.length) % options.length); document.getElementById(`selector-option-${this.selectorActiveIndex()}`)?.scrollIntoView({ block: "nearest" }); } else if (event.key === "Enter") { event.preventDefault(); const option = options[this.selectorActiveIndex()]; this.selectorOpen() === "project" ? this.chooseProject(option.id) : this.chooseThread(option); } else if (event.key === "Tab") { const dialog = document.querySelector<HTMLElement>(".selector-dialog"); const focusable = dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')] : []; if (focusable.length) { const first = focusable[0], last = focusable.at(-1)!; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } } }
  projectDisplay(project: any) { return projectLabel(project); }
  async newThread() {
    const project = this.selectedProject(); if (!project) { this.error.set("Select a project before creating a new session."); return; }
    try { const result = await this.connection.rpc("thread/start", { cwd: project.root, ...this.threadDefaults(project) }); this.threads.update((items) => [result.thread, ...items]); await this.selectThread(result.thread); }
    catch (error) { this.showError(error); }
  }

  updateDraft(value: string) { this.draft.set(value); void this.drafts.set(this.selectedThread()?.id ?? `project:${this.projectId()}`, value); }
  autoGrow(target: EventTarget | null) { const element = target as HTMLTextAreaElement; element.style.height = "auto"; element.style.height = `${Math.min(element.scrollHeight, 160)}px`; }
  async send() {
    const text = this.draft().trim(); if (!text || this.sending()) return; this.sending.set(true);
    try { if (!this.selectedThread()) await this.newThread(); const thread = this.selectedThread(); if (!thread) return; this.appendLocalUserMessage(text); this.updateDraft(""); this.isNearBottom.set(true); this.clearUnseenUpdates(); this.scheduleScroll(false); await this.connection.rpc("turn/start", { threadId: thread.id, input: [{ type: "text", text, text_elements: [] }], effort: this.effort(), ...this.executionOverrides() }); }
    catch (error) { this.showError(error); } finally { this.sending.set(false); }
  }
  async steer() { const thread = this.selectedThread(); const text = this.draft().trim(); if (!thread || !text || this.sending()) return; this.sending.set(true); this.appendLocalUserMessage(text); this.updateDraft(""); this.isNearBottom.set(true); this.clearUnseenUpdates(); this.scheduleScroll(false); try { await this.connection.rpc("turn/steer", { threadId: thread.id, input: [{ type: "text", text, text_elements: [] }] }); } catch (error) { this.showError(error); } finally { this.sending.set(false); } }
  stop() { const thread = this.selectedThread(); if (thread) void this.connection.rpc("turn/interrupt", { threadId: thread.id }).catch((error) => this.showError(error)); }
  onComposerKeydown(event: KeyboardEvent) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); this.active() ? void this.steer() : void this.send(); } }
  onTimelineScroll() { this.isUserScrolling.set(true); clearTimeout(this.userScrollTimer); this.userScrollTimer = window.setTimeout(() => this.isUserScrolling.set(false), 140); this.updateNearBottom(); this.saveScrollPosition(); }
  scrollToLatest() { const sentinel = this.bottomSentinel?.nativeElement; if (sentinel) sentinel.scrollIntoView({ block: "end", behavior: scrollBehavior(matchMedia("(prefers-reduced-motion: reduce)").matches) }); else this.scheduleScroll(false); }

  openCode(path?: string) { const project = this.codeProject(); if (!project?.codeServerUrl) return; const url = path ? `${project.codeServerUrl.replace(/\/$/, "")}/?folder=${encodeURIComponent(project.root)}&file=${encodeURIComponent(path)}` : project.codeServerUrl; window.open(url, "_blank", "noopener"); }
  setAnswer(requestKey: string, questionId: string, value: string) { this.answers.update((all) => ({ ...all, [requestKey]: { ...(all[requestKey] ?? {}), [questionId]: [value] } })); }
  submitAnswers(request: any) { this.resolveAttention(request, { answers: this.answers()[request.requestKey] ?? {} }); }
  setElicitation(requestKey: string, value: string) { this.elicitationContent.update((all) => ({ ...all, [requestKey]: value })); }
  submitElicitation(request: any) { let content: unknown; try { content = JSON.parse(this.elicitationContent()[request.requestKey] || "{}"); } catch { this.error.set("The response must be valid JSON."); return; } this.resolveAttention(request, { action: "accept", content, _meta: null }); }
  approve(request: any, decision: ApprovalDecision) { this.resolveAttention(request, approvalResult(request.method, request.params, decision)); }
  supportsSessionApproval(request: any) { return canApproveForSession(request.method); }
  async sessionAction(action: string) { const thread = this.selectedThread(); if (!thread) return; this.sessionMenuOpen.set(false); try { if (action === "rename") { const name = prompt("Session name", this.formatThread(thread)); if (name) await this.connection.rpc("thread/name/set", { threadId: thread.id, name }); } else if (action === "goal") { const objective = prompt("Session goal", thread.goal?.objective ?? ""); if (objective) await this.connection.rpc("thread/goal/set", { threadId: thread.id, objective }); } else if (action === "pin") await this.connection.rpc("thread/metadata/update", { threadId: thread.id, isPinned: !thread.isPinned }); else if (action === "fork") { const result = await this.connection.rpc("thread/fork", { threadId: thread.id }); this.threads.update((items) => [result.thread, ...items]); await this.selectThread(result.thread); } else if (action === "compact") await this.connection.rpc("thread/compact/start", { threadId: thread.id }); else if (action === "archive") await this.connection.rpc("thread/archive", { threadId: thread.id }); else if (action === "delete" && confirm("Delete this session? This cannot be undone.")) await this.connection.rpc("thread/delete", { threadId: thread.id }); await this.refreshThreads(); } catch (error) { this.showError(error); } }
  goToAttention(request: any) { this.selectTab("chat"); const threadId = request.params?.threadId; if (threadId) this.selectThreadById(threadId); this.hasUnseenUpdates.set(true); this.unseenUpdateCount.set(1); }
  persistSetting(key: string, value: string) { localStorage.setItem(`codex.${key}`, value); }
  formatThread(thread: any) { return sessionTitle({ ...thread, firstPrompt: this.firstPrompt(thread) }); }
  threadLocation(thread: any) { return sessionLocation(this.projects(), thread); }
  threadStatus(thread: any) { const status = thread?.status?.type ?? thread?.status ?? "idle"; return status === "inProgress" ? "Running" : status.charAt(0).toUpperCase() + status.slice(1); }
  markdown(value: string) { return renderMarkdown(value); }
  commandSummary(item: ChatItem) { if (item.status === "inProgress") return "Running…"; if (item.meta?.exitCode && item.meta.exitCode !== 0) return `Failed · exit code ${item.meta.exitCode}`; return [item.status === "completed" ? "Completed" : item.status, item.meta?.duration].filter(Boolean).join(" · ") || "View result"; }
  changes(item: ChatItem) { return item.meta?.changes ?? []; }
  changeLabel(change: any) { const value = change?.kind ?? change?.type ?? "modified"; if (typeof value === "string") return value; if (value && typeof value === "object") return String(value.type ?? value.kind ?? value.name ?? "modified"); return String(value); }
  changeCounts(item: ChatItem) { const counts: Record<string, number> = {}; for (const change of this.changes(item)) { const type = this.changeLabel(change); counts[type] = (counts[type] ?? 0) + 1; } return Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(" · "); }
  changePaths(item: ChatItem) { return this.changes(item).map((change: any) => change.path).filter(Boolean).join("\n"); }
  planSteps(item: ChatItem) { return item.meta?.steps ?? (item.body ? item.body.split("\n").filter(Boolean).map((step) => ({ step, status: "pending" })) : []); }
  planDone(item: ChatItem) { return this.planSteps(item).filter((step: any) => step.status === "completed").length; }
  copy(value: string) { void navigator.clipboard?.writeText(value).catch(() => this.error.set("Could not copy to the clipboard.")); }
  attentionTitle(request: any) { if (request.method === "item/tool/requestUserInput") return "Codex needs input"; if (request.method?.includes("fileChange")) return "Approve file changes"; return "Approval required"; }
  attentionSummary(request: any) { return request.params?.reason || request.params?.message || request.params?.command || request.params?.tool || "Codex needs your decision before it can continue."; }

  private resolveAttention(request: any, result: unknown) { try { this.connection.resolve(request.requestKey, result); this.answers.update((all) => { const { [request.requestKey]: _removed, ...rest } = all; return rest; }); this.elicitationContent.update((all) => { const { [request.requestKey]: _removed, ...rest } = all; return rest; }); } catch (error) { this.showError(error); } }
  private firstPrompt(thread: any) { for (const turn of thread?.turns ?? []) for (const item of turn.items ?? []) if (item.type === "userMessage") return item.content?.find((part: any) => part.type === "text")?.text; return ""; }
  private threadDefaults(project: any) { return { approvalPolicy: project.defaults?.approvalPolicy, model: project.defaults?.model }; }
  private executionOverrides() {
    const approvalPolicy = this.selectedProject()?.defaults?.approvalPolicy ?? "never";
    if (this.execution() === "safe") return { approvalPolicy, sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
    if (this.execution() === "unrestricted") return { approvalPolicy, sandboxPolicy: { type: "dangerFullAccess" } };
    return { approvalPolicy, sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } };
  }
  private appendLocalUserMessage(text: string) { const thread = this.selectedThread(); if (!thread) return; const turn = { id: `local-turn-${createId()}`, status: "inProgress", error: null, items: [{ id: `local-${createId()}`, type: "userMessage", content: [{ type: "text", text, text_elements: [] }] }] }; this.selectedThread.set({ ...thread, turns: [...(thread.turns ?? []), turn] }); }
  private observeLayout() {
    const composer = this.composerRegion?.nativeElement;
    if (composer) { this.composerResizeObserver = new ResizeObserver(([entry]) => { this.composerHeight.set(entry.contentRect.height); this.setLayoutVariables(); this.updateNearBottom(); }); this.composerResizeObserver.observe(composer); }
    const timeline = this.timelineViewport?.nativeElement;
    const content = this.timelineContent?.nativeElement;
    if (timeline && content) { this.timelineResizeObserver = new ResizeObserver(() => { this.setLayoutVariables(); this.updateNearBottom(); if (this.isNearBottom()) this.scheduleScroll(false); }); this.timelineResizeObserver.observe(content); }
    const sentinel = this.bottomSentinel?.nativeElement;
    if (timeline && sentinel) { this.sentinelObserver = new IntersectionObserver(([entry]) => this.updateNearBottom(entry.isIntersecting), { root: timeline, threshold: 0.01 }); this.sentinelObserver.observe(sentinel); }
    const nav = this.bottomNav?.nativeElement; if (nav) this.bottomNavHeight.set(nav.getBoundingClientRect().height);
    if (nav) { this.navResizeObserver = new ResizeObserver(([entry]) => { this.bottomNavHeight.set(entry.borderBoxSize?.[0]?.blockSize ?? nav.getBoundingClientRect().height); this.setLayoutVariables(); }); this.navResizeObserver.observe(nav); }
    this.setLayoutVariables();
    this.visualViewportListener = () => { this.setLayoutVariables(); this.updateNearBottom(); if (this.isNearBottom()) this.scheduleScroll(false); };
    visualViewport?.addEventListener("resize", this.visualViewportListener);
  }
  private setLayoutVariables() { const host = this.shell?.nativeElement; if (!host) return; host.style.setProperty("--composer-height", `${this.composerHeight()}px`); host.style.setProperty("--bottom-nav-height", `${this.bottomNavHeight()}px`); host.style.setProperty("--visual-viewport-height", `${visualViewport?.height ?? window.innerHeight}px`); }
  private updateNearBottom(sentinelVisible = false) { const el = this.timelineViewport?.nativeElement; if (!el) return; const near = calculateNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight, sentinelVisible); this.isNearBottom.set(near); if (near) this.clearUnseenUpdates(); }
  private clearUnseenUpdates() { this.hasUnseenUpdates.set(false); this.unseenUpdateCount.set(0); }
  private scheduleScroll(smooth: boolean, restore = false) { cancelAnimationFrame(this.scrollFrame); this.scrollFrame = requestAnimationFrame(() => { const el = this.timelineViewport?.nativeElement; if (!el) return; if (restore && this.selectedThread()) { this.restoreScrollPosition(this.selectedThread().id); return; } el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" }); }); }
  private saveScrollPosition() { const id = this.selectedThread()?.id; const el = this.timelineViewport?.nativeElement; if (id && el) sessionStorage.setItem(`codex.scroll.${id}`, String(el.scrollTop)); }
  private restoreScrollPosition(id: string) { requestAnimationFrame(() => { const el = this.timelineViewport?.nativeElement; if (!el) return; el.scrollTop = restoredScrollTop(sessionStorage.getItem(`codex.scroll.${id}`), el.scrollHeight); this.updateNearBottom(); }); }
  private showError(error: unknown) { this.error.set(error instanceof Error ? error.message : String(error)); }
}
