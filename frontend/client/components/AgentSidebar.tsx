import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { AgentLogEntry, ConnectionState } from '../types/agent-live'

const BADGE_LABELS: Record<AgentLogEntry['type'], string> = {
	'user-text': 'You',
	'user-transcription': 'You',
	'user-audio': 'Audio',
	'agent-text': 'Agent',
	'agent-transcription': 'Agent',
	'agent-audio': 'Audio',
	'tool-call': 'Tool',
	'tool-result': 'Result',
	system: 'System',
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString('en-US', {
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	})
}

interface AgentSidebarProps {
	connectionState: ConnectionState
	eventLog: AgentLogEntry[]
	isAudioActive: boolean
	onConnect: () => void
	onDisconnect: () => void
	onSendText: (msg: string) => void
	onStartAudio: () => void
	onStopAudio: () => void
	onClearLog: () => void
}

export function AgentSidebar({
	connectionState,
	eventLog,
	isAudioActive,
	onConnect,
	onDisconnect,
	onSendText,
	onStartAudio,
	onStopAudio,
	onClearLog,
}: AgentSidebarProps) {
	const [showAudioEvents, setShowAudioEvents] = useState(false)
	const logEndRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	const isConnected = connectionState === 'connected'
	const isConnecting = connectionState === 'connecting'

	useEffect(() => {
		logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [eventLog.length])

	const handleSubmit = useCallback(
		(e: FormEvent) => {
			e.preventDefault()
			const value = inputRef.current?.value.trim()
			if (value) {
				onSendText(value)
				inputRef.current!.value = ''
			}
		},
		[onSendText]
	)

	const statusLabel =
		connectionState === 'connected'
			? 'Connected'
			: connectionState === 'connecting'
				? 'Connecting...'
				: connectionState === 'disconnecting'
					? 'Disconnecting...'
					: 'Disconnected'

	const statusDotClass =
		connectionState === 'connected'
			? 'connected'
			: connectionState === 'connecting'
				? 'connecting'
				: ''

	const filteredLog = showAudioEvents
		? eventLog
		: eventLog.filter((e) => !e.isAudioEvent)

	return (
		<div className="agent-sidebar">
			{/* Header */}
			<div className="agent-sidebar-header">
				<div className="agent-sidebar-header-left">
					<span className="agent-sidebar-title">Live Agent</span>
					<div className="agent-sidebar-status">
						<span className={`agent-sidebar-status-dot ${statusDotClass}`} />
						<span>{statusLabel}</span>
					</div>
				</div>
				{isConnected ? (
					<button
						className="agent-sidebar-connect-btn active"
						onClick={onDisconnect}
					>
						Disconnect
					</button>
				) : (
					<button
						className="agent-sidebar-connect-btn"
						onClick={onConnect}
						disabled={isConnecting}
					>
						{isConnecting ? 'Connecting...' : 'Connect'}
					</button>
				)}
			</div>

			{/* Controls */}
			<div className="agent-sidebar-controls">
				{isAudioActive ? (
					<button
						className="agent-sidebar-audio-btn active"
						onClick={onStopAudio}
					>
						Stop Audio
					</button>
				) : (
					<button
						className="agent-sidebar-audio-btn"
						onClick={onStartAudio}
						disabled={!isConnected}
					>
						Start Audio
					</button>
				)}
				<label className="agent-sidebar-checkbox">
					<input
						type="checkbox"
						checked={showAudioEvents}
						onChange={(e) => setShowAudioEvents(e.target.checked)}
					/>
					Show audio
				</label>
				<button className="agent-sidebar-clear-btn" onClick={onClearLog}>
					Clear
				</button>
			</div>

			{/* Event Log */}
			<div className="agent-sidebar-log">
				{filteredLog.length === 0 ? (
					<div className="agent-sidebar-log-empty">
						{isConnected
							? 'Waiting for events...'
							: 'Connect to start a session'}
					</div>
				) : (
					filteredLog.map((entry) => (
						<div
							key={entry.id}
							className={`agent-log-entry type-${entry.type}`}
						>
							<div className="agent-log-entry-header">
								<span className="agent-log-entry-time">
									{formatTime(entry.timestamp)}
								</span>
								<span className="agent-log-entry-badge">
									{BADGE_LABELS[entry.type]}
								</span>
							</div>
							<div
								className={`agent-log-entry-content${entry.isPartial ? ' partial' : ''}`}
							>
								{entry.content}
							</div>
						</div>
					))
				)}
				<div ref={logEndRef} />
			</div>

			{/* Text Input */}
			<form className="agent-sidebar-input" onSubmit={handleSubmit}>
				<input
					ref={inputRef}
					type="text"
					placeholder={
						isConnected ? 'Type a message...' : 'Connect to chat'
					}
					disabled={!isConnected}
					autoComplete="off"
				/>
				<button type="submit" disabled={!isConnected}>
					Send
				</button>
			</form>
		</div>
	)
}
