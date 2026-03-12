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

export type FrontendActionType =
	| 'canvas.job_started'
	| 'canvas.context_requested'
	| 'canvas.viewport_snapshot_requested'
	| 'canvas.delegate_requested'
	| 'canvas.insert_visual'
	| 'canvas.insert_widget'
	| 'flashcards.begin'
	| 'flashcards.show'
	| 'flashcards.next'
	| 'flashcards.reveal_answer'
	| 'flashcards.clear'

export interface FrontendAction {
	type: FrontendActionType
	source_tool: string
	job_id?: string
	payload: unknown
}

export interface FrontendActionMessage {
	type: 'frontend_action'
	action: FrontendAction
}

export interface ToolResultEnvelope {
	status: 'accepted' | 'completed' | 'failed'
	tool: string
	summary?: string
	job?: {
		id: string
	}
	payload?: unknown
	frontend_action?: FrontendAction
}

export interface ToolResultMessage {
	type: 'tool_result'
	result: ToolResultEnvelope
}

export type FrontendAckStatus = 'applied' | 'failed'

export interface FrontendAck {
	status: FrontendAckStatus
	action_type: FrontendActionType
	source_tool: string
	job_id?: string
	summary?: string
}

export interface FrontendAckMessage {
	type: 'frontend_ack'
	ack: FrontendAck
}

export interface CanvasContextResponseMessage {
	type: 'canvas_context_response'
	source_tool: string
	job_id: string
	context: unknown
}

export interface CanvasDelegateResultMessage {
	type: 'canvas_delegate_result'
	source_tool: string
	job_id: string
	status: 'completed' | 'failed'
	error?: string
}
