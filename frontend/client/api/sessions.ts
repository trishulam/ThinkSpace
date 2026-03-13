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
  document: unknown | null;
  session: unknown | null;
  agentAppState: unknown | null;
  payload: unknown | null;
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

export interface ApiAdkSessionSummary {
  sessionId: string;
  userId: string;
  eventCount: number;
  stateKeyCount: number;
  lastUpdateTime: number | null;
  latestInvocationId: string | null;
}

export interface ApiSessionResumeResponse {
  session: ApiSession;
  latestCheckpoint: ApiCheckpoint | null;
  transcript?: ApiTranscriptTurn[];
  adkSession?: ApiAdkSessionSummary | null;
}

export interface ApiRecordingSegment {
  segmentId: string;
  sessionId: string;
  sequence: number;
  status: "ready";
  fileName: string;
  relativePath: string;
  mimeType: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  sizeBytes: number;
}

export interface ApiSessionRecordingManifest {
  sessionId: string;
  status: "idle" | "recording" | "ready" | "processing" | "failed";
  segments: ApiRecordingSegment[];
  finalFileName: string | null;
  finalRelativePath: string | null;
  finalMimeType: string | null;
  finalSizeBytes: number | null;
  mergedAt: string | null;
  error: string | null;
  updatedAt: string;
}

export interface ApiSessionKeyMoment {
  id: string;
  title: string;
  summary: string;
  startTurnSequence: number;
  endTurnSequence: number;
  startTimestamp: string;
}

export interface ApiSessionKeyMomentArtifact {
  sessionId: string;
  status: "completed";
  keyMoments: ApiSessionKeyMoment[];
  generatedAt: string;
  model: string;
  sourceTranscriptTurnCount: number;
  sourceTranscriptHash: string;
}

export interface ApiKeyMomentGenerationResponse {
  artifact: ApiSessionKeyMomentArtifact;
  debug?: unknown;
}

export type ApiReplayArtifactStatus =
  | "idle"
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "unavailable";

export interface ApiSessionReplayStatus {
  sessionId: string;
  replayStatus: "idle" | "processing" | "ready" | "failed" | "partial";
  transcriptStatus: ApiReplayArtifactStatus;
  transcriptTurnCount: number;
  videoStatus: ApiReplayArtifactStatus;
  videoSegmentCount: number;
  videoError: string | null;
  keyMomentsStatus: ApiReplayArtifactStatus;
  keyMomentCount: number;
  keyMomentsError: string | null;
  requestedAt: string | null;
  updatedAt: string;
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
  document?: unknown;
  session?: unknown;
  agentAppState?: unknown;
  payload?: unknown;
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
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${getSessionApiBaseUrl()}${path}`, {
    ...init,
    headers,
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
    status: session.status,
    summary: session.summary || undefined,
    lastActive: new Date(session.lastActiveAt),
    duration: Math.round(session.durationMs / 60000),
    createdAt: new Date(session.createdAt),
    updatedAt: new Date(session.updatedAt),
    checkpointCount: session.checkpointCount,
    milestoneCount: session.milestoneCount,
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

export async function getSessionRecordingManifest(
  sessionId: string
): Promise<ApiSessionRecordingManifest> {
  return requestJson<ApiSessionRecordingManifest>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/recordings`
  );
}

export async function getSessionReplayStatus(
  sessionId: string
): Promise<ApiSessionReplayStatus> {
  return requestJson<ApiSessionReplayStatus>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/replay-status`
  );
}

export async function getSessionKeyMoments(
  sessionId: string
): Promise<ApiSessionKeyMomentArtifact> {
  return requestJson<ApiSessionKeyMomentArtifact>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/key-moments`
  );
}

export async function generateSessionKeyMoments(
  sessionId: string
): Promise<ApiKeyMomentGenerationResponse> {
  return requestJson<ApiKeyMomentGenerationResponse>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/key-moments:generate`,
    {
      method: "POST",
    }
  );
}

export async function uploadSessionRecordingSegment(
  sessionId: string,
  recording: Blob,
  options?: {
    fileName?: string;
    startedAt?: string;
    endedAt?: string;
  }
): Promise<ApiSessionRecordingManifest> {
  const formData = new FormData();
  const fileName = options?.fileName || "segment.webm";
  formData.append("video", recording, fileName);
  if (options?.startedAt) {
    formData.append("startedAt", options.startedAt);
  }
  if (options?.endedAt) {
    formData.append("endedAt", options.endedAt);
  }

  return requestJson<ApiSessionRecordingManifest>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/recordings/segments`,
    {
      method: "POST",
      body: formData,
    }
  );
}

export async function finalizeSessionRecordings(
  sessionId: string
): Promise<ApiSessionRecordingManifest> {
  return requestJson<ApiSessionRecordingManifest>(
    `/v1/sessions/${encodeURIComponent(sessionId)}/recordings/finalize`,
    {
      method: "POST",
    }
  );
}

export async function completeSession(sessionId: string): Promise<ApiSession> {
  return requestJson<ApiSession>(`/v1/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
  });
}

export function getSessionRecordingFinalUrl(sessionId: string): string {
  return `${getSessionApiBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/recordings/final`;
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
