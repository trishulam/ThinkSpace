import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	AgentLogEntry,
	AgentSubtitleState,
	CanvasContextResponseMessage,
	CanvasDelegateResultMessage,
	ConnectionState,
	FrontendAck,
	FrontendAction,
	FrontendActionMessage,
	ToolResultMessage,
	TalkingState,
} from '../types/agent-live'

let logIdCounter = 0
function nextLogId(): string {
	return `log-${Date.now()}-${++logIdCounter}`
}

function base64AudioByteLength(base64: string): number {
	const normalized = base64.replace(/-/g, '+').replace(/_/g, '/')
	const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
	return Math.floor((normalized.length * 3) / 4) - padding
}

interface UseAgentWebSocketOptions {
	userId: string
	sessionId: string
	onPlayAudio?: (base64Data: string) => void
	onStopPlayback?: () => void
	/** Persisted transcript entries to restore on mount (e.g. from session resume). */
	initialEventLog?: AgentLogEntry[]
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

function formatToolResultContent(message: ToolResultMessage): string {
	const summary = message.result.summary || message.result.tool
	if (message.result.tool !== 'canvas.generate_visual') {
		return `${message.result.status}: ${summary}`
	}

	const payload = isRecord(message.result.payload) ? message.result.payload : null
	const plannerTrace = payload && isRecord(payload.planner_trace) ? payload.planner_trace : null
	if (!plannerTrace) {
		return `${message.result.status}: ${summary}`
	}

	const rawPlan = isRecord(plannerTrace.raw_response_payload)
		? plannerTrace.raw_response_payload
		: isRecord(plannerTrace.parsed_plan)
			? plannerTrace.parsed_plan
			: null
	const finalGeometry = isRecord(plannerTrace.final_geometry) ? plannerTrace.final_geometry : null
	const hint =
		typeof plannerTrace.placement_hint === 'string' ? plannerTrace.placement_hint : 'auto'
	const rawPlanText = rawPlan ? JSON.stringify(rawPlan) : 'none'
	const finalGeometryText = finalGeometry ? JSON.stringify(finalGeometry) : 'none'
	const fallbackText = plannerTrace.used_fallback ? ' | fallback used' : ''
	return `${message.result.status}: ${summary} | hint=${hint} | raw_plan=${rawPlanText} | final=${finalGeometryText}${fallbackText}`
}

export function useAgentWebSocket({
	userId,
	sessionId,
	onPlayAudio,
	onStopPlayback,
	initialEventLog,
}: UseAgentWebSocketOptions) {
	const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
	const [talkingState, setTalkingState] = useState<TalkingState>('none')
	const [eventLog, setEventLog] = useState<AgentLogEntry[]>([])
	const [agentSubtitle, setAgentSubtitle] = useState<AgentSubtitleState>(EMPTY_SUBTITLE)
	const [frontendActions, setFrontendActions] = useState<FrontendAction[]>([])

	const wsRef = useRef<WebSocket | null>(null)
	const intentionalDisconnectRef = useRef(false)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const hasAppliedInitialLogRef = useRef(false)
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

	// Stable refs for callbacks so the WS handler always sees the latest
	const onPlayAudioRef = useRef(onPlayAudio)
	onPlayAudioRef.current = onPlayAudio
	const onStopPlaybackRef = useRef(onStopPlayback)
	onStopPlaybackRef.current = onStopPlayback

	const addLogEntry = useCallback(
		(type: AgentLogEntry['type'], content: string, rawEvent?: unknown, extra?: Partial<AgentLogEntry>) => {
			const entry: AgentLogEntry = {
				id: nextLogId(),
				timestamp: new Date(),
				type,
				content,
				rawEvent,
				...extra,
			}
			setEventLog((prev) => [...prev, entry])
		},
		[]
	)

	const clearLog = useCallback(() => {
		setEventLog([])
		hasAppliedInitialLogRef.current = false
	}, [])

	const clearFrontendActions = useCallback(() => {
		setFrontendActions([])
	}, [])

	const shiftFrontendAction = useCallback(() => {
		setFrontendActions((prev) => (prev.length > 0 ? prev.slice(1) : prev))
	}, [])

	// Restore persisted transcript when initialEventLog becomes available (e.g. from session resume)
	useEffect(() => {
		if (
			initialEventLog &&
			initialEventLog.length > 0 &&
			!hasAppliedInitialLogRef.current
		) {
			hasAppliedInitialLogRef.current = true
			setEventLog(initialEventLog)
		}
	}, [initialEventLog])

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
			clearSubtitleTimer()
			clearRevealLoop()
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current)
			}
		}
	}, [clearRevealLoop, clearSubtitleTimer])

	const connect = useCallback(() => {
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

		intentionalDisconnectRef.current = false
		setConnectionState('connecting')
		resetSubtitle()

		// Connect directly to the backend. The Cloudflare Vite plugin intercepts
		// upgrade requests before the Vite proxy can forward them, so we bypass
		// the proxy and connect to the FastAPI backend directly.
		const backendHost = getAgentWebSocketBaseUrl()
		const wsUrl = `${backendHost}/ws/${userId}/${sessionId}`

		const ws = new WebSocket(wsUrl)
		wsRef.current = ws

		ws.onopen = () => {
			setConnectionState('connected')
			setTalkingState('none')
			setFrontendActions([])
			addLogEntry('system', 'Connected to agent', { userId, sessionId, url: wsUrl })
		}

		ws.onmessage = (event: MessageEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const parsedMessage: any = JSON.parse(event.data)

			if (isFrontendActionMessage(parsedMessage)) {
				setFrontendActions((prev) => [...prev, parsedMessage.action])
				addLogEntry(
					'system',
					`Frontend action: ${parsedMessage.action.type}`,
					parsedMessage
				)
				return
			}

			if (isToolResultMessage(parsedMessage)) {
				addLogEntry(
					'tool-result',
					formatToolResultContent(parsedMessage),
					parsedMessage
				)
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
				addLogEntry('system', 'Turn complete', adkEvent)
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
				addLogEntry('system', 'Interrupted', adkEvent)
				return
			}

			// --- inputTranscription (user's speech) ---
			if (adkEvent.inputTranscription?.text) {
				const text = adkEvent.inputTranscription.text
				const finished = adkEvent.inputTranscription.finished
				setTalkingState('user')
				addLogEntry(
					'user-transcription',
					text,
					adkEvent,
					{ isPartial: !finished }
				)
			}

			// --- outputTranscription (agent's speech) ---
			if (adkEvent.outputTranscription?.text) {
				const text = adkEvent.outputTranscription.text
				const finished = adkEvent.outputTranscription.finished
				setTalkingState('agent')
				updateSubtitleFromOutput(text, finished === true)
				addLogEntry(
					'agent-transcription',
					text,
					adkEvent,
					{ isPartial: !finished }
				)
			}

			// --- usageMetadata ---
			if (adkEvent.usageMetadata) {
				const u = adkEvent.usageMetadata
				const total = u.totalTokenCount || 0
				const prompt = u.promptTokenCount || 0
				const response = u.candidatesTokenCount || 0
				addLogEntry(
					'system',
					`Tokens: ${total} total (${prompt} prompt + ${response} response)`,
					adkEvent
				)
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
						const byteSize = Math.floor((part.inlineData.data?.length || 0) * 0.75)
						addLogEntry(
							'agent-audio',
							`Audio: ${mimeType} (${byteSize.toLocaleString()} bytes)`,
							undefined,
							{ isAudioEvent: true }
						)
					}

					// Text (skip thought/reasoning)
					if (part.text && !part.thought) {
						setTalkingState('agent')
						addLogEntry('agent-text', part.text, adkEvent, { isPartial: !!adkEvent.partial })
					}

					// Executable code (tool call)
					if (part.executableCode) {
						const lang = part.executableCode.language || 'unknown'
						const code = part.executableCode.code || ''
						addLogEntry('tool-call', `[${lang}] ${code}`, adkEvent)
					}

					// Code execution result
					if (part.codeExecutionResult) {
						const outcome = part.codeExecutionResult.outcome || 'UNKNOWN'
						const output = part.codeExecutionResult.output || ''
						addLogEntry('tool-result', `${outcome}: ${output}`, adkEvent)
					}
				}
			}
		}

		ws.onclose = () => {
			wsRef.current = null
			setConnectionState('idle')
			setTalkingState('none')
			setFrontendActions([])
			resetSubtitle()

			if (!intentionalDisconnectRef.current) {
				addLogEntry('system', 'Disconnected. Reconnecting in 5s...')
				reconnectTimerRef.current = setTimeout(() => {
					connect()
				}, 5000)
			} else {
				addLogEntry('system', 'Disconnected')
			}
		}

		ws.onerror = () => {
			addLogEntry('system', 'WebSocket error')
		}
	}, [
		userId,
		sessionId,
		addLogEntry,
		resetSubtitle,
		scheduleSubtitleClear,
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
		resetSubtitle()
	}, [resetSubtitle])

	const sendText = useCallback((message: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			const payload = JSON.stringify({ type: 'text', text: message })
			wsRef.current.send(payload)
			addLogEntry('user-text', message)
		}
	}, [addLogEntry])

	const sendImage = useCallback((base64: string, mimeType: string) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			const payload = JSON.stringify({ type: 'image', data: base64, mimeType })
			wsRef.current.send(payload)
			addLogEntry('user-text', `Sent image (${mimeType})`)
		}
	}, [addLogEntry])

	const sendCanvasContext = useCallback((context: unknown) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			const payload = JSON.stringify({ type: 'canvas_context', context })
			wsRef.current.send(payload)
			addLogEntry('system', 'Updated canvas placement context', payload)
		}
	}, [addLogEntry])

	const sendCanvasContextResponse = useCallback(
		(message: CanvasContextResponseMessage) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			const payload = JSON.stringify(message)
			wsRef.current.send(payload)
			addLogEntry(
				'system',
				`Sent canvas context response for ${message.job_id}`,
				payload
			)
		},
		[addLogEntry]
	)

	const sendCanvasDelegateResult = useCallback(
		(message: CanvasDelegateResultMessage) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			const payload = JSON.stringify(message)
			wsRef.current.send(payload)
			addLogEntry(
				'system',
				`Sent canvas delegate result for ${message.job_id} (${message.status})`,
				payload
			)
		},
		[addLogEntry]
	)

	const sendAudioChunk = useCallback((data: ArrayBuffer) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(data)
		}
	}, [])

	const sendFrontendAck = useCallback(
		(ack: FrontendAck) => {
			if (wsRef.current?.readyState !== WebSocket.OPEN) return
			const payload = JSON.stringify({ type: 'frontend_ack', ack })
			wsRef.current.send(payload)
			addLogEntry('system', `Frontend ack: ${ack.action_type} (${ack.status})`, payload)
		},
		[addLogEntry]
	)

	return {
		connectionState,
		talkingState,
		eventLog,
		agentSubtitle,
		frontendActions,
		connect,
		disconnect,
		sendText,
		sendImage,
		sendCanvasContext,
		sendCanvasContextResponse,
		sendCanvasDelegateResult,
		sendAudioChunk,
		sendFrontendAck,
		clearLog,
		clearFrontendActions,
		shiftFrontendAction,
	}
}
