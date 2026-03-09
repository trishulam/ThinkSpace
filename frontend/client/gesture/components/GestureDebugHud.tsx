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

export function GestureDebugHud({ state, logs, onToggle, onClearLogs }: GestureDebugHudProps) {
	const previewRef = useRef<HTMLVideoElement | null>(null)

	useEffect(() => {
		if (!previewRef.current) return
		previewRef.current.srcObject = state?.stream ?? null
	}, [state?.stream])

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

	return (
		<div className="gesture-sidebar-panel">
			<div className="gesture-sidebar-panel__header">
				<div>
					<div className="gesture-sidebar-panel__title">Gestures</div>
					<div className="gesture-sidebar-panel__subtitle">Native draw runtime</div>
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

			<div className="gesture-debug-grid">
				<div>
					<span>camera</span>
					<strong>{state.cameraState}</strong>
				</div>
				<div>
					<span>model</span>
					<strong>{state.modelState}</strong>
				</div>
				<div>
					<span>tracking</span>
					<strong>{state.handPresent ? 'hand present' : 'no hand'}</strong>
				</div>
				<div>
					<span>video</span>
					<strong>
						{state.videoSize ? `${state.videoSize.width}x${state.videoSize.height}` : 'n/a'}
					</strong>
				</div>
				<div>
					<span>raw gesture</span>
					<strong>{state.rawGestureLabel ?? 'n/a'}</strong>
				</div>
				<div>
					<span>stable gesture</span>
					<strong>{state.stableGestureLabel ?? 'n/a'}</strong>
				</div>
				<div>
					<span>raw draw</span>
					<strong>{state.rawDrawGestureActive ? 'active' : 'inactive'}</strong>
				</div>
				<div>
					<span>stable draw</span>
					<strong>{state.stableDrawGestureActive ? 'active' : 'inactive'}</strong>
				</div>
				<div>
					<span>confidence</span>
					<strong>
						{state.rawConfidence !== null ? state.rawConfidence.toFixed(3) : 'n/a'}
					</strong>
				</div>
				<div>
					<span>cursor</span>
					<strong>{state.cursorVisibility}</strong>
				</div>
				<div>
					<span>raw point</span>
					<strong>{formatPoint(state.rawCursorPoint)}</strong>
				</div>
				<div>
					<span>smooth point</span>
					<strong>{formatPoint(state.cursorPoint)}</strong>
				</div>
				<div>
					<span>hand inference</span>
					<strong>{formatMs(state.metrics.lastHandInferenceMs)}</strong>
				</div>
				<div>
					<span>classifier</span>
					<strong>{formatMs(state.metrics.lastClassifierInferenceMs)}</strong>
				</div>
				<div>
					<span>vector length</span>
					<strong>{state.metrics.preprocessedVectorLength ?? 'n/a'}</strong>
				</div>
				<div>
					<span>draw lifecycle</span>
					<strong>{state.drawLifecycleState}</strong>
				</div>
				<div>
					<span>stroke state</span>
					<strong>{state.strokeState}</strong>
				</div>
				<div>
					<span>native session</span>
					<strong>{state.nativeSessionActive ? 'active' : 'inactive'}</strong>
				</div>
				<div>
					<span>pointer id</span>
					<strong>{state.activePointerId ?? 'n/a'}</strong>
				</div>
				<div>
					<span>tool</span>
					<strong>{state.currentToolId ?? 'n/a'}</strong>
				</div>
				<div>
					<span>prev tool</span>
					<strong>{state.previousToolId ?? 'n/a'}</strong>
				</div>
				<div>
					<span>last event</span>
					<strong>{state.lastDispatchedEvent ?? 'none'}</strong>
				</div>
				<div>
					<span>dispatch screen</span>
					<strong>{formatPoint(state.lastDispatchScreenPoint)}</strong>
				</div>
				<div>
					<span>dispatch page</span>
					<strong>{formatPoint(state.lastDispatchPagePoint)}</strong>
				</div>
				<div>
					<span>last draw</span>
					<strong>{state.lastDrawEvent ?? 'none'}</strong>
				</div>
				<div>
					<span>error</span>
					<strong>{state.error ?? 'none'}</strong>
				</div>
				<div>
					<span>warning</span>
					<strong>{state.warning ?? 'none'}</strong>
				</div>
			</div>

			<div className="gesture-sidebar-panel__logHeader">
				<span>Gesture logs</span>
				<strong>{logs.length}</strong>
			</div>
			<div className="gesture-sidebar-panel__log">
				{logs.length === 0 ? (
					<div className="gesture-sidebar-empty">
						Start the runtime to see gesture lifecycle logs here.
					</div>
				) : (
					[...logs].reverse().map((entry) => {
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
