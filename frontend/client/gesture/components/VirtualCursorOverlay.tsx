import { GesturePoint, GestureRuntimeState } from '../types'

interface VirtualCursorOverlayProps {
	cursorPoint: GesturePoint | null
	cursorVisibility: GestureRuntimeState['cursorVisibility']
}

export function VirtualCursorOverlay({
	cursorPoint,
	cursorVisibility,
}: VirtualCursorOverlayProps) {
	if (!cursorPoint) return null

	return (
		<div
			aria-hidden="true"
			className={`gesture-virtual-cursor gesture-virtual-cursor--${cursorVisibility}`}
			style={{
				transform: `translate(${cursorPoint.x}px, ${cursorPoint.y}px)`,
			}}
		/>
	)
}
