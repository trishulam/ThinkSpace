import React, { useEffect, useRef } from "react";
import type { ConnectionState, TalkingState } from "../types/agent-live";

interface DynamicIslandStatus {
  title: string;
  message?: string;
  severity: "info" | "error";
  isLoading: boolean;
}

interface DynamicIslandProps {
  connectionState: ConnectionState;
  talkingState: TalkingState;
  status?: DynamicIslandStatus | null;
}

/* ── Waveform bars rendered for speaking states ── */
const WaveformBars: React.FC<{ variant: "agent" | "idle" }> = ({ variant }) => (
  <div className={`ts-notch-waveform ts-notch-waveform--${variant}`}>
    {Array.from({ length: 5 }).map((_, i) => (
      <span
        key={i}
        className="ts-notch-waveform-bar"
        style={{ "--bar-i": i } as React.CSSProperties}
      />
    ))}
  </div>
);

/* ── Three orbiting dots for thinking/tool-call ── */
const ThinkingOrbs: React.FC = () => (
  <div className="ts-notch-thinking">
    <span className="ts-notch-thinking-dot" />
    <span className="ts-notch-thinking-dot" />
    <span className="ts-notch-thinking-dot" />
  </div>
);

/* ── Shimmer ring for connecting ── */
const ConnectingRing: React.FC = () => (
  <div className="ts-notch-connecting">
    <span className="ts-notch-ring" />
    <span className="ts-notch-ring ts-notch-ring--2" />
    <span className="ts-notch-core" />
  </div>
);

/* ── Status dot for idle / disconnecting ── */
const StatusDot: React.FC<{ state: "idle" | "disconnecting" }> = ({
  state,
}) => <span className={`ts-notch-dot ts-notch-dot--${state}`} />;

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  connectionState,
  talkingState,
  status,
}) => {
  const notchRef = useRef<HTMLDivElement>(null);

  /* Derive the visual mode from both props */
  const getMode = (): string => {
    if (connectionState === "idle") return "idle";
    if (connectionState === "connecting") return "connecting";
    if (connectionState === "disconnecting") return "disconnecting";
    // connected
    if (talkingState === "thinking") return "thinking";
    if (talkingState === "agent") return "speaking-agent";
    // user talking now shows same as idle connected
    return "connected";
  };

  const mode = getMode();

  /* aria-label for screen-reader context */
  const ariaLabels: Record<string, string> = {
    idle: "Agent disconnected",
    connecting: "Agent connecting",
    connected: "Agent connected",
    thinking: "Agent thinking",
    "speaking-agent": "Agent speaking",
    disconnecting: "Agent disconnecting",
  };

  const renderInner = () => {
    switch (mode) {
      case "connecting":
        return (
          <>
            <ConnectingRing />
            <span className="ts-notch-label">Connecting</span>
          </>
        );
      case "thinking":
        return (
          <>
            <ThinkingOrbs />
            <span className="ts-notch-label">Thinking</span>
          </>
        );
      case "speaking-agent":
        return (
          <>
            <span className="ts-notch-pill-dot ts-notch-pill-dot--agent" />
            <WaveformBars variant="agent" />
          </>
        );

      case "connected":
        return (
          <>
            <span className="ts-notch-pill-dot ts-notch-pill-dot--connected" />
            <WaveformBars variant="idle" />
          </>
        );
      case "disconnecting":
        return <StatusDot state="disconnecting" />;
      default: // idle
        return <StatusDot state="idle" />;
    }
  };

  return (
    <div className="ts-notch-stack">
      <div
        ref={notchRef}
        className={`ts-notch ts-notch--${mode}`}
        role="status"
        aria-label={ariaLabels[mode] ?? "Agent status"}
      >
        <div className="ts-notch-inner">{renderInner()}</div>
      </div>
      <div
        className={`ts-notch-status${status ? " is-visible" : ""}${
          status?.severity === "error" ? " is-error" : ""
        }`}
        aria-hidden={status ? undefined : true}
      >
        {status && (
          <>
            <div className="ts-notch-status-row">
              <span
                className={`ts-notch-status-indicator${
                  status.isLoading ? " is-loading" : ""
                }`}
              />
              <span className="ts-notch-status-title">{status.title}</span>
            </div>
            {status.message && (
              <div className="ts-notch-status-message">{status.message}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
