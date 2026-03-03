import { useCallback, useRef, useState } from 'react'
import type { AgentLogEntry, ConnectionState, TalkingState } from '../types/agent-live'

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

export function useAgentWebSocket({
	userId,
	sessionId,
	onPlayAudio,
	onStopPlayback,
}: UseAgentWebSocketOptions) {
	const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
	const [talkingState, setTalkingState] = useState<TalkingState>('none')
	const [eventLog, setEventLog] = useState<AgentLogEntry[]>([])

	const wsRef = useRef<WebSocket | null>(null)
	const intentionalDisconnectRef = useRef(false)
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

	const connect = useCallback(() => {
		if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

		intentionalDisconnectRef.current = false
		setConnectionState('connecting')

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
				addLogEntry('system', 'Turn complete', adkEvent)
				return
			}

			// --- interrupted ---
			if (adkEvent.interrupted === true) {
				setTalkingState('none')
				onStopPlaybackRef.current?.()
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
	}, [userId, sessionId, addLogEntry])

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
	}, [])

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
		connect,
		disconnect,
		sendText,
		sendImage,
		sendAudioChunk,
		clearLog,
	}
}
