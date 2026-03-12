import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  type ApiTranscriptEntry,
  type ApiTranscriptTurn,
} from "../api/sessions";
import { TopNavigation } from "../components/TopNavigation";

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

function toDisplayStatus(value: string | null | undefined): string {
  if (!value) {
    return "Idle";
  }
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function getReplayTranscriptEntries(turn: ApiTranscriptTurn): ApiTranscriptEntry[] {
  const userTranscription = turn.entries.find(
    (entry) => entry.type === "user-transcription" && entry.isPartial === false
  );

  const finalAgentTextIndex = turn.entries.findIndex(
    (entry) => entry.type === "agent-text" && !entry.isPartial
  );

  const previousEntry =
    finalAgentTextIndex > 0 ? turn.entries[finalAgentTextIndex - 1] : undefined;
  const agentTranscription =
    previousEntry?.type === "agent-transcription" ? previousEntry : undefined;

  return [userTranscription, agentTranscription].filter(
    (entry): entry is ApiTranscriptEntry => Boolean(entry?.content?.trim())
  );
}

export const SessionReplay: React.FC = () => {
  const navigate = useNavigate();
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
  const [expandedMomentIds, setExpandedMomentIds] = useState<Record<string, boolean>>({});
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
  const replayStatus = manifest?.finalRelativePath ? "Ready" : toDisplayStatus(manifest?.status);

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

  const toggleMomentExpanded = (momentId: string) => {
    setExpandedMomentIds((current) => ({
      ...current,
      [momentId]: !current[momentId],
    }));
  };

  return (
    <div className="mindpad-dashboard ts-home-dashboard">
      <TopNavigation
        onPrimaryAction={() => navigate("/dashboard")}
        primaryActionLabel="Back to Dashboard"
        pageTitle="Replay"
        pageSubtitle="Review video, transcript, and study materials."
        showSearch={false}
      />

      <div className="ts-replay-shell">
        {isLoading ? (
          <section className="ts-home-empty-state">
            <h3 className="ts-home-empty-state-title">Loading replay</h3>
            <p className="ts-home-empty-state-sub">
              Pulling together the session video, transcript, and generated study materials.
            </p>
          </section>
        ) : error ? (
          <section className="ts-home-empty-state">
            <h3 className="ts-home-empty-state-title">Replay unavailable</h3>
            <p className="ts-home-empty-state-sub">{error}</p>
          </section>
        ) : (
          <div className="ts-replay-layout">
            <div className="ts-replay-top-grid">
              <section className="ts-replay-video-card">
                <div className="ts-replay-card-header">
                  <div>
                    <p className="ts-replay-section-kicker">Replay Video</p>
                    <h1 className="ts-replay-title">{sessionTitle}</h1>
                  </div>
                  <span className="ts-replay-status">{replayStatus}</span>
                </div>
                {finalVideoUrl ? (
                  <div className="ts-replay-video-shell">
                    <video
                      ref={videoRef}
                      src={finalVideoUrl}
                      className="ts-replay-video"
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
                    <div className="ts-replay-player-controls">
                      <button
                        type="button"
                        className="ts-replay-play-toggle"
                        onClick={togglePlayback}
                      >
                        {isVideoPlaying ? "Pause" : "Play"}
                      </button>
                      <span className="ts-replay-player-time">
                        {formatVideoTime(videoCurrentTime)} / {formatVideoTime(videoDuration)}
                      </span>
                      <div className="ts-replay-timeline">
                        <input
                          type="range"
                          min={0}
                          max={videoDuration || 0}
                          step={0.1}
                          value={Math.min(videoCurrentTime, videoDuration || 0)}
                          className="ts-replay-timeline-slider"
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
                        <div className="ts-replay-timeline-markers">
                          {timelineKeyMoments.map((moment) => (
                            <button
                              key={moment.id}
                              type="button"
                              className="ts-replay-timeline-marker"
                              style={{ left: `${moment.progressPercent}%` }}
                              onClick={() => seekToMoment(moment.timeSeconds)}
                              title={`${moment.title} - ${moment.resolvedTimestampLabel}`}
                            >
                              <span className="ts-replay-timeline-tooltip">
                                {moment.title} · {moment.resolvedTimestampLabel}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="ts-replay-empty">
                    <h3>Replay video not available yet</h3>
                    <p>
                      Status: {manifest?.status ?? "idle"}
                      {manifest?.error ? ` - ${manifest.error}` : ""}
                    </p>
                  </div>
                )}
              </section>

              <section className="ts-replay-panel ts-replay-panel--moments">
                <div className="ts-replay-card-header">
                  <div>
                    <p className="ts-replay-section-kicker">Key Moments</p>
                    <h2>Important segments</h2>
                  </div>
                </div>
                {keyMoments.length === 0 ? (
                  <div className="ts-replay-empty">
                    <p>No key moments were inferred for this session yet.</p>
                  </div>
                ) : (
                  <div className="ts-replay-moments">
                    {keyMoments.map((moment) => (
                      <article
                        key={moment.id}
                        className="ts-replay-moment"
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
                        <div className="ts-replay-moment-dot" />
                        <div className="ts-replay-moment-body">
                          <div className="ts-replay-moment-meta">
                            {timelineKeyMoments.find(
                              (timelineMoment) => timelineMoment.id === moment.id
                            )?.resolvedTimestampLabel ?? `Turn ${moment.startTurnSequence}`}
                          </div>
                          <h3 className="ts-replay-moment-title">{moment.title}</h3>
                          <p
                            className={
                              expandedMomentIds[moment.id]
                                ? "ts-replay-moment-description ts-replay-moment-description--expanded"
                                : "ts-replay-moment-description"
                            }
                          >
                            {moment.summary}
                          </p>
                          {moment.summary.trim().length > 140 ? (
                            <button
                              className="ts-replay-moment-expand"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleMomentExpanded(moment.id);
                              }}
                              aria-expanded={expandedMomentIds[moment.id] ? "true" : "false"}
                            >
                              {expandedMomentIds[moment.id] ? "Collapse ▴" : "Expand ▾"}
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="ts-replay-bottom-grid">
              <section className="ts-replay-panel ts-replay-panel--transcript">
                <div className="ts-replay-card-header">
                  <div>
                    <p className="ts-replay-section-kicker">Transcript</p>
                    <h2>Conversation timeline</h2>
                  </div>
                </div>
                {transcript.length === 0 ? (
                  <div className="ts-replay-empty">
                    <p>No transcript saved for this session.</p>
                  </div>
                ) : (
                  <div className="ts-replay-transcript">
                    {transcript.map((turn) => {
                      const replayEntries = getReplayTranscriptEntries(turn);

                      return (
                        <article key={turn.turnId} className="ts-replay-transcript-turn">
                          <div className="ts-replay-transcript-turn-header">
                            <span>Turn {turn.sequence}</span>
                            <span>{toDisplayStatus(turn.status)}</span>
                          </div>
                          <div className="ts-replay-transcript-entries">
                            {replayEntries.length > 0 ? (
                              replayEntries.map((entry, index) => (
                                <div
                                  key={`${turn.turnId}-${index}`}
                                  className="ts-replay-transcript-entry"
                                >
                                  <div className="ts-replay-transcript-entry-type">
                                    {toDisplayStatus(entry.type)}
                                  </div>
                                  <div className="ts-replay-transcript-entry-content">
                                    {entry.content}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="ts-replay-transcript-entry ts-replay-transcript-entry--empty">
                                <div className="ts-replay-transcript-entry-type">Replay view</div>
                                <div className="ts-replay-transcript-entry-content">
                                  No transcript excerpt was captured for this turn.
                                </div>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <div className="ts-replay-right-stack">
                <section className="ts-replay-panel">
                  <div className="ts-replay-card-header">
                    <div>
                      <p className="ts-replay-section-kicker">Flashcards</p>
                      <h2>Review prompts</h2>
                    </div>
                  </div>
                  <div className="ts-replay-flashcards">
                    {flashcards.map((card) => (
                      <article key={card.id} className="ts-replay-flashcard">
                        <p className="ts-replay-flashcard-label">Prompt</p>
                        <p className="ts-replay-flashcard-question">{card.prompt}</p>
                        <p className="ts-replay-flashcard-label">Answer</p>
                        <p className="ts-replay-flashcard-answer">{card.answer}</p>
                      </article>
                    ))}
                  </div>
                </section>

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};