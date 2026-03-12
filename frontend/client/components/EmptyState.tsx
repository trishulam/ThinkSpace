import React from "react";

interface EmptyStateProps {
  onCreateSession: () => void;
  title?: string;
  subtitle?: string;
}

const PlusIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
  </svg>
);

export const EmptyState: React.FC<EmptyStateProps> = ({
  onCreateSession,
  title = "Start your first learning session",
  subtitle = "Pick a concept, ask questions, and build mastery with transcripts, replay, and study artifacts in one place.",
}) => {
  return (
    <div className="ts-home-empty-state">
      <div className="ts-home-empty-state-glyph">🧠</div>
      <h3 className="ts-home-empty-state-title">{title}</h3>
      <p className="ts-home-empty-state-sub">{subtitle}</p>
      <button
        className="ts-home-primary-btn"
        onClick={onCreateSession}
        type="button"
      >
        <PlusIcon />
        New Session
      </button>
    </div>
  );
};
