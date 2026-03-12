import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  finalizeSessionRecordings,
  generateSessionKeyMoments,
  getSessionRecordingFinalUrl,
  getSessionKeyMoments,
  getSessionRecordingManifest,
  getSessionResume,
  type ApiSessionKeyMoment,
  type ApiSessionKeyMomentArtifact,
  type ApiSessionRecordingManifest,
  type ApiSessionResumeResponse,
  type ApiTranscriptTurn,
} from "../api/sessions";

type SessionFlashcard = {
  id: string;
  prompt: string;
  answer: string;
};

type TimelineKeyMoment = ApiSessionKeyMoment & {
  timeSeconds: number;
  progressPercent: number;
  resolvedTimestampLabel: string;
};

function extractPlainText(turn: ApiTranscriptTurn): string {
  const finalAgentText =
    turn.entries.find((entry) => entry.type === "agent-text" && !entry.isPartial)?.content ??
    turn.entries
      .filter((entry) => entry.type.startsWith("agent") && !entry.isPartial)
      .map((entry) => entry.content.trim())
      .filter(Boolean)
      .join(" ");
  return finalAgentText.replace(/\s+/g, " ").trim();
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

async function loadSessionKeyMomentArtifact(
  sessionId: string
): Promise<ApiSessionKeyMomentArtifact | null> {
  try {
    return await getSessionKeyMoments(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/key moments not found/i.test(message)) {
      console.warn("Failed to load key moments", error);
      return null;
    }
  }

  try {
    const generated = await generateSessionKeyMoments(sessionId);
    return generated.artifact;
  } catch (error) {
    console.warn("Failed to generate key moments", error);
    return null;
  }
}

function resolveMomentTimeSeconds(
  moment: ApiSessionKeyMoment,
  manifest: ApiSessionRecordingManifest | null,
  transcript: ApiTranscriptTurn[],
  videoDuration: number
): number | null {
  const sortedSegments = [...(manifest?.segments ?? [])].sort((a, b) => a.sequence - b.sequence);
  const momentTimestampMs = parseTimestampMs(moment.startTimestamp);
  if (momentTimestampMs !== null && sortedSegments.length > 0) {
    let accumulatedSeconds = 0;
    for (const segment of sortedSegments) {
      const segmentStartMs = parseTimestampMs(segment.startedAt);
      const segmentEndMs = parseTimestampMs(segment.endedAt);
      if (segmentStartMs === null || segmentEndMs === null || segmentEndMs < segmentStartMs) {
        continue;
      }

      const segmentDurationSeconds = (segmentEndMs - segmentStartMs) / 1000;
      if (momentTimestampMs >= segmentStartMs && momentTimestampMs <= segmentEndMs) {
        const offsetSeconds = (momentTimestampMs - segmentStartMs) / 1000;
        const leadInSeconds = Math.max(accumulatedSeconds + offsetSeconds - 1, 0);
        return videoDuration > 0 ? Math.min(leadInSeconds, videoDuration) : leadInSeconds;
      }
      accumulatedSeconds += segmentDurationSeconds;
    }
  }

  if (videoDuration <= 0 || transcript.length === 0) {
    return null;
  }

  const denominator = Math.max(transcript.length - 1, 1);
  const normalized =
    denominator === 0 ? 0 : (Math.max(moment.startTurnSequence, 1) - 1) / denominator;
  const clamped = Math.min(Math.max(normalized, 0), 1);
  return Math.max(clamped * videoDuration - 1, 0);
}

function formatVideoTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function buildFlashcards(
  session: ApiSessionResumeResponse["session"] | null,
  transcript: ApiTranscriptTurn[]
): SessionFlashcard[] {
  const topic = session?.topic ?? "this session";
  const goal = session?.goal ?? `Review the key ideas from ${topic}`;
  const transcriptHighlights = transcript
    .map((turn) => extractPlainText(turn))
    .filter(Boolean)
    .slice(0, 2);

  return [
    {
      id: "topic",
      prompt: `What was the main topic of ${topic}?`,
      answer: goal,
    },
    {
      id: "summary-1",
      prompt: "What was one important concept covered?",
      answer: transcriptHighlights[0] ?? "Key concepts will appear here once richer replay metadata is available.",
    },
    {
      id: "summary-2",
      prompt: "What is a good next review prompt for this session?",
      answer:
        transcriptHighlights[1] ??
        `Summarize the core learning outcome from ${topic} in your own words.`,
    },
  ];
}

export const SessionReplay: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [manifest, setManifest] = useState<ApiSessionRecordingManifest | null>(null);
  const [sessionResume, setSessionResume] = useState<ApiSessionResumeResponse | null>(null);
  const [keyMomentArtifact, setKeyMomentArtifact] = useState<ApiSessionKeyMomentArtifact | null>(
    null
  );
  const [transcript, setTranscript] = useState<ApiTranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setKeyMomentArtifact(null);

    void Promise.allSettled([
      getSessionRecordingManifest(sessionId),
      getSessionResume(sessionId),
      loadSessionKeyMomentArtifact(sessionId),
    ])
      .then(async ([manifestResult, resumeResult, keyMomentResult]) => {
        if (manifestResult.status === "rejected") {
          throw manifestResult.reason;
        }
        if (resumeResult.status === "rejected") {
          throw resumeResult.reason;
        }

        const nextManifest = manifestResult.value;
        const resumePayload = resumeResult.value;
        let resolvedManifest = nextManifest;
        if (!resolvedManifest.finalRelativePath && resolvedManifest.segments.length > 0) {
          resolvedManifest = await finalizeSessionRecordings(sessionId);
        }
        if (cancelled) {
          return;
        }
        setManifest(resolvedManifest);
        setSessionResume(resumePayload);
        setTranscript(resumePayload.transcript ?? []);
        if (keyMomentResult.status === "fulfilled") {
          setKeyMomentArtifact(keyMomentResult.value);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load session replay"
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const finalVideoUrl = manifest?.finalRelativePath
    ? getSessionRecordingFinalUrl(sessionId ?? "")
    : null;
  const keyMoments = useMemo(
    () => keyMomentArtifact?.keyMoments ?? [],
    [keyMomentArtifact]
  );
  const timelineKeyMoments = useMemo<TimelineKeyMoment[]>(() => {
    if (keyMoments.length === 0) {
      return [];
    }

    return keyMoments
      .map((moment) => {
        const timeSeconds = resolveMomentTimeSeconds(
          moment,
          manifest,
          transcript,
          videoDuration
        );
        if (timeSeconds === null) {
          return null;
        }

        const progressPercent =
          videoDuration > 0 ? Math.min((timeSeconds / videoDuration) * 100, 100) : 0;
        return {
          ...moment,
          timeSeconds,
          progressPercent,
          resolvedTimestampLabel: formatVideoTime(timeSeconds),
        };
      })
      .filter((moment): moment is TimelineKeyMoment => moment !== null);
  }, [keyMoments, manifest, transcript, videoDuration]);
  const flashcards = useMemo(
    () => buildFlashcards(sessionResume?.session ?? null, transcript),
    [sessionResume?.session, transcript]
  );
  const sessionTitle = sessionResume?.session.topic ?? "Session Summary";
  const sessionGoal = sessionResume?.session.goal;

  if (!sessionId) {
    return <div>Session not found</div>;
  }

  const seekToMoment = (timeSeconds: number) => {
    if (!videoRef.current || !Number.isFinite(timeSeconds)) {
      return;
    }
    videoRef.current.currentTime = timeSeconds;
    setVideoCurrentTime(timeSeconds);
  };

  const togglePlayback = () => {
    if (!videoRef.current) {
      return;
    }

    if (videoRef.current.paused) {
      void videoRef.current.play();
      return;
    }

    videoRef.current.pause();
  };

  return (
    <div className="mindpad-dashboard">
      <div className="mindpad-nav">
        <Link to="/dashboard" className="mindpad-nav-logo">
          <svg className="mindpad-icon-lg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 4L13 5V7C13 8.66 14.34 10 16 10H21ZM7 14C7 15.66 8.34 17 10 17H14C15.66 17 17 15.66 17 14V12H7V14ZM3 14V16C3 17.66 4.34 19 6 19H18C19.66 19 21 17.66 21 16V14C21 12.34 19.66 11 18 11H6C4.34 11 3 12.34 3 14Z" />
          </svg>
          <span>MindPad</span>
        </Link>

        <Link to={`/session/${sessionId}`} className="mindpad-btn-ghost">
          Open Session
        </Link>
      </div>

      <div className="mindpad-container">
        <div className="mindpad-page-header replay-page-header">
          <div>
            <h1 className="mindpad-page-title">{sessionTitle}</h1>
            <p className="mindpad-page-subtitle">
              Review the session video, moments, and transcript in one place.
            </p>
          </div>
          <div className="replay-page-header-actions">
            <Link to={`/session/${sessionId}`} className="mindpad-btn-ghost">
              Open Session
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="mindpad-empty-state">
            <h3 className="mindpad-empty-state-title">Loading replay</h3>
          </div>
        ) : error ? (
          <div className="mindpad-empty-state">
            <h3 className="mindpad-empty-state-title">Replay unavailable</h3>
            <p className="mindpad-empty-state-subtitle">{error}</p>
          </div>
        ) : (
          <div className="session-summary-layout">
            <div className="session-summary-hero">
              <section className="session-summary-video-card">
                <div className="session-summary-video-header">
                  <div>
                    <h2 className="session-summary-section-title">Session Video</h2>
                    <p className="session-summary-section-subtitle">
                      Full replay merged from {manifest?.segments.length ?? 0} recording segment(s)
                    </p>
                  </div>
                  <span className="session-summary-status-pill">
                    {manifest?.finalRelativePath ? "Ready" : manifest?.status ?? "Idle"}
                  </span>
                </div>
                {finalVideoUrl ? (
                  <div className="session-summary-video-shell">
                    <video
                      ref={videoRef}
                      src={finalVideoUrl}
                      className="session-summary-video"
                      onLoadedMetadata={(event) => {
                        setVideoDuration(event.currentTarget.duration || 0);
                      }}
                      onTimeUpdate={(event) => {
                        setVideoCurrentTime(event.currentTarget.currentTime || 0);
                      }}
                      onPlay={() => setIsVideoPlaying(true)}
                      onPause={() => setIsVideoPlaying(false)}
                      onEnded={() => setIsVideoPlaying(false)}
                      onClick={togglePlayback}
                    />
                    <div className="session-summary-player-controls">
                      <button
                        type="button"
                        className="session-summary-play-toggle"
                        onClick={togglePlayback}
                      >
                        {isVideoPlaying ? "Pause" : "Play"}
                      </button>
                      <span className="session-summary-player-time">
                        {formatVideoTime(videoCurrentTime)} / {formatVideoTime(videoDuration)}
                      </span>
                      <div className="session-summary-timeline">
                        <input
                          type="range"
                          min={0}
                          max={videoDuration || 0}
                          step={0.1}
                          value={Math.min(videoCurrentTime, videoDuration || 0)}
                          className="session-summary-timeline-slider"
                          style={
                            {
                              "--slider-progress":
                                videoDuration > 0 ? (videoCurrentTime / videoDuration) * 100 : 0,
                            } as React.CSSProperties
                          }
                          onChange={(event) => {
                            const nextTime = Number(event.currentTarget.value);
                            seekToMoment(nextTime);
                          }}
                          aria-label="Replay timeline"
                        />
                        <div className="session-summary-timeline-markers">
                          {timelineKeyMoments.map((moment) => (
                            <button
                              key={moment.id}
                              type="button"
                              className="session-summary-timeline-marker"
                              style={{ left: `${moment.progressPercent}%` }}
                              onClick={() => seekToMoment(moment.timeSeconds)}
                              title={`${moment.title} - ${moment.resolvedTimestampLabel}`}
                            >
                              <span className="session-summary-timeline-tooltip">
                                {moment.title} · {moment.resolvedTimestampLabel}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="session-summary-empty">
                    <h3>Replay video not available yet</h3>
                    <p>
                      Status: {manifest?.status ?? "idle"}
                      {manifest?.error ? ` - ${manifest.error}` : ""}
                    </p>
                  </div>
                )}
              </section>

              <aside className="session-summary-sidebar">
                <section className="session-summary-side-card">
                  <h3 className="session-summary-side-title">Session Overview</h3>
                  <div className="session-summary-stat-list">
                    <div className="session-summary-stat">
                      <span className="session-summary-stat-label">Topic</span>
                      <span className="session-summary-stat-value">{sessionTitle}</span>
                    </div>
                    <div className="session-summary-stat">
                      <span className="session-summary-stat-label">Goal</span>
                      <span className="session-summary-stat-value">
                        {sessionGoal || "No goal added"}
                      </span>
                    </div>
                    <div className="session-summary-stat">
                      <span className="session-summary-stat-label">Transcript turns</span>
                      <span className="session-summary-stat-value">{transcript.length}</span>
                    </div>
                    <div className="session-summary-stat">
                      <span className="session-summary-stat-label">Recorded segments</span>
                      <span className="session-summary-stat-value">
                        {manifest?.segments.length ?? 0}
                      </span>
                    </div>
                  </div>
                </section>

                <section className="session-summary-side-card">
                  <h3 className="session-summary-side-title">Quick Actions</h3>
                  <div className="session-summary-action-stack">
                    <Link to={`/session/${sessionId}`} className="mindpad-btn-primary">
                      Continue Learning
                    </Link>
                    <Link to="/dashboard" className="mindpad-btn-ghost">
                      Back to Dashboard
                    </Link>
                  </div>
                </section>
              </aside>
            </div>

            <div className="session-summary-sections">
              <section className="session-summary-panel">
                <div className="session-summary-panel-header">
                  <h2 className="session-summary-section-title">Flashcards</h2>
                  <span className="session-summary-panel-count">{flashcards.length} cards</span>
                </div>
                <div className="session-summary-flashcards">
                  {flashcards.map((card) => (
                    <article key={card.id} className="session-summary-flashcard">
                      <p className="session-summary-flashcard-label">Prompt</p>
                      <p className="session-summary-flashcard-question">{card.prompt}</p>
                      <p className="session-summary-flashcard-label">Answer</p>
                      <p className="session-summary-flashcard-answer">{card.answer}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="session-summary-panel">
                <div className="session-summary-panel-header">
                  <h2 className="session-summary-section-title">Key Moments</h2>
                  <span className="session-summary-panel-count">{keyMoments.length} items</span>
                </div>
                {keyMoments.length === 0 ? (
                  <div className="session-summary-empty">
                    <p>No key moments were inferred for this session yet.</p>
                  </div>
                ) : (
                  <div className="session-summary-moments">
                    {keyMoments.map((moment) => (
                      <article
                        key={moment.id}
                        className="session-summary-moment"
                        role={timelineKeyMoments.length > 0 ? "button" : undefined}
                        tabIndex={timelineKeyMoments.length > 0 ? 0 : -1}
                        onClick={() => {
                          const resolvedMoment = timelineKeyMoments.find(
                            (timelineMoment) => timelineMoment.id === moment.id
                          );
                          if (resolvedMoment) {
                            seekToMoment(resolvedMoment.timeSeconds);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          const resolvedMoment = timelineKeyMoments.find(
                            (timelineMoment) => timelineMoment.id === moment.id
                          );
                          if (resolvedMoment) {
                            event.preventDefault();
                            seekToMoment(resolvedMoment.timeSeconds);
                          }
                        }}
                      >
                        <div className="session-summary-moment-dot" />
                        <div>
                          <div className="session-summary-moment-meta">
                            {timelineKeyMoments.find(
                              (timelineMoment) => timelineMoment.id === moment.id
                            )?.resolvedTimestampLabel ?? `Turn ${moment.startTurnSequence}`}
                          </div>
                          <h3 className="session-summary-moment-title">{moment.title}</h3>
                          <p className="session-summary-moment-description">
                            {moment.summary}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="session-summary-panel">
                <div className="session-summary-panel-header">
                  <h2 className="session-summary-section-title">Transcript</h2>
                  <span className="session-summary-panel-count">{transcript.length} turns</span>
                </div>
                {transcript.length === 0 ? (
                  <div className="session-summary-empty">
                    <p>No transcript saved for this session.</p>
                  </div>
                ) : (
                  <div className="session-summary-transcript">
                    {transcript.map((turn) => (
                      <article key={turn.turnId} className="session-summary-transcript-turn">
                        <div className="session-summary-transcript-turn-header">
                          <span>Turn {turn.sequence}</span>
                          <span>{turn.status}</span>
                        </div>
                        <div className="session-summary-transcript-entries">
                          {turn.entries.map((entry, index) => (
                            <div
                              key={`${turn.turnId}-${index}`}
                              className="session-summary-transcript-entry"
                            >
                              <div className="session-summary-transcript-entry-type">
                                {entry.type}
                              </div>
                              <div className="session-summary-transcript-entry-content">
                                {entry.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};