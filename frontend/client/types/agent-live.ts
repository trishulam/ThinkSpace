export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnecting'
export type TalkingState = 'none' | 'user' | 'agent' | 'thinking'
export type AgentSubtitleStatus = 'idle' | 'active' | 'complete' | 'interrupted'
export type LogEntryType =
	| 'user-text'
	| 'user-transcription'
	| 'user-audio'
	| 'agent-text'
	| 'agent-transcription'
	| 'agent-audio'
	| 'tool-call'
	| 'tool-result'
	| 'system'

export interface AgentLogEntry {
	id: string
	timestamp: Date
	type: LogEntryType
	content: string
	rawEvent?: unknown
	isPartial?: boolean
	isAudioEvent?: boolean
}

export interface AgentSubtitleState {
	receivedText: string
	revealedText: string
	isVisible: boolean
	isPartial: boolean
	isFinal: boolean
	isCatchingUp: boolean
	status: AgentSubtitleStatus
	updatedAt: number | null
}
