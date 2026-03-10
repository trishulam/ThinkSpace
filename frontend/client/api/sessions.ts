import type { AgentLogEntry, LogEntryType } from "../types/agent-live";
import type { NewSessionData, Session } from "../types/session";

export interface ApiSession {
  sessionId: string;
  userId: string;
  topic: string;
  goal: string | null;
  mode: Session["mode"];
  level: Session["level"];
  status: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  durationMs: number;
  summary: string | null;
  lastUserMessagePreview: string | null;
  lastAgentMessagePreview: string | null;
  latestCheckpointId: string | null;
  checkpointCount: number;
  milestoneCount: number;
}

export interface ApiCheckpoint {
  checkpointId: string;
  sessionId: string;
  version: number;
  createdAt: string;
  checkpointType: "material" | "semantic" | "hybrid";
  saveReason: string;
  triggerSource: string;
  label: string | null;
  summary: string | null;
  isImportant: boolean;
  includeInReplay: boolean;
  relatedTurnSequence: number | null;
  linkedMaterialCheckpointId: string | null;
  document: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
  agentAppState: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
}

export interface ApiSessionListResponse {
  sessions: ApiSession[];
}

export interface ApiTranscriptEntry {
  type: string;
  content: string;
  timestamp: string;
  isPartial?: boolean;
}

export interface ApiTranscriptTurn {
  turnId: string;
  sequence: number;
  entries: ApiTranscriptEntry[];
  status: string;
  completedAt: string;
}

export interface ApiSessionResumeResponse {
  session: ApiSession;
  latestCheckpoint: ApiCheckpoint | null;
  transcript?: ApiTranscriptTurn[];
}

export interface CreateSessionRequest extends NewSessionData {
  userId?: string;
}

export interface CreateCheckpointRequest {
  checkpointType?: "material" | "semantic" | "hybrid";
  saveReason?: string;
  triggerSource?: string;
  label?: string;
  summary?: string;
  isImportant?: boolean;
  includeInReplay?: boolean;
  document?: Record<string, unknown>;
  session?: Record<string, unknown>;
  agentAppState?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  linkedMaterialCheckpointId?: string;
  relatedTurnSequence?: number;
  clientUpdatedAt?: string;
}

function getSessionApiBaseUrl(): string {
  const explicitBaseUrl = import.meta.env.VITE_SESSION_API_BASE_URL?.trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/$/, "");
  }

  const wsBaseUrl = import.meta.env.VITE_AGENT_BACKEND_URL?.trim();
  if (wsBaseUrl) {
    if (wsBaseUrl.startsWith("wss://")) {
      return `https://${wsBaseUrl.slice("wss://".length)}`.replace(/\/$/, "");
    }
    if (wsBaseUrl.startsWith("ws://")) {
      return `http://${wsBaseUrl.slice("ws://".length)}`.replace(/\/$/, "");
    }
    return wsBaseUrl.replace(/\/$/, "");
  }

  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return "http://localhost:8000";
  }

  return window.location.origin;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getSessionApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const fallbackMessage = `Request failed with status ${response.status}`;
    let errorMessage = fallbackMessage;
    try {
      const errorBody = (await response.json()) as { detail?: string };
      errorMessage = errorBody.detail || fallbackMessage;
    } catch {
      // Ignore JSON parsing failures and use the fallback message instead.
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

export function apiSessionToSession(session: ApiSession): Session {
  return {
    id: session.sessionId,
    topic: session.topic,
    goal: session.goal || undefined,
    mode: session.mode,
    level: session.level,
    lastActive: new Date(session.lastActiveAt),
    duration: Math.round(session.durationMs / 60000),
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
  };
}

export async function listSessions(userId?: string): Promise<Session[]> {
  const searchParams = new URLSearchParams();
  if (userId) {
    searchParams.set("userId", userId);
  }

  const query = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
  const response = await requestJson<ApiSessionListResponse>(`/v1/sessions${query}`);
  return response.sessions.map(apiSessionToSession);
}

export async function createSession(
  request: CreateSessionRequest
): Promise<Session> {
  const response = await requestJson<ApiSession>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify(request),
  });
  return apiSessionToSession(response);
}

export async function getSessionResume(
  sessionId: string
): Promise<ApiSessionResumeResponse> {
  return requestJson<ApiSessionResumeResponse>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/resume`
  );
}

const VALID_LOG_ENTRY_TYPES: LogEntryType[] = [
  "user-text",
  "user-transcription",
  "user-audio",
  "agent-text",
  "agent-transcription",
  "agent-audio",
  "tool-call",
  "tool-result",
  "system",
];

/** Convert persisted transcript turns to AgentLogEntry[] for the sidebar. */
export function transcriptToEventLog(
  transcript: ApiTranscriptTurn[] | undefined
): AgentLogEntry[] {
  if (!transcript?.length) return [];
  const entries: AgentLogEntry[] = [];
  let idx = 0;
  for (const turn of transcript) {
    for (const e of turn.entries) {
      const type = VALID_LOG_ENTRY_TYPES.includes(e.type as LogEntryType)
        ? (e.type as LogEntryType)
        : "system";
      entries.push({
        id: `persisted-${turn.turnId}-${idx}`,
        timestamp: new Date(e.timestamp),
        type,
        content: e.content,
        isPartial: e.isPartial ?? false,
      });
      idx += 1;
    }
  }
  return entries;
}

export async function createCheckpoint(
  sessionId: string,
  request: CreateCheckpointRequest
): Promise<ApiCheckpoint> {
  return requestJson<ApiCheckpoint>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/checkpoints`,
    {
      method: "POST",
      body: JSON.stringify(request),
    }
  );
}
