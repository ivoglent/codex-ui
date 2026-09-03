import { Component, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import type { ScheduleRecord, ScheduleStatus } from "./schedule.types";
import { ScheduleStore } from "./schedule.store";

interface ModelPairOption { key: string; label: string; model: string; modelProvider: string }

@Component({
  selector: "codex-schedule",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./schedule.component.html",
  styleUrl: "./schedule.component.css"
})
export class ScheduleComponent {
  private readonly store = inject(ScheduleStore);
  readonly records = this.store.records;
  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly pending = this.store.pending;
  readonly running = this.store.running;
  readonly history = this.store.history;
  readonly safeRoot = signal<string>("");

  readonly dialogOpen = signal(false);
  readonly editing = signal<ScheduleRecord | null>(null);
  readonly saving = signal(false);
  readonly dialogError = signal<string | null>(null);

  // Individual writable signals so Angular's ngModel two-way binding actually
  // updates the form. The previous single-signal `form.update(...)` pattern was
  // fighting ngModelChange and made the prompt and working directory read-only.
  readonly promptInput = signal("");
  readonly cwdInput = signal("");
  readonly cronInput = signal("");
  readonly modelKey = signal<string | undefined>(undefined);
  readonly modelProvider = signal<string | undefined>(undefined);

  readonly modelOptions = signal<ModelPairOption[]>([]);

  readonly canSave = computed(() => {
    return !this.saving()
      && this.promptInput().trim().length > 0
      && this.cwdInput().trim().length > 0
      && this.cronInput().trim().length > 0;
  });

  constructor() {
    void this.store.refresh();
    void this.loadModelOptions();
    void this.fetchSafeRoot();
  }

  private async fetchSafeRoot(): Promise<void> {
    try {
      const response = await fetch("/api/system/status");
      if (!response.ok) return;
      const body = await response.json().catch(() => ({}));
      const safeRoot = typeof body?.schedule?.safeRoot === "string" ? body.schedule.safeRoot : "";
      if (safeRoot) this.safeRoot.set(safeRoot);
    } catch { /* noop */ }
  }

  private async loadModelOptions(): Promise<void> {
    try {
      const response = await fetch("/api/model-presets");
      if (!response.ok) return;
      const body = await response.json().catch(() => ({}));
      const presets = Array.isArray(body?.presets) ? body.presets : [];
      const options: ModelPairOption[] = presets.flatMap((preset: any) => {
        if (!preset || typeof preset.model !== "string" || typeof preset.modelProvider !== "string") return [];
        return [{ key: `${preset.model}|${preset.modelProvider}`, label: `${preset.model} · ${preset.modelProvider}`, model: preset.model, modelProvider: preset.modelProvider }];
      });
      this.modelOptions.set(options);
    } catch { /* noop */ }
  }

  badgeClass(status: ScheduleStatus): string { return `status-badge status-${status}`; }

  promptPreview(schedule: ScheduleRecord): string {
    const trimmed = schedule.prompt.trim().replace(/\s+/g, " ");
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  }

  formatRunAt(iso: string | undefined): string {
    if (!iso) return "—";
    try {
      const date = new Date(iso);
      return date.toLocaleString();
    } catch { return iso; }
  }

  modelLabel(schedule: ScheduleRecord): string {
    if (!schedule.modelKey) return "ChatGPT (default)";
    return `${schedule.modelKey}${schedule.modelProvider ? " · " + schedule.modelProvider : ""}`;
  }

  modelSelectValue(): string {
    const key = this.modelKey();
    if (!key) return "";
    const provider = this.modelProvider() ?? "";
    return `${key}|${provider}`;
  }

  onModelChange(value: string): void {
    if (!value) {
      this.modelKey.set(undefined);
      this.modelProvider.set(undefined);
      return;
    }
    const match = this.modelOptions().find((option) => option.key === value);
    if (!match) {
      this.modelKey.set(undefined);
      this.modelProvider.set(undefined);
      return;
    }
    this.modelKey.set(match.model);
    this.modelProvider.set(match.modelProvider);
  }

  openCreate(): void {
    this.editing.set(null);
    this.promptInput.set("");
    this.cwdInput.set(this.safeRoot() ? this.safeRoot() + "/" : "");
    this.cronInput.set("*/5 * * * *");
    this.modelKey.set(undefined);
    this.modelProvider.set(undefined);
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  openEdit(schedule: ScheduleRecord): void {
    if (schedule.status !== "pending") return;
    this.editing.set(schedule);
    this.promptInput.set(schedule.prompt);
    this.cwdInput.set(schedule.cwd);
    this.cronInput.set(schedule.cron);
    this.modelKey.set(schedule.modelKey);
    this.modelProvider.set(schedule.modelProvider);
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    if (this.saving()) return;
    this.dialogOpen.set(false);
    this.editing.set(null);
    this.dialogError.set(null);
  }

  onBackdropMouseDown(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeDialog();
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const prompt = this.promptInput().trim();
    const cwd = this.cwdInput().trim();
    const cron = this.cronInput().trim();
    if (!prompt || !cwd || !cron) { this.dialogError.set("Prompt, working directory, and cron are required."); return; }
    this.saving.set(true);
    this.dialogError.set(null);
    try {
      const editing = this.editing();
      const payload = { prompt, cwd, cron, modelKey: this.modelKey(), modelProvider: this.modelProvider() };
      if (editing) await this.store.update(editing.id, payload);
      else await this.store.create(payload);
      this.dialogOpen.set(false);
      this.editing.set(null);
    } catch (error) {
      this.dialogError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }

  async run(id: string): Promise<void> {
    try { await this.store.run(id); }
    catch (error) { this.store.setError({ code: "RUN_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  }

  async cancel(id: string): Promise<void> {
    try { await this.store.cancel(id); }
    catch (error) { this.store.setError({ code: "CANCEL_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  }

  async remove(schedule: ScheduleRecord): Promise<void> {
    if (!confirm(`Delete schedule "${this.promptPreview(schedule)}"?`)) return;
    try { await this.store.remove(schedule.id); }
    catch (error) { this.store.setError({ code: "DELETE_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  }
}
