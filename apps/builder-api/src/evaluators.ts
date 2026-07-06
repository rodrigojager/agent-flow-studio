import { WorkspaceError } from "./workspace.ts";

export interface ExternalEvaluatorRequest {
  endpointUrl?: string;
  headers?: Record<string, unknown>;
  payload?: unknown;
  passPath?: string;
  reasonPath?: string;
  scorePath?: string;
  verdictPath?: string;
  minScore?: number | null;
  timeoutMs?: number;
}

export interface ExternalEvaluatorResult {
  format: "agent-flow-builder.external-evaluator-result.v1";
  ok: boolean;
  pass: boolean;
  severity: "pass" | "fail";
  verdict: string;
  reason: string;
  score: number | null;
  status: number;
  elapsedMs: number;
  raw: unknown;
}

export async function evaluateExternalEvaluator(body: unknown): Promise<ExternalEvaluatorResult> {
  if (!isRecord(body)) {
    throw new WorkspaceError("Payload do evaluator externo deve ser objeto.", 400);
  }
  const endpointUrl = requiredString(body.endpointUrl, "endpointUrl");
  const url = parseEndpointUrl(endpointUrl);
  const headers = normalizeHeaders(body.headers);
  const timeoutMs = normalizeTimeoutMs(body.timeoutMs);
  const passPath = optionalPath(body.passPath, "passPath", "pass");
  const reasonPath = optionalPath(body.reasonPath, "reasonPath", "reason");
  const scorePath = optionalPath(body.scorePath, "scorePath", "score");
  const verdictPath = optionalPath(body.verdictPath, "verdictPath", "verdict");
  const minScore = normalizeMinScore(body.minScore);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...headers,
      },
      body: JSON.stringify(body.payload ?? {}),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const raw = parseEvaluatorResponseBody(rawText);
    if (!response.ok) {
      throw new WorkspaceError(`Evaluator externo retornou HTTP ${response.status}.`, 502, raw);
    }
    const passValue = readJsonPath(raw, passPath);
    const scoreValue = readJsonPath(raw, scorePath);
    const reasonValue = readJsonPath(raw, reasonPath);
    const verdictValue = readJsonPath(raw, verdictPath);
    const score = normalizeScore(scoreValue.value);
    const pass = passValue.found ? normalizePass(passValue.value) : score !== null && score >= minScore;
    const reason = typeof reasonValue.value === "string" ? reasonValue.value : "";
    const verdict =
      typeof verdictValue.value === "string" && verdictValue.value.trim()
        ? verdictValue.value.trim()
        : pass
          ? "Evaluator externo aprovou a saída."
          : "Evaluator externo reprovou a saída.";
    return {
      format: "agent-flow-builder.external-evaluator-result.v1",
      ok: true,
      pass,
      severity: pass ? "pass" : "fail",
      verdict,
      reason,
      score,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      raw,
    };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new WorkspaceError(`Evaluator externo excedeu timeout de ${timeoutMs}ms.`, 504);
    }
    throw new WorkspaceError(error instanceof Error ? error.message : "Falha ao executar evaluator externo.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function parseEndpointUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError("endpointUrl deve ser uma URL HTTP/HTTPS válida.", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError("endpointUrl deve usar http ou https.", 400);
  }
  return parsed.toString();
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new WorkspaceError("headers deve ser um objeto string:string.", 400);
  }
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) {
      throw new WorkspaceError(`Header inválido: ${key}.`, 400);
    }
    if (typeof headerValue !== "string") {
      throw new WorkspaceError(`Header ${key} deve ser string.`, 400);
    }
    if (key.toLowerCase() === "host" || key.toLowerCase() === "content-length") {
      continue;
    }
    headers[key] = headerValue;
  }
  return headers;
}

function parseEvaluatorResponseBody(value: string): unknown {
  if (!value.trim()) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { text: value };
  }
}

function readJsonPath(value: unknown, path: string): { found: boolean; value: unknown } {
  const segments = jsonPathSegments(path);
  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !(segment in current)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function jsonPathSegments(path: string): string[] {
  const normalized = path.trim().replace(/^\$\.?/, "");
  const segments: string[] = [];
  for (const part of normalized.split(".")) {
    const matches = part.matchAll(/([^\[\]]+)|\[(\d+)\]/g);
    for (const match of matches) {
      const segment = match[1] ?? match[2];
      if (segment) {
        segments.push(segment);
      }
    }
  }
  return segments;
}

function normalizePass(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    return ["true", "pass", "passed", "ok", "approved", "aprovado", "sim"].includes(value.trim().toLowerCase());
  }
  return false;
}

function normalizeScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10_000;
  }
  return Math.min(60_000, Math.max(500, Math.round(value)));
}

function normalizeMinScore(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return 0.7;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorkspaceError("minScore deve ser número quando informado.", 400);
  }
  return value;
}

function optionalPath(value: unknown, name: string, fallback: string): string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} deve ser string.`, 400);
  }
  return value.trim();
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} é obrigatório.`, 400);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
