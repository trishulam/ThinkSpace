import { useEffect, useRef } from 'react'
import { GestureLogEntry, GestureRuntimeState } from '../types'

interface GestureDebugHudProps {
	state: GestureRuntimeState | null
	logs: GestureLogEntry[]
	onToggle: () => void
	onClearLogs: () => void
}

function formatPoint(point: GestureRuntimeState['cursorPoint']) {
	if (!point) return 'n/a'
	return `${point.x.toFixed(1)}, ${point.y.toFixed(1)}`
}

function formatMs(value: number | null) {
	if (value === null) return 'n/a'
	return `${value.toFixed(1)} ms`
}

function formatLogDetails(details: unknown) {
	if (details === undefined) return null

	try {
		return JSON.stringify(details, null, 2)
	} catch {
		return String(details)
	}
}

function formatLogTime(date: Date) {
	return date.toLocaleTimeString('en-US', {
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	})
}

function getInteractionMode(state: GestureRuntimeState) {
	if (state.stableDrawGestureActive) return 'draw'
	if (state.stablePanGestureActive) return 'pan'
	if (state.stableGestureLabel) return 'cursor'
	return 'idle'
}

function renderField(label: string, value: string) {
	return (
		<div className="gesture-debug-field" key={label}>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	)
}

export function GestureDebugHud({ state, logs, onToggle, onClearLogs }: GestureDebugHudProps) {
	const previewRef = useRef<HTMLVideoElement | null>(null)
	const logRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		if (!previewRef.current) return
		previewRef.current.srcObject = state?.stream ?? null
	}, [state?.stream])

	useEffect(() => {
		if (!logRef.current) return
		logRef.current.scrollTop = logRef.current.scrollHeight
	}, [logs.length])

	if (!state) {
		return (
			<div className="gesture-sidebar-panel">
				<div className="gesture-sidebar-panel__header">
					<div>
						<div className="gesture-sidebar-panel__title">Gestures</div>
						<div className="gesture-sidebar-panel__subtitle">Waiting for runtime</div>
					</div>
					<div className="gesture-sidebar-panel__actions">
						<button className="gesture-sidebar-panel__clear" onClick={onClearLogs} type="button">
							Clear logs
						</button>
						<button className="gesture-sidebar-panel__toggle" onClick={onToggle} type="button">
							Start
						</button>
					</div>
				</div>
				<div className="gesture-sidebar-empty">Gesture runtime has not mounted yet.</div>
			</div>
		)
	}

	const interactionMode = getInteractionMode(state)
	const recentLogs = logs.slice(-120)

	return (
		<div className="gesture-sidebar-panel">
			<div className="gesture-sidebar-panel__header">
				<div>
					<div className="gesture-sidebar-panel__title">Gestures</div>
					<div className="gesture-sidebar-panel__subtitle">Canvas gesture runtime</div>
				</div>
				<div className="gesture-sidebar-panel__actions">
					<button className="gesture-sidebar-panel__clear" onClick={onClearLogs} type="button">
						Clear logs
					</button>
					<button className="gesture-sidebar-panel__toggle" onClick={onToggle} type="button">
						{state.enabled ? 'Stop' : 'Start'}
					</button>
				</div>
			</div>

			<div className="gesture-sidebar-panel__preview">
				<video autoPlay muted playsInline ref={previewRef} />
				<div className="gesture-sidebar-panel__preview-badge">{state.trackingState}</div>
			</div>

			<div className="gesture-sidebar-summary">
				<div className="gesture-sidebar-chip">
					<span>mode</span>
					<strong>{interactionMode}</strong>
				</div>
				<div className="gesture-sidebar-chip">
					<span>raw</span>
					<strong>{state.rawGestureLabel ?? 'n/a'}</strong>
				</div>
				<div className="gesture-sidebar-chip">
					<span>stable</span>
					<strong>{state.stableGestureLabel ?? 'n/a'}</strong>
				</div>
				<div className="gesture-sidebar-chip">
					<span>tracking</span>
					<strong>{state.handPresent ? 'live' : 'lost'}</strong>
				</div>
				<div className="gesture-sidebar-chip">
					<span>tool</span>
					<strong>{state.currentToolId ?? 'n/a'}</strong>
				</div>
				<div className="gesture-sidebar-chip">
					<span>confidence</span>
					<strong>{state.rawConfidence !== null ? state.rawConfidence.toFixed(3) : 'n/a'}</strong>
				</div>
			</div>

			<div className="gesture-debug-sections">
				<section className="gesture-debug-section">
					<div className="gesture-debug-section__title">System</div>
					<div className="gesture-debug-grid">
						{renderField('camera', state.cameraState)}
						{renderField('model', state.modelState)}
						{renderField('tracking', state.handPresent ? 'hand present' : 'no hand')}
						{renderField(
							'video',
							state.videoSize ? `${state.videoSize.width}x${state.videoSize.height}` : 'n/a'
						)}
						{renderField('cursor', state.cursorVisibility)}
						{renderField('cursor point', formatPoint(state.cursorPoint))}
						{renderField('hand inference', formatMs(state.metrics.lastHandInferenceMs))}
						{renderField('classifier', formatMs(state.metrics.lastClassifierInferenceMs))}
					</div>
				</section>

				<section className="gesture-debug-section">
					<div className="gesture-debug-section__title">Pan</div>
					<div className="gesture-debug-grid">
						{renderField('raw pan', state.rawPanGestureActive ? 'active' : 'inactive')}
						{renderField('stable pan', state.stablePanGestureActive ? 'active' : 'inactive')}
						{renderField('lifecycle', state.panLifecycleState)}
						{renderField('last pan', state.lastPanEvent ?? 'none')}
						{renderField('anchor', formatPoint(state.lastPanAnchorPoint))}
						{renderField('delta', formatPoint(state.lastPanDelta))}
					</div>
				</section>

				<section className="gesture-debug-section">
					<div className="gesture-debug-section__title">Draw</div>
					<div className="gesture-debug-grid">
						{renderField('raw draw', state.rawDrawGestureActive ? 'active' : 'inactive')}
						{renderField('stable draw', state.stableDrawGestureActive ? 'active' : 'inactive')}
						{renderField('lifecycle', state.drawLifecycleState)}
						{renderField('stroke', state.strokeState)}
						{renderField('native session', state.nativeSessionActive ? 'active' : 'inactive')}
						{renderField('last draw', state.lastDrawEvent ?? 'none')}
						{renderField('dispatch event', state.lastDispatchedEvent ?? 'none')}
						{renderField('dispatch point', formatPoint(state.lastDispatchScreenPoint))}
					</div>
				</section>

				{state.warning || state.error ? (
					<section className="gesture-debug-section">
						<div className="gesture-debug-section__title">Issues</div>
						<div className="gesture-issue-list">
							{state.warning ? (
								<div className="gesture-issue-card gesture-issue-card--warn">
									<span>warning</span>
									<strong>{state.warning}</strong>
								</div>
							) : null}
							{state.error ? (
								<div className="gesture-issue-card gesture-issue-card--error">
									<span>error</span>
									<strong>{state.error}</strong>
								</div>
							) : null}
						</div>
					</section>
				) : null}
			</div>

			<div className="gesture-sidebar-panel__logHeader">
				<span>Recent lifecycle logs</span>
				<strong>{recentLogs.length}</strong>
			</div>
			<div className="gesture-sidebar-panel__log" ref={logRef}>
				{recentLogs.length === 0 ? (
					<div className="gesture-sidebar-empty">
						Start the runtime to see gesture lifecycle logs here.
					</div>
				) : (
					recentLogs.map((entry) => {
						const details = formatLogDetails(entry.details)

						return (
							<div
								key={entry.id}
								className={`gesture-sidebar-log-entry gesture-sidebar-log-entry--${entry.level}`}
							>
								<div className="gesture-sidebar-log-entry__header">
									<span>{formatLogTime(entry.timestamp)}</span>
									<span>{entry.namespace}</span>
									<span>{entry.level}</span>
								</div>
								<div className="gesture-sidebar-log-entry__message">{entry.message}</div>
								{details ? (
									<pre className="gesture-sidebar-log-entry__details">{details}</pre>
								) : null}
							</div>
						)
					})
				)}
			</div>
		</div>
	)
}
