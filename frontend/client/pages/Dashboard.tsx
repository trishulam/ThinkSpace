import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSessionReplayStatuses } from "../api/sessions";
import { useSession } from "../context/SessionContext";
import { NewSessionModal } from "../components/NewSessionModal";
import { NewSessionData, Session } from "../types/session";

type DashboardFilter = "all" | "active" | "completed" | "transcript" | "recording";

type SessionArtifactState = {
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
};

const FILTER_OPTIONS: Array<{ value: DashboardFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "transcript", label: "Transcript Ready" },
  { value: "recording", label: "Recording Ready" },
];

const HERO_SUGGESTIONS = [
  "Quantum physics deep dive",
  "Neural networks 101",
  "Philosophy of mind",
];

const SESSION_CREATION_PREVIEW_STEPS = [
  {
    label: "Initializing session",
    description: "Setting up a fresh canvas so your next learning flow feels focused from the first second.",
  },
  {
    label: "Reading your prompt",
    description: "Pulling in your topic and intent so ThinkSpace knows where to begin the conversation.",
  },
  {
    label: "Gathering context",
    description: "Reviewing any attached material and nearby signals before the session experience opens.",
  },
  {
    label: "Preparing the canvas",
    description: "Arranging the workspace for exploration, note-taking, and follow-up questions.",
  },
] as const;

const EMPTY_ARTIFACT_STATE: SessionArtifactState = {
  replayStatus: "idle",
  transcriptStatus: "idle",
  hasTranscript: false,
  transcriptTurns: 0,
  videoStatus: "idle",
  hasRecording: false,
  recordingSegments: 0,
  keyMomentsStatus: "idle",
  hasFlashcards: false,
  isReplayReady: false,
  isLoading: true,
};

const INACTIVE_ARTIFACT_STATE: SessionArtifactState = {
  ...EMPTY_ARTIFACT_STATE,
  isLoading: false,
};

const isUnhydratedArtifactState = (state: SessionArtifactState | undefined): boolean =>
  !state ||
  (state.replayStatus === "idle" &&
    state.transcriptStatus === "idle" &&
    state.transcriptTurns === 0 &&
    state.videoStatus === "idle" &&
    state.recordingSegments === 0 &&
    state.keyMomentsStatus === "idle" &&
    !state.hasTranscript &&
    !state.hasRecording &&
    !state.hasFlashcards);

const toArtifactState = (
  status: Pick<
    SessionArtifactState,
    | "replayStatus"
    | "transcriptStatus"
    | "transcriptTurns"
    | "videoStatus"
    | "recordingSegments"
    | "keyMomentsStatus"
  >
): SessionArtifactState => {
  const hasRecording = status.videoStatus === "ready";
  return {
    replayStatus: status.replayStatus,
    transcriptStatus: status.transcriptStatus,
    hasTranscript: status.transcriptTurns > 0,
    transcriptTurns: status.transcriptTurns,
    videoStatus: status.videoStatus,
    hasRecording,
    recordingSegments: status.recordingSegments,
    keyMomentsStatus: status.keyMomentsStatus,
    hasFlashcards: status.keyMomentsStatus === "ready" || status.transcriptTurns > 0,
    isReplayReady: status.replayStatus === "ready",
    isLoading: false,
  };
};

/* Library-shaped skeleton rows shown during loading */
const LibrarySkeletonRows: React.FC = () => (
  <section className="ts-home-landing-section ts-home-landing-section--library-loading" id="thinkspace-library">
    <div className="ts-home-landing-section-header ts-home-landing-section-header--library">
      <div>
        <p className="ts-home-landing-section-kicker">Learning Library</p>
        <h2>Sessions</h2>
      </div>
    </div>
    <div className="ts-home-library-skeleton-list" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="ts-home-library-skeleton-item">
          <div className="ts-home-library-skeleton-main">
            <div className="ts-home-library-skeleton-icon" />
            <div className="ts-home-library-skeleton-copy">
              <div className="ts-home-library-skeleton-line ts-home-library-skeleton-line--date" />
              <div className="ts-home-library-skeleton-line ts-home-library-skeleton-line--title" />
              <div className="ts-home-library-skeleton-line ts-home-library-skeleton-line--body" />
              <div className="ts-home-library-skeleton-line ts-home-library-skeleton-line--body-short" />
            </div>
          </div>
          <div className="ts-home-library-skeleton-actions">
            <div className="ts-home-library-skeleton-button" />
            <div className="ts-home-library-skeleton-button ts-home-library-skeleton-button--secondary" />
          </div>
        </div>
      ))}
    </div>
  </section>
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

const LogoGlyph: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8 6.25C6.37 7.37 5.25 9.24 5.25 11.38c0 3.47 3 6.28 6.75 6.28s6.75-2.81 6.75-6.28c0-2.14-1.12-4.01-2.75-5.13" />
    <path d="M9 5.5c.72-.83 1.79-1.25 3-1.25s2.28.42 3 1.25" />
    <path d="M9.75 11.25h4.5" />
    <path d="M12 9v4.5" />
  </svg>
);

const SessionPreviewLoader: React.FC = () => (
  <div className="ts-home-session-preview-loader" aria-hidden="true">
    <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--outer" />
    <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--inner" />
    <span className="ts-home-session-preview-loader-core" />
  </div>
);

const BellIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M15 17H5.5a1 1 0 0 1-.77-1.64l1.02-1.23A3 3 0 0 0 6.5 12.2V10a5.5 5.5 0 1 1 11 0v2.2a3 3 0 0 0 .75 1.93l1.02 1.23A1 1 0 0 1 18.5 17H15Z" />
    <path d="M9.5 19a2.5 2.5 0 0 0 5 0" />
  </svg>
);

const PromptPlusIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const ArrowIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M5 12h12" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

const StopIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="8" />
    <path d="M9 9h6v6H9z" />
  </svg>
);

const getStatusLabel = (status: string): string =>
  status === "completed" ? "Completed" : status === "processing" ? "Processing" : "In Progress";

const getSessionDescriptor = (session: Session): string =>
  session.summary ||
  session.goal ||
  `Return to ${session.topic} and keep building your understanding.`;

const getLibraryArtifacts = (
  availability?: SessionArtifactState
): string[] =>
  [
    availability?.hasTranscript ? "Transcript" : null,
    availability?.hasRecording ? "Recording" : null,
    availability?.hasFlashcards ? "Flashcards" : null,
  ].filter((value): value is string => Boolean(value));

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { sessions, createSession, completeSession, isLoading, error } = useSession();
  const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSessionPreviewVisible, setIsSessionPreviewVisible] = useState(false);
  const [sessionPreviewStepIndex, setSessionPreviewStepIndex] = useState(0);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [isPromptPopoverOpen, setIsPromptPopoverOpen] = useState(false);
  const [attachedFileNames, setAttachedFileNames] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>("all");
  const [artifactBySessionId, setArtifactBySessionId] = useState<
    Record<string, SessionArtifactState>
  >({});
  const promptPopoverRef = useRef<HTMLDivElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  const handleNewSession = () => setIsNewSessionModalOpen(true);
  const handleOpenCanvas = () => setIsNewSessionModalOpen(true);
  const handleSessionPreviewOpen = () => {
    setSessionActionError(null);
    setIsPromptPopoverOpen(false);
    setSessionPreviewStepIndex(0);
    setIsSessionPreviewVisible(true);
  };

  const handleCreateSession = async (data: NewSessionData) => {
    setIsCreatingSession(true);
    setSessionActionError(null);
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
    navigate(`/session/${sessionId}/session-summary`);
  const handleCompleteSession = async (sessionId: string) => {
    if (endingSessionId) {
      return;
    }

    setEndingSessionId(sessionId);
    setSessionActionError(null);
    try {
      await completeSession(sessionId);
      navigate(`/session/${sessionId}/session-summary`);
    } catch (completeError) {
      setSessionActionError(
        completeError instanceof Error ? completeError.message : "Unable to end the session"
      );
    } finally {
      setEndingSessionId(null);
    }
  };

  useEffect(() => {
    if (sessions.length === 0) {
      setArtifactBySessionId({});
      return;
    }

    setArtifactBySessionId((current) => {
      const next: Record<string, SessionArtifactState> = {};
      sessions.forEach((session) => {
        const existingState = current[session.id];
        if (session.status === "completed") {
          next[session.id] = isUnhydratedArtifactState(existingState)
            ? EMPTY_ARTIFACT_STATE
            : (existingState ?? EMPTY_ARTIFACT_STATE);
          return;
        }

        next[session.id] = existingState ?? INACTIVE_ARTIFACT_STATE;
      });
      return next;
    });
  }, [sessions]);

  useEffect(() => {
    const sessionIdsToFetch = sessions
      .filter((session) => session.status === "completed")
      .filter((session) => artifactBySessionId[session.id]?.isLoading)
      .map((session) => session.id);

    if (sessionIdsToFetch.length === 0) {
      return;
    }

    let cancelled = false;

    void getSessionReplayStatuses(sessionIdsToFetch)
      .then((statuses) => {
        if (cancelled) {
          return;
        }

        const statusBySessionId = new Map(statuses.map((status) => [status.sessionId, status]));
        setArtifactBySessionId((current) => {
          const next = { ...current };
          sessionIdsToFetch.forEach((sessionId) => {
            const status = statusBySessionId.get(sessionId);
            next[sessionId] = status
              ? toArtifactState({
                  replayStatus: status.replayStatus,
                  transcriptStatus: status.transcriptStatus,
                  transcriptTurns: status.transcriptTurnCount,
                  videoStatus: status.videoStatus,
                  recordingSegments: status.videoSegmentCount,
                  keyMomentsStatus: status.keyMomentsStatus,
                })
              : INACTIVE_ARTIFACT_STATE;
          });
          return next;
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setArtifactBySessionId((current) => {
          const next = { ...current };
          sessionIdsToFetch.forEach((sessionId) => {
            next[sessionId] = INACTIVE_ARTIFACT_STATE;
          });
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [artifactBySessionId, sessions]);

  useEffect(() => {
    if (!isPromptPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (promptPopoverRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsPromptPopoverOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isPromptPopoverOpen]);

  useEffect(() => {
    if (!isSessionPreviewVisible) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSessionPreviewStepIndex((current) => (current + 1) % SESSION_CREATION_PREVIEW_STEPS.length);
    }, 2400);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSessionPreviewVisible(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSessionPreviewVisible]);

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
        (activeFilter === "transcript" && artifacts?.transcriptStatus === "ready") ||
        (activeFilter === "recording" && artifacts?.videoStatus === "ready");

      return matchesQuery && matchesFilter;
    });
  }, [activeFilter, artifactBySessionId, searchQuery, sortedSessions]);

  const currentSessionPreviewStep = SESSION_CREATION_PREVIEW_STEPS[sessionPreviewStepIndex];
  const scrollToSection = (sectionId: string) => {
    const section = document.getElementById(sectionId);
    if (!section) {
      return;
    }

    const scrollContainer = document.querySelector(".mindpad-dashboard");
    const nav = document.querySelector(".ts-home-landing-nav");
    const navHeight = nav instanceof HTMLElement ? nav.offsetHeight : 0;
    const containerTop =
      scrollContainer instanceof HTMLElement ? scrollContainer.getBoundingClientRect().top : 0;
    const currentScrollTop =
      scrollContainer instanceof HTMLElement ? scrollContainer.scrollTop : window.scrollY;
    const top = currentScrollTop + section.getBoundingClientRect().top - containerTop - navHeight - 18;

    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTo({
        top: Math.max(top, 0),
        behavior: "smooth",
      });
      return;
    }

    window.scrollTo({
      top: Math.max(top, 0),
      behavior: "smooth",
    });
  };

  return (
    <div className="mindpad-dashboard ts-home-dashboard ts-home-dashboard--landing">
      {isSessionPreviewVisible ? (
        <section className="ts-home-session-preview" aria-live="polite">
          <div className="ts-home-session-preview-shell">
            <SessionPreviewLoader />
            <div className="ts-home-session-preview-copy">
              <p className="ts-home-session-preview-kicker">Preparing your session</p>
              <div
                key={currentSessionPreviewStep.label}
                className="ts-home-session-preview-copy-body"
              >
                <div className="ts-home-session-preview-text-row">
                  <p className="ts-home-session-preview-text">
                    {currentSessionPreviewStep.label}
                  </p>
                  <span
                    className="ts-home-session-preview-text-trail"
                    aria-hidden="true"
                  />
                </div>
                <p className="ts-home-session-preview-description">
                  {currentSessionPreviewStep.description}
                </p>
              </div>
            </div>
            <div
              className="ts-home-session-preview-steps"
              aria-label="Session preparation progress"
            >
              {SESSION_CREATION_PREVIEW_STEPS.map((step, index) => (
                <span
                  key={step.label}
                  className={
                    index === sessionPreviewStepIndex
                      ? "ts-home-session-preview-step ts-home-session-preview-step--active"
                      : "ts-home-session-preview-step"
                  }
                />
              ))}
            </div>
          </div>
        </section>
      ) : (
        <>
          <header className="ts-home-landing-nav">
            <div className="ts-home-landing-brand">
              <button className="ts-home-landing-logo" onClick={() => navigate("/dashboard")} type="button">
                <span className="ts-home-landing-logo-mark">
                  <LogoGlyph />
                </span>
                <span>ThinkSpace</span>
              </button>
            </div>
            <nav className="ts-home-landing-nav-links" aria-label="Primary">
              <button type="button" onClick={() => scrollToSection("thinkspace-hero")}>
                Explore
              </button>
              <button type="button" onClick={() => scrollToSection("thinkspace-library")}>
                Library
              </button>
              <button type="button" onClick={handleOpenCanvas}>
                New Session
              </button>
            </nav>
            <div className="ts-home-landing-nav-actions">
              <button className="ts-home-landing-icon-btn" type="button" aria-label="Notifications">
                <BellIcon />
              </button>
              <button className="ts-home-landing-avatar" type="button" aria-label="Open profile" />
            </div>
          </header>
          <div className="ts-home-dashboard-inner">
            {(error || sessionActionError) && (
              <p className="ts-home-error-banner" role="status">
                {sessionActionError || error}
              </p>
            )}

            <section className="ts-home-landing-hero" id="thinkspace-hero">
              <div className="ts-home-landing-hero-core">
                <h1>ThinkSpace</h1>
                <div className="ts-home-landing-prompt-shell">
                  <div className="ts-home-landing-prompt-tools" ref={promptPopoverRef}>
                    <button
                      className="ts-home-landing-prompt-icon-btn"
                      type="button"
                      aria-label="Open prompt tools"
                      aria-expanded={isPromptPopoverOpen ? "true" : "false"}
                      onClick={() => setIsPromptPopoverOpen((current) => !current)}
                    >
                      <PromptPlusIcon />
                    </button>
                    {isPromptPopoverOpen ? (
                      <div className="ts-home-landing-prompt-popover">
                        <button
                          className="ts-home-landing-prompt-popover-action"
                          type="button"
                          onClick={() => attachInputRef.current?.click()}
                        >
                          Attach files
                        </button>
                        <p className="ts-home-landing-prompt-popover-note">
                          Add supporting files before starting a new session.
                        </p>
                        {attachedFileNames.length > 0 ? (
                          <div className="ts-home-landing-prompt-file-list">
                            {attachedFileNames.map((fileName) => (
                              <span key={fileName} className="ts-home-landing-prompt-file-pill">
                                {fileName}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <input
                      ref={attachInputRef}
                      type="file"
                      className="ts-home-landing-file-input"
                      multiple
                      onChange={(event) => {
                        const nextFiles = Array.from(event.target.files ?? []).map((file) => file.name);
                        setAttachedFileNames(nextFiles);
                        setIsPromptPopoverOpen(false);
                      }}
                    />
                  </div>
                  <input
                    className="ts-home-landing-prompt-input"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="What would you like to master today?"
                    aria-label="Search or describe what you want to learn"
                  />
                  <button
                    className="ts-home-landing-prompt-btn"
                    onClick={handleSessionPreviewOpen}
                    type="button"
                  >
                    Ask ThinkSpace
                  </button>
                </div>
                <div className="ts-home-landing-suggestions">
                  <span className="ts-home-landing-suggestions-label">Suggested for you</span>
                  <div className="ts-home-landing-suggestion-row">
                    {HERO_SUGGESTIONS.map((topic) => (
                      <button
                        key={topic}
                        className="ts-home-landing-suggestion-chip"
                        onClick={() => setSearchQuery(topic)}
                        type="button"
                      >
                        <span className="ts-home-landing-suggestion-dot" aria-hidden="true" />
                        {topic}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className="ts-home-landing-scroll"
                  type="button"
                  onClick={() => scrollToSection("thinkspace-library")}
                >
                  Scroll to sessions
                  <span className="ts-home-landing-scroll-indicator" aria-hidden="true">
                    <span />
                  </span>
                </button>
              </div>
            </section>

            {isLoading && sessions.length === 0 ? (
              <LibrarySkeletonRows />
            ) : sessions.length === 0 ? (
              <section className="ts-home-landing-empty">
                <p className="ts-home-landing-kicker">Get started</p>
                <h2>Build your ThinkSpace library</h2>
                <p>
                  Start your first session, ask questions out loud, and come back to replay the
                  recording with notes and key moments.
                </p>
                <button className="ts-home-landing-prompt-btn" onClick={handleOpenCanvas} type="button">
                  Start Canvas Session
                </button>
                <button className="ts-home-landing-prompt-btn" onClick={handleNewSession} type="button">
                  Start First Session
                </button>
              </section>
            ) : (
              <>
                <section className="ts-home-landing-section" id="thinkspace-library">
                  <div className="ts-home-landing-section-header ts-home-landing-section-header--library">
                    <div>
                      <p className="ts-home-landing-section-kicker">Learning Library</p>
                      <h2>Sessions</h2>
                    </div>
                    <div className="ts-home-landing-library-controls">
                      {FILTER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={
                            option.value === activeFilter
                              ? "ts-home-landing-filter ts-home-landing-filter--active"
                              : "ts-home-landing-filter"
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
                    <div className="ts-home-library-list">
                      {filteredSessions.map((session) => {
                        const availability = artifactBySessionId[session.id];
                        const artifacts = getLibraryArtifacts(availability);
                        const summaryText = getSessionDescriptor(session);
                        const isCompleted = session.status === "completed";

                        return (
                          <article key={session.id} className="ts-home-library-item">
                            <div className="ts-home-library-item-main">
                              <div className="ts-home-library-item-icon">
                                {session.topic.charAt(0).toUpperCase()}
                              </div>
                              <div className="ts-home-library-item-copy">
                                <div className="ts-home-library-item-eyebrow">
                                  <span className="ts-home-library-item-date">
                                    {formatCalendarDate(session.lastActive)}
                                  </span>
                                </div>
                                <h3>{session.topic}</h3>
                                <p>{summaryText}</p>
                                {artifacts.length > 0 ? (
                                  <div className="ts-home-library-item-meta">
                                    {artifacts.map((artifact) => (
                                      <span key={artifact} className="ts-home-library-artifact">
                                        {artifact}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="ts-home-library-item-actions">
                              {isCompleted ? (
                                <button
                                  className="ts-home-library-summary-btn"
                                  type="button"
                                  onClick={() => handleSummarySession(session.id)}
                                >
                                  <span>Session summary</span>
                                  <ArrowIcon />
                                </button>
                              ) : (
                                <>
                                  <button
                                    className="ts-home-library-action"
                                    type="button"
                                    onClick={() => handleResumeSession(session.id)}
                                  >
                                    Continue
                                  </button>
                                  <button
                                    className="ts-home-library-action ts-home-library-action--muted"
                                    type="button"
                                    onClick={() => handleCompleteSession(session.id)}
                                    disabled={endingSessionId === session.id}
                                  >
                                    {endingSessionId === session.id ? "Ending..." : "End session"}
                                  </button>
                                </>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="ts-home-landing-zero">
                      <h3>No sessions match your current filters</h3>
                      <p>Try a different prompt, search phrase, or status filter to surface the right sessions.</p>
                    </div>
                  )}
                </section>

                <footer className="ts-home-landing-footer">
                  <div className="ts-home-landing-footer-brand">
                    <span className="ts-home-landing-footer-mark">
                      <LogoGlyph />
                    </span>
                    <span>&copy; 2026 ThinkSpace</span>
                  </div>
                  <div className="ts-home-landing-footer-links">
                    <button type="button">Privacy Policy</button>
                    <button type="button">Terms of Service</button>
                    <button type="button">Support</button>
                  </div>
                </footer>
              </>
            )}
          </div>
        </>
      )}

      <NewSessionModal
        isOpen={isNewSessionModalOpen}
        onClose={() => setIsNewSessionModalOpen(false)}
        onCreateSession={handleCreateSession}
        isSubmitting={isCreatingSession}
      />
    </div>
  );
};
