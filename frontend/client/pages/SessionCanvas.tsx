import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { useSession } from '../context/SessionContext'
import {
  AssetRecordType,
  DefaultSizeStyle,
  // ErrorBoundary,
  defaultShapeUtils,
  Editor,
  TLShapeId,
  TLComponents,
  Tldraw,
  TldrawOverlays,
  TldrawUiToastsProvider,
  TLUiOverrides,
  createShapeId,
  getSnapshot,
  loadSnapshot,
} from "tldraw";
import {
  createCheckpoint,
  completeSession,
  getSessionResume,
} from "../api/sessions";
import { TldrawAgentApp } from "../agent/TldrawAgentApp";
import {
  TldrawAgentAppContextProvider,
  TldrawAgentAppProvider,
} from "../agent/TldrawAgentAppProvider";
import { CustomHelperButtons } from "../components/CustomHelperButtons";
import { AgentViewportBoundsHighlights } from "../components/highlights/AgentViewportBoundsHighlights";
import { AllContextHighlights } from "../components/highlights/ContextHighlights";
import { TargetAreaTool } from "../tools/TargetAreaTool";
import { TargetShapeTool } from "../tools/TargetShapeTool";
import { DynamicIsland } from "../components/DynamicIsland";
import { AgentSubtitleOverlay } from "../components/AgentSubtitleOverlay";
import { SessionRestoreOverlay } from "../components/SessionRestoreOverlay";
import { FlashcardPanel } from "../components/FlashcardPanel";
import { GestureHost } from "../gesture/components/GestureHost";
import { GestureRuntimeState } from "../gesture/types";
import {
  EMPTY_FLASHCARD_STATE,
  applyFlashcardAction,
  type FlashcardState,
} from "../flashcards";
import { useAgentWebSocket } from "../hooks/useAgentWebSocket";
import { useAudioWorklets } from "../hooks/useAudioWorklets";
import { useSessionRecording } from "../hooks/useSessionRecording";
import type {
  GraphWidgetSpec,
  NotationWidgetSpec,
} from "../api/widgets";
import {
  CanvasActivityWindowManager,
  type CanvasActivityWindow,
} from "../canvasActivityWindow";
import { buildCanvasPlacementPlannerContext } from "../canvasPlacementPlannerContext";
import { CanvasChangeTracker } from "../canvasChangeTracker";
import {
  captureCanvasScreenshotForBounds,
  captureCanvasScreenshotForShapeIds,
} from "../canvasScreenshot";
import type {
  FrontendAction,
  InterpreterLifecyclePayload,
} from "../types/agent-live";
import { thinkspaceShapeUtils } from "../components/widgets/ThinkspaceWidgetShapeUtil";
import {
  NotationCardContent,
  notationCardRootStyle,
} from "../components/widgets/NotationWidget";

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue("s");

// Custom tools for picking context items
const tools = [TargetShapeTool, TargetAreaTool];

type CanvasTopChromeProps = {
  recordingEnabled: boolean;
  recordingStatus: string;
  recordingError: string | null;
  isRecording: boolean;
  elapsedSeconds: number;
  isAudioActive: boolean;
  isMicMuted: boolean;
  isBusy: boolean;
  onToggleMute: () => void;
  onBackToDashboard: () => void;
  onEndSession: () => void;
};

function formatRecordingDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<void> {
  await Promise.race([
    promise.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    }),
  ]);
}

function createLiveEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `live-entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const AUTO_CONNECT_SETTLE_MS = 2500;
const STARTUP_GREETING_SETTLE_MS = 1500;
const SESSION_RECORDING_ENABLED =
  String(import.meta.env.VITE_ENABLE_SESSION_RECORDING ?? "false").toLowerCase() ===
  "true";

type CanvasCaptureHudProps = {
  gestureState: CanvasGestureCaptureState | null;
  recordingError: string | null;
};

type CanvasRecordingIndicatorProps = {
  recordingEnabled: boolean;
  recordingStatus: string;
  recordingError: string | null;
  isRecording: boolean;
  elapsedSeconds: number;
};

type CanvasGestureCaptureState = Pick<GestureRuntimeState, "stream" | "cameraState">;

type CanvasExitAction = "back" | "end";

type CanvasStartupOverlayProps = {
  recordingEnabled: boolean;
  recordingStatus: string;
  recordingError: string | null;
  onRetryRecording: () => void;
  onBackToDashboard: () => void;
};

const MicIcon = ({ muted }: { muted: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M12 3.5a2.75 2.75 0 0 1 2.75 2.75v5.5a2.75 2.75 0 0 1-5.5 0v-5.5A2.75 2.75 0 0 1 12 3.5Z" />
    <path d="M6.75 10.75a5.25 5.25 0 0 0 10.5 0" />
    <path d="M12 16v4" />
    <path d="M8.5 20h7" />
    {muted ? <path d="M4.5 4.5 19.5 19.5" /> : null}
  </svg>
);

const EndSessionIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M7 6.5h10" />
    <path d="M9.5 6.5V5.25A1.75 1.75 0 0 1 11.25 3.5h1.5A1.75 1.75 0 0 1 14.5 5.25V6.5" />
    <path d="M7.75 6.5h8.5l-.7 10.05A2 2 0 0 1 13.56 18.4h-3.12a2 2 0 0 1-1.99-1.85L7.75 6.5Z" />
    <path d="M10 10.25v4.5" />
    <path d="M14 10.25v4.5" />
  </svg>
);

const BackToDashboardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="m10.5 6-6 6 6 6" />
    <path d="M5.5 12h10.25a3.75 3.75 0 1 1 0 7.5H14.5" />
  </svg>
);

const CanvasCaptureHud = ({
  gestureState,
  recordingError,
}: CanvasCaptureHudProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const gestureStream = gestureState?.stream ?? null;

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    if (videoElement.srcObject !== gestureStream) {
      videoElement.srcObject = gestureStream;
    }

    if (gestureStream) {
      void videoElement.play().catch(() => {
        // Autoplay can be interrupted while the stream is warming up.
      });
    }
  }, [gestureStream]);

  return (
    <div className="ts-canvas-capture-hud">
      <div className="ts-canvas-capture-hud__viewport">
        {gestureStream ? (
          <video
            ref={videoRef}
            className="ts-canvas-capture-hud__video"
            muted
            playsInline
            autoPlay
          />
        ) : (
          <div className="ts-canvas-capture-hud__empty">
            <div className="ts-canvas-capture-hud__empty-title">Gesture camera</div>
            <div className="ts-canvas-capture-hud__empty-copy">
              {gestureState?.cameraState === "denied"
                ? "Camera access denied"
                : gestureState?.cameraState === "requesting"
                  ? "Requesting camera access"
                  : "Waiting for gesture camera"}
            </div>
          </div>
        )}
      </div>

      {recordingError ? (
        <div className="ts-canvas-capture-hud__error">{recordingError}</div>
      ) : null}
    </div>
  );
};

const CanvasRecordingIndicator = ({
  recordingEnabled,
  recordingStatus,
  recordingError,
  isRecording,
  elapsedSeconds,
}: CanvasRecordingIndicatorProps) => {
  const label = !recordingEnabled
    ? "Recording off"
    : recordingError
    ? "Recording blocked"
    : isRecording
      ? "Recording"
      : recordingStatus === "requesting-permission"
        ? "Awaiting access"
        : "Preparing";
  const detail = !recordingEnabled
    ? "Session not captured"
    : recordingError
    ? "Check browser permissions"
    : isRecording
      ? formatRecordingDuration(elapsedSeconds)
      : recordingStatus === "requesting-permission"
        ? "Select this tab"
        : "Starting up";

  return (
    <div
      className={`ts-canvas-recording-indicator${isRecording ? " is-live" : ""}${
        recordingError ? " is-error" : ""
      }`}
      aria-live="polite"
    >
      <span className="ts-canvas-recording-indicator__dot" aria-hidden="true" />
      <span className="ts-canvas-recording-indicator__label">{label}</span>
      <span className="ts-canvas-recording-indicator__time">{detail}</span>
    </div>
  );
};

const CanvasExitOverlay = ({ action }: { action: CanvasExitAction }) => {
  const title = action === "end" ? "Finishing session" : "Leaving session";
  const description =
    action === "end"
      ? "Wrapping up your recording and preparing your summary."
      : "Saving your progress and returning to the dashboard.";

  return (
    <section className="ts-home-session-preview ts-home-session-preview--canvas-exit">
      <div className="ts-home-session-preview-shell">
        <div className="ts-home-session-preview-loader" aria-hidden="true">
          <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--outer" />
          <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--inner" />
          <span className="ts-home-session-preview-loader-core" />
        </div>
        <div className="ts-home-session-preview-copy">
          <p className="ts-home-session-preview-kicker">Please wait</p>
          <div className="ts-home-session-preview-copy-body">
            <div className="ts-home-session-preview-text-row">
              <p className="ts-home-session-preview-text">{title}</p>
              <span
                className="ts-home-session-preview-text-trail"
                aria-hidden="true"
              />
            </div>
            <p className="ts-home-session-preview-description">{description}</p>
          </div>
        </div>
      </div>
    </section>
  );
};

const CanvasTopChrome = ({
  recordingEnabled,
  recordingStatus,
  recordingError,
  isRecording,
  elapsedSeconds,
  isAudioActive,
  isMicMuted,
  isBusy,
  onToggleMute,
  onBackToDashboard,
  onEndSession,
}: CanvasTopChromeProps) => {
  const muteDisabled = !isAudioActive || isBusy;
  const muteLabel = isMicMuted ? "Unmute microphone" : "Mute microphone";

  return (
    <div className="ts-canvas-top-chrome">
      <CanvasRecordingIndicator
        recordingEnabled={recordingEnabled}
        recordingStatus={recordingStatus}
        recordingError={recordingError}
        isRecording={isRecording}
        elapsedSeconds={elapsedSeconds}
      />
      <div className="ts-canvas-control-rail" role="toolbar" aria-label="Canvas session controls">
        <button
          type="button"
          className={`ts-canvas-control-rail__button${isMicMuted ? " is-active" : ""}`}
          onClick={onToggleMute}
          title={muteDisabled ? "Microphone is still starting" : muteLabel}
          aria-label={muteLabel}
          aria-pressed={isMicMuted}
          disabled={muteDisabled}
        >
          <MicIcon muted={isMicMuted} />
        </button>
        <button
          type="button"
          className="ts-canvas-control-rail__button"
          onClick={onBackToDashboard}
          title="Back to dashboard"
          aria-label="Back to dashboard"
          disabled={isBusy}
        >
          <BackToDashboardIcon />
        </button>
        <button
          type="button"
          className="ts-canvas-control-rail__button ts-canvas-control-rail__button--danger"
          onClick={onEndSession}
          title="End session"
          aria-label="End session"
          disabled={isBusy}
        >
          <EndSessionIcon />
        </button>
      </div>
    </div>
  );
};

const CanvasStartupOverlay = ({
  recordingEnabled,
  recordingStatus,
  recordingError,
  onRetryRecording,
  onBackToDashboard,
}: CanvasStartupOverlayProps) => {
  if (!recordingEnabled) {
    return null;
  }

  if (recordingStatus !== "requesting-permission" && recordingStatus !== "error") {
    return null;
  }

  const isError = recordingStatus === "error";
  const title = isError ? "Recording access is required" : "Enable recording to start";
  const description = isError
    ? recordingError ?? "ThinkSpace could not start recording for this session."
    : "Choose this browser tab when prompted. Gestures, agent connection, and audio will start automatically after access is granted.";

  return (
    <div className="ts-canvas-startup-overlay" role="status" aria-live="polite">
      <div className="ts-canvas-startup-overlay__panel">
        {isError ? (
          <div className="ts-canvas-startup-overlay__badge ts-canvas-startup-overlay__badge--error">
            Recording blocked
          </div>
        ) : (
          <div className="ts-canvas-startup-overlay__spinner" aria-hidden="true" />
        )}
        <h2 className="ts-canvas-startup-overlay__title">{title}</h2>
        <p className="ts-canvas-startup-overlay__copy">{description}</p>
        {isError ? (
          <div className="ts-canvas-startup-overlay__actions">
            <button
              type="button"
              className="ts-home-secondary-btn"
              onClick={onBackToDashboard}
            >
              Back to dashboard
            </button>
            <button
              type="button"
              className="ts-home-primary-btn"
              onClick={onRetryRecording}
            >
              Retry recording access
            </button>
          </div>
        ) : (
          <div className="ts-canvas-startup-overlay__hint">
            Tip: pick the current browser tab for the best capture quality.
          </div>
        )}
      </div>
    </div>
  );
};

const overrides: TLUiOverrides = {
  tools: (editor, tools) => {
    return {
      ...tools,
      "target-area": {
        id: "target-area",
        label: "Pick Area",
        kbd: "c",
        icon: "tool-frame",
        onSelect() {
          editor.setCurrentTool("target-area");
        },
      },
      "target-shape": {
        id: "target-shape",
        label: "Pick Shape",
        kbd: "s",
        icon: "tool-frame",
        onSelect() {
          editor.setCurrentTool("target-shape");
        },
      },
    };
  },
};

type CanvasInsertVisualPayload = {
  artifact_id: string;
  image_url: string;
  title: string;
  caption?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  mime_type?: string;
};

type CanvasInsertWidgetPayload = {
  artifact_id: string;
  widget_kind: "graph" | "notation";
  title: string;
  spec: GraphWidgetSpec | NotationWidgetSpec;
  x: number;
  y: number;
  w?: number;
  h?: number;
};

type CanvasDelegatePayload = {
  goal: string;
  target_scope: "viewport" | "selection";
  constraints?: string;
  teaching_intent?: string;
  title?: string;
  message?: string;
};

type NotchStatusChannel = "canvas" | "tutor";

type CanvasJobToastState = {
  jobId?: string;
  title: string;
  message?: string;
  severity: "info" | "error";
  isLoading: boolean;
  channel: NotchStatusChannel;
};

const CANVAS_ERROR_TOAST_VISIBLE_MS = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeToastText(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function presentNotchToast(
  toast: Omit<CanvasJobToastState, "channel">,
  channel: NotchStatusChannel,
): CanvasJobToastState {
  const rawTitle = normalizeToastText(toast.title) ?? "";
  const rawMessage = normalizeToastText(toast.message);
  const title = rawTitle.toLowerCase();

  if (toast.severity === "error") {
    return {
      ...toast,
      channel,
      title:
        channel === "tutor"
          ? "Couldn't review your work"
          : "Couldn't update the canvas",
      message: rawMessage ?? "Please try again in a moment.",
    };
  }

  if (channel === "tutor") {
    return {
      ...toast,
      channel,
      title: "Reviewing your work",
      message: "Using your latest canvas work to guide the lesson",
    };
  }

  if (title.includes("creating graph")) {
    return {
      ...toast,
      channel,
      title: "Preparing graph",
      message: "Adding it to your canvas",
    };
  }

  if (title.includes("creating notation")) {
    return {
      ...toast,
      channel,
      title: "Preparing notation",
      message: "Adding it to your canvas",
    };
  }

  if (title.includes("creating visual")) {
    return {
      ...toast,
      channel,
      title: "Preparing visual",
      message: "Adding it to your canvas",
    };
  }

  if (title.includes("refreshing canvas view")) {
    return {
      ...toast,
      channel,
      title: "Reviewing canvas",
      message: "Looking at the latest canvas state",
    };
  }

  if (title.includes("editing canvas")) {
    return {
      ...toast,
      channel,
      title: "Updating canvas",
      message: "Making changes on the board",
    };
  }

  return {
    ...toast,
    channel,
    title: rawTitle || "Updating canvas",
    message: rawMessage ?? "Working on the latest request",
  };
}

function isGraphWidgetSpec(value: unknown): value is GraphWidgetSpec {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.expression === "string" &&
    typeof value.x_min === "number" &&
    typeof value.x_max === "number" &&
    typeof value.y_min === "number" &&
    typeof value.y_max === "number" &&
    typeof value.x_label === "string" &&
    typeof value.y_label === "string"
  );
}

function isNotationWidgetSpec(value: unknown): value is NotationWidgetSpec {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    Array.isArray(value.blocks) &&
    value.blocks.every(
      (block) =>
        isRecord(block) &&
        typeof block.latex === "string" &&
        typeof block.label === "string",
    ) &&
    typeof value.annotation === "string"
  );
}

function normalizeCanvasInsertVisualPayload(
  payload: unknown,
): CanvasInsertVisualPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const artifactId = payload.artifact_id;
  const imageUrl = payload.image_url;
  const title = payload.title;
  const x = payload.x;
  const y = payload.y;
  const w = payload.w;
  const h = payload.h;
  const caption = payload.caption;
  const mimeType = payload.mime_type;

  if (
    typeof artifactId !== "string" ||
    typeof imageUrl !== "string" ||
    typeof title !== "string" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number"
  ) {
    return null;
  }

  return {
    artifact_id: artifactId,
    image_url: imageUrl,
    title,
    caption: typeof caption === "string" ? caption : null,
    x,
    y,
    w,
    h,
    mime_type: typeof mimeType === "string" ? mimeType : undefined,
  };
}

function normalizeCanvasInsertWidgetPayload(
  payload: unknown,
): CanvasInsertWidgetPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const artifactId = payload.artifact_id;
  const widgetKind = payload.widget_kind;
  const title = payload.title;
  const spec = payload.spec;
  const x = payload.x;
  const y = payload.y;
  const w = payload.w;
  const h = payload.h;

  if (
    typeof artifactId !== "string" ||
    (widgetKind !== "graph" && widgetKind !== "notation") ||
    typeof title !== "string" ||
    typeof x !== "number" ||
    typeof y !== "number"
  ) {
    return null;
  }

  if (
    (widgetKind === "graph" && !isGraphWidgetSpec(spec)) ||
    (widgetKind === "notation" && !isNotationWidgetSpec(spec))
  ) {
    return null;
  }

  return {
    artifact_id: artifactId,
    widget_kind: widgetKind,
    title,
    spec: spec as GraphWidgetSpec | NotationWidgetSpec,
    x,
    y,
    w: typeof w === "number" ? w : undefined,
    h: typeof h === "number" ? h : undefined,
  };
}

function measureNotationWidgetSize(spec: NotationWidgetSpec): { w: number; h: number } {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "-10000px";
  host.style.pointerEvents = "none";
  host.style.visibility = "hidden";
  host.style.zIndex = "-1";
  host.style.width = "max-content";
  host.style.maxWidth = "none";
  document.body.appendChild(host);

  const root = ReactDOM.createRoot(host);

  try {
    flushSync(() => {
      root.render(
        <div
          style={{
            ...notationCardRootStyle,
            width: "max-content",
            maxWidth: "none",
          }}
        >
          <NotationCardContent spec={spec} />
        </div>,
      );
    });

    const element = host.firstElementChild as HTMLElement | null;
    const rect = element?.getBoundingClientRect();
    const measuredWidth = element
      ? Math.max(rect?.width ?? 0, element.scrollWidth)
      : 0;
    const measuredHeight = element
      ? Math.max(rect?.height ?? 0, element.scrollHeight)
      : 0;

    return {
      w: Math.max(220, Math.ceil(measuredWidth || 420)),
      h: Math.max(180, Math.ceil(measuredHeight || 220)),
    };
  } finally {
    root.unmount();
    document.body.removeChild(host);
  }
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function measureNotationWidgetSizeAsync(
  spec: NotationWidgetSpec,
): Promise<{ w: number; h: number }> {
  const initialSize = measureNotationWidgetSize(spec);
  const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fontSet?.ready) {
    await fontSet.ready;
    await waitForNextPaint();
    return measureNotationWidgetSize(spec);
  }

  return initialSize;
}

async function insertWidgetIntoCanvas(
  editor: Editor,
  payload: CanvasInsertWidgetPayload,
): Promise<{
  applied: boolean;
  summary: string;
  shapeId?: TLShapeId;
  bounds?: { x: number; y: number; w: number; h: number };
}> {
  const shapeId = createShapeId();
  const createdAt = new Date().toISOString();
  const widgetMeta = buildGeneratedWidgetMeta(payload, createdAt);
  const resolvedSize =
    payload.widget_kind === "notation"
      ? await measureNotationWidgetSizeAsync(payload.spec as NotationWidgetSpec)
      : {
          w: payload.w ?? 640,
          h: payload.h ?? 420,
        };

  editor.createShapes([
    {
      id: shapeId,
      type: "thinkspace-widget",
      x: payload.x,
      y: payload.y,
      props: {
        w: resolvedSize.w,
        h: resolvedSize.h,
        widgetKind: payload.widget_kind,
        specJson: JSON.stringify(payload.spec),
      },
      meta: widgetMeta,
    } as never,
  ]);

  editor.select(shapeId);

  return {
    applied: true,
    summary: payload.title
      ? `Title: ${payload.title}`
      : "Widget inserted into canvas",
    shapeId,
    bounds: {
      x: payload.x,
      y: payload.y,
      w: resolvedSize.w,
      h: resolvedSize.h,
    },
  };
}

function normalizeCanvasJobToastPayload(
  payload: unknown,
): Pick<CanvasJobToastState, "title" | "message"> | null {
  if (!isRecord(payload) || typeof payload.title !== "string") {
    return null;
  }

  return {
    title: payload.title,
    message: typeof payload.message === "string" ? payload.message : undefined,
  };
}

function normalizeInterpreterLifecyclePayload(
  payload: unknown,
): InterpreterLifecyclePayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const state = payload.state;
  const runId = payload.run_id;
  const packetWindowId = payload.packet_window_id;

  if (
    (state !== "started" && state !== "completed" && state !== "failed") ||
    typeof runId !== "string" ||
    !runId.trim() ||
    typeof packetWindowId !== "string" ||
    !packetWindowId.trim()
  ) {
    return null;
  }

  return {
    state,
    run_id: runId.trim(),
    packet_window_id: packetWindowId.trim(),
    title:
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : undefined,
    message:
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : undefined,
    trace_file:
      typeof payload.trace_file === "string" && payload.trace_file.trim()
        ? payload.trace_file.trim()
        : undefined,
    error:
      typeof payload.error === "string" && payload.error.trim()
        ? payload.error.trim()
        : undefined,
  };
}

function normalizeCanvasDelegatePayload(
  payload: unknown,
): CanvasDelegatePayload | null {
  if (!isRecord(payload) || typeof payload.goal !== "string") {
    return null;
  }

  const targetScope = payload.target_scope;
  if (targetScope !== "viewport" && targetScope !== "selection") {
    return null;
  }

  return {
    goal: payload.goal,
    target_scope: targetScope,
    constraints:
      typeof payload.constraints === "string" ? payload.constraints : undefined,
    teaching_intent:
      typeof payload.teaching_intent === "string"
        ? payload.teaching_intent
        : undefined,
    title: typeof payload.title === "string" ? payload.title : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
  };
}

function normalizeCanvasWorkerText(text: string): string {
  return text
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function buildCanvasDelegateWorkerMessages(
  payload: CanvasDelegatePayload,
): string[] {
  const messages = [
    "MAKE THE REQUESTED CHANGES DIRECTLY ON THE CANVAS NOW. DO NOT JUST DESCRIBE THE TASK. CREATE, WRITE, ARRANGE, CONNECT, RELAYOUT, AND EDIT SHAPES OR TEXT AS NEEDED.",
    `TASK: ${payload.goal}`,
  ];

  if (payload.constraints) {
    messages.push(`CONSTRAINTS: ${payload.constraints}`);
  }
  if (payload.teaching_intent) {
    messages.push(`TEACHING INTENT: ${payload.teaching_intent}`);
  }

  return messages.map(normalizeCanvasWorkerText).filter(Boolean);
}

function buildGeneratedVisualMeta(
  payload: CanvasInsertVisualPayload,
  createdAt: string,
) {
  return {
    artifactId: payload.artifact_id,
    title: payload.title,
    thinkspace_actor: "agent",
    thinkspace_source_tool: "canvas.generate_visual",
    thinkspace_artifact_id: payload.artifact_id,
    thinkspace_created_at: createdAt,
  };
}

function buildGeneratedWidgetMeta(
  payload: CanvasInsertWidgetPayload,
  createdAt: string,
) {
  return {
    artifactId: payload.artifact_id,
    title: payload.title,
    thinkspace_actor: "agent",
    thinkspace_source_tool:
      payload.widget_kind === "graph"
        ? "canvas.generate_graph"
        : "canvas.generate_notation",
    thinkspace_artifact_id: payload.artifact_id,
    thinkspace_widget_kind: payload.widget_kind,
    thinkspace_created_at: createdAt,
  };
}

function mergeDelegateCreatedShapeMeta(
  existingMeta: Record<string, unknown>,
  jobId: string,
  createdAt: string,
) {
  return {
    ...existingMeta,
    thinkspace_actor:
      typeof existingMeta.thinkspace_actor === "string"
        ? existingMeta.thinkspace_actor
        : "agent",
    thinkspace_source_tool:
      typeof existingMeta.thinkspace_source_tool === "string"
        ? existingMeta.thinkspace_source_tool
        : "canvas.delegate_task",
    thinkspace_delegate_job_id:
      typeof existingMeta.thinkspace_delegate_job_id === "string"
        ? existingMeta.thinkspace_delegate_job_id
        : jobId,
    thinkspace_created_at:
      typeof existingMeta.thinkspace_created_at === "string"
        ? existingMeta.thinkspace_created_at
        : createdAt,
  };
}

function stampDelegateCreatedShapeMetadata(
  editor: Editor,
  shapeIds: TLShapeId[],
  jobId: string,
) {
  if (shapeIds.length === 0) {
    return;
  }

  const createdAt = new Date().toISOString();

  for (const shapeId of shapeIds) {
    const shape = editor.getShape(shapeId);
    if (!shape) {
      continue;
    }

    editor.updateShape({
      ...shape,
      meta: mergeDelegateCreatedShapeMeta(
        shape.meta as Record<string, unknown>,
        jobId,
        createdAt,
      ),
    });
  }
}

function insertVisualIntoCanvas(
  editor: Editor,
  payload: CanvasInsertVisualPayload,
): {
  applied: boolean;
  summary: string;
  shapeId?: TLShapeId;
  assetId?: string;
  bounds?: { x: number; y: number; w: number; h: number };
} {
  const assetId = AssetRecordType.createId();
  const shapeId = createShapeId();
  const createdAt = new Date().toISOString();
  const visualMeta = buildGeneratedVisualMeta(payload, createdAt);

  editor.createAssets([
    {
      id: assetId,
      typeName: "asset",
      type: "image",
      props: {
        name: payload.title || payload.artifact_id,
        src: payload.image_url,
        w: payload.w,
        h: payload.h,
        mimeType: payload.mime_type ?? "image/png",
        isAnimated: false,
      },
      meta: visualMeta,
    } as never,
  ]);

  editor.createShapes([
    {
      id: shapeId,
      type: "image",
      x: payload.x,
      y: payload.y,
      props: {
        assetId,
        w: payload.w,
        h: payload.h,
      },
      meta: visualMeta,
    } as never,
  ]);

  editor.select(shapeId);

  return {
    applied: true,
    summary: payload.title
      ? `Title: ${payload.title}`
      : "Visual inserted into canvas",
    shapeId,
    assetId,
    bounds: {
      x: payload.x,
      y: payload.y,
      w: payload.w,
      h: payload.h,
    },
  };
}


function getDelegateBounds(editor: Editor, payload: CanvasDelegatePayload) {
  if (payload.target_scope === "selection") {
    return editor.getSelectionPageBounds() ?? editor.getViewportPageBounds();
  }
  return editor.getViewportPageBounds();
}

export const SessionCanvas: React.FC = () => {
  const FLASHCARD_BEGIN_VISIBLE_MS = 350;
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const suppressRestoreOverlay =
    ((location.state as { skipRestoreOverlay?: boolean } | null)
      ?.skipRestoreOverlay ?? false) === true;
  const [app, setApp] = useState<TldrawAgentApp | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [isSessionActionPending, setIsSessionActionPending] = useState(false);
  const [exitAction, setExitAction] = useState<CanvasExitAction | null>(null);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [gestureState, setGestureState] = useState<CanvasGestureCaptureState | null>(
    null,
  );
  const [resolvedUserId, setResolvedUserId] = useState("demo-user");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasChangeTrackerRef = useRef<CanvasChangeTracker | null>(null);
  const canvasActivityWindowManagerRef =
    useRef<CanvasActivityWindowManager | null>(null);
  const hasLoadedRemoteSnapshotRef = useRef(false);
  const isSavingCheckpointRef = useRef(false);
  const [flashcardState, setFlashcardState] =
    useState<FlashcardState>(EMPTY_FLASHCARD_STATE);
  const [canvasJobToast, setCanvasJobToast] =
    useState<CanvasJobToastState | null>(null);
  const [interpreterToast, setInterpreterToast] =
    useState<CanvasJobToastState | null>(null);
  const flashcardStateRef = useRef<FlashcardState>(EMPTY_FLASHCARD_STATE);
  const liveEntryIdRef = useRef<string>(createLiveEntryId());
  const autoConnectAttemptedRef = useRef(false);
  const autoRecordingAttemptedRef = useRef(false);
  const autoAudioAttemptedRef = useRef(false);
  const autoGestureAttemptedRef = useRef(false);
  const startupGreetingSentRef = useRef(false);
  const wasRecordingActiveRef = useRef(false);
  const flashcardActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const canvasToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interpreterToastTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedFlashcardActionKeyRef = useRef<string | null>(null);

  const handleUnmount = useCallback(() => {
    setApp(null);
  }, []);

  const navigateWithFallback = useCallback((path: string) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    flushSync(() => {
      navigate(normalizedPath, { replace: true });
    });

    window.setTimeout(() => {
      const canvasStillMounted = document.querySelector(".tldraw-agent-container");
      if (!canvasStillMounted) {
        return;
      }

      window.location.replace(
        `${window.location.origin}${window.location.pathname}?ts-nav=${Date.now()}#${normalizedPath}`,
      );
    }, 180);
  }, [navigate]);

  const setCanvasActivityWindowHold = useCallback((active: boolean) => {
    canvasActivityWindowManagerRef.current?.setExternalHold(active);
  }, []);

  const saveCheckpoint = useCallback(
    async (saveReason: string, triggerSource: string) => {
      if (!sessionId || !editor || isSavingCheckpointRef.current) {
        return;
      }

      try {
        isSavingCheckpointRef.current = true;
        const { document, session } = getSnapshot(editor.store);
        await createCheckpoint(sessionId, {
          checkpointType: "material",
          saveReason,
          triggerSource,
          document,
          session,
          payload: {
            source: "session-canvas",
            savedAt: new Date().toISOString(),
          },
          clientUpdatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Failed to save session checkpoint", error);
      } finally {
        isSavingCheckpointRef.current = false;
      }
    },
    [editor, sessionId],
  );

  // Audio worklets
  const {
    isAudioActive,
    isMicMuted,
    playbackCaptureStream,
    startAudio,
    stopAudio,
    toggleMicMuted,
    playAudioChunk,
    stopPlayback,
  } = useAudioWorklets();

  // Agent WebSocket
  const userId = resolvedUserId;
  const wsSessionId = sessionId || "default-session";

  const ws = useAgentWebSocket({
    userId,
    sessionId: wsSessionId,
    sessionEntryId: liveEntryIdRef.current,
    onPlayAudio: playAudioChunk,
    onStopPlayback: stopPlayback,
  });
  const wsConnectionState = ws.connectionState;
  const connectAgent = ws.connect;
  const disconnectAgent = ws.disconnect;
  const sendSessionStartup = ws.sendSessionStartup;
  const {
    status: recordingStatus,
    error: recordingError,
    isSupported: isRecordingSupported,
    isRecording,
    elapsedSeconds,
    startRecording,
    stopRecording,
  } = useSessionRecording(sessionId, {
    extraAudioStream: playbackCaptureStream,
  });
  const recordingEnabled = SESSION_RECORDING_ENABLED;
  const liveSessionReady = recordingEnabled ? recordingStatus === "recording" : true;

  const sendFocusedScreenshot = useCallback(
    async (
      screenshotPromise: Promise<
        | {
            base64: string;
            mimeType: string;
          }
        | null
      >,
      failureMessage: string,
    ) => {
      try {
        const screenshot = await screenshotPromise;
        if (!screenshot) {
          return;
        }
        ws.sendImage(screenshot.base64, screenshot.mimeType);
      } catch (error) {
        console.error(failureMessage, error);
      }
    },
    [ws],
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const tracker = new CanvasChangeTracker({
      editor,
      getAgent: () => app?.agents.getAgent() ?? null,
    });
    tracker.start();
    canvasChangeTrackerRef.current = tracker;

    const activityWindowManager = new CanvasActivityWindowManager(tracker, {
      onWindowReady: async (window: CanvasActivityWindow) => {
        if (import.meta.env.DEV) {
          console.debug("Canvas activity window ready", window);
        }
        ws.sendCanvasActivityWindow({
          type: "canvas_activity_window",
          window,
        });
      },
    });
    activityWindowManager.start();
    canvasActivityWindowManagerRef.current = activityWindowManager;

    if (import.meta.env.DEV) {
      const debugWindow = window as typeof window & {
        __thinkspaceCanvasChangeTracker?: CanvasChangeTracker;
        __thinkspaceCanvasActivityWindowManager?: CanvasActivityWindowManager;
      };
      debugWindow.__thinkspaceCanvasChangeTracker = tracker;
      debugWindow.__thinkspaceCanvasActivityWindowManager = activityWindowManager;
    }

    return () => {
      activityWindowManager.stop();
      tracker.stop();
      if (canvasChangeTrackerRef.current === tracker) {
        canvasChangeTrackerRef.current = null;
      }
      if (canvasActivityWindowManagerRef.current === activityWindowManager) {
        canvasActivityWindowManagerRef.current = null;
      }
      if (import.meta.env.DEV) {
        const debugWindow = window as typeof window & {
          __thinkspaceCanvasChangeTracker?: CanvasChangeTracker;
          __thinkspaceCanvasActivityWindowManager?: CanvasActivityWindowManager;
        };
        if (debugWindow.__thinkspaceCanvasChangeTracker === tracker) {
          delete debugWindow.__thinkspaceCanvasChangeTracker;
        }
        if (
          debugWindow.__thinkspaceCanvasActivityWindowManager ===
          activityWindowManager
        ) {
          delete debugWindow.__thinkspaceCanvasActivityWindowManager;
        }
      }
    };
  }, [app, editor]);

  const handleStartAudio = useCallback(() => {
    return startAudio((pcmChunk) => {
      ws.sendAudioChunk(pcmChunk);
    });
  }, [startAudio, ws.sendAudioChunk]);

  const handleFitAllCanvasContent = useCallback(() => {
    if (!editor) {
      return { applied: false, reason: "Canvas editor is not ready" };
    }

    if (editor.getCurrentPageShapes().length === 0) {
      return { applied: false, reason: "No canvas content to fit" };
    }

    editor.zoomToFit({
      animation: { duration: editor.options.animationMediumMs },
    });

    return { applied: true, reason: "Fit view applied" };
  }, [editor]);

  const handleToggleMicMute = useCallback(() => {
    if (ws.connectionState !== "connected") {
      return { applied: false, reason: "Live agent is not connected" };
    }

    if (!isAudioActive) {
      return { applied: false, reason: "Live microphone is not active" };
    }

    toggleMicMuted();
    return {
      applied: true,
      reason: isMicMuted ? "Microphone unmuted" : "Microphone muted",
    };
  }, [isAudioActive, isMicMuted, toggleMicMuted, ws.connectionState]);

  const handleGestureStateChange = useCallback(
    (nextState: CanvasGestureCaptureState) => {
      setGestureState(nextState);
    },
    [],
  );

  const stopRecordingIfNeeded = useCallback(async () => {
    if (
      recordingStatus !== "recording" &&
      recordingStatus !== "stopping" &&
      recordingStatus !== "uploading"
    ) {
      return;
    }

    await stopRecording();
  }, [recordingStatus, stopRecording]);

  const handleBackToDashboard = useCallback(() => {
    if (isSessionActionPending) {
      return;
    }

    setExitAction("back");
    setIsSessionActionPending(true);
    setSessionActionError(null);

    void (async () => {
      let didTriggerNavigation = false;
      try {
        const checkpointPromise = saveCheckpoint("disconnect", "frontend_manual");
        const recordingPromise = stopRecordingIfNeeded();
        canvasActivityWindowManagerRef.current?.flush("manual");
        ws.disconnect();
        await Promise.all([
          settleWithin(checkpointPromise, 1200),
          settleWithin(recordingPromise, 2500),
        ]);
        didTriggerNavigation = true;
        navigateWithFallback("/dashboard");
      } catch (error) {
        setExitAction(null);
        setSessionActionError(
          error instanceof Error ? error.message : "Failed to store the session recording",
        );
      } finally {
        if (!didTriggerNavigation) {
          setIsSessionActionPending(false);
        }
      }
    })();
  }, [isSessionActionPending, navigateWithFallback, saveCheckpoint, stopRecordingIfNeeded, ws]);

  const handleEndSession = useCallback(() => {
    if (!sessionId || isSessionActionPending) {
      return;
    }

    setExitAction("end");
    setIsSessionActionPending(true);
    setSessionActionError(null);

    void (async () => {
      let didTriggerNavigation = false;
      try {
        await saveCheckpoint("complete", "frontend_manual");
        await stopRecordingIfNeeded();
        canvasActivityWindowManagerRef.current?.flush("manual");
        ws.disconnect();
        await completeSession(sessionId);
        didTriggerNavigation = true;
        navigateWithFallback(`/session/${sessionId}/session-summary`);
      } catch (error) {
        setExitAction(null);
        setSessionActionError(
          error instanceof Error ? error.message : "Failed to end the session cleanly",
        );
      } finally {
        if (!didTriggerNavigation) {
          setIsSessionActionPending(false);
        }
      }
    })();
  }, [
    isSessionActionPending,
    navigateWithFallback,
    saveCheckpoint,
    sessionId,
    stopRecordingIfNeeded,
    ws,
  ]);

  const applyFrontendFlashcardState = useCallback(
    (action: Parameters<typeof applyFlashcardAction>[1]) => {
      const result = applyFlashcardAction(flashcardStateRef.current, action);
      flashcardStateRef.current = result.nextState;
      setFlashcardState(result.nextState);
      return result;
    },
    [],
  );

  const clearCanvasToastTimer = useCallback(() => {
    if (canvasToastTimerRef.current) {
      clearTimeout(canvasToastTimerRef.current);
      canvasToastTimerRef.current = null;
    }
  }, []);

  const clearCanvasToast = useCallback(() => {
    clearCanvasToastTimer();
    setCanvasJobToast(null);
  }, [clearCanvasToastTimer]);

  const showCanvasToast = useCallback(
    (nextToast: Omit<CanvasJobToastState, "channel">, autoDismissMs?: number) => {
      clearCanvasToastTimer();
      const presentedToast = presentNotchToast(nextToast, "canvas");
      setCanvasJobToast(presentedToast);

      if (autoDismissMs && autoDismissMs > 0) {
        canvasToastTimerRef.current = setTimeout(() => {
          setCanvasJobToast((current) =>
            current?.jobId === presentedToast.jobId ? null : current,
          );
          canvasToastTimerRef.current = null;
        }, autoDismissMs);
      }
    },
    [clearCanvasToastTimer],
  );

  const clearInterpreterToastTimer = useCallback(() => {
    if (interpreterToastTimerRef.current) {
      clearTimeout(interpreterToastTimerRef.current);
      interpreterToastTimerRef.current = null;
    }
  }, []);

  const clearInterpreterToast = useCallback(
    (jobId?: string) => {
      clearInterpreterToastTimer();
      setInterpreterToast((current) =>
        !jobId || current?.jobId === jobId ? null : current,
      );
    },
    [clearInterpreterToastTimer],
  );

  const showInterpreterToast = useCallback(
    (nextToast: Omit<CanvasJobToastState, "channel">, autoDismissMs?: number) => {
      clearInterpreterToastTimer();
      const presentedToast = presentNotchToast(nextToast, "tutor");
      setInterpreterToast(presentedToast);

      if (autoDismissMs && autoDismissMs > 0) {
        interpreterToastTimerRef.current = setTimeout(() => {
          setInterpreterToast((current) =>
            current?.jobId === presentedToast.jobId ? null : current,
          );
          interpreterToastTimerRef.current = null;
        }, autoDismissMs);
      }
    },
    [clearInterpreterToastTimer],
  );

  const handleFrontendAction = useCallback(
    (action: FrontendAction) => {
      switch (action.type) {
        case "canvas.job_started": {
          const toastPayload = normalizeCanvasJobToastPayload(action.payload);
          if (!toastPayload) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Invalid canvas job toast payload",
            });
            return;
          }

          showCanvasToast({
            jobId: action.job_id,
            title: toastPayload.title,
            message: toastPayload.message,
            severity: "info",
            isLoading: true,
          });
          ws.sendFrontendAck({
            status: "applied",
            action_type: action.type,
            source_tool: action.source_tool,
            job_id: action.job_id,
            summary: "Canvas loading toast shown",
          });
          return;
        }
        case "canvas.context_requested":
        case "canvas.viewport_snapshot_requested": {
          const isInterpreterSnapshotRequest =
            action.type === "canvas.viewport_snapshot_requested" &&
            action.source_tool === "canvas.interpreter_reasoning";
          const toastPayload = normalizeCanvasJobToastPayload(action.payload);
          if (!isInterpreterSnapshotRequest && !toastPayload) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Invalid canvas viewport context payload",
            });
            return;
          }

          if (!isInterpreterSnapshotRequest && toastPayload) {
            showCanvasToast({
              jobId: action.job_id,
              title: toastPayload.title,
              message: toastPayload.message,
              severity: "info",
              isLoading: true,
            });
          }

          if (!editor) {
            if (action.job_id) {
              ws.sendCanvasContextTrace({
                type: "canvas_context_trace",
                source_tool: action.source_tool,
                job_id: action.job_id,
                trace: {
                  event: "editor_not_ready",
                  action_type: action.type,
                  editor_ready: false,
                  app_ready: app !== null,
                  timestamp: new Date().toISOString(),
                },
              });
            }
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Canvas editor is not ready",
            });
            return;
          }

          if (!action.job_id) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              summary: "Canvas context request missing job id",
            });
            return;
          }

          const jobId = action.job_id;
          const traceStartedAtMs = Date.now();
          const sendCanvasContextTrace = (
            event: string,
            details: Record<string, unknown> = {},
          ) => {
            ws.sendCanvasContextTrace({
              type: "canvas_context_trace",
              source_tool: action.source_tool,
              job_id: jobId,
              trace: {
                event,
                action_type: action.type,
                editor_ready: true,
                app_ready: app !== null,
                elapsed_ms: Math.max(0, Date.now() - traceStartedAtMs),
                ...details,
              },
            });
          };

          void (async () => {
            sendCanvasContextTrace("action_received");
            try {
              const buildStartedAt = new Date().toISOString();
              sendCanvasContextTrace("context_build_started", {
                started_at: buildStartedAt,
              });
              const context = await buildCanvasPlacementPlannerContext(editor, app);
              const buildCompletedAt = new Date().toISOString();
              const responseTrace = {
                action_type: action.type,
                build_started_at: buildStartedAt,
                build_completed_at: buildCompletedAt,
                response_sent_at: new Date().toISOString(),
                elapsed_ms: Math.max(0, Date.now() - traceStartedAtMs),
                editor_ready: true,
                app_ready: app !== null,
                selected_shape_count: context.selected_shape_ids.length,
                blurry_shape_count: context.blurry_shapes.length,
                peripheral_cluster_count: context.peripheral_clusters.length,
                canvas_lint_count: context.canvas_lints.length,
                screenshot_present: context.screenshot_data_url.length > 0,
              } satisfies Record<string, unknown>;
              sendCanvasContextTrace("context_build_completed", responseTrace);
              ws.sendCanvasContextResponse({
                type: "canvas_context_response",
                source_tool: action.source_tool,
                job_id: jobId,
                context,
                trace: responseTrace,
              });
              sendCanvasContextTrace("context_response_sent", {
                response_sent_at: responseTrace.response_sent_at,
              });
              ws.sendFrontendAck({
                status: "applied",
                action_type: action.type,
                source_tool: action.source_tool,
                job_id: jobId,
                summary: isInterpreterSnapshotRequest
                  ? "Fresh interpreter canvas context captured and returned"
                  : "Fresh canvas context captured and returned",
              });
            } catch (error) {
              console.error("Failed to build fresh canvas context", error);
              sendCanvasContextTrace("context_build_failed", {
                error:
                  error instanceof Error
                    ? error.message
                    : "Failed to build fresh canvas context",
              });
              ws.sendFrontendAck({
                status: "failed",
                action_type: action.type,
                source_tool: action.source_tool,
                job_id: jobId,
                summary: "Failed to build fresh canvas context",
              });
            }
          })();
          return;
        }
        case "canvas.delegate_requested": {
          const delegatePayload = normalizeCanvasDelegatePayload(action.payload);
          if (!delegatePayload) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Invalid canvas delegate payload",
            });
            return;
          }

          if (!editor || !app) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Canvas agent is not ready",
            });
            if (action.job_id) {
              ws.sendCanvasDelegateResult({
                type: "canvas_delegate_result",
                source_tool: action.source_tool,
                job_id: action.job_id,
                status: "failed",
                error: "Canvas agent is not ready",
              });
            }
            return;
          }

          if (!action.job_id) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              summary: "Canvas delegate request missing job id",
            });
            return;
          }

          const activeEditor = editor;
          const activeApp = app;
          const jobId = action.job_id;

          showCanvasToast({
            jobId,
            title: delegatePayload.title ?? "Editing canvas",
            message:
              delegatePayload.message ?? "The canvas agent is working on the board",
            severity: "info",
            isLoading: true,
          });

          ws.sendFrontendAck({
            status: "applied",
            action_type: action.type,
            source_tool: action.source_tool,
            job_id: jobId,
            summary: "Canvas delegate task started",
          });

          void (async () => {
            const canvasAgent = activeApp.agents.getAgent();
            if (!canvasAgent) {
              showCanvasToast(
                {
                  jobId,
                  title: "Canvas task failed",
                  message: "Canvas agent is not available",
                  severity: "error",
                  isLoading: false,
                },
                CANVAS_ERROR_TOAST_VISIBLE_MS,
              );
              ws.sendCanvasDelegateResult({
                type: "canvas_delegate_result",
                source_tool: action.source_tool,
                job_id: jobId,
                status: "failed",
                error: "Canvas agent is not available",
              });
              return;
            }

            setCanvasActivityWindowHold(true);
            const agentMessages = buildCanvasDelegateWorkerMessages(
              delegatePayload,
            );
            const tracker = canvasChangeTrackerRef.current;
            const eventStartIndex = tracker?.getEventCount() ?? 0;

            try {
              await canvasAgent.prompt({
                agentMessages,
                userMessages: agentMessages,
                source: "other-agent",
                bounds: getDelegateBounds(activeEditor, delegatePayload),
                contextItems: [],
                data: [],
              });
              const delegateEvents = tracker?.getEventsSince(eventStartIndex) ?? [];
              const createdShapeIds = Array.from(
                new Set(
                  delegateEvents
                    .filter(
                      (event) =>
                        event.actor === "agent" && event.event_type === "create",
                    )
                    .map((event) => event.shape_id),
                ),
              );
              stampDelegateCreatedShapeMetadata(
                activeEditor,
                createdShapeIds,
                jobId,
              );
              if (tracker) {
                const affectedShapeIds = Array.from(
                  new Set(
                    delegateEvents
                      .filter(
                        (event) =>
                          event.actor === "agent" &&
                          (event.event_type === "create" ||
                            event.event_type === "update"),
                      )
                      .map((event) => event.shape_id),
                  ),
                );
                if (affectedShapeIds.length > 0) {
                  await sendFocusedScreenshot(
                    captureCanvasScreenshotForShapeIds(
                      activeEditor,
                      affectedShapeIds,
                    ),
                    "Failed to capture delegate task screenshot",
                  );
                }
              }
              clearCanvasToast();
              ws.sendCanvasDelegateResult({
                type: "canvas_delegate_result",
                source_tool: action.source_tool,
                job_id: jobId,
                status: "completed",
              });
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Canvas agent failed to complete the task";
              showCanvasToast(
                {
                  jobId,
                  title: "Canvas task failed",
                  message,
                  severity: "error",
                  isLoading: false,
                },
                CANVAS_ERROR_TOAST_VISIBLE_MS,
              );
              ws.sendCanvasDelegateResult({
                type: "canvas_delegate_result",
                source_tool: action.source_tool,
                job_id: jobId,
                status: "failed",
                error: message,
              });
            } finally {
              setCanvasActivityWindowHold(false);
            }
          })();
          return;
        }
        case "canvas.insert_visual": {
          if (!editor) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Canvas editor is not ready",
            });
            return;
          }

          const insertPayload = normalizeCanvasInsertVisualPayload(action.payload);
          if (!insertPayload) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Invalid canvas visual payload",
            });
            return;
          }

          const result = insertVisualIntoCanvas(editor, insertPayload);
          if (result.applied) {
            void (async () => {
              if (result.bounds && result.shapeId) {
                await sendFocusedScreenshot(
                  captureCanvasScreenshotForBounds(
                    editor,
                    result.bounds,
                    [result.shapeId],
                  ),
                  "Failed to capture generate visual screenshot",
                );
              }
              clearCanvasToast();
              ws.sendFrontendAck({
                status: "applied",
                action_type: action.type,
                source_tool: action.source_tool,
                job_id: action.job_id,
                summary: result.summary,
              });
            })();
          } else {
            showCanvasToast(
              {
                jobId: action.job_id,
                title: "Visual insertion failed",
                message: result.summary,
                severity: "error",
                isLoading: false,
              },
              CANVAS_ERROR_TOAST_VISIBLE_MS,
            );
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: result.summary,
            });
          }
          return;
        }
        case "canvas.insert_widget": {
          if (!editor) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Canvas editor is not ready",
            });
            return;
          }

          const insertPayload = normalizeCanvasInsertWidgetPayload(action.payload);
          if (!insertPayload) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Invalid canvas widget payload",
            });
            return;
          }

          void (async () => {
            try {
              const result = await insertWidgetIntoCanvas(editor, insertPayload);
              if (result.applied) {
                if (result.bounds && result.shapeId) {
                  await sendFocusedScreenshot(
                    captureCanvasScreenshotForBounds(
                      editor,
                      result.bounds,
                      [result.shapeId],
                    ),
                    "Failed to capture generated widget screenshot",
                  );
                }
                clearCanvasToast();
                ws.sendFrontendAck({
                  status: "applied",
                  action_type: action.type,
                  source_tool: action.source_tool,
                  job_id: action.job_id,
                  summary: result.summary,
                });
              } else {
                showCanvasToast(
                  {
                    jobId: action.job_id,
                    title: "Widget insertion failed",
                    message: result.summary,
                    severity: "error",
                    isLoading: false,
                  },
                  CANVAS_ERROR_TOAST_VISIBLE_MS,
                );
                ws.sendFrontendAck({
                  status: "failed",
                  action_type: action.type,
                  source_tool: action.source_tool,
                  job_id: action.job_id,
                  summary: result.summary,
                });
              }
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Widget insertion failed";
              showCanvasToast(
                {
                  jobId: action.job_id,
                  title: "Widget insertion failed",
                  message,
                  severity: "error",
                  isLoading: false,
                },
                CANVAS_ERROR_TOAST_VISIBLE_MS,
              );
              ws.sendFrontendAck({
                status: "failed",
                action_type: action.type,
                source_tool: action.source_tool,
                job_id: action.job_id,
                summary: message,
              });
            }
          })();
          return;
        }
        case "flashcards.begin":
        case "flashcards.show":
        case "flashcards.next":
        case "flashcards.reveal_answer":
        case "flashcards.clear": {
          const result = applyFrontendFlashcardState({
            type: action.type,
            jobId: action.job_id,
            payload: action.payload,
          });
          ws.sendFrontendAck({
            status: result.applied ? "applied" : "failed",
            action_type: action.type,
            source_tool: action.source_tool,
            job_id: action.job_id,
            summary: result.summary,
          });
          return;
        }
        case "interpreter.lifecycle": {
          const lifecyclePayload = normalizeInterpreterLifecyclePayload(action.payload);
          if (!lifecyclePayload) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Invalid interpreter lifecycle payload",
            });
            return;
          }

          const jobId = action.job_id ?? lifecyclePayload.run_id;
          if (lifecyclePayload.state === "started") {
            showInterpreterToast({
              jobId,
              title: lifecyclePayload.title ?? "Understanding your progress",
              message:
                lifecyclePayload.message ??
                "Using your latest canvas work to guide the lesson",
              severity: "info",
              isLoading: true,
            });
            ws.sendFrontendAck({
              status: "applied",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: jobId,
              summary: "Interpreter progress cue shown",
            });
            return;
          }

          if (lifecyclePayload.state === "completed") {
            clearInterpreterToast(jobId);
            ws.sendFrontendAck({
              status: "applied",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: jobId,
              summary: "Interpreter progress cue cleared",
            });
            return;
          }

          showInterpreterToast(
            {
              jobId,
              title:
                lifecyclePayload.title ?? "Couldn't read the latest canvas change",
              message:
                lifecyclePayload.message ??
                "The tutor could not interpret the latest update just now",
              severity: "error",
              isLoading: false,
            },
            CANVAS_ERROR_TOAST_VISIBLE_MS,
          );
          ws.sendFrontendAck({
            status: "applied",
            action_type: action.type,
            source_tool: action.source_tool,
            job_id: jobId,
            summary: "Interpreter failure cue shown",
          });
          return;
        }
        default:
          ws.sendFrontendAck({
            status: "failed",
            action_type: action.type,
            source_tool: action.source_tool,
            job_id: action.job_id,
            summary: `Unhandled frontend action: ${action.type}`,
          });
      }
    },
    [
      app,
      applyFrontendFlashcardState,
      clearCanvasToast,
      clearInterpreterToast,
      editor,
      sendFocusedScreenshot,
      showCanvasToast,
      showInterpreterToast,
      ws,
    ],
  );

  useEffect(() => {
    if (!app || !sessionId) {
      return;
    }

    app.agents.resetAllAgents();
  }, [app, sessionId]);

  useEffect(() => {
    hasLoadedRemoteSnapshotRef.current = false;
    liveEntryIdRef.current = createLiveEntryId();
    autoConnectAttemptedRef.current = false;
    autoRecordingAttemptedRef.current = false;
    autoAudioAttemptedRef.current = false;
    autoGestureAttemptedRef.current = false;
    startupGreetingSentRef.current = false;
    wasRecordingActiveRef.current = false;
    setResumeError(null);
    setSessionActionError(null);
    setResolvedUserId("demo-user");

    if (!sessionId) {
      setIsRestoringSession(false);
      return;
    }

    if (!editor) {
      setIsRestoringSession(true);
      return;
    }

    let cancelled = false;
    setIsRestoringSession(true);

    void getSessionResume(sessionId)
      .then((resumePayload) => {
        if (cancelled || !editor) {
          return;
        }

        setResolvedUserId(resumePayload.session.userId);

        const latestCheckpoint = resumePayload.latestCheckpoint;
        if (
          latestCheckpoint?.document &&
          latestCheckpoint.session &&
          !hasLoadedRemoteSnapshotRef.current
        ) {
          editor.setCurrentTool("select");
          loadSnapshot(editor.store, {
            document: latestCheckpoint.document,
            session: latestCheckpoint.session,
          } as Parameters<typeof loadSnapshot>[1]);
          hasLoadedRemoteSnapshotRef.current = true;
        }

      })
      .catch((error) => {
        if (!cancelled) {
          setResumeError(
            error instanceof Error ? error.message : "Unable to restore session",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRestoringSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editor, sessionId]);

  useEffect(() => {
    if (!editor || !sessionId) {
      return;
    }

    const handleBeforeUnload = () => {
      void saveCheckpoint("before_unload", "frontend_manual");
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void saveCheckpoint("disconnect", "frontend_manual");
    };
  }, [editor, saveCheckpoint, sessionId]);

  useEffect(() => {
    if (
      !sessionId ||
      !liveSessionReady ||
      isAudioActive ||
      autoAudioAttemptedRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (isAudioActive || autoAudioAttemptedRef.current) {
        return;
      }

      autoAudioAttemptedRef.current = true;
      void handleStartAudio();
    }, suppressRestoreOverlay ? 140 : 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    handleStartAudio,
    isAudioActive,
    liveSessionReady,
    sessionId,
    suppressRestoreOverlay,
  ]);

  useEffect(() => {
    if (
      !sessionId ||
      !editor ||
      !app ||
      !liveSessionReady ||
      !isAudioActive ||
      isRestoringSession ||
      !!resumeError ||
      isSessionActionPending ||
      wsConnectionState !== "idle" ||
      autoConnectAttemptedRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (
        autoConnectAttemptedRef.current ||
        !isAudioActive ||
        wsConnectionState !== "idle" ||
        isSessionActionPending
      ) {
        return;
      }

      autoConnectAttemptedRef.current = true;
      connectAgent();
    }, suppressRestoreOverlay ? AUTO_CONNECT_SETTLE_MS : AUTO_CONNECT_SETTLE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    app,
    editor,
    isAudioActive,
    isRestoringSession,
    isSessionActionPending,
    liveSessionReady,
    resumeError,
    sessionId,
    suppressRestoreOverlay,
    wsConnectionState,
    connectAgent,
  ]);

  useEffect(() => {
    if (
      !sessionId ||
      !liveSessionReady ||
      !isAudioActive ||
      wsConnectionState !== "connected" ||
      startupGreetingSentRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (
        startupGreetingSentRef.current ||
        wsConnectionState !== "connected" ||
        !liveSessionReady ||
        !isAudioActive
      ) {
        return;
      }

      const didSend = sendSessionStartup(liveEntryIdRef.current);
      if (didSend) {
        startupGreetingSentRef.current = true;
      }
    }, STARTUP_GREETING_SETTLE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    isAudioActive,
    liveSessionReady,
    sessionId,
    wsConnectionState,
    sendSessionStartup,
  ]);

  useEffect(() => {
    if (!recordingEnabled) {
      return;
    }

    if (recordingStatus === "recording") {
      wasRecordingActiveRef.current = true;
      return;
    }

    if (!wasRecordingActiveRef.current || isSessionActionPending) {
      if (recordingStatus === "idle" || recordingStatus === "error") {
        wasRecordingActiveRef.current = false;
        autoConnectAttemptedRef.current = false;
        autoAudioAttemptedRef.current = false;
        autoGestureAttemptedRef.current = false;
        startupGreetingSentRef.current = false;
        setGestureEnabled(false);
      }
      return;
    }

    wasRecordingActiveRef.current = false;
    autoConnectAttemptedRef.current = false;
    autoAudioAttemptedRef.current = false;
    autoGestureAttemptedRef.current = false;
    startupGreetingSentRef.current = false;
    setGestureEnabled(false);
    if (isAudioActive) {
      stopAudio();
    }
    if (
      wsConnectionState === "connected" ||
      wsConnectionState === "connecting"
    ) {
      disconnectAgent();
    }
  }, [
    isAudioActive,
    isSessionActionPending,
    recordingEnabled,
    recordingStatus,
    stopAudio,
    wsConnectionState,
    disconnectAgent,
  ]);

  useEffect(() => {
    if (
      !recordingEnabled ||
      !sessionId ||
      !editor ||
      !isRecordingSupported ||
      isRestoringSession ||
      !!resumeError ||
      autoRecordingAttemptedRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (autoRecordingAttemptedRef.current) {
        return;
      }

      autoRecordingAttemptedRef.current = true;
      void startRecording();
    }, suppressRestoreOverlay ? 180 : 420);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    editor,
    isRecordingSupported,
    isRestoringSession,
    recordingEnabled,
    resumeError,
    sessionId,
    startRecording,
    suppressRestoreOverlay,
  ]);

  useEffect(() => {
    if (
      !sessionId ||
      !liveSessionReady ||
      autoGestureAttemptedRef.current
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      autoGestureAttemptedRef.current = true;
      setGestureEnabled(true);
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [liveSessionReady, sessionId]);

  useEffect(() => {
    if (ws.turnCompleteCount > 0) {
      void saveCheckpoint("turn_complete", "frontend_manual");
    }
  }, [saveCheckpoint, ws.turnCompleteCount]);

  React.useEffect(() => {
    return () => {
      if (flashcardActionTimerRef.current) {
        clearTimeout(flashcardActionTimerRef.current);
        flashcardActionTimerRef.current = null;
      }
      if (canvasToastTimerRef.current) {
        clearTimeout(canvasToastTimerRef.current);
        canvasToastTimerRef.current = null;
      }
      if (interpreterToastTimerRef.current) {
        clearTimeout(interpreterToastTimerRef.current);
        interpreterToastTimerRef.current = null;
      }
      processedFlashcardActionKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ws.latestToolResult) {
      return;
    }

    const { result } = ws.latestToolResult;

    if (
      result.tool !== "canvas.generate_visual" ||
      result.status !== "failed"
    ) {
      return;
    }

    const summary =
      typeof result.summary === "string"
        ? result.summary
        : "Visual generation failed";
    showCanvasToast(
      {
        jobId: typeof result.job === "object" && result.job && "id" in result.job
          ? String((result.job as { id?: unknown }).id ?? "")
          : undefined,
        title: "Visual generation failed",
        message: summary,
        severity: "error",
        isLoading: false,
      },
      CANVAS_ERROR_TOAST_VISIBLE_MS,
    );
  }, [showCanvasToast, ws.latestToolResult]);

  React.useEffect(() => {
    if (ws.frontendActions.length === 0) {
      return;
    }

    const nextAction = ws.frontendActions[0];
    if (!nextAction) {
      return;
    }

    const actionKey = [
      nextAction.type,
      nextAction.source_tool,
      nextAction.job_id ?? "",
    ].join(":");

    if (processedFlashcardActionKeyRef.current === actionKey) {
      return;
    }

    processedFlashcardActionKeyRef.current = actionKey;
    handleFrontendAction(nextAction);

    if (flashcardActionTimerRef.current) {
      clearTimeout(flashcardActionTimerRef.current);
      flashcardActionTimerRef.current = null;
    }

    const delayMs =
      nextAction.type === "flashcards.begin" ? FLASHCARD_BEGIN_VISIBLE_MS : 0;

    const finalizeAction = () => {
      processedFlashcardActionKeyRef.current = null;
      ws.shiftFrontendAction();
      flashcardActionTimerRef.current = null;
    };

    if (delayMs <= 0) {
      finalizeAction();
      return;
    }

    flashcardActionTimerRef.current = setTimeout(finalizeAction, delayMs);
  }, [
    handleFrontendAction,
    ws,
    ws.frontendActions,
    ws.shiftFrontendAction,
  ]);

  React.useEffect(() => {
    flashcardStateRef.current = flashcardState;
  }, [flashcardState]);

  // Custom components to visualize what the agent is doing
  const components: TLComponents = useMemo(() => {
    return {
      HelperButtons: () =>
        app && (
          <TldrawAgentAppContextProvider app={app}>
            <CustomHelperButtons />
          </TldrawAgentAppContextProvider>
        ),
      Overlays: () => (
        <>
          <TldrawOverlays />
          {app && (
            <TldrawAgentAppContextProvider app={app}>
              <AgentViewportBoundsHighlights />
              <AllContextHighlights />
            </TldrawAgentAppContextProvider>
          )}
        </>
      ),
    };
  }, [app]);

  const notchTalkingState = ws.isKnowledgeLookupActive ? "thinking" : ws.talkingState;
  if (!sessionId) {
    return <div>Session not found</div>;
  }

  return (
    <>
      {isSessionActionPending && exitAction ? (
        <CanvasExitOverlay action={exitAction} />
      ) : null}
      <TldrawUiToastsProvider>
        <div className="tldraw-agent-container tldraw-agent-container--dark">
          <SessionRestoreOverlay
            isRestoring={suppressRestoreOverlay ? false : isRestoringSession}
            error={resumeError}
          />
          <div className="tldraw-canvas" ref={canvasRef}>
            <Tldraw
              persistenceKey={`session-${sessionId}`}
              onMount={setEditor}
              inferDarkMode={false}
              licenseKey="tldraw-2026-06-18/WyJIUVlKamNRTCIsWyIqIl0sMTYsIjIwMjYtMDYtMTgiXQ.quVBu6P7tCMq3MRg6LyYhHKOvgiHA4PJpP1CiA3D2qPpLTuOPTHjvNNZjrkyFKtNsrvtiKocSV+PLk44uh6j2Q"
              tools={tools}
              shapeUtils={[...defaultShapeUtils, ...thinkspaceShapeUtils]}
              overrides={overrides}
              components={components}
            >
              <GestureHost
                canvasRef={canvasRef}
                enabled={gestureEnabled}
                micMuted={isMicMuted}
                onStateChange={handleGestureStateChange}
                onFitView={handleFitAllCanvasContent}
                onToggleMicMute={handleToggleMicMute}
              />
              <TldrawAgentAppProvider
                enablePersistence={false}
                onMount={setApp}
                onUnmount={handleUnmount}
              />
            </Tldraw>
            <CanvasStartupOverlay
              recordingEnabled={recordingEnabled}
              recordingStatus={recordingStatus}
              recordingError={sessionActionError || recordingError}
              onRetryRecording={() => {
                setSessionActionError(null);
                autoRecordingAttemptedRef.current = false;
                void startRecording();
              }}
              onBackToDashboard={handleBackToDashboard}
            />
            <AgentSubtitleOverlay subtitle={ws.agentSubtitle} />
            <FlashcardPanel state={flashcardState} />
            <CanvasCaptureHud
              gestureState={gestureState}
              recordingError={sessionActionError || recordingError}
            />
          </div>
        </div>
      </TldrawUiToastsProvider>

      <CanvasTopChrome
        recordingEnabled={recordingEnabled}
        recordingStatus={recordingStatus}
        recordingError={sessionActionError || recordingError}
        isRecording={isRecording}
        elapsedSeconds={elapsedSeconds}
        isAudioActive={isAudioActive}
        isMicMuted={isMicMuted}
        isBusy={isSessionActionPending}
        onToggleMute={() => {
          handleToggleMicMute();
        }}
        onBackToDashboard={handleBackToDashboard}
        onEndSession={handleEndSession}
      />

      <DynamicIsland
        connectionState={ws.connectionState}
        talkingState={notchTalkingState}
        status={canvasJobToast ?? interpreterToast}
      />
    </>
  );
};
