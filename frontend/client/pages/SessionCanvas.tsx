import React from "react";
import { useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { useSession } from '../context/SessionContext'
import {
  AssetRecordType,
  DefaultSizeStyle,
  // ErrorBoundary,
  Editor,
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
  getSessionResume,
  transcriptToEventLog,
} from "../api/sessions";
import { TldrawAgentApp } from "../agent/TldrawAgentApp";
import {
  TldrawAgentAppContextProvider,
  TldrawAgentAppProvider,
} from "../agent/TldrawAgentAppProvider";
// Chat panel replaced by AgentSidebar
// import { ChatPanel } from '../components/ChatPanel'
// import { ChatPanelFallback } from '../components/ChatPanelFallback'
import { CustomHelperButtons } from "../components/CustomHelperButtons";
import { AgentViewportBoundsHighlights } from "../components/highlights/AgentViewportBoundsHighlights";
import { AllContextHighlights } from "../components/highlights/ContextHighlights";
import { TargetAreaTool } from "../tools/TargetAreaTool";
import { TargetShapeTool } from "../tools/TargetShapeTool";
import { DynamicIsland } from "../components/DynamicIsland";
import { AgentSidebar } from "../components/AgentSidebar";
import { AgentSubtitleOverlay } from "../components/AgentSubtitleOverlay";
import { SessionRestoreOverlay } from "../components/SessionRestoreOverlay";
import { FlashcardPanel } from "../components/FlashcardPanel";
import { GestureHost } from "../gesture/components/GestureHost";
import { GestureLogEntry, GestureRuntimeState } from "../gesture/types";
import { subscribeGestureLogs } from "../gesture/utils/logger";
import {
  EMPTY_FLASHCARD_STATE,
  applyFlashcardAction,
  type FlashcardState,
} from "../flashcards";
import { useAgentWebSocket } from "../hooks/useAgentWebSocket";
import { useAudioWorklets } from "../hooks/useAudioWorklets";
import { buildCanvasPlacementPlannerContext } from "../canvasPlacementPlannerContext";
import type { AgentLogEntry } from "../types/agent-live";
import type {
  ConnectionState,
  FrontendAction,
  TalkingState,
} from "../types/agent-live";

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue("s");

// Custom tools for picking context items
const tools = [TargetShapeTool, TargetAreaTool];

// Custom Toolbar component with back button
const CustomToolbar = () => {
  const handleBackToDashboard = () => {
    window.location.href = "/#/dashboard";
  };

  return (
    <div className="tldraw-custom-toolbar">
      <button
        onClick={handleBackToDashboard}
        className="tldraw-back-button"
        title="Back to Dashboard"
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
      </button>
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

type CanvasJobToastState = {
  jobId?: string;
  title: string;
  message?: string;
  severity: "info" | "error";
  isLoading: boolean;
};

const CANVAS_ERROR_TOAST_VISIBLE_MS = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function insertVisualIntoCanvas(
  editor: Editor,
  payload: CanvasInsertVisualPayload,
): { applied: boolean; summary: string } {
  const assetId = AssetRecordType.createId();
  const shapeId = createShapeId();

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
      meta: {
        artifactId: payload.artifact_id,
        title: payload.title,
      },
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
      meta: {
        artifactId: payload.artifact_id,
        title: payload.title,
      },
    } as never,
  ]);

  editor.select(shapeId);

  return {
    applied: true,
    summary: payload.title
      ? `Title: ${payload.title}`
      : "Visual inserted into canvas",
  };
}

export const SessionCanvas: React.FC = () => {
  const FLASHCARD_BEGIN_VISIBLE_MS = 350;
  const { sessionId } = useParams<{ sessionId: string }>();
  const [app, setApp] = useState<TldrawAgentApp | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [gestureState, setGestureState] = useState<GestureRuntimeState | null>(
    null,
  );
  const [gestureLogs, setGestureLogs] = useState<GestureLogEntry[]>([]);
  const [persistedEventLog, setPersistedEventLog] = useState<AgentLogEntry[]>(
    [],
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedRemoteSnapshotRef = useRef(false);
  const isSavingCheckpointRef = useRef(false);
  const [flashcardState, setFlashcardState] =
    useState<FlashcardState>(EMPTY_FLASHCARD_STATE);
  const [canvasJobToast, setCanvasJobToast] =
    useState<CanvasJobToastState | null>(null);
  const flashcardStateRef = useRef<FlashcardState>(EMPTY_FLASHCARD_STATE);
  const flashcardActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const canvasToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processedFlashcardActionKeyRef = useRef<string | null>(null);

  // Temporary testing state for Dynamic Island
  const [testConnState, setTestConnState] = useState<ConnectionState | null>(
    null,
  );
  const [testTalkState, setTestTalkState] = useState<TalkingState | null>(null);

  const handleUnmount = useCallback(() => {
    setApp(null);
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
  const { isAudioActive, startAudio, stopAudio, playAudioChunk, stopPlayback } =
    useAudioWorklets();

  // Agent WebSocket
  const userId = "demo-user";
  const wsSessionId = sessionId || "default-session";

  const ws = useAgentWebSocket({
    userId,
    sessionId: wsSessionId,
    onPlayAudio: playAudioChunk,
    onStopPlayback: stopPlayback,
    initialEventLog: persistedEventLog,
  });

  // Audio start/stop handlers that wire into the WS
  const handleStartAudio = useCallback(() => {
    startAudio((pcmChunk) => {
      ws.sendAudioChunk(pcmChunk);
    });
  }, [startAudio, ws.sendAudioChunk]);

  const handleStopAudio = useCallback(() => {
    stopAudio();
  }, [stopAudio]);

  const handleSendText = useCallback(
    (message: string) => {
      ws.sendText(message);
    },
    [ws.sendText],
  );

  const handleToggleGestures = useCallback(() => {
    setGestureEnabled((current) => !current);
  }, []);

  const handleGestureStateChange = useCallback(
    (nextState: GestureRuntimeState) => {
      setGestureState(nextState);
    },
    [],
  );

  const handleClearGestureLogs = useCallback(() => {
    setGestureLogs([]);
  }, []);

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
    (nextToast: CanvasJobToastState, autoDismissMs?: number) => {
      clearCanvasToastTimer();
      setCanvasJobToast(nextToast);

      if (autoDismissMs && autoDismissMs > 0) {
        canvasToastTimerRef.current = setTimeout(() => {
          setCanvasJobToast((current) =>
            current?.jobId === nextToast.jobId ? null : current,
          );
          canvasToastTimerRef.current = null;
        }, autoDismissMs);
      }
    },
    [clearCanvasToastTimer],
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
        case "canvas.context_requested": {
          const toastPayload = normalizeCanvasJobToastPayload(action.payload);
          if (!toastPayload) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              job_id: action.job_id,
              summary: "Invalid canvas context request payload",
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

          if (!action.job_id) {
            ws.sendFrontendAck({
              status: "failed",
              action_type: action.type,
              source_tool: action.source_tool,
              summary: "Canvas context request missing job id",
            });
            return;
          }

          void (async () => {
            try {
              const context = await buildCanvasPlacementPlannerContext(editor, app);
              ws.sendCanvasContextResponse({
                type: "canvas_context_response",
                source_tool: action.source_tool,
                job_id: action.job_id,
                context,
              });
              ws.sendFrontendAck({
                status: "applied",
                action_type: action.type,
                source_tool: action.source_tool,
                job_id: action.job_id,
                summary: "Fresh canvas context captured and returned",
              });
            } catch (error) {
              console.error("Failed to build fresh canvas placement context", error);
              ws.sendFrontendAck({
                status: "failed",
                action_type: action.type,
                source_tool: action.source_tool,
                job_id: action.job_id,
                summary: "Failed to build fresh canvas context",
              });
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
            clearCanvasToast();
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
          }

          ws.sendFrontendAck({
            status: result.applied ? "applied" : "failed",
            action_type: action.type,
            source_tool: action.source_tool,
            job_id: action.job_id,
            summary: result.summary,
          });
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
    [app, applyFrontendFlashcardState, clearCanvasToast, editor, showCanvasToast, ws],
  );

  React.useEffect(() => {
    return subscribeGestureLogs((entry) => {
      setGestureLogs((previous) => [...previous.slice(-399), entry]);
    });
  }, []);

  useEffect(() => {
    hasLoadedRemoteSnapshotRef.current = false;
    setResumeError(null);

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
          });
          hasLoadedRemoteSnapshotRef.current = true;
        }

        if (resumePayload.transcript?.length) {
          setPersistedEventLog(transcriptToEventLog(resumePayload.transcript));
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
    const latestEvent = ws.eventLog[ws.eventLog.length - 1];
    if (
      latestEvent &&
      latestEvent.type === "system" &&
      latestEvent.content === "Turn complete"
    ) {
      void saveCheckpoint("turn_complete", "frontend_manual");
    }
  }, [saveCheckpoint, ws.eventLog]);

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
      processedFlashcardActionKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const latestEvent = ws.eventLog[ws.eventLog.length - 1];
    if (
      !latestEvent ||
      latestEvent.type !== "tool-result" ||
      !isRecord(latestEvent.rawEvent)
    ) {
      return;
    }

    const result = latestEvent.rawEvent.result;
    if (!isRecord(result)) {
      return;
    }

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
  }, [showCanvasToast, ws.eventLog]);

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

  if (!sessionId) {
    return <div>Session not found</div>;
  }

  return (
    <>
      <TldrawUiToastsProvider>
        <div className="tldraw-agent-container">
          <SessionRestoreOverlay
            isRestoring={isRestoringSession}
            error={resumeError}
          />
          <div className="tldraw-canvas" ref={canvasRef}>
            <Tldraw
              persistenceKey={`session-${sessionId}`}
              onMount={setEditor}
              licenseKey="tldraw-2026-06-18/WyJIUVlKamNRTCIsWyIqIl0sMTYsIjIwMjYtMDYtMTgiXQ.quVBu6P7tCMq3MRg6LyYhHKOvgiHA4PJpP1CiA3D2qPpLTuOPTHjvNNZjrkyFKtNsrvtiKocSV+PLk44uh6j2Q"
              tools={tools}
              overrides={overrides}
              components={components}
            >
              <GestureHost
                canvasRef={canvasRef}
                enabled={gestureEnabled}
                onStateChange={handleGestureStateChange}
              />
              <TldrawAgentAppProvider
                onMount={setApp}
                onUnmount={handleUnmount}
              />
            </Tldraw>
            <AgentSubtitleOverlay subtitle={ws.agentSubtitle} />
            <FlashcardPanel state={flashcardState} />
          </div>
          {/* ChatPanel replaced by live agent sidebar */}
          {/* <ErrorBoundary fallback={ChatPanelFallback}>
            {app && (
              <TldrawAgentAppContextProvider app={app}>
                <ChatPanel />
              </TldrawAgentAppContextProvider>
            )}
          </ErrorBoundary> */}
          <AgentSidebar
            app={app}
            connectionState={ws.connectionState}
            eventLog={ws.eventLog}
            gestureState={gestureState}
            gestureLogs={gestureLogs}
            gestureEnabled={gestureEnabled}
            isAudioActive={isAudioActive}
            onConnect={ws.connect}
            onDisconnect={ws.disconnect}
            onSendText={handleSendText}
            onStartAudio={handleStartAudio}
            onStopAudio={handleStopAudio}
            onClearLog={ws.clearLog}
            onClearGestureLogs={handleClearGestureLogs}
            onToggleGestures={handleToggleGestures}
          />
        </div>
      </TldrawUiToastsProvider>

      <CustomToolbar />

      {/* Dynamic Island for AI Voice Agent */}
      <DynamicIsland
        connectionState={ws.connectionState}
        talkingState={ws.talkingState}
        status={canvasJobToast}
      />
    </>
  );
};
