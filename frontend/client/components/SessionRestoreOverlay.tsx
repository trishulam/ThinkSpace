import React, { useEffect, useState } from "react";

interface SessionRestoreOverlayProps {
  isRestoring: boolean;
  error: string | null;
}

const SESSION_RESTORE_PREVIEW_STEPS = [
  {
    label: "Restoring session",
    description: "Loading your canvas state, transcript, and the last working context.",
  },
  {
    label: "Recovering your canvas",
    description: "Bringing your workspace back so you can continue without losing momentum.",
  },
  {
    label: "Syncing conversation context",
    description: "Reconnecting your session state so ThinkSpace can pick up where you left off.",
  },
  {
    label: "Almost ready",
    description: "Finalizing the session view and preparing the canvas for interaction.",
  },
] as const;

export function SessionRestoreOverlay({
  isRestoring,
  error,
}: SessionRestoreOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!isRestoring || error) {
      return;
    }

    setStepIndex(0);
    const intervalId = window.setInterval(() => {
      setStepIndex((current) => (current + 1) % SESSION_RESTORE_PREVIEW_STEPS.length);
    }, 2400);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [error, isRestoring]);

  if (!isRestoring && !error) return null;

  const currentStep = SESSION_RESTORE_PREVIEW_STEPS[stepIndex];

  if (!error) {
    return (
      <div
        className="session-restore-overlay session-restore-overlay--modern-loading"
        role="status"
        aria-live="polite"
        aria-label="Restoring session"
      >
        <section className="ts-home-session-preview session-restore-overlay__modern-view">
          <div className="ts-home-session-preview-shell">
            <div className="ts-home-session-preview-loader" aria-hidden="true">
              <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--outer" />
              <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--inner" />
              <span className="ts-home-session-preview-loader-core" />
            </div>
            <div className="ts-home-session-preview-copy">
              <p className="ts-home-session-preview-kicker">Preparing your session</p>
              <div
                key={currentStep.label}
                className="ts-home-session-preview-copy-body"
              >
                <div className="ts-home-session-preview-text-row">
                  <p className="ts-home-session-preview-text">{currentStep.label}</p>
                  <span
                    className="ts-home-session-preview-text-trail"
                    aria-hidden="true"
                  />
                </div>
                <p className="ts-home-session-preview-description">
                  {currentStep.description}
                </p>
              </div>
            </div>
            <div
              className="ts-home-session-preview-steps"
              aria-label="Session restoration progress"
            >
              {SESSION_RESTORE_PREVIEW_STEPS.map((step, index) => (
                <span
                  key={step.label}
                  className={
                    index === stepIndex
                      ? "ts-home-session-preview-step ts-home-session-preview-step--active"
                      : "ts-home-session-preview-step"
                  }
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className="session-restore-overlay"
      role="status"
      aria-live="polite"
      aria-label={error ? "Session restore failed" : "Restoring session"}
    >
      <div className="session-restore-overlay__backdrop" />
      <div className="session-restore-overlay__content">
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
      </div>
    </div>
  );
}
