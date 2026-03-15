import { useCallback, useEffect, useRef, useState } from 'react'

function convertFloat32ToPCM(inputData: Float32Array): ArrayBuffer {
	const pcm16 = new Int16Array(inputData.length)
	for (let i = 0; i < inputData.length; i++) {
		pcm16[i] = inputData[i] * 0x7fff
	}
	return pcm16.buffer
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	let standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/')
	while (standardBase64.length % 4) {
		standardBase64 += '='
	}
	const binaryString = window.atob(standardBase64)
	const bytes = new Uint8Array(binaryString.length)
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i)
	}
	return bytes.buffer
}

export function useAudioWorklets() {
	const [isAudioActive, setIsAudioActive] = useState(false)
	const [isMicMuted, setIsMicMuted] = useState(false)
	const [playbackCaptureStream, setPlaybackCaptureStream] = useState<MediaStream | null>(null)

	const playerNodeRef = useRef<AudioWorkletNode | null>(null)
	const playerContextRef = useRef<AudioContext | null>(null)
	const playerCaptureDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
	const recorderNodeRef = useRef<AudioWorkletNode | null>(null)
	const recorderContextRef = useRef<AudioContext | null>(null)
	const micStreamRef = useRef<MediaStream | null>(null)
	const isMicMutedRef = useRef(false)

	const updateMicMuted = useCallback((nextValue: boolean) => {
		isMicMutedRef.current = nextValue
		setIsMicMuted(nextValue)
	}, [])

	const cleanupAudio = useCallback(() => {
		if (micStreamRef.current) {
			micStreamRef.current.getTracks().forEach((track) => track.stop())
			micStreamRef.current = null
		}
		if (recorderContextRef.current) {
			void recorderContextRef.current.close()
			recorderContextRef.current = null
		}
		recorderNodeRef.current = null
		if (playerContextRef.current) {
			void playerContextRef.current.close()
			playerContextRef.current = null
		}
		playerNodeRef.current = null
		playerCaptureDestinationRef.current = null
		setPlaybackCaptureStream(null)
		updateMicMuted(false)
		setIsAudioActive(false)
	}, [updateMicMuted])

	const startAudio = useCallback(async (onAudioChunk: (data: ArrayBuffer) => void) => {
		if (
			playerContextRef.current ||
			recorderContextRef.current ||
			micStreamRef.current ||
			isAudioActive
		) {
			return
		}

		// --- Player setup (24kHz output) ---
		try {
			const playerContext = new AudioContext({ sampleRate: 24000 })
			await playerContext.audioWorklet.addModule('/worklets/pcm-player-processor.js')
			const playerNode = new AudioWorkletNode(playerContext, 'pcm-player-processor')
			playerNode.connect(playerContext.destination)
			const playerCaptureDestination = playerContext.createMediaStreamDestination()
			playerNode.connect(playerCaptureDestination)
			playerContextRef.current = playerContext
			playerNodeRef.current = playerNode
			playerCaptureDestinationRef.current = playerCaptureDestination
			setPlaybackCaptureStream(playerCaptureDestination.stream)

			// --- Recorder setup (16kHz input) ---
			const recorderContext = new AudioContext({ sampleRate: 16000 })
			await recorderContext.audioWorklet.addModule('/worklets/pcm-recorder-processor.js')
			const micStream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1 },
			})
			const source = recorderContext.createMediaStreamSource(micStream)
			const recorderNode = new AudioWorkletNode(recorderContext, 'pcm-recorder-processor')
			source.connect(recorderNode)

			recorderNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
				if (isMicMutedRef.current) {
					return
				}
				const pcmData = convertFloat32ToPCM(event.data)
				onAudioChunk(pcmData)
			}

			recorderContextRef.current = recorderContext
			recorderNodeRef.current = recorderNode
			micStreamRef.current = micStream
			updateMicMuted(false)
			setIsAudioActive(true)
		} catch (error) {
			cleanupAudio()
			throw error
		}
	}, [cleanupAudio, isAudioActive, updateMicMuted])

	const stopAudio = useCallback(() => {
		cleanupAudio()
	}, [cleanupAudio])

	const setMicMuted = useCallback(
		(nextValue: boolean) => {
			updateMicMuted(nextValue)
		},
		[updateMicMuted]
	)

	const toggleMicMuted = useCallback(() => {
		updateMicMuted(!isMicMutedRef.current)
	}, [updateMicMuted])

	const playAudioChunk = useCallback((base64Data: string) => {
		if (playerNodeRef.current) {
			const buffer = base64ToArrayBuffer(base64Data)
			playerNodeRef.current.port.postMessage(buffer)
		}
	}, [])

	const stopPlayback = useCallback(() => {
		if (playerNodeRef.current) {
			playerNodeRef.current.port.postMessage({ command: 'endOfAudio' })
		}
	}, [])

	useEffect(() => {
		return () => {
			cleanupAudio()
		}
	}, [cleanupAudio])

	return {
		isAudioActive,
		isMicMuted,
		playbackCaptureStream,
		startAudio,
		stopAudio,
		setMicMuted,
		toggleMicMuted,
		playAudioChunk,
		stopPlayback,
	}
}
