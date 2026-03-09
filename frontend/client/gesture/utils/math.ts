import { GesturePoint } from '../types'

export function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max)
}

export function lerp(start: number, end: number, alpha: number) {
	return start + (end - start) * alpha
}

export function smoothPoint(
	previous: GesturePoint | null,
	next: GesturePoint,
	alpha: number
): GesturePoint {
	if (!previous) return next

	return {
		x: lerp(previous.x, next.x, alpha),
		y: lerp(previous.y, next.y, alpha),
	}
}
