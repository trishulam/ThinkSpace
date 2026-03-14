import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { useNavigate, useParams } from "react-router-dom";
import {
  getSession,
  getSessionRecordingFinalUrl,
  getSessionKeyMoments,
  getSessionNotes,
  getSessionRecordingManifest,
  getSessionReplayStatus,
  getSessionTranscript,
  type ApiSession,
  type ApiSessionKeyMoment,
  type ApiSessionKeyMomentArtifact,
  type ApiSessionNotesArtifact,
  type ApiSessionRecordingManifest,
  type ApiSessionReplayStatus,
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

async function loadStoredKeyMomentArtifact(
  sessionId: string
): Promise<ApiSessionKeyMomentArtifact | null> {
  try {
    return await getSessionKeyMoments(sessionId);
  } catch (error) {
    console.warn("Failed to load stored key moments", error);
    return null;
  }
}

async function loadStoredNotesArtifact(sessionId: string): Promise<ApiSessionNotesArtifact | null> {
  try {
    return await getSessionNotes(sessionId);
  } catch (error) {
    console.warn("Failed to load stored session notes", error);
    return null;
  }
}

type ReplayDataPayload = {
  statusPayload: ApiSessionReplayStatus;
  manifestPayload: ApiSessionRecordingManifest;
  nextKeyMomentArtifact: ApiSessionKeyMomentArtifact | null;
  nextNotesArtifact: ApiSessionNotesArtifact | null;
};

type ReplayStaticDataPayload = {
  sessionPayload: ApiSession;
  transcriptPayload: ApiTranscriptTurn[];
};

async function fetchReplayStaticData(sessionId: string): Promise<ReplayStaticDataPayload> {
  const [sessionPayload, transcriptPayload] = await Promise.all([
    getSession(sessionId),
    getSessionTranscript(sessionId),
  ]);
  return {
    sessionPayload,
    transcriptPayload,
  };
}

async function fetchReplayStatusData(sessionId: string): Promise<ReplayDataPayload> {
  const [statusPayload, manifestPayload] = await Promise.all([
    getSessionReplayStatus(sessionId),
    getSessionRecordingManifest(sessionId),
  ]);
  const [nextKeyMomentArtifact, nextNotesArtifact] = await Promise.all([
    statusPayload.keyMomentsStatus === "ready"
      ? loadStoredKeyMomentArtifact(sessionId)
      : Promise.resolve(null),
    statusPayload.notesStatus === "ready"
      ? loadStoredNotesArtifact(sessionId)
      : Promise.resolve(null),
  ]);

  return {
    statusPayload,
    manifestPayload,
    nextKeyMomentArtifact,
    nextNotesArtifact,
  };
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

function formatStatusTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildFlashcards(
  session: ApiSession | null,
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
  const [replayArtifactStatus, setReplayArtifactStatus] = useState<ApiSessionReplayStatus | null>(
    null
  );
  const [sessionData, setSessionData] = useState<ApiSession | null>(null);
  const [keyMomentArtifact, setKeyMomentArtifact] = useState<ApiSessionKeyMomentArtifact | null>(
    null
  );
  const [notesArtifact, setNotesArtifact] = useState<ApiSessionNotesArtifact | null>(null);
  const [transcript, setTranscript] = useState<ApiTranscriptTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [expandedMomentIds, setExpandedMomentIds] = useState<Record<string, boolean>>({});
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const applyReplayStatusData = useCallback((payload: ReplayDataPayload) => {
    setReplayArtifactStatus(payload.statusPayload);
    setManifest(payload.manifestPayload);
    setKeyMomentArtifact(payload.nextKeyMomentArtifact);
    setNotesArtifact(payload.nextNotesArtifact);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setKeyMomentArtifact(null);
    setNotesArtifact(null);
    setSessionData(null);
    setTranscript([]);

    void (async () => {
      try {
        const [staticPayload, statusPayload] = await Promise.all([
          fetchReplayStaticData(sessionId),
          fetchReplayStatusData(sessionId),
        ]);
        if (cancelled) {
          return;
        }
        setSessionData(staticPayload.sessionPayload);
        setTranscript(staticPayload.transcriptPayload);
        applyReplayStatusData(statusPayload);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load session replay"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyReplayStatusData, sessionId]);

  useEffect(() => {
    if (!sessionId || !replayArtifactStatus) {
      return;
    }

    const shouldPoll =
      replayArtifactStatus.replayStatus === "processing" ||
      replayArtifactStatus.videoStatus === "pending" ||
      replayArtifactStatus.videoStatus === "processing" ||
      (replayArtifactStatus.videoStatus === "ready" && !manifest?.finalRelativePath) ||
      replayArtifactStatus.keyMomentsStatus === "pending" ||
      replayArtifactStatus.keyMomentsStatus === "processing" ||
      (replayArtifactStatus.keyMomentsStatus === "ready" && keyMomentArtifact === null) ||
      replayArtifactStatus.notesStatus === "pending" ||
      replayArtifactStatus.notesStatus === "processing" ||
      (replayArtifactStatus.notesStatus === "ready" && notesArtifact === null);

    if (!shouldPoll) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const payload = await fetchReplayStatusData(sessionId);
          if (cancelled) {
            return;
          }
          applyReplayStatusData(payload);
        } catch (pollError) {
          console.warn("Failed to poll replay readiness", pollError);
        }
      })();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    applyReplayStatusData,
    keyMomentArtifact,
    manifest?.finalRelativePath,
    notesArtifact,
    replayArtifactStatus,
    sessionId,
  ]);

  const refreshReplayStatus = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    setIsRefreshing(true);
    setError(null);
    try {
      const payload = await fetchReplayStatusData(sessionId);
      applyReplayStatusData(payload);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : "Unable to refresh replay status"
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [applyReplayStatusData, sessionId]);

  const finalVideoUrl =
    replayArtifactStatus?.videoStatus === "ready" && manifest?.finalRelativePath
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
    () => buildFlashcards(sessionData, transcript),
    [sessionData, transcript]
  );
  const notesMarkdown = notesArtifact?.notesMarkdown.trim() ?? "";
  const sessionTitle = sessionData?.topic ?? "Session Summary";
  const sessionLifecycleStatus = sessionData?.status ?? "active";
  const replayStatus = toDisplayStatus(
    replayArtifactStatus?.replayStatus ??
      (manifest?.finalRelativePath ? "ready" : manifest?.status ?? "idle")
  );
  const requestedAtLabel = formatStatusTimestamp(replayArtifactStatus?.requestedAt);
  const updatedAtLabel = formatStatusTimestamp(replayArtifactStatus?.updatedAt);
  const replayProgressHint =
    sessionLifecycleStatus !== "completed"
      ? "Replay generation starts after you end the session from the canvas."
      : replayArtifactStatus?.replayStatus === "processing"
        ? "Replay artifacts are still being generated. This page auto-refreshes every few seconds."
        : replayArtifactStatus?.replayStatus === "failed"
          ? "One or more replay jobs failed. The backend error is shown below in the affected section."
          : replayArtifactStatus?.replayStatus === "ready"
            ? "Replay artifacts are ready."
            : "Replay artifacts are queued or only partially available.";
  const videoAvailabilityMessage =
    sessionLifecycleStatus !== "completed"
      ? "This session is still active. End the session to start replay video generation."
      : replayArtifactStatus?.videoStatus === "processing" ||
          replayArtifactStatus?.videoStatus === "pending"
        ? `Replay video is being prepared${
            manifest?.segments?.length ? ` from ${manifest.segments.length} recorded segment(s)` : ""
          }.`
        : replayArtifactStatus?.videoStatus === "failed"
          ? replayArtifactStatus.videoError ||
            manifest?.error ||
            "Replay video generation failed for this session."
          : replayArtifactStatus?.videoStatus === "unavailable"
            ? "No recording segments were uploaded for this session, so there is no replay video to merge."
            : "Replay video is not available for this session yet.";
  const keyMomentsMessage =
    sessionLifecycleStatus !== "completed"
      ? "Key moments will be inferred after the session is completed."
      : replayArtifactStatus?.keyMomentsStatus === "processing" ||
          replayArtifactStatus?.keyMomentsStatus === "pending"
        ? "Key moments are being generated from the completed transcript."
        : replayArtifactStatus?.keyMomentsStatus === "failed"
          ? replayArtifactStatus.keyMomentsError ||
            "Key moments could not be generated for this session."
          : "No key moments were inferred for this session yet.";
  const notesMessage =
    sessionLifecycleStatus !== "completed"
      ? "Notes generation starts after the session is completed."
      : replayArtifactStatus?.notesStatus === "processing" ||
          replayArtifactStatus?.notesStatus === "pending"
        ? "Generating structured session notes from the completed transcript."
        : replayArtifactStatus?.notesStatus === "failed"
          ? replayArtifactStatus.notesError || "Session notes could not be generated for this session."
          : "Session notes are not available for this session yet.";

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
            <section className="ts-replay-progress-strip">
              <div className="ts-replay-progress-copy">
                <p className="ts-replay-section-kicker">Replay Progress</p>
                <h2>Track video, notes, and key moments</h2>
                <p className="ts-replay-progress-text">{replayProgressHint}</p>
              </div>
              <div className="ts-replay-progress-meta">
                <div className="ts-replay-chip-group">
                  <span className="ts-replay-chip">Session {toDisplayStatus(sessionLifecycleStatus)}</span>
                  <span className="ts-replay-chip">Replay {replayStatus}</span>
                  {requestedAtLabel ? (
                    <span className="ts-replay-chip">Started {requestedAtLabel}</span>
                  ) : null}
                  {updatedAtLabel ? <span className="ts-replay-chip">Updated {updatedAtLabel}</span> : null}
                </div>
                <button
                  type="button"
                  className="ts-replay-refresh-btn"
                  onClick={() => {
                    void refreshReplayStatus();
                  }}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh Status"}
                </button>
              </div>
              <div className="ts-replay-progress-grid">
                <article className="ts-replay-progress-card">
                  <span className="ts-replay-progress-label">Video</span>
                  <strong>{toDisplayStatus(replayArtifactStatus?.videoStatus ?? manifest?.status ?? "idle")}</strong>
                  <p>
                    {manifest?.segments?.length
                      ? `${manifest.segments.length} recorded segment${manifest.segments.length === 1 ? "" : "s"}`
                      : "No recorded segments yet"}
                  </p>
                </article>
                <article className="ts-replay-progress-card">
                  <span className="ts-replay-progress-label">Notes</span>
                  <strong>{toDisplayStatus(replayArtifactStatus?.notesStatus ?? "idle")}</strong>
                  <p>{notesArtifact ? "Notes artifact saved" : "Waiting for generated notes"}</p>
                </article>
                <article className="ts-replay-progress-card">
                  <span className="ts-replay-progress-label">Key Moments</span>
                  <strong>{toDisplayStatus(replayArtifactStatus?.keyMomentsStatus ?? "idle")}</strong>
                  <p>
                    {keyMoments.length > 0
                      ? `${keyMoments.length} important segment${keyMoments.length === 1 ? "" : "s"}`
                      : "Waiting for generated moments"}
                  </p>
                </article>
                <article className="ts-replay-progress-card">
                  <span className="ts-replay-progress-label">Transcript</span>
                  <strong>{toDisplayStatus(replayArtifactStatus?.transcriptStatus ?? "idle")}</strong>
                  <p>
                    {transcript.length > 0
                      ? `${transcript.length} turn${transcript.length === 1 ? "" : "s"} captured`
                      : "Transcript not available yet"}
                  </p>
                </article>
              </div>
            </section>
            <section className="ts-replay-surface">
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
                    <p>{videoAvailabilityMessage}</p>
                    <p>
                      Status: {toDisplayStatus(replayArtifactStatus?.videoStatus ?? manifest?.status ?? "idle")}
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
                {replayArtifactStatus?.keyMomentsStatus === "processing" ||
                replayArtifactStatus?.keyMomentsStatus === "pending" ? (
                  <div className="ts-replay-empty">
                    <p>{keyMomentsMessage}</p>
                  </div>
                ) : keyMoments.length === 0 ? (
                  <div className="ts-replay-empty">
                    <p>{keyMomentsMessage}</p>
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
            </section>

            <section className="ts-replay-surface">
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
                      <p className="ts-replay-section-kicker">Session Notes</p>
                      <h2>Generated markdown notes</h2>
                    </div>
                  </div>
                  {replayArtifactStatus?.notesStatus === "processing" ||
                  replayArtifactStatus?.notesStatus === "pending" ? (
                    <div className="ts-replay-empty">
                      <p>{notesMessage}</p>
                    </div>
                  ) : notesMarkdown ? (
                    <div className="ts-replay-notes">
                      <Markdown>{notesMarkdown}</Markdown>
                    </div>
                  ) : (
                    <div className="ts-replay-empty">
                      <p>{notesMessage}</p>
                    </div>
                  )}
                </section>

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
            </section>
          </div>
        )}
      </div>
    </div>
  );
};