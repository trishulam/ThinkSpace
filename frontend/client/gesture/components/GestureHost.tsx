import { RefObject, useEffect } from 'react'
import { useEditor } from 'tldraw'
import { useGestureRuntime } from '../useGestureRuntime'
import { GestureRuntimeCallbacks, GestureRuntimeState } from '../types'
import { VirtualCursorOverlay } from './VirtualCursorOverlay'

interface GestureHostProps {
	canvasRef: RefObject<HTMLDivElement | null>
	enabled: boolean
	micMuted?: GestureRuntimeCallbacks['micMuted']
	onStateChange?: (state: GestureRuntimeState) => void
	onFitView?: GestureRuntimeCallbacks['onFitView']
	onToggleMicMute?: GestureRuntimeCallbacks['onToggleMicMute']
}

export function GestureHost({
	canvasRef,
	enabled,
	micMuted,
	onStateChange,
	onFitView,
	onToggleMicMute,
}: GestureHostProps) {
	const editor = useEditor()
	const state = useGestureRuntime(canvasRef, enabled, editor, {
		micMuted,
		onFitView,
		onToggleMicMute,
	})

	useEffect(() => {
		onStateChange?.(state)
	}, [onStateChange, state])

	return (
		<>
			<div className="gesture-overlay-layer">
				<VirtualCursorOverlay
					cursorPoint={state.cursorPoint}
					cursorVisibility={state.cursorVisibility}
				/>
			</div>
		</>
	)
}
