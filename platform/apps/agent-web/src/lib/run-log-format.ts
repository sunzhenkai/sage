import type { RunLogEvent } from '@/lib/types';

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1_000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}s`;
}

export function parseEventAtMs(payload: Record<string, unknown>): number | undefined {
  const at = payload.at;
  if (typeof at !== 'string' || at.length === 0) return undefined;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : undefined;
}

export function formatEventTime(payload: Record<string, unknown>, baseMs?: number): { clock?: string; elapsed?: string } {
  const ms = parseEventAtMs(payload);
  if (ms === undefined) return {};
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (baseMs === undefined || !Number.isFinite(baseMs) || ms < baseMs) return { clock };
  return { clock, elapsed: `+${formatDurationMs(ms - baseMs)}` };
}

export function eventTone(event: RunLogEvent): 'error' | 'success' | 'active' | 'neutral' {
  if (event.type === 'run.failed' || event.payload.ok === false) return 'error';
  if (event.type === 'run.completed' || (event.type === 'tool.completed' && event.payload.ok === true)) return 'success';
  if (event.type === 'model.completed') return 'active';
  return 'neutral';
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function prettyMaybeJson(raw: string): string {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return raw;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

export function summarizeRunLogEvent(event: RunLogEvent): string {
  const p = event.payload;
  switch (event.type) {
    case 'run.started': {
      const parts: string[] = [];
      const source = str(p.source);
      if (source !== undefined) parts.push(`source=${source}`);
      const attempt = num(p.attempt);
      if (attempt !== undefined) parts.push(`attempt ${attempt}`);
      const delivery = num(p.deliveryAttempt);
      if (delivery !== undefined && delivery > 1) parts.push(`delivery #${delivery}`);
      const slice = num(p.sliceNumber);
      if (slice !== undefined) parts.push(`slice #${slice}`);
      return parts.length > 0 ? parts.join(' · ') : 'run started';
    }
    case 'engine.started': {
      const parts: string[] = [];
      const modelId = str(p.modelId);
      if (modelId !== undefined) parts.push(modelId);
      else if (str(p.engine) !== undefined) parts.push(str(p.engine)!);
      if (p.toolsEnabled === true) {
        const cap = str(p.capabilities);
        parts.push(cap ? `tools: ${cap}` : 'tools enabled');
      } else if (p.toolsEnabled === false) {
        parts.push('text-only');
      }
      const maxTurns = num(p.maxTurns);
      if (maxTurns !== undefined) parts.push(`maxTurns=${maxTurns}`);
      const timeoutMs = num(p.timeoutMs);
      if (timeoutMs !== undefined) parts.push(`timeout=${formatDurationMs(timeoutMs)}`);
      return parts.length > 0 ? parts.join(' · ') : 'engine started';
    }
    case 'context.resolved': {
      const parts: string[] = [];
      const inputBytes = num(p.inputBytes);
      if (inputBytes !== undefined) parts.push(`input ${inputBytes} B`);
      const modelId = str(p.modelId);
      if (modelId !== undefined) parts.push(modelId);
      if (p.toolsEnabled === true) parts.push('tools enabled');
      return parts.length > 0 ? parts.join(' · ') : 'context resolved';
    }
    case 'model.completed': {
      const turn = num(p.turn);
      const prefix = turn !== undefined ? `turn ${turn}` : 'model';
      if (p.ok === false) {
        const err = str(p.error);
        return err ? `${prefix} failed · ${err}` : `${prefix} failed`;
      }
      if (p.inferred === true) return 'model completed (inferred)';
      const parts = [prefix];
      const modelId = str(p.modelId);
      if (modelId !== undefined) parts.push(modelId);
      const toolCount = num(p.toolCallCount);
      const toolNames = str(p.toolNames);
      if (toolCount !== undefined && toolCount > 0) {
        parts.push(toolNames ? `→ ${toolCount} tool(s): ${toolNames}` : `→ ${toolCount} tool(s)`);
      } else if (str(p.stopReason) !== undefined) {
        parts.push(str(p.stopReason)!);
      }
      const tokens = num(p.tokens);
      if (tokens !== undefined) parts.push(`${tokens} tok`);
      return parts.join(' · ');
    }
    case 'tool.completed': {
      const toolName = str(p.toolName);
      if (toolName !== undefined) {
        const turn = num(p.turn);
        const idx = num(p.index);
        const total = num(p.totalInTurn);
        const pos = turn !== undefined && idx !== undefined && total !== undefined
          ? `T${turn} [${idx}/${total}]`
          : turn !== undefined
            ? `T${turn}`
            : undefined;
        const status = p.ok === false
          ? (str(p.errorCode) ? `error (${str(p.errorCode)})` : 'error')
          : 'ok';
        return [pos, toolName, status].filter((x): x is string => x !== undefined).join(' · ');
      }
      const count = num(p.count);
      const total = num(p.total);
      if (count !== undefined) return total !== undefined ? `${count} tool call(s) (total ${total})` : `${count} tool call(s)`;
      return 'tool completed';
    }
    case 'checkpoint.sealed': {
      const ref = str(p.checkpointRef);
      return ref ? `checkpoint ${ref}` : 'checkpoint sealed';
    }
    case 'run.completed': {
      const parts: string[] = [str(p.status) ?? 'succeeded'];
      const turns = num(p.turns);
      const toolCalls = num(p.toolCalls);
      const tokens = num(p.tokens);
      if (turns !== undefined) parts.push(`${turns} turn(s)`);
      if (toolCalls !== undefined) parts.push(`${toolCalls} tool(s)`);
      if (tokens !== undefined) parts.push(`${tokens} tok`);
      const files = str(p.files);
      if (files !== undefined) parts.push(`files: ${files}`);
      return parts.join(' · ');
    }
    case 'run.failed': {
      const code = str(p.errorCode);
      const msg = str(p.message);
      const retry = p.retryable === true ? 'retryable' : p.retryable === false ? 'non-retryable' : undefined;
      return [code ?? 'failed', retry, msg].filter((x): x is string => x !== undefined).join(' · ');
    }
    default: {
      const entries = Object.entries(p).slice(0, 4).map(([k, v]) => `${k}=${String(v)}`);
      return entries.length > 0 ? entries.join(' · ') : event.type;
    }
  }
}

export interface DetailSection {
  readonly key: string;
  readonly labelKey: string;
  readonly text: string;
  readonly tone?: 'error';
}

export function extractDetailSections(event: RunLogEvent): DetailSection[] {
  const p = event.payload;
  const sections: DetailSection[] = [];
  const err = str(p.error) ?? str(p.message);
  if (err !== undefined && (event.type === 'run.failed' || p.ok === false)) {
    sections.push({ key: 'error', labelKey: 'tasks.runLogs.sectionError', text: err, tone: 'error' });
  }
  const args = str(p.args);
  if (args !== undefined) {
    sections.push({ key: 'args', labelKey: 'tasks.runLogs.sectionArgs', text: prettyMaybeJson(args) });
  }
  const resultPreview = str(p.resultPreview);
  if (resultPreview !== undefined) {
    sections.push({ key: 'result', labelKey: 'tasks.runLogs.sectionResult', text: prettyMaybeJson(resultPreview) });
  }
  const textPreview = str(p.textPreview);
  if (textPreview !== undefined) {
    sections.push({ key: 'output', labelKey: 'tasks.runLogs.sectionOutput', text: prettyMaybeJson(textPreview) });
  }
  return sections;
}
