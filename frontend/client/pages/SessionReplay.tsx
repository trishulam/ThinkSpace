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

const LogoGlyph: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M8 6.25C6.37 7.37 5.25 9.24 5.25 11.38c0 3.47 3 6.28 6.75 6.28s6.75-2.81 6.75-6.28c0-2.14-1.12-4.01-2.75-5.13" />
    <path d="M9 5.5c.72-.83 1.79-1.25 3-1.25s2.28.42 3 1.25" />
    <path d="M9.75 11.25h4.5" />
    <path d="M12 9v4.5" />
  </svg>
);

const BellIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M15 17H5.5a1 1 0 0 1-.77-1.64l1.02-1.23A3 3 0 0 0 6.5 12.2V10a5.5 5.5 0 1 1 11 0v2.2a3 3 0 0 0 .75 1.93l1.02 1.23A1 1 0 0 1 18.5 17H15Z" />
    <path d="M9.5 19a2.5 2.5 0 0 0 5 0" />
  </svg>
);

const SUMMARY_LOADING_STEPS = [
  {
    label: "Loading session summary",
    description: "Pulling together the session video, transcript, and generated study materials.",
  },
  {
    label: "Syncing replay assets",
    description: "Checking the latest recording, transcript, and artifact availability for this session.",
  },
  {
    label: "Preparing your review view",
    description: "Getting the summary workspace ready so you can jump straight into replay and notes.",
  },
] as const;

const SessionPreviewLoader: React.FC = () => (
  <div className="ts-home-session-preview-loader" aria-hidden="true">
    <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--outer" />
    <span className="ts-home-session-preview-loader-ring ts-home-session-preview-loader-ring--inner" />
    <span className="ts-home-session-preview-loader-core" />
  </div>
);

const ClockIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.8v4.7l3.1 2" />
  </svg>
);

const PlayIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 7.5v9l7-4.5-7-4.5Z" />
  </svg>
);

const ChevronLeftIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="m14.5 6-6 6 6 6" />
  </svg>
);

const ChevronRightIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

const NoteIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M8 5.5h8.2a1.8 1.8 0 0 1 1.8 1.8v9.4L14 20.5H8A1.8 1.8 0 0 1 6.2 18.7V7.3A1.8 1.8 0 0 1 8 5.5Z" />
    <path d="M13.8 20.3v-3.1a1.4 1.4 0 0 1 1.4-1.4h3.1" />
    <path d="M9.2 10h5.8" />
    <path d="M9.2 13.2h4.6" />
  </svg>
);

const DownloadIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path d="M12 5.5v8.5" />
    <path d="m8.5 10.8 3.5 3.7 3.5-3.7" />
    <path d="M6.5 18.5h11" />
  </svg>
);

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

function getTranscriptSpeaker(entry: ApiTranscriptEntry): {
  speakerLabel: "User" | "Agent";
  speakerType: "user" | "agent";
} {
  if (entry.type.startsWith("user")) {
    return {
      speakerLabel: "User",
      speakerType: "user",
    };
  }

  return {
    speakerLabel: "Agent",
    speakerType: "agent",
  };
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
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [flashcardPage, setFlashcardPage] = useState(0);
  const [revealedFlashcards, setRevealedFlashcards] = useState<Record<string, boolean>>({});
  const [summaryLoadingStepIndex, setSummaryLoadingStepIndex] = useState(0);
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

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    setSummaryLoadingStepIndex(0);
    const intervalId = window.setInterval(() => {
      setSummaryLoadingStepIndex((current) => (current + 1) % SUMMARY_LOADING_STEPS.length);
    }, 2400);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoading]);

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
  const flashcardsPerPage = 2;
  const flashcardPageCount = Math.max(Math.ceil(flashcards.length / flashcardsPerPage), 1);
  const notesMarkdown = notesArtifact?.notesMarkdown.trim() ?? "";
  const sessionTitle = sessionData?.topic ?? "Session Summary";
  const sessionSubtitle =
    sessionData?.summary?.trim() ??
    sessionData?.goal?.trim() ??
    "Review the session recording, transcript, key moments, and generated study materials.";
  const currentSummaryLoadingStep = SUMMARY_LOADING_STEPS[summaryLoadingStepIndex];
  const sessionLifecycleStatus = sessionData?.status ?? "active";
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
  const recommendedNext = {
    title: "ReLU Activation Function",
    description: "Learn about the ReLU activation function and its properties.",
    duration: "",
  };
  const activeKeyMomentId = useMemo(() => {
    if (timelineKeyMoments.length === 0) {
      return null;
    }

    if (videoDuration > 0) {
      return timelineKeyMoments.reduce((closest, current) =>
        Math.abs(current.timeSeconds - videoCurrentTime) <
        Math.abs(closest.timeSeconds - videoCurrentTime)
          ? current
          : closest
      ).id;
    }

    return timelineKeyMoments[Math.min(1, timelineKeyMoments.length - 1)]?.id ?? null;
  }, [timelineKeyMoments, videoCurrentTime, videoDuration]);
  const visibleFlashcards = useMemo(() => {
    const pageStart = flashcardPage * flashcardsPerPage;
    return flashcards.slice(pageStart, pageStart + flashcardsPerPage);
  }, [flashcardPage, flashcards]);

  useEffect(() => {
    setFlashcardPage(0);
    setRevealedFlashcards({});
  }, [sessionId]);

  useEffect(() => {
    setFlashcardPage((current) => Math.min(current, flashcardPageCount - 1));
  }, [flashcardPageCount]);

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

  const downloadTranscript = () => {
    if (transcript.length === 0) {
      return;
    }

    const transcriptText = transcript
      .map((turn) => {
        const content = getReplayTranscriptEntries(turn)
          .map((entry) => {
            const text = entry.content.trim();
            if (!text) {
              return null;
            }
            const { speakerLabel } = getTranscriptSpeaker(entry);
            return `${speakerLabel}: ${text}`;
          })
          .filter((entry): entry is string => Boolean(entry))
          .join("\n");

        if (content) {
          return `[${turn.sequence}]\n${content}`;
        }

        const fallbackText = extractPlainText(turn);
        return fallbackText ? `[${turn.sequence}]\nAgent: ${fallbackText}` : null;
      })
      .filter((entry): entry is string => Boolean(entry))
      .join("\n\n");

    const blob = new Blob([transcriptText], { type: "text/plain;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${sessionTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "session"}-transcript.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  };

  return (
    <div className="mindpad-dashboard ts-home-dashboard ts-home-dashboard--landing">
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
          <button type="button" onClick={() => navigate("/dashboard")}>
            Dashboard
          </button>
        </nav>
        <div className="ts-home-landing-nav-actions">
          <button className="ts-home-landing-icon-btn" type="button" aria-label="Notifications">
            <BellIcon />
          </button>
          <button className="ts-home-landing-avatar" type="button" aria-label="Open profile" />
        </div>
      </header>

      <div className="ts-home-dashboard-inner ts-home-dashboard-inner--summary">
        <div className="ts-replay-shell">
        {isLoading ? (
          <section className="ts-home-session-preview ts-home-session-preview--summary" aria-live="polite">
            <div className="ts-home-session-preview-shell">
              <SessionPreviewLoader />
              <div className="ts-home-session-preview-copy">
                <p className="ts-home-session-preview-kicker">Session Summary</p>
                <div
                  key={currentSummaryLoadingStep.label}
                  className="ts-home-session-preview-copy-body"
                >
                  <div className="ts-home-session-preview-text-row">
                    <p className="ts-home-session-preview-text">
                      {currentSummaryLoadingStep.label}
                    </p>
                    <span
                      className="ts-home-session-preview-text-trail"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="ts-home-session-preview-description">
                    {currentSummaryLoadingStep.description}
                  </p>
                </div>
              </div>
              <div
                className="ts-home-session-preview-steps"
                aria-label="Session summary loading progress"
              >
                {SUMMARY_LOADING_STEPS.map((step, index) => (
                  <span
                    key={step.label}
                    className={
                      index === summaryLoadingStepIndex
                        ? "ts-home-session-preview-step ts-home-session-preview-step--active"
                        : "ts-home-session-preview-step"
                    }
                  />
                ))}
              </div>
            </div>
          </section>
        ) : error ? (
          <section className="ts-home-landing-empty">
            <p className="ts-home-landing-section-kicker">Session Summary</p>
            <h2>Session summary unavailable</h2>
            <p>{error}</p>
          </section>
        ) : (
          <div className="ts-replay-layout">
            <section className="ts-replay-summary-grid">
              <div className="ts-replay-summary-copy">
                <h1 className="ts-replay-title">{sessionTitle}</h1>
                <p className="ts-replay-hero-subtitle">{sessionSubtitle}</p>
              </div>

              <aside className="ts-replay-side-card--recommended">
                <p className="ts-replay-section-kicker">Recommended Next</p>
                <div className="ts-replay-recommendation-card">
                  <div className="ts-replay-recommendation-thumb" aria-hidden="true">
                    <span className="ts-replay-recommendation-thumb-glow" />
                  </div>
                  <div className="ts-replay-recommendation-copy">
                    <h2>{recommendedNext.title}</h2>
                    <p className="ts-replay-side-card-copy">
                      {recommendedNext.description} · {recommendedNext.duration}
                    </p>
                  </div>
                </div>
              </aside>
            </section>

            <div className="ts-replay-content-grid">
              <div className="ts-replay-main-stack">
                <section className="ts-replay-video-card">
                  <div className="ts-replay-card-header ts-replay-card-header--notes">
                    <div className="ts-replay-panel-heading">
                      <h2>Session Replay</h2>
                    </div>
                    <div className="ts-replay-panel-actions">
                      <button
                        type="button"
                        className="ts-replay-refresh-btn ts-replay-refresh-btn--minimal ts-replay-download-action"
                        onClick={downloadTranscript}
                        disabled={transcript.length === 0}
                      >
                        <DownloadIcon />
                        <span>{transcript.length > 0 ? "Download Transcript" : "Transcript Unavailable"}</span>
                      </button>
                    </div>
                  </div>
                  {finalVideoUrl ? (
                    <div className="ts-replay-video-shell">
                      <div className="ts-replay-video-frame">
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
                        {!isVideoPlaying ? (
                          <button
                            type="button"
                            className="ts-replay-video-overlay"
                            onClick={togglePlayback}
                            aria-label="Play session recording"
                          >
                            <PlayIcon />
                          </button>
                        ) : null}
                      </div>
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
                      <h3>Session recording not available yet</h3>
                      <p>{videoAvailabilityMessage}</p>
                      <p>
                        Status: {toDisplayStatus(replayArtifactStatus?.videoStatus ?? manifest?.status ?? "idle")}
                      </p>
                    </div>
                  )}
                </section>

                <section className="ts-replay-panel">
                  <div className="ts-replay-card-header ts-replay-card-header--notes">
                    <div className="ts-replay-panel-heading">
                      <span className="ts-replay-inline-icon" aria-hidden="true">
                        <NoteIcon />
                      </span>
                      <h2>Notes</h2>
                    </div>
                    <div className="ts-replay-panel-actions">
                      <span className="ts-replay-panel-tag">AI-generated</span>
                      <span className="ts-replay-panel-link">Edit Notes</span>
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

              </div>

              <aside className="ts-replay-side-stack">
                <section className="ts-replay-panel ts-replay-panel--moments">
                  <div className="ts-replay-card-header ts-replay-card-header--feature">
                    <div className="ts-replay-feature-title">
                      <span className="ts-replay-feature-icon" aria-hidden="true">
                        <ClockIcon />
                      </span>
                      <h2>Key Moments</h2>
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
                          className={
                            moment.id === activeKeyMomentId
                              ? "ts-replay-moment ts-replay-moment--active"
                              : "ts-replay-moment"
                          }
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
                            <p className="ts-replay-moment-description">{moment.summary}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section className="ts-replay-panel ts-replay-panel--flashcards">
                  <div className="ts-replay-card-header">
                    <div>
                      <h2>Session Flashcards</h2>
                    </div>
                    {flashcardPageCount > 1 ? (
                      <div className="ts-replay-carousel-controls">
                        <button
                          type="button"
                          className="ts-replay-carousel-btn"
                          onClick={() => setFlashcardPage((current) => Math.max(current - 1, 0))}
                          disabled={flashcardPage === 0}
                          aria-label="Show previous flashcards"
                        >
                          <ChevronLeftIcon />
                        </button>
                        <button
                          type="button"
                          className="ts-replay-carousel-btn"
                          onClick={() =>
                            setFlashcardPage((current) => Math.min(current + 1, flashcardPageCount - 1))
                          }
                          disabled={flashcardPage >= flashcardPageCount - 1}
                          aria-label="Show next flashcards"
                        >
                          <ChevronRightIcon />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="ts-replay-flashcards">
                    {visibleFlashcards.map((card, index) => {
                      const isRevealed = revealedFlashcards[card.id] ?? false;
                      const flashcardIndex = flashcardPage * flashcardsPerPage + index;
                      const flashcardLabel = flashcardIndex === 0
                        ? "Definition"
                        : flashcardIndex === 1
                          ? "Concept"
                          : "Review";

                      return (
                        <article
                          key={card.id}
                          className={
                            isRevealed ? "ts-replay-flashcard ts-replay-flashcard--revealed" : "ts-replay-flashcard"
                          }
                          role="button"
                          tabIndex={0}
                          aria-pressed={isRevealed}
                          onClick={() =>
                            setRevealedFlashcards((current) => ({
                              ...current,
                              [card.id]: !isRevealed,
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setRevealedFlashcards((current) => ({
                                ...current,
                                [card.id]: !isRevealed,
                              }));
                            }
                          }}
                        >
                          <p className="ts-replay-flashcard-label">{flashcardLabel}</p>
                          <p className="ts-replay-flashcard-question">{card.prompt}</p>
                          <p className="ts-replay-flashcard-answer">
                            {isRevealed ? card.answer : "Click to reveal answer"}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </section>

              </aside>
            </div>
          </div>
        )}
        </div>

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
      </div>
    </div>
  );
};