import React from "react";
import { Session } from "../types/session";

interface SessionAvailability {
  replayStatus: "idle" | "processing" | "ready" | "failed" | "partial";
  transcriptStatus: "idle" | "pending" | "processing" | "ready" | "failed" | "unavailable";
  hasTranscript: boolean;
  transcriptTurns: number;
  videoStatus: "idle" | "pending" | "processing" | "ready" | "failed" | "unavailable";
  hasRecording: boolean;
  recordingSegments: number;
  keyMomentsStatus: "idle" | "pending" | "processing" | "ready" | "failed" | "unavailable";
  hasFlashcards: boolean;
  isReplayReady: boolean;
  isLoading: boolean;
}

interface SessionCardProps {
  session: Session;
  availability?: SessionAvailability;
  onResume: (sessionId: string) => void;
  onSummary: (sessionId: string) => void;
}

/* Topic emoji picker — deterministic from topic string */
const TOPIC_EMOJIS = [
  "📓",
  "🔬",
  "🌏",
  "📐",
  "💡",
  "🎵",
  "⚗️",
  "🌱",
  "🎨",
  "🧠",
  "📊",
  "🚀",
];
const ICON_BGSCOLOR = [
  "rgba(91,43,238,0.12)",
  "rgba(99,102,241,0.12)",
  "rgba(14,165,233,0.12)",
  "rgba(168,85,247,0.12)",
  "rgba(245,158,11,0.12)",
  "rgba(244,63,94,0.1)",
];

function topicHash(topic: string): number {
  let h = 0;
  for (let i = 0; i < topic.length; i++) {
    h = (h * 31 + topic.charCodeAt(i)) & 0xffffff;
  }
  return h;
}

function topicEmoji(topic: string) {
  const h = topicHash(topic);
  return TOPIC_EMOJIS[h % TOPIC_EMOJIS.length];
}

function topicBg(topic: string) {
  const h = topicHash(topic);
  return ICON_BGSCOLOR[h % ICON_BGSCOLOR.length];
}

const formatLastActive = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const ClockIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4.5l3 1.75" />
  </svg>
);

const SparkIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="m12 3 1.9 4.85L19 9.75l-4.1 2.4L13.5 17 10.8 12.3 6 9.75l5.1-1.9L12 3Z" />
  </svg>
);

const PlayIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const ReplayIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M4 12a8 8 0 0 0 13.66 5.66" />
    <path d="M20 12A8 8 0 0 0 6.34 6.34" />
    <path d="M4 4v5h5" />
  </svg>
);

const getModeLabel = (mode: Session["mode"]): string => {
  switch (mode) {
    case "guided":
      return "Guided";
    case "socratic":
      return "Socratic";
    case "challenge":
      return "Challenge";
    default:
      return mode;
  }
};

const getLevelLabel = (level: Session["level"]): string => {
  switch (level) {
    case "beginner":
      return "Beginner";
    case "intermediate":
      return "Intermediate";
    case "advanced":
      return "Advanced";
    default:
      return level;
  }
};

const getStatusMeta = (
  status: string
): { label: string; tone: "active" | "completed" | "pending" } => {
  if (status === "completed") {
    return { label: "Ready", tone: "completed" };
  }
  if (status === "processing") {
    return { label: "Processing", tone: "pending" };
  }
  return { label: "In Progress", tone: "active" };
};

export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  availability,
  onResume,
  onSummary,
}) => {
  const emoji = topicEmoji(session.topic);
  const bgColor = topicBg(session.topic);
  const status = getStatusMeta(session.status);
  const summaryText =
    session.summary ||
    session.goal ||
    `Continue learning ${session.topic} with a ${getModeLabel(session.mode).toLowerCase()} study session.`;
  const resources = [
    availability?.hasTranscript ? "Transcript" : null,
    availability?.hasRecording ? "Recording" : null,
    availability?.hasFlashcards ? "Flashcards" : null,
    availability?.isReplayReady ? "Replay" : null,
  ].filter((value): value is string => Boolean(value));
  const replayButtonLabel =
    availability?.replayStatus === "processing" ? "Preparing replay" : "Replay";
  const isReplayDisabled =
    availability?.isLoading ||
    (session.status === "completed" && availability?.isReplayReady === false);

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResume(session.id);
  };

  const handleSummary = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSummary(session.id);
  };

  return (
    <div className="ts-home-session-card" onClick={() => onResume(session.id)}>
      <div className="ts-home-session-card-main">
        <div className="ts-home-session-card-icon" style={{ background: bgColor }}>
          {emoji}
        </div>

        <div className="ts-home-session-card-copy">
          <div className="ts-home-session-card-header">
            <div>
              <h3 className="ts-home-session-card-title">{session.topic}</h3>
              <p className="ts-home-session-card-summary">{summaryText}</p>
            </div>
            <span
              className={`ts-home-status-pill ts-home-status-pill--${status.tone}`}
            >
              {status.label}
            </span>
          </div>

          <div className="ts-home-session-card-meta">
            <span>{getModeLabel(session.mode)}</span>
            <span>{getLevelLabel(session.level)}</span>
            <span>{formatLastActive(session.lastActive)}</span>
            {session.duration > 0 && <span>{formatDuration(session.duration)}</span>}
            {session.checkpointCount > 0 && <span>{session.checkpointCount} checkpoints</span>}
            {session.milestoneCount > 0 && <span>{session.milestoneCount} milestones</span>}
          </div>

          <div className="ts-home-session-card-resources">
            {resources.length > 0 ? (
              resources.map((resource) => (
                <span key={resource} className="ts-home-session-card-resource">
                  {resource}
                </span>
              ))
            ) : availability?.isLoading ? (
              <span className="ts-home-session-card-resource ts-home-session-card-resource--muted">
                Checking study materials...
              </span>
            ) : (
              <span className="ts-home-session-card-resource ts-home-session-card-resource--muted">
                Session workspace
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="ts-home-session-card-aside">
        <div className="ts-home-session-card-stats">
          <span className="ts-home-session-card-stat">
            <ClockIcon />
            Updated {formatLastActive(session.lastActive)}
          </span>
          <span className="ts-home-session-card-stat">
            <SparkIcon />
            {session.summary ? "Summary ready" : "Continue building"}
          </span>
        </div>

        <div className="ts-home-session-card-actions">
          <button
            className="ts-home-inline-text-btn"
            onClick={handleSummary}
            type="button"
            title="View replay"
            disabled={Boolean(isReplayDisabled)}
          >
            <ReplayIcon />
            {replayButtonLabel}
          </button>
          <button
            className="ts-home-inline-text-btn ts-home-inline-text-btn--primary"
            onClick={handleResume}
            type="button"
            title="Resume session"
          >
            <PlayIcon />
            {session.status === "completed" ? "Open" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
};
