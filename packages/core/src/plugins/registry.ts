import type {
  QuestionPlugin,
  ProctoringSignalPlugin,
  ExportTargetPlugin,
} from "./types.js";

/**
 * Registry managing runtime plugins for Pariksha (O-06).
 */
export class PluginRegistry {
  private questions = new Map<string, QuestionPlugin<unknown, unknown>>();
  private proctoringSignals = new Map<string, ProctoringSignalPlugin>();
  private exportTargets = new Map<string, ExportTargetPlugin>();

  registerQuestion<C, R>(plugin: QuestionPlugin<C, R>): void {
    if (this.questions.has(plugin.type)) {
      throw new Error(`Question plugin "${plugin.type}" is already registered.`);
    }
    this.questions.set(plugin.type, plugin);
  }

  getQuestion(type: string): QuestionPlugin<unknown, unknown> | undefined {
    return this.questions.get(type);
  }

  hasQuestion(type: string): boolean {
    return this.questions.has(type);
  }

  listQuestions(): readonly string[] {
    return Array.from(this.questions.keys());
  }

  registerProctoringSignal(plugin: ProctoringSignalPlugin): void {
    if (this.proctoringSignals.has(plugin.name)) {
      throw new Error(`Proctoring signal plugin "${plugin.name}" is already registered.`);
    }
    this.proctoringSignals.set(plugin.name, plugin);
  }

  getProctoringSignal(name: string): ProctoringSignalPlugin | undefined {
    return this.proctoringSignals.get(name);
  }

  listProctoringSignals(): readonly string[] {
    return Array.from(this.proctoringSignals.keys());
  }

  registerExportTarget(plugin: ExportTargetPlugin): void {
    if (this.exportTargets.has(plugin.format)) {
      throw new Error(`Export target plugin "${plugin.format}" is already registered.`);
    }
    this.exportTargets.set(plugin.format, plugin);
  }

  getExportTarget(format: string): ExportTargetPlugin | undefined {
    return this.exportTargets.get(format);
  }

  listExportTargets(): readonly string[] {
    return Array.from(this.exportTargets.keys());
  }

  clear(): void {
    this.questions.clear();
    this.proctoringSignals.clear();
    this.exportTargets.clear();
  }
}

/** Global default plugin registry instance */
export const plugins = new PluginRegistry();
