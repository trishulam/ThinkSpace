import { useCallback, useEffect, useRef, useState } from 'react'
import type {
	AgentLogEntry,
	AgentSubtitleState,
	ConnectionState,
	TalkingState,
} from '../types/agent-live'

let logIdCounter = 0
function nextLogId(): string {
	return `log-${Date.now()}-${++logIdCounter}`
}

interface UseAgentWebSocketOptions {
	userId: string
	sessionId: string
	onPlayAudio?: (base64Data: string) => void
	onStopPlayback?: () => void
}

const NORMAL_SUBTITLE_LINGER_MS = 1600
const INTERRUPTED_FINAL_LINGER_MS = 500
const INTERRUPTED_PARTIAL_LINGER_MS = 120
const BASE_REVEAL_CPS = 15
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

export function useAgentWebSocket({
	userId,
	sessionId,
	onPlayAudio,
	onStopPlayback,
}: UseAgentWebSocketOptions) {
	const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
	const [talkingState, setTalkingState] = useState<TalkingState>('none')
	const [eventLog, setEventLog] = useState<AgentLogEntry[]>([])
	const [agentSubtitle, setAgentSubtitle] = useState<AgentSubtitleState>(EMPTY_SUBTITLE)

	const wsRef = useRef<WebSocket | null>(null)
	const intentionalDisconnectRef = useRef(false)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const subtitleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const subtitleRevealLoopRef = useRef<ReturnType<typeof setInterval> | null>(null)
	const subtitleReceivedTextRef = useRef('')
	const subtitleRevealedLengthRef = useRef(0)
	const subtitleRevealCarryRef = useRef(0)
	const hasOutputTranscriptionRef = useRef(false)
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
	}, [])

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
		hasOutputTranscriptionRef.current = false
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
				pendingTurnCompleteRef.current = false
				setAgentSubtitle(EMPTY_SUBTITLE)
			}, delayMs)
			hasOutputTranscriptionRef.current = false
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

			const revealAmount =
				BASE_REVEAL_CPS * (REVEAL_TICK_MS / 1000) + subtitleRevealCarryRef.current
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

	const updateSubtitleFromOutput = useCallback(
		(textChunk: string, isFinal: boolean) => {
			clearSubtitleTimer()
			startRevealLoop()
			hasOutputTranscriptionRef.current = true
			pendingTurnCompleteRef.current = false

			const nextText = isFinal
				? textChunk
				: `${subtitleReceivedTextRef.current}${textChunk}`
			subtitleReceivedTextRef.current = nextText
			hasFinalSubtitleRef.current = isFinal

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
		[clearSubtitleTimer, startRevealLoop]
	)

	const updateSubtitleFromTextFallback = useCallback(
		(textChunk: string, isPartial: boolean) => {
			if (hasOutputTranscriptionRef.current) return

			clearSubtitleTimer()
			startRevealLoop()
			pendingTurnCompleteRef.current = false
			const nextText = isPartial
				? `${subtitleReceivedTextRef.current}${textChunk}`
				: textChunk
			subtitleReceivedTextRef.current = nextText
			hasFinalSubtitleRef.current = !isPartial

			setAgentSubtitle((current) => ({
				...current,
				receivedText: nextText,
				isVisible: current.revealedText.trim().length > 0,
				isPartial,
				isFinal: !isPartial,
				isCatchingUp:
					subtitleRevealedLengthRef.current < nextText.length ||
					current.isCatchingUp,
				status: 'active',
				updatedAt: Date.now(),
			}))
		},
		[clearSubtitleTimer, startRevealLoop]
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
		const backendHost = import.meta.env.VITE_AGENT_BACKEND_URL || 'ws://localhost:8000'
		const wsUrl = `${backendHost}/ws/${userId}/${sessionId}`

		const ws = new WebSocket(wsUrl)
		wsRef.current = ws

		ws.onopen = () => {
			setConnectionState('connected')
			setTalkingState('none')
			addLogEntry('system', 'Connected to agent', { userId, sessionId, url: wsUrl })
		}

		ws.onmessage = (event: MessageEvent) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const adkEvent: any = JSON.parse(event.data)

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
				const textParts = adkEvent.content.parts
					.filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
					.map((part: { text: string }) => part.text)
					.join('')
				if (textParts) {
					updateSubtitleFromTextFallback(textParts, !!adkEvent.partial)
				}

				for (const part of adkEvent.content.parts) {
					// Audio
					if (part.inlineData) {
						const mimeType: string = part.inlineData.mimeType || ''
						if (mimeType.startsWith('audio/pcm')) {
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
		updateSubtitleFromOutput,
		updateSubtitleFromTextFallback,
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

	const sendAudioChunk = useCallback((data: ArrayBuffer) => {
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			wsRef.current.send(data)
		}
	}, [])

	return {
		connectionState,
		talkingState,
		eventLog,
		agentSubtitle,
		connect,
		disconnect,
		sendText,
		sendImage,
		sendAudioChunk,
		clearLog,
	}
}
