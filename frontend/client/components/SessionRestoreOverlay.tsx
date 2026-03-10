import React from "react";

interface SessionRestoreOverlayProps {
  isRestoring: boolean;
  error: string | null;
}

export function SessionRestoreOverlay({
  isRestoring,
  error,
}: SessionRestoreOverlayProps) {
  if (!isRestoring && !error) return null;

  return (
    <div
      className="session-restore-overlay"
      role="status"
      aria-live="polite"
      aria-label={error ? "Session restore failed" : "Restoring session"}
    >
      <div className="session-restore-overlay__backdrop" />
      <div className="session-restore-overlay__content">
        {error ? (
          <div className="session-restore-overlay__error">
            <div className="session-restore-overlay__error-icon">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="session-restore-overlay__error-title">
              Couldn&apos;t restore session
            </h2>
            <p className="session-restore-overlay__error-message">{error}</p>
          </div>
        ) : (
          <div className="session-restore-overlay__loading">
            <div className="session-restore-overlay__loader">
              <div className="session-restore-overlay__loader-ring" />
              <div className="session-restore-overlay__loader-icon">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M12 18v-6" />
                  <path d="M9 15h6" />
                </svg>
              </div>
            </div>
            <h2 className="session-restore-overlay__title">
              Restoring session
            </h2>
            <p className="session-restore-overlay__subtitle">
              Loading your canvas and transcript
            </p>
            <div className="session-restore-overlay__dots">
              <span className="session-restore-overlay__dot" />
              <span className="session-restore-overlay__dot" />
              <span className="session-restore-overlay__dot" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
