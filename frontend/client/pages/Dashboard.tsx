import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSessionRecordingManifest, getSessionResume } from "../api/sessions";
import { useSession } from "../context/SessionContext";
import { TopNavigation } from "../components/TopNavigation";
import { SessionCard } from "../components/SessionCard";
import { EmptyState } from "../components/EmptyState";
import { NewSessionModal } from "../components/NewSessionModal";
import { NewSessionData, Session } from "../types/session";

type DashboardFilter = "all" | "active" | "completed" | "transcript" | "recording";

type SessionArtifactState = {
  hasTranscript: boolean;
  transcriptTurns: number;
  hasRecording: boolean;
  recordingSegments: number;
  hasFlashcards: boolean;
  isLoading: boolean;
};

const FILTER_OPTIONS: Array<{ value: DashboardFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "transcript", label: "Transcript Ready" },
  { value: "recording", label: "Recording Ready" },
];

const PINNED_SESSIONS = [
  "Quantum Computing 101",
  "Game Theory Strategy",
  "Advanced TypeScript Patterns",
];

const EMPTY_ARTIFACT_STATE: SessionArtifactState = {
  hasTranscript: false,
  transcriptTurns: 0,
  hasRecording: false,
  recordingSegments: 0,
  hasFlashcards: false,
  isLoading: true,
};

/* Skeleton rows shown during loading */
const SkeletonRows: React.FC = () => (
  <div className="ts-home-session-list">
    {[1, 2, 3].map((i) => (
      <div key={i} className="ts-home-skeleton-row" style={{ position: "relative" }}>
        <div className="ts-home-skeleton-icon" />
        <div className="ts-home-skeleton-body">
          <div
            className="ts-home-skeleton-line ts-home-skeleton-line--wide"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
          <div
            className="ts-home-skeleton-line ts-home-skeleton-line--narrow"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        </div>
      </div>
    ))}
  </div>
);

const formatRelativeTime = (date: Date): string => {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(Math.floor(diffMs / 60000), 0);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 60) {
    return minutes <= 1 ? "Just now" : `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 7) {
    return `${days}d ago`;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

const formatCalendarDate = (date: Date): string =>
  date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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

const buildResourceList = (
  session: Session,
  artifacts: SessionArtifactState | undefined
): string[] => {
  const resources: string[] = [];

  if (artifacts?.hasTranscript) {
    resources.push("Transcript");
  }
  if (artifacts?.hasRecording) {
    resources.push("Recording");
  }
  if (artifacts?.hasFlashcards) {
    resources.push("Flashcards");
  }
  if (session.summary || session.checkpointCount > 0) {
    resources.push("Replay");
  }

  return resources;
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { sessions, createSession, isLoading, error } = useSession();
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>("all");
  const [artifactBySessionId, setArtifactBySessionId] = useState<
    Record<string, SessionArtifactState>
  >({});

  const handleNewSession = () => setIsNewSessionModalOpen(true);

  const handleCreateSession = async (data: NewSessionData) => {
    setIsCreatingSession(true);
    try {
      const newSession = await createSession(data);
      setIsNewSessionModalOpen(false);
      navigate(`/session/${newSession.id}`);
    } catch {
      // The shared session context already exposes the API error message.
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleResumeSession = (sessionId: string) =>
    navigate(`/session/${sessionId}`);
  const handleSummarySession = (sessionId: string) =>
    navigate(`/session/${sessionId}/replay`);

  useEffect(() => {
    if (sessions.length === 0) {
      setArtifactBySessionId({});
      return;
    }

    let cancelled = false;
    setArtifactBySessionId((current) => {
      const next: Record<string, SessionArtifactState> = {};
      sessions.forEach((session) => {
        next[session.id] = current[session.id] ?? EMPTY_ARTIFACT_STATE;
      });
      return next;
    });

    void Promise.all(
      sessions.map(async (session) => {
        const [resumeResult, manifestResult] = await Promise.allSettled([
          getSessionResume(session.id),
          getSessionRecordingManifest(session.id),
        ]);

        const transcriptTurns =
          resumeResult.status === "fulfilled" ? resumeResult.value.transcript?.length ?? 0 : 0;
        const recordingSegments =
          manifestResult.status === "fulfilled" ? manifestResult.value.segments.length : 0;
        const hasRecording =
          manifestResult.status === "fulfilled"
            ? Boolean(manifestResult.value.finalRelativePath) || manifestResult.value.segments.length > 0
            : false;

        return [
          session.id,
          {
            hasTranscript: transcriptTurns > 0,
            transcriptTurns,
            hasRecording,
            recordingSegments,
            hasFlashcards: transcriptTurns > 0,
            isLoading: false,
          },
        ] as const;
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }

      setArtifactBySessionId((current) => {
        const next = { ...current };
        results.forEach(([sessionId, state]) => {
          next[sessionId] = state;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [sessions]);

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((left, right) => right.lastActive.getTime() - left.lastActive.getTime()),
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortedSessions.filter((session) => {
      const artifacts = artifactBySessionId[session.id];
      const matchesQuery =
        query.length === 0 ||
        [
          session.topic,
          session.goal,
          session.summary,
          getModeLabel(session.mode),
          getLevelLabel(session.level),
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query));

      const matchesFilter =
        activeFilter === "all" ||
        (activeFilter === "active" && session.status !== "completed") ||
        (activeFilter === "completed" && session.status === "completed") ||
        (activeFilter === "transcript" && Boolean(artifacts?.hasTranscript)) ||
        (activeFilter === "recording" && Boolean(artifacts?.hasRecording));

      return matchesQuery && matchesFilter;
    });
  }, [activeFilter, artifactBySessionId, searchQuery, sortedSessions]);

  const continueLearningSessions = useMemo(() => sortedSessions.slice(0, 2), [sortedSessions]);
  const latestSession = sortedSessions[0];
  const recommendationTopic = latestSession?.topic ?? "your latest concept";
  const recommendationBody =
    latestSession?.summary ||
    latestSession?.goal ||
    `Review the main idea from ${recommendationTopic} and explain it back in your own words.`;

  const sidebar = (
    <aside className="ts-home-rail">
      <section className="ts-home-rail-section ts-home-rail-section--accent">
        <div className="ts-home-rail-header">
          <span className="ts-home-rail-kicker">Recommended Next</span>
          <h3>Return to {recommendationTopic}</h3>
        </div>
        <p className="ts-home-rail-body">{recommendationBody}</p>
        {latestSession ? (
          <button
            className="ts-home-sidebar-link"
            onClick={() => handleSummarySession(latestSession.id)}
            type="button"
          >
            Open replay
          </button>
        ) : (
          <span className="ts-home-sidebar-caption">Appears once you create a session</span>
        )}
      </section>

      <section className="ts-home-rail-section">
        <div className="ts-home-rail-header">
          <span className="ts-home-rail-kicker">Pinned Sessions</span>
          <h3>Quick access</h3>
        </div>
        <ul className="ts-home-pin-list">
          {PINNED_SESSIONS.map((title) => (
            <li key={title}>
              <button className="ts-home-pin-row" type="button">
                <span>{title}</span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );

  return (
    <div className="mindpad-dashboard ts-home-dashboard">
      <TopNavigation
        onPrimaryAction={handleNewSession}
        primaryActionLabel="New Session"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <div className="ts-home-dashboard-inner">
        {error && (
          <p className="ts-home-error-banner" role="status">
            {error}
          </p>
        )}

        <section className="ts-home-banner">
          <div className="ts-home-banner-copy">
            <p className="ts-home-eyebrow">Learning Dashboard</p>
            <h1>Welcome back.</h1>
            <p className="ts-home-hero-text">
              Your place to learn concepts deeply, revisit session replays, and master topics
              with AI-guided study sessions.
            </p>
            <div className="ts-home-hero-actions">
              <button className="ts-home-primary-btn" onClick={handleNewSession} type="button">
                Start New Session
              </button>
              <button
                className="ts-home-secondary-btn"
                onClick={() => latestSession && handleResumeSession(latestSession.id)}
                type="button"
                disabled={!latestSession}
              >
                Continue Last Session
              </button>
            </div>
          </div>
        </section>

        <div className="ts-home-workspace">
          <div className="ts-home-main">
            {isLoading ? (
              <section className="ts-home-section">
                <div className="ts-home-section-header">
                  <div>
                    <p className="ts-home-section-kicker">Loading</p>
                    <h2>Fetching your sessions</h2>
                  </div>
                </div>
                <SkeletonRows />
              </section>
            ) : sessions.length === 0 ? (
              <section className="ts-home-section">
                <div className="ts-home-section-header">
                  <div>
                    <p className="ts-home-section-kicker">Get started</p>
                    <h2>Build your learning library</h2>
                  </div>
                </div>
                <EmptyState onCreateSession={handleNewSession} />
              </section>
            ) : (
              <>
                <section className="ts-home-section">
                  <div className="ts-home-section-header">
                    <div>
                      <p className="ts-home-section-kicker">Continue Learning</p>
                      <h2>Pick up where you left off</h2>
                    </div>
                    <button
                      className="ts-home-link-btn"
                      onClick={() => {
                        setSearchQuery("");
                        setActiveFilter("all");
                      }}
                      type="button"
                    >
                      View all history
                    </button>
                  </div>

                  <div className="ts-home-feature-surface">
                    {continueLearningSessions.map((session) => {
                      return (
                        <article key={session.id} className="ts-home-feature-slab">
                          <div className="ts-home-feature-meta">
                            <span className="ts-home-feature-badge">{getModeLabel(session.mode)}</span>
                            <span>{formatRelativeTime(session.lastActive)}</span>
                          </div>
                          <h3>{session.topic}</h3>
                          <p>
                            {session.summary ||
                              session.goal ||
                              "Return to this topic and keep building your understanding."}
                          </p>
                          <div className="ts-home-feature-footer">
                            <button
                              className="ts-home-inline-action"
                              onClick={() => handleResumeSession(session.id)}
                              type="button"
                            >
                              Continue
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <section className="ts-home-section">
                  <div className="ts-home-section-header ts-home-section-header--stacked">
                    <div>
                      <p className="ts-home-section-kicker">Recent Sessions</p>
                      <h2>Recent learning objects</h2>
                    </div>
                    <div className="ts-home-filter-row">
                      {FILTER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={
                            option.value === activeFilter
                              ? "ts-home-filter-chip ts-home-filter-chip--active"
                              : "ts-home-filter-chip"
                          }
                          onClick={() => setActiveFilter(option.value)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredSessions.length > 0 ? (
                    <div className="ts-home-session-surface">
                      {filteredSessions.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          availability={artifactBySessionId[session.id]}
                          onResume={handleResumeSession}
                          onSummary={handleSummarySession}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="ts-home-zero-state">
                      <h3>No sessions match your current filters</h3>
                      <p>
                        Try a different search term or switch filters to see more of your learning
                        history.
                      </p>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          {sidebar}
        </div>
      </div>

      <NewSessionModal
        isOpen={isNewSessionModalOpen}
        onClose={() => setIsNewSessionModalOpen(false)}
        onCreateSession={handleCreateSession}
        isSubmitting={isCreatingSession}
      />
    </div>
  );
};
