import React from "react";
import { useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { useSession } from '../context/SessionContext'
import {
  DefaultSizeStyle,
  // ErrorBoundary,
  Editor,
  TLComponents,
  Tldraw,
  TldrawOverlays,
  TldrawUiToastsProvider,
  TLUiOverrides,
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
import { GestureHost } from "../gesture/components/GestureHost";
import { GestureLogEntry, GestureRuntimeState } from "../gesture/types";
import { subscribeGestureLogs } from "../gesture/utils/logger";
import { useAgentWebSocket } from "../hooks/useAgentWebSocket";
import { useAudioWorklets } from "../hooks/useAudioWorklets";
import type { AgentLogEntry } from "../types/agent-live";

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

export const SessionCanvas: React.FC = () => {
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

  const handleExportGestureTrace = useCallback(() => {
    const sanitizedState = gestureState
      ? {
          ...gestureState,
          stream: gestureState.stream ? "[MediaStream omitted]" : null,
        }
      : null;

    const payload = {
      exportedAt: new Date().toISOString(),
      routeSessionId: sessionId,
      gestureState: sanitizedState,
      gestureLogs: gestureLogs.map((entry) => ({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gesture-trace-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [gestureLogs, gestureState, sessionId]);

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
            onSendText={ws.sendText}
            onStartAudio={handleStartAudio}
            onStopAudio={handleStopAudio}
            onClearLog={ws.clearLog}
            onClearGestureLogs={handleClearGestureLogs}
            onToggleGestures={handleToggleGestures}
            onExportGestureTrace={handleExportGestureTrace}
          />
        </div>
      </TldrawUiToastsProvider>

      <CustomToolbar />

      {/* Dynamic Island for AI Voice Agent */}
      <DynamicIsland
        connectionState={ws.connectionState}
        talkingState={ws.talkingState}
      />
    </>
  );
};
