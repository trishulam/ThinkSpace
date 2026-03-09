import { RefObject, useEffect } from 'react'
import { useEditor } from 'tldraw'
import { useGestureRuntime } from '../useGestureRuntime'
import { GestureRuntimeState } from '../types'
import { VirtualCursorOverlay } from './VirtualCursorOverlay'

interface GestureHostProps {
	canvasRef: RefObject<HTMLDivElement | null>
	enabled: boolean
	onStateChange?: (state: GestureRuntimeState) => void
}

export function GestureHost({ canvasRef, enabled, onStateChange }: GestureHostProps) {
	const editor = useEditor()
	const state = useGestureRuntime(canvasRef, enabled, editor)

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
