import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	CanvasActivityWindowMessage,
	AgentSubtitleState,
	CanvasContextResponseMessage,
	CanvasContextTraceMessage,
	CanvasDelegateResultMessage,
	ConnectionState,
	FrontendAck,
	FrontendAction,
	FrontendActionMessage,
	ToolResultMessage,
	TalkingState,
} from '../types/agent-live'

let wsSignalIdCounter = 0
function nextWsSignalId(): string {
	return `ws-signal-${Date.now()}-${++wsSignalIdCounter}`
}

function base64AudioByteLength(base64: string): number {
	const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
	const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
	return Math.floor((normalized.length * 3) / 4) - padding
}

interface UseAgentWebSocketOptions {
	userId: string
	sessionId: string
	sessionEntryId?: string
	onPlayAudio?: (base64Data: string) => void
	onStopPlayback?: () => void
}

function getAgentWebSocketBaseUrl(): string {
	const configuredUrl = import.meta.env.VITE_AGENT_BACKEND_URL?.trim()
	if (configuredUrl) {
		if (configuredUrl.startsWith('https://')) {
			return `wss://${configuredUrl.slice('https://'.length)}`
		}
		if (configuredUrl.startsWith('http://')) {
			return `ws://${configuredUrl.slice('http://'.length)}`
		}
		return configuredUrl
	}

	if (
		window.location.hostname === 'localhost' ||
		window.location.hostname === '127.0.0.1'
	) {
		return 'ws://localhost:8000'
	}

	return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
}

const NORMAL_SUBTITLE_LINGER_MS = 1600
const INTERRUPTED_FINAL_LINGER_MS = 500
const INTERRUPTED_PARTIAL_LINGER_MS = 120
const BASE_REVEAL_CPS = 14
const MIN_REVEAL_CPS = 12.5
const MAX_REVEAL_CPS = 16.5
const MIN_AUDIO_MS_FOR_ADJUSTMENT = 600
const MIN_TEXT_LENGTH_FOR_ADJUSTMENT = 24
const CPS_SMOOTHING_FACTOR = 0.2
const OUTPUT_AUDIO_SAMPLE_RATE = 24000
const OUTPUT_AUDIO_BYTES_PER_SAMPLE = 2
const REVEAL_TICK_MS = 50

const EMPTY_SUBTITLE: AgentSubtitleState = {
	receivedText: '',
	revealedText: '',
	isVisible: false,
	isPartial: false,
	isFinal: false,
	isCatchingUp: false,
	status: 'idle',
	updatedAt: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isFrontendActionMessage(value: unknown): value is FrontendActionMessage {
	if (!isRecord(value) || value.type !== 'frontend_action') return false
	if (!isRecord(value.action)) return false
	if (typeof value.action.type !== 'string') return false
	if (typeof value.action.source_tool !== 'string') return false
	return 'payload' in value.action
}

function isToolResultMessage(value: unknown): value is ToolResultMessage {
	if (!isRecord(value) || value.type !== 'tool_result') return false
	if (!isRecord(value.result)) return false
	if (typeof value.result.status !== 'string') return false
	if (typeof value.result.tool !== 'string') return false
	return true
}

export function useAgentWebSocket({
	userId,
	sessionId,
	sessionEntryId,
	onPlayAudio,
	onStopPlayback,
}: UseAgentWebSocketOptions) {
	const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
	const [talkingState, setTalkingState] = useState<TalkingState>('none')
	const [agentSubtitle, setAgentSubtitle] = useState<AgentSubtitleState>(EMPTY_SUBTITLE)
	const [frontendActions, setFrontendActions] = useState<FrontendAction[]>([])
	const [isKnowledgeLookupActive, setIsKnowledgeLookupActive] = useState(false)
	const [turnCompleteCount, setTurnCompleteCount] = useState(0)
	const [latestToolResult, setLatestToolResult] = useState<{
		id: string
		result: ToolResultMessage['result']
	} | null>(null)

	const wsRef = useRef<WebSocket | null>(null)
	const intentionalDisconnectRef = useRef(false)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const subtitleRevealLoopRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const subtitleReceivedTextRef = useRef('')
	const subtitleRevealedLengthRef = useRef(0)
	const subtitleRevealCarryRef = useRef(0)
	const subtitleAudioDurationMsRef = useRef(0)
	const currentRevealCpsRef = useRef(BASE_REVEAL_CPS)
	const targetRevealCpsRef = useRef(BASE_REVEAL_CPS)
	const hasFinalSubtitleRef = useRef(false)
	const pendingTurnCompleteRef = useRef(false)
	const activeKnowledgeLookupJobIdsRef = useRef<Set<string>>(new Set())

	// Stable refs for callbacks so the WS handler always sees the latest
	const onPlayAudioRef = useRef(onPlayAudio)
	onPlayAudioRef.current = onPlayAudio
	const onStopPlaybackRef = useRef(onStopPlayback)
	onStopPlaybackRef.current = onStopPlayback

	const clearKnowledgeLookupActive = useCallback(() => {
		activeKnowledgeLookupJobIdsRef.current.clear()
		setIsKnowledgeLookupActive(false)
	}, [])

	const updateKnowledgeLookupActive = useCallback(
		(result: ToolResultMessage['result']) => {
			if (result.tool !== 'knowledge.lookup') return

			const jobId =
				typeof result.job?.id === 'string' && result.job.id.trim()
					? result.job.id.trim()
					: null

			if (jobId) {
				if (result.status === 'accepted') {
					activeKnowledgeLookupJobIdsRef.current.add(jobId)
				} else if (result.status === 'completed' || result.status === 'failed') {
					activeKnowledgeLookupJobIdsRef.current.delete(jobId)
				}
				setIsKnowledgeLookupActive(activeKnowledgeLookupJobIdsRef.current.size > 0)
				return
			}

			if (result.status === 'accepted') {
				setIsKnowledgeLookupActive(true)
			} else if (result.status === 'completed' || result.status === 'failed') {
				clearKnowledgeLookupActive()
			}
		},
		[clearKnowledgeLookupActive]
	)

	const shiftFrontendAction = useCallback(() => {
		setFrontendActions((prev) => (prev.length > 0 ? prev.slice(1) : prev))
	}, [])

	useEffect(() => {
		setFrontendActions([])
		setTurnCompleteCount(0)
		setLatestToolResult(null)
	}, [sessionId])

	const clearSubtitleTimer = useCallback(() => {
		if (subtitleTimerRef.current) {
			clearTimeout(subtitleTimerRef.current)
			subtitleTimerRef.current = null
		}
	}, [])

	const clearRevealLoop = useCallback(() => {
		if (subtitleRevealLoopRef.current) {
			clearInterval(subtitleRevealLoopRef.current)
			subtitleRevealLoopRef.current = null
		}
	}, [])

	const resetSubtitle = useCallback(() => {
		clearSubtitleTimer()
		clearRevealLoop()
		subtitleReceivedTextRef.current = ''
		subtitleRevealedLengthRef.current = 0
		subtitleRevealCarryRef.current = 0
		subtitleAudioDurationMsRef.current = 0
		currentRevealCpsRef.current = BASE_REVEAL_CPS
		targetRevealCpsRef.current = BASE_REVEAL_CPS
		hasFinalSubtitleRef.current = false
		pendingTurnCompleteRef.current = false
		setAgentSubtitle(EMPTY_SUBTITLE)
	}, [clearRevealLoop, clearSubtitleTimer])

	const scheduleSubtitleClear = useCallback(
		(status: AgentSubtitleState['status'], delayMs: number) => {
			clearSubtitleTimer()
			clearRevealLoop()
			setAgentSubtitle((current) => {
				if (!current.revealedText) return EMPTY_SUBTITLE
				return {
					...current,
					status,
					isPartial: false,
					isVisible: true,
					isCatchingUp: false,
					updatedAt: Date.now(),
				}
			})
			subtitleTimerRef.current = setTimeout(() => {
				subtitleReceivedTextRef.current = ''
				subtitleRevealedLengthRef.current = 0
				subtitleRevealCarryRef.current = 0
				subtitleAudioDurationMsRef.current = 0
				currentRevealCpsRef.current = BASE_REVEAL_CPS
				targetRevealCpsRef.current = BASE_REVEAL_CPS
				pendingTurnCompleteRef.current = false
				setAgentSubtitle(EMPTY_SUBTITLE)
			}, delayMs)
			hasFinalSubtitleRef.current = false
		},
		[clearRevealLoop, clearSubtitleTimer]
	)

	const startRevealLoop = useCallback(() => {
		if (subtitleRevealLoopRef.current) return

		subtitleRevealLoopRef.current = setInterval(() => {
			const receivedText = subtitleReceivedTextRef.current
			const revealedLength = subtitleRevealedLengthRef.current
			const backlog = receivedText.length - revealedLength

			if (backlog <= 0) {
				subtitleRevealCarryRef.current = 0
				setAgentSubtitle((current) => {
					if (!current.isCatchingUp) return current
					return {
						...current,
						isCatchingUp: false,
						updatedAt: Date.now(),
					}
				})

				if (pendingTurnCompleteRef.current) {
					pendingTurnCompleteRef.current = false
					scheduleSubtitleClear('complete', NORMAL_SUBTITLE_LINGER_MS)
				} else {
					clearRevealLoop()
				}
				return
			}

			currentRevealCpsRef.current =
				currentRevealCpsRef.current +
				(targetRevealCpsRef.current - currentRevealCpsRef.current) * CPS_SMOOTHING_FACTOR
			const revealAmount =
				currentRevealCpsRef.current * (REVEAL_TICK_MS / 1000) +
				subtitleRevealCarryRef.current
			const wholeChars = Math.max(1, Math.floor(revealAmount))
			subtitleRevealCarryRef.current = revealAmount - wholeChars

			const nextRevealedLength = Math.min(receivedText.length, revealedLength + wholeChars)
			subtitleRevealedLengthRef.current = nextRevealedLength
			const revealedText = receivedText.slice(0, nextRevealedLength)
			const nextBacklog = receivedText.length - nextRevealedLength

			setAgentSubtitle((current) => ({
				...current,
				revealedText,
				isVisible: revealedText.trim().length > 0,
				isCatchingUp: nextBacklog > 0,
				updatedAt: Date.now(),
			}))

			if (nextBacklog === 0 && pendingTurnCompleteRef.current) {
				pendingTurnCompleteRef.current = false
				scheduleSubtitleClear('complete', NORMAL_SUBTITLE_LINGER_MS)
			}
		}, REVEAL_TICK_MS)
	}, [clearRevealLoop, scheduleSubtitleClear])

	const updateTargetRevealCps = useCallback(() => {
		const receivedTextLength = subtitleReceivedTextRef.current.length
		const audioDurationMs = subtitleAudioDurationMsRef.current

		if (
			audioDurationMs < MIN_AUDIO_MS_FOR_ADJUSTMENT ||
			receivedTextLength < MIN_TEXT_LENGTH_FOR_ADJUSTMENT
		) {
			targetRevealCpsRef.current = BASE_REVEAL_CPS
			return
		}

		const audioDurationSeconds = audioDurationMs / 1000
		const rawCps = receivedTextLength / audioDurationSeconds
		targetRevealCpsRef.current = Math.min(
			MAX_REVEAL_CPS,
			Math.max(MIN_REVEAL_CPS, rawCps)
		)
	}, [])

	const updateSubtitleFromOutput = useCallback(
		(textChunk: string, isFinal: boolean) => {
			clearSubtitleTimer()
			startRevealLoop()
			pendingTurnCompleteRef.current = false

			const nextText = isFinal
				? textChunk
				: `${subtitleReceivedTextRef.current}${textChunk}`
			subtitleReceivedTextRef.current = nextText
			hasFinalSubtitleRef.current = isFinal
			updateTargetRevealCps()

			setAgentSubtitle((current) => ({
				...current,
				receivedText: nextText,
				isVisible: current.revealedText.trim().length > 0,
				isPartial: !isFinal,
				isFinal,
				isCatchingUp:
					subtitleRevealedLengthRef.current < nextText.length ||
					current.isCatchingUp,
				status: 'active',
				updatedAt: Date.now(),
			}))
		},
		[clearSubtitleTimer, startRevealLoop, updateTargetRevealCps]
	)

	useEffect(() => {
		return () => {
			intentionalDisconnectRef.current = true
			clearSubtitleTimer()
			clearRevealLoop()
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current)
			}
			if (wsRef.current) {
				wsRef.current.close()
				wsRef.current = null
			}
		}
	}, [clearRevealLoop, clearSubtitleTimer])

	const connect = useCallback(() => {
		if (
			wsRef.current &&
			(wsRef.current.readyState === WebSocket.OPEN ||
				wsRef.current.readyState === WebSocket.CONNECTING)
		)
			return

		intentionalDisconnectRef.current = false
		setConnectionState('connecting')
		clearKnowledgeLookupActive()
		resetSubtitle()

		// Connect directly to the backend. The Cloudflare Vite plugin intercepts
		// upgrade requests before the Vite proxy can forward them, so we bypass
		// the proxy and connect to the FastAPI backend directly.
		const backendHost = getAgentWebSocketBaseUrl()
		const params = new URLSearchParams()
		if (sessionEntryId) {
			params.set('entry_id', sessionEntryId)
		}
		const wsUrl = `${backendHost}/ws/${userId}/${sessionId}${params.size > 0 ? `?${params.toString()}` : ''}`

		const ws = new WebSocket(wsUrl)
		wsRef.current = ws

		ws.onopen = () => {
			setConnectionState('connected')
			setTalkingState('none')
			setFrontendActions([])
			clearKnowledgeLookupActive()
		}

		ws.onmessage = (event: MessageEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const parsedMessage: any = JSON.parse(event.data)

			if (isFrontendActionMessage(parsedMessage)) {
				setFrontendActions((prev) => [...prev, parsedMessage.action])
				return
			}

			if (isToolResultMessage(parsedMessage)) {
				updateKnowledgeLookupActive(parsedMessage.result)
				setLatestToolResult({
					id: nextWsSignalId(),
					result: parsedMessage.result,
				})
				return
			}

			const adkEvent = parsedMessage

			// --- turnComplete ---
			if (adkEvent.turnComplete === true) {
				setTalkingState('none')
				if (
					subtitleReceivedTextRef.current &&
					subtitleRevealedLengthRef.current < subtitleReceivedTextRef.current.length
				) {
					pendingTurnCompleteRef.current = true
					setAgentSubtitle((current) => ({
						...current,
						isPartial: false,
						isFinal: true,
						status: 'active',
						updatedAt: Date.now(),
					}))
				} else {
					scheduleSubtitleClear('complete', NORMAL_SUBTITLE_LINGER_MS)
				}
				setTurnCompleteCount((count) => count + 1)
				return
			}

			// --- interrupted ---
			if (adkEvent.interrupted === true) {
				setTalkingState('none')
				onStopPlaybackRef.current?.()
				pendingTurnCompleteRef.current = false
				scheduleSubtitleClear(
					'interrupted',
					hasFinalSubtitleRef.current
						? INTERRUPTED_FINAL_LINGER_MS
						: INTERRUPTED_PARTIAL_LINGER_MS
				)
				return
			}

			// --- inputTranscription (user's speech) ---
			if (adkEvent.inputTranscription?.text) {
				setTalkingState('user')
			}

			// --- outputTranscription (agent's speech) ---
			if (adkEvent.outputTranscription?.text) {
				const text = adkEvent.outputTranscription.text
				const finished = adkEvent.outputTranscription.finished
				setTalkingState('agent')
				updateSubtitleFromOutput(text, finished === true)
			}

			// --- content.parts ---
			if (adkEvent.content?.parts) {
				for (const part of adkEvent.content.parts) {
					// Audio
					if (part.inlineData) {
						const mimeType: string = part.inlineData.mimeType || ''
						if (mimeType.startsWith('audio/pcm')) {
							const byteLength = base64AudioByteLength(part.inlineData.data)
							const chunkDurationMs =
								(byteLength /
									(OUTPUT_AUDIO_SAMPLE_RATE * OUTPUT_AUDIO_BYTES_PER_SAMPLE)) *
								1000
							subtitleAudioDurationMsRef.current += chunkDurationMs
							updateTargetRevealCps()
							onPlayAudioRef.current?.(part.inlineData.data)
							setTalkingState('agent')
						}
					}

					// Text (skip thought/reasoning)
					if (part.text && !part.thought) {
						setTalkingState('agent')
					}
				}
			}
		}

		ws.onclose = () => {
			wsRef.current = null
			setConnectionState('idle')
			setTalkingState('none')
			setFrontendActions([])
			clearKnowledgeLookupActive()
			resetSubtitle()

			if (!intentionalDisconnectRef.current) {
				reconnectTimerRef.current = setTimeout(() => {
					connect()
				}, 5000)
			}
		}

		ws.onerror = () => undefined
	}, [
		userId,
		sessionId,
		sessionEntryId,
		clearKnowledgeLookupActive,
		resetSubtitle,
		scheduleSubtitleClear,
		updateKnowledgeLookupActive,
		updateTargetRevealCps,
		updateSubtitleFromOutput,
	])

	const disconnect = useCallback(() => {
		intentionalDisconnectRef.current = true
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current)
			reconnectTimerRef.current = null
		}
		if (wsRef.current) {
			setConnectionState('disconnecting')
			wsRef.current.close()
		}
		clearKnowledgeLookupActive()
		resetSubtitle()
	}, [clearKnowledgeLookupActive, resetSubtitle])

	const sendText = useCallback((message: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'text', text: message }))
		}
	}, [])

	const sendSessionStartup = useCallback((entryId?: string): boolean => {
		if (wsRef.current?.readyState !== WebSocket.OPEN) {
			return false
		}
		const payload = JSON.stringify({
			type: 'session_startup',
			entry_id: entryId,
		})
		wsRef.current.send(payload)
		return true
	}, [])

	const sendImage = useCallback((base64: string, mimeType: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'image', data: base64, mimeType }))
		}
	}, [])

	const sendCanvasContext = useCallback((context: unknown) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(JSON.stringify({ type: 'canvas_context', context }))
		}
	}, [])

	const sendCanvasContextResponse = useCallback(
		(message: CanvasContextResponseMessage) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			wsRef.current.send(JSON.stringify(message))
		},
		[]
	)

	const sendCanvasContextTrace = useCallback(
		(message: CanvasContextTraceMessage) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			wsRef.current.send(JSON.stringify(message))
		},
		[]
	)

	const sendCanvasDelegateResult = useCallback(
		(message: CanvasDelegateResultMessage) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			wsRef.current.send(JSON.stringify(message))
		},
		[]
	)

	const sendCanvasActivityWindow = useCallback(
		(message: CanvasActivityWindowMessage) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			wsRef.current.send(JSON.stringify(message))
		},
		[]
	)

	const sendAudioChunk = useCallback((data: ArrayBuffer) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(data)
		}
	}, [])

	const sendFrontendAck = useCallback(
		(ack: FrontendAck) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			wsRef.current.send(JSON.stringify({ type: 'frontend_ack', ack }))
		},
		[]
	)

	return {
		connectionState,
		talkingState,
		isKnowledgeLookupActive,
		turnCompleteCount,
		latestToolResult,
		agentSubtitle,
		frontendActions,
		connect,
		disconnect,
		sendText,
		sendSessionStartup,
		sendImage,
		sendCanvasContext,
		sendCanvasContextResponse,
		sendCanvasContextTrace,
		sendCanvasDelegateResult,
		sendCanvasActivityWindow,
		sendAudioChunk,
		sendFrontendAck,
		shiftFrontendAction,
	}
}
