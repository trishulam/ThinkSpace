import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ApiSessionRecordingManifest,
  uploadSessionRecordingSegment,
} from "../api/sessions";

export type SessionRecordingStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "stopping"
  | "uploading"
  | "error";

type StopResult = {
  uploaded: boolean;
  manifest: ApiSessionRecordingManifest | null;
};

type SessionRecordingOptions = {
  extraAudioStream?: MediaStream | null;
};

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function pickSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function useSessionRecording(
  sessionId: string | undefined,
  options: SessionRecordingOptions = {}
) {
  const [status, setStatus] = useState<SessionRecordingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [segmentCount, setSegmentCount] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recordingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const extraAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const attachedExtraAudioStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<string | null>(null);
  const stopPromiseRef = useRef<Promise<StopResult> | null>(null);
  const stopResolveRef = useRef<((value: StopResult) => void) | null>(null);
  const stopRejectRef = useRef<((reason?: unknown) => void) | null>(null);

  const cleanupResources = useCallback(() => {
    recorderRef.current = null;
    stopMediaStream(displayStreamRef.current);
    stopMediaStream(microphoneStreamRef.current);
    stopMediaStream(combinedStreamRef.current);
    displayStreamRef.current = null;
    microphoneStreamRef.current = null;
    combinedStreamRef.current = null;
    attachedExtraAudioStreamRef.current = null;
    if (extraAudioSourceRef.current) {
      extraAudioSourceRef.current.disconnect();
      extraAudioSourceRef.current = null;
    }
    recordingDestinationRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const attachExtraAudioStream = useCallback((stream: MediaStream | null) => {
    if (!audioContextRef.current || !recordingDestinationRef.current) {
      return;
    }

    if (extraAudioSourceRef.current) {
      extraAudioSourceRef.current.disconnect();
      extraAudioSourceRef.current = null;
      attachedExtraAudioStreamRef.current = null;
    }

    if (!stream || stream.getAudioTracks().length === 0) {
      return;
    }

    extraAudioSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
    extraAudioSourceRef.current.connect(recordingDestinationRef.current);
    attachedExtraAudioStreamRef.current = stream;
  }, []);

  const startRecording = useCallback(async () => {
    if (!sessionId) {
      throw new Error("Session not found");
    }
    if (
      status === "recording" ||
      status === "requesting-permission" ||
      status === "stopping" ||
      status === "uploading"
    ) {
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setStatus("error");
      setError("This browser does not support screen recording");
      return;
    }

    setStatus("requesting-permission");
    setError(null);
    chunksRef.current = [];

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 },
        },
        audio: true,
      });
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const combinedStream = new MediaStream();
      for (const track of displayStream.getVideoTracks()) {
        combinedStream.addTrack(track);
      }

      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      let hasAudioTrack = false;

      if (displayStream.getAudioTracks().length > 0) {
        const displaySource = audioContext.createMediaStreamSource(displayStream);
        displaySource.connect(destination);
        hasAudioTrack = true;
      }
      if (microphoneStream.getAudioTracks().length > 0) {
        const microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
        microphoneSource.connect(destination);
        hasAudioTrack = true;
      }
      if (options.extraAudioStream?.getAudioTracks().length) {
        hasAudioTrack = true;
      }
      if (hasAudioTrack) {
        for (const track of destination.stream.getAudioTracks()) {
          combinedStream.addTrack(track);
        }
      }

      const mimeType = pickSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(combinedStream, { mimeType })
        : new MediaRecorder(combinedStream);

      displayStreamRef.current = displayStream;
      microphoneStreamRef.current = microphoneStream;
      combinedStreamRef.current = combinedStream;
      audioContextRef.current = audioContext;
      recordingDestinationRef.current = destination;
      recorderRef.current = recorder;
      startedAtRef.current = new Date().toISOString();
      attachExtraAudioStream(options.extraAudioStream ?? null);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setStatus("error");
        setError("Recording failed");
        cleanupResources();
      };

      recorder.onstop = () => {
        const finalize = async () => {
          try {
            setStatus("uploading");
            const blobType = recorder.mimeType || mimeType || "video/webm";
            const recordingBlob = new Blob(chunksRef.current, { type: blobType });
            cleanupResources();
            chunksRef.current = [];

            if (!recordingBlob.size) {
              throw new Error("Recording did not capture any media");
            }

            const endedAt = new Date().toISOString();
            const manifest = await uploadSessionRecordingSegment(sessionId, recordingBlob, {
              fileName: `segment-${Date.now()}.webm`,
              startedAt: startedAtRef.current ?? undefined,
              endedAt,
            });
            setSegmentCount(manifest.segments.length);
            setStatus("idle");
            setError(null);
            stopResolveRef.current?.({ uploaded: true, manifest });
          } catch (stopError) {
            const message =
              stopError instanceof Error
                ? stopError.message
                : "Failed to upload recording";
            setStatus("error");
            setError(message);
            cleanupResources();
            stopRejectRef.current?.(stopError);
          } finally {
            startedAtRef.current = null;
            stopResolveRef.current = null;
            stopRejectRef.current = null;
            stopPromiseRef.current = null;
          }
        };

        void finalize();
      };

      const primaryVideoTrack = displayStream.getVideoTracks()[0];
      primaryVideoTrack?.addEventListener("ended", () => {
        if (recorder.state === "recording") {
          void stopRecording();
        }
      });

      recorder.start();
      setStatus("recording");
    } catch (startError) {
      cleanupResources();
      const message =
        startError instanceof Error
          ? startError.message
          : "Recording permission was denied";
      setStatus("error");
      setError(message);
    }
  }, [attachExtraAudioStream, cleanupResources, options.extraAudioStream, sessionId, status]);

  const stopRecording = useCallback(async (): Promise<StopResult> => {
    if (stopPromiseRef.current) {
      return stopPromiseRef.current;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      cleanupResources();
      return { uploaded: false, manifest: null };
    }

    setStatus("stopping");
    stopPromiseRef.current = new Promise<StopResult>((resolve, reject) => {
      stopResolveRef.current = resolve;
      stopRejectRef.current = reject;
    });

    recorder.stop();
    return stopPromiseRef.current;
  }, [cleanupResources]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  useEffect(() => {
    if (!audioContextRef.current || !recordingDestinationRef.current) {
      return;
    }

    if (attachedExtraAudioStreamRef.current === options.extraAudioStream) {
      return;
    }

    attachExtraAudioStream(options.extraAudioStream ?? null);
  }, [attachExtraAudioStream, options.extraAudioStream]);

  const isSupported = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getDisplayMedia &&
      typeof MediaRecorder !== "undefined",
    []
  );

  return {
    status,
    error,
    isSupported,
    isRecording: status === "recording",
    segmentCount,
    startRecording,
    stopRecording,
  };
}
