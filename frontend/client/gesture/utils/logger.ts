import { GestureDebugMode, GestureLogEntry, GestureLogLevel } from '../types'

const LEVELS: Record<GestureDebugMode, number> = {
	basic: 1,
	verbose: 2,
}

let logIdCounter = 0
const listeners = new Set<(entry: GestureLogEntry) => void>()

function canLog(debugMode: GestureDebugMode, verbose: boolean) {
	if (!verbose) return true
	return LEVELS[debugMode] >= LEVELS.verbose
}

export function gestureLog(
	namespace: string,
	message: string,
	details?: unknown,
	options?: {
		debugMode?: GestureDebugMode
		verbose?: boolean
		level?: GestureLogLevel
	}
) {
	const debugMode = options?.debugMode ?? 'basic'
	const verbose = options?.verbose ?? false
	const level = options?.level ?? 'log'

	if (!canLog(debugMode, verbose)) return

	const entry: GestureLogEntry = {
		id: `gesture-log-${Date.now()}-${++logIdCounter}`,
		timestamp: new Date(),
		namespace,
		message,
		level,
		details,
	}

	for (const listener of listeners) {
		listener(entry)
	}

	const prefix = `[gesture:${namespace}]`
	if (details !== undefined) {
		console[level](prefix, message, details)
		return
	}

	console[level](prefix, message)
}

export function subscribeGestureLogs(listener: (entry: GestureLogEntry) => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
