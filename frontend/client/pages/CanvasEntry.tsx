import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import type { NewSessionData, Session } from "../types/session";
import { DEFAULT_SESSION_PERSONA, isSessionPersonaId } from "../config/personas";

const DEFAULT_SESSION: NewSessionData = {
  topic: "Canvas workspace",
  goal: "Explore ideas on the canvas",
  mode: "guided",
  level: "beginner",
  persona: DEFAULT_SESSION_PERSONA,
};

function isMode(value: string | null): value is Session["mode"] {
  return value === "guided" || value === "socratic" || value === "challenge";
}

function isLevel(value: string | null): value is Session["level"] {
  return value === "beginner" || value === "intermediate" || value === "advanced";
}

export const CanvasEntry: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { createSession } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inFlightRef = useRef(false);

  const sessionData = useMemo<NewSessionData>(() => {
    const topic = searchParams.get("topic")?.trim();
    const goal = searchParams.get("goal")?.trim();
    const mode = searchParams.get("mode");
    const level = searchParams.get("level");
    const persona = searchParams.get("persona");

    return {
      topic: topic || DEFAULT_SESSION.topic,
      goal: goal || DEFAULT_SESSION.goal,
      mode: isMode(mode) ? mode : DEFAULT_SESSION.mode,
      level: isLevel(level) ? level : DEFAULT_SESSION.level,
      persona: isSessionPersonaId(persona) ? persona : DEFAULT_SESSION.persona,
    };
  }, [searchParams]);

  useEffect(() => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setError(null);

    void createSession(sessionData)
      .then((session) => {
        navigate(`/session/${session.id}`, { replace: true });
      })
      .catch((creationError) => {
        setError(
          creationError instanceof Error
            ? creationError.message
            : "Unable to open the canvas session",
        );
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [attempt, createSession, navigate, sessionData]);

  return (
    <div className="ts-canvas-entry">
      <div className="ts-canvas-entry__panel">
        <p className="ts-canvas-entry__kicker">Opening canvas</p>
        <h1 className="ts-canvas-entry__title">Preparing your session</h1>
        <p className="ts-canvas-entry__copy">
          ThinkSpace is creating a live canvas session and restoring the full workspace.
        </p>
        {error ? (
          <>
            <p className="ts-canvas-entry__error">{error}</p>
            <div className="ts-canvas-entry__actions">
              <button
                type="button"
                className="ts-home-secondary-btn"
                onClick={() => navigate("/dashboard")}
              >
                Back to dashboard
              </button>
              <button
                type="button"
                className="ts-home-primary-btn"
                onClick={() => setAttempt((current) => current + 1)}
              >
                Try again
              </button>
            </div>
          </>
        ) : (
          <div className="ts-canvas-entry__loader" aria-hidden="true">
            <span className="ts-canvas-entry__loader-ring ts-canvas-entry__loader-ring--outer" />
            <span className="ts-canvas-entry__loader-ring ts-canvas-entry__loader-ring--inner" />
            <span className="ts-canvas-entry__loader-core" />
          </div>
        )}
      </div>
    </div>
  );
};
