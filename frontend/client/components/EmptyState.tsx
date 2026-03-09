import React from "react";

interface EmptyStateProps {
  onCreateSession: () => void;
}

const PlusIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
  </svg>
);

export const EmptyState: React.FC<EmptyStateProps> = ({ onCreateSession }) => {
  return (
    <div className="ts-empty-state">
      <div className="ts-empty-state-glyph">🧠</div>
      <h3 className="ts-empty-state-title">No sessions yet</h3>
      <p className="ts-empty-state-sub">
        Start your first AI-powered learning session. Pick a topic and dive in.
      </p>
      <button
        className="mindpad-btn-primary"
        onClick={onCreateSession}
        type="button"
      >
        <PlusIcon />
        Create your first session
      </button>
    </div>
  );
};
