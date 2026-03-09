export type GestureDebugMode = 'basic' | 'verbose'
export type GestureLogLevel = 'log' | 'warn' | 'error'

export type CameraState = 'idle' | 'requesting' | 'ready' | 'denied' | 'error'
export type TrackingState = 'no-hand' | 'tracking' | 'lost'
export type ModelState = 'uninitialized' | 'loading' | 'ready' | 'error'
export type CursorVisibility = 'hidden' | 'visible' | 'frozen'
export type DrawLifecycleState = 'idle' | 'drawArming' | 'drawing' | 'drawEnding'
export type PanLifecycleState = 'idle' | 'panArming' | 'panning' | 'panEnding'
export type StrokeState =
	| 'idle'
	| 'arming'
	| 'pointerDownSent'
	| 'streaming'
	| 'finishing'
	| 'cancelled'

export interface GesturePoint {
	x: number
	y: number
}

export interface GestureVideoSize {
	width: number
	height: number
}

export interface GesturePredictionState {
	rawGestureId: number | null
	rawGestureLabel: string | null
	rawConfidence: number | null
	stableGestureId: number | null
	stableGestureLabel: string | null
}

export interface GestureMetrics {
	lastHandInferenceMs: number | null
	lastClassifierInferenceMs: number | null
	lastFrameAt: number | null
	preprocessedVectorLength: number | null
}

export interface GestureLogEntry {
	id: string
	timestamp: Date
	namespace: string
	message: string
	level: GestureLogLevel
	details?: unknown
}

export interface GestureRuntimeState extends GesturePredictionState {
	enabled: boolean
	initializing: boolean
	isSupported: boolean
	error: string | null
	warning: string | null
	cameraState: CameraState
	trackingState: TrackingState
	modelState: ModelState
	cursorVisibility: CursorVisibility
	handPresent: boolean
	videoSize: GestureVideoSize | null
	rawCursorPoint: GesturePoint | null
	cursorPoint: GesturePoint | null
	rawPanGestureActive: boolean
	stablePanGestureActive: boolean
	panLifecycleState: PanLifecycleState
	lastPanAnchorPoint: GesturePoint | null
	lastPanDelta: GesturePoint | null
	lastPanEvent: string | null
	rawDrawGestureActive: boolean
	stableDrawGestureActive: boolean
	drawLifecycleState: DrawLifecycleState
	strokeState: StrokeState
	nativeSessionActive: boolean
	activePointerId: number | null
	currentToolId: string | null
	previousToolId: string | null
	lastDispatchedEvent: string | null
	lastDispatchScreenPoint: GesturePoint | null
	lastDispatchPagePoint: GesturePoint | null
	lastDrawEvent: string | null
	stream: MediaStream | null
	metrics: GestureMetrics
}
