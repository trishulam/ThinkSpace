import React from "react";
import { Session } from "../types/session";

interface SessionCardProps {
  session: Session;
  onResume: (sessionId: string) => void;
  onReplay: (sessionId: string) => void;
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
  "rgba(16,185,129,0.12)",
  "rgba(59,130,246,0.12)",
  "rgba(139,92,246,0.12)",
  "rgba(245,158,11,0.12)",
  "rgba(239,68,68,0.1)",
  "rgba(20,184,166,0.12)",
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

const TimeIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 5v5.25l4.5 2.67-.75 1.23L11 13V7h1.5z" />
  </svg>
);

const ClockIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm5.01 15l-6-3.78V7h1.5v5.43l5.27 3.31L17 17z" />
  </svg>
);

const PlayIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const ReplayIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
  </svg>
);

export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  onResume,
  onReplay,
}) => {
  const emoji = topicEmoji(session.topic);
  const bgColor = topicBg(session.topic);

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResume(session.id);
  };

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReplay(session.id);
  };

  return (
    <div className="ts-session-row" onClick={() => onResume(session.id)}>
      {/* Icon */}
      <div className="ts-session-row-icon" style={{ background: bgColor }}>
        {emoji}
      </div>

      {/* Body */}
      <div className="ts-session-row-body">
        <span className="ts-session-row-title">{session.topic}</span>
        {session.goal && (
          <span className="ts-session-row-goal">{session.goal}</span>
        )}
      </div>

      {/* Meta */}
      <div className="ts-session-row-meta">
        <span className="ts-session-row-meta-chip">
          <TimeIcon />
          {formatLastActive(session.lastActive)}
        </span>
        {session.duration > 0 && (
          <span className="ts-session-row-meta-chip">
            <ClockIcon />
            {formatDuration(session.duration)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="ts-session-row-actions">
        <button
          className="ts-row-btn ts-row-btn--ghost"
          onClick={handleReplay}
          type="button"
          title="Replay session"
        >
          <ReplayIcon />
          Replay
        </button>
        <button
          className="ts-row-btn ts-row-btn--primary"
          onClick={handleResume}
          type="button"
          title="Resume session"
        >
          <PlayIcon />
          Resume
        </button>
      </div>
    </div>
  );
};
