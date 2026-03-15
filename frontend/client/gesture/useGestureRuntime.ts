import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, TLPointerEventInfo } from 'tldraw'
import {
	CURSOR_GESTURE_ID,
	DRAW_GESTURE_ID,
	ERASER_GESTURE_ID,
	FIT_VIEW_GESTURE_ID,
	GESTURE_ASSETS,
	GESTURE_DEBUG_MODE,
	GESTURE_THRESHOLDS,
	MIC_TOGGLE_GESTURE_ID,
	PAN_GESTURE_ID,
	ZOOM_GESTURE_ID,
} from './config'
import { loadTfLiteRuntime } from './runtime/loadTfLiteRuntime'
import { preprocessLandmarksForClassifier } from './runtime/preprocess'
import {
	CursorLockReason,
	DrawLifecycleState,
	EraseLifecycleState,
	GestureCommandId,
	GestureCommandResult,
	GestureInteractionMode,
	GesturePoint,
	GestureRuntimeCallbacks,
	GestureRuntimeState,
	GestureVideoSize,
	ModelState,
	PanLifecycleState,
	StrokeState,
	TrackingState,
	ZoomLifecycleState,
} from './types'
import { clamp, smoothPoint } from './utils/math'
import { gestureLog } from './utils/logger'

const INITIAL_STATE: GestureRuntimeState = {
	enabled: false,
	initializing: false,
	isSupported: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
	error: null,
	warning: null,
	cameraState: 'idle',
	trackingState: 'no-hand',
	modelState: 'uninitialized',
	cursorVisibility: 'hidden',
	interactionMode: 'idle',
	cursorLockReason: 'none',
	handPresent: false,
	videoSize: null,
	rawGestureId: null,
	rawGestureLabel: null,
	rawConfidence: null,
	stableGestureId: null,
	stableGestureLabel: null,
	rawCursorPoint: null,
	cursorPoint: null,
	rawZoomGestureActive: false,
	stableZoomGestureActive: false,
	zoomLifecycleState: 'idle',
	lastZoomAnchorScreenPoint: null,
	lastZoomAnchorPagePoint: null,
	lastZoomControlPoint: null,
	lastZoomDeltaY: null,
	lastZoomEvent: null,
	lastZoomLevel: null,
	rawPanGestureActive: false,
	stablePanGestureActive: false,
	panLifecycleState: 'idle',
	lastPanAnchorPoint: null,
	lastPanDelta: null,
	lastPanEvent: null,
	rawDrawGestureActive: false,
	stableDrawGestureActive: false,
	drawLifecycleState: 'idle',
	rawEraserGestureActive: false,
	stableEraserGestureActive: false,
	eraseLifecycleState: 'idle',
	strokeState: 'idle',
	nativeSessionActive: false,
	activePointerId: null,
	currentToolId: null,
	previousToolId: null,
	lastDispatchedEvent: null,
	lastDispatchScreenPoint: null,
	lastDispatchPagePoint: null,
	lastDrawEvent: null,
	lastEraseEvent: null,
	micMuted: false,
	lastCommandId: null,
	lastCommandLabel: null,
	lastCommandStatus: null,
	lastCommandReason: null,
	lastCommandAt: null,
	stream: null,
	metrics: {
		lastHandInferenceMs: null,
		lastClassifierInferenceMs: null,
		lastFrameAt: null,
		preprocessedVectorLength: null,
	},
}

type LoadedTfLiteRuntime = Awaited<ReturnType<typeof loadTfLiteRuntime>>
type LoadedTfLiteModel = Awaited<ReturnType<LoadedTfLiteRuntime['tflite']['loadTFLiteModel']>>
type GestureDispatchEventName = TLPointerEventInfo['name'] | 'cancel'
type PointerToolId = 'draw' | 'eraser'
const GESTURE_POINTER_ID = 1

async function waitForVideoMetadata(video: HTMLVideoElement) {
	if (video.readyState >= 1) return

	await new Promise<void>((resolve) => {
		const onLoadedMetadata = () => {
			video.removeEventListener('loadedmetadata', onLoadedMetadata)
			resolve()
		}
		video.addEventListener('loadedmetadata', onLoadedMetadata)
	})
}

async function loadLabels() {
	const response = await fetch(GESTURE_ASSETS.classifierLabelsPath)
	if (!response.ok) {
		throw new Error(`Failed to load gesture labels: ${response.status}`)
	}

	const text = await response.text()
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
}

function getArgMax(values: number[]) {
	let maxIndex = 0
	let maxValue = Number.NEGATIVE_INFINITY

	for (let index = 0; index < values.length; index++) {
		const value = values[index]
		if (value > maxValue) {
			maxValue = value
			maxIndex = index
		}
	}

	return {
		index: maxIndex,
		value: maxValue,
	}
}

function toCanvasPoint(
	canvasSize: GestureVideoSize,
	videoSize: GestureVideoSize,
	pixelPoint: GesturePoint
): GesturePoint {
	return {
		x: (pixelPoint.x / videoSize.width) * canvasSize.width,
		y: (pixelPoint.y / videoSize.height) * canvasSize.height,
	}
}

function buildGesturePointerEvent(
	name: TLPointerEventInfo['name'],
	point: GesturePoint
): TLPointerEventInfo {
	return {
		type: 'pointer',
		name,
		button: 0,
		isPen: true,
		shiftKey: false,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		accelKey: false,
		point,
		pointerId: GESTURE_POINTER_ID,
		target: 'canvas',
	}
}

export function useGestureRuntime(
	canvasRef: RefObject<HTMLDivElement | null>,
	enabled: boolean,
	editor: Editor,
	callbacks?: GestureRuntimeCallbacks
) {
	const [state, setState] = useState<GestureRuntimeState>({
		...INITIAL_STATE,
		enabled,
	})

	const animationFrameRef = useRef<number | null>(null)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const handLandmarkerRef = useRef<HandLandmarker | null>(null)
	const tfRuntimeRef = useRef<LoadedTfLiteRuntime | null>(null)
	const classifierRef = useRef<LoadedTfLiteModel | null>(null)
	const labelsRef = useRef<string[]>([])
	const cursorRef = useRef<GesturePoint | null>(null)
	const lastSeenHandAtRef = useRef<number | null>(null)
	const cursorStableHitsRef = useRef(0)
	const cursorStableMissesRef = useRef(0)
	const zoomStableHitsRef = useRef(0)
	const zoomStableMissesRef = useRef(0)
	const panStableHitsRef = useRef(0)
	const panStableMissesRef = useRef(0)
	const drawStableHitsRef = useRef(0)
	const drawStableMissesRef = useRef(0)
	const eraserStableHitsRef = useRef(0)
	const eraserStableMissesRef = useRef(0)
	const fitViewStableHitsRef = useRef(0)
	const fitViewStableMissesRef = useRef(0)
	const micToggleStableHitsRef = useRef(0)
	const micToggleStableMissesRef = useRef(0)
	const rawGestureIdRef = useRef<number | null>(null)
	const rawZoomGestureActiveRef = useRef(false)
	const stableCursorActiveRef = useRef(false)
	const stableZoomActiveRef = useRef(false)
	const stablePanActiveRef = useRef(false)
	const stableDrawActiveRef = useRef(false)
	const stableEraserActiveRef = useRef(false)
	const activePointerToolRef = useRef<PointerToolId | null>(null)
	const trackingStateRef = useRef<TrackingState>('no-hand')
	const labelWarningRef = useRef<string | null>(null)
	const zoomLifecycleStateRef = useRef<ZoomLifecycleState>('idle')
	const panLifecycleStateRef = useRef<PanLifecycleState>('idle')
	const drawLifecycleStateRef = useRef<DrawLifecycleState>('idle')
	const eraseLifecycleStateRef = useRef<EraseLifecycleState>('idle')
	const strokeStateRef = useRef<StrokeState>('idle')
	const lastZoomAnchorScreenPointRef = useRef<GesturePoint | null>(null)
	const lastZoomAnchorPagePointRef = useRef<GesturePoint | null>(null)
	const lastZoomControlPointRef = useRef<GesturePoint | null>(null)
	const lastZoomStartControlYRef = useRef<number | null>(null)
	const lastZoomStartLevelRef = useRef<number | null>(null)
	const lastZoomDeltaYRef = useRef<number | null>(null)
	const lastZoomEventRef = useRef<string | null>(null)
	const lastZoomLevelRef = useRef<number | null>(null)
	const lastPanAnchorPointRef = useRef<GesturePoint | null>(null)
	const lastPanDeltaRef = useRef<GesturePoint | null>(null)
	const lastPanEventRef = useRef<string | null>(null)
	const previousToolIdRef = useRef<string | null>(null)
	const lastDispatchedEventRef = useRef<GestureDispatchEventName | null>(null)
	const lastDispatchScreenPointRef = useRef<GesturePoint | null>(null)
	const lastDispatchPagePointRef = useRef<GesturePoint | null>(null)
	const lastDrawEventRef = useRef<string | null>(null)
	const lastEraseEventRef = useRef<string | null>(null)
	const lastPointerToolPointRef = useRef<GesturePoint | null>(null)
	const commandLatchRef = useRef<GestureCommandId | null>(null)
	const lastFitViewCommandAtRef = useRef<number | null>(null)
	const lastMicToggleCommandAtRef = useRef<number | null>(null)
	const lastCommandIdRef = useRef<GestureCommandId | null>(null)
	const lastCommandLabelRef = useRef<string | null>(null)
	const lastCommandStatusRef = useRef<GestureRuntimeState['lastCommandStatus']>(null)
	const lastCommandReasonRef = useRef<string | null>(null)
	const lastCommandAtRef = useRef<number | null>(null)
	const fitViewCallbackRef = useRef<GestureRuntimeCallbacks['onFitView']>(callbacks?.onFitView)
	const toggleMicMuteCallbackRef = useRef<GestureRuntimeCallbacks['onToggleMicMute']>(
		callbacks?.onToggleMicMute
	)
	const micMutedRef = useRef(Boolean(callbacks?.micMuted))

	const isSupported = useMemo(() => {
		return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
	}, [])

	useEffect(() => {
		fitViewCallbackRef.current = callbacks?.onFitView
	}, [callbacks?.onFitView])

	useEffect(() => {
		toggleMicMuteCallbackRef.current = callbacks?.onToggleMicMute
	}, [callbacks?.onToggleMicMute])

	useEffect(() => {
		micMutedRef.current = Boolean(callbacks?.micMuted)
		setState((previous) => ({
			...previous,
			micMuted: Boolean(callbacks?.micMuted),
		}))
	}, [callbacks?.micMuted])

	const getInteractionMode = (): GestureInteractionMode => {
		if (stableEraserActiveRef.current) return 'erase'
		if (stableDrawActiveRef.current) return 'draw'
		if (stableZoomActiveRef.current) return 'zoom'
		if (stablePanActiveRef.current) return 'pan'
		if (stableCursorActiveRef.current) return 'cursor'
		return 'idle'
	}

	const getCursorLockReason = (cursorFrozenForTrackingLoss: boolean): CursorLockReason => {
		if (stableZoomActiveRef.current) return 'zoom-anchor'
		if (cursorFrozenForTrackingLoss) return 'tracking-loss'
		return 'none'
	}

	useEffect(() => {
		if (!enabled) {
			setState((previous) => ({
				...INITIAL_STATE,
				isSupported,
				enabled: false,
				micMuted: micMutedRef.current,
			}))
			return
		}

		if (!isSupported) {
			setState((previous) => ({
				...previous,
				enabled: true,
				error: 'Camera access is not supported in this browser.',
				cameraState: 'error',
			}))
			return
		}

		let cancelled = false

		const syncDispatchDiagnostics = (
			eventName: GestureDispatchEventName,
			screenPoint: GesturePoint | null
		) => {
			lastDispatchedEventRef.current = eventName
			lastDispatchScreenPointRef.current = screenPoint
			lastDispatchPagePointRef.current = screenPoint ? editor.screenToPage(screenPoint) : null
		}

		const restorePreviousTool = () => {
			const previousToolId = previousToolIdRef.current
			if (previousToolId && editor.getCurrentToolId() !== previousToolId) {
				editor.setCurrentTool(previousToolId)
				gestureLog(
					'draw',
					'Restored previous tool',
					{ previousToolId },
					{ debugMode: GESTURE_DEBUG_MODE }
				)
			}

			previousToolIdRef.current = null
		}

		const setCommandDiagnostics = (
			commandId: GestureCommandId,
			label: string,
			status: GestureRuntimeState['lastCommandStatus'],
			reason: string,
			timestamp: number | null = performance.now()
		) => {
			lastCommandIdRef.current = commandId
			lastCommandLabelRef.current = label
			lastCommandStatusRef.current = status
			lastCommandReasonRef.current = reason
			lastCommandAtRef.current = timestamp
		}

		const setPointerToolLifecycle = (
			toolId: PointerToolId,
			lifecycleState: DrawLifecycleState | EraseLifecycleState
		) => {
			if (toolId === 'draw') {
				drawLifecycleStateRef.current = lifecycleState as DrawLifecycleState
				return
			}

			eraseLifecycleStateRef.current = lifecycleState as EraseLifecycleState
		}

		const setPointerToolEvent = (toolId: PointerToolId, message: string) => {
			if (toolId === 'draw') {
				lastDrawEventRef.current = message
				return
			}

			lastEraseEventRef.current = message
		}

		const startZoomSession = (anchorScreenPoint: GesturePoint, controlPoint: GesturePoint) => {
			const anchorPagePoint = editor.screenToPage(anchorScreenPoint)
			const camera = editor.getCamera()

			cursorRef.current = anchorScreenPoint
			lastZoomAnchorScreenPointRef.current = anchorScreenPoint
			lastZoomAnchorPagePointRef.current = anchorPagePoint
			lastZoomControlPointRef.current = controlPoint
			lastZoomStartControlYRef.current = controlPoint.y
			lastZoomStartLevelRef.current = camera.z
			lastZoomDeltaYRef.current = 0
			lastZoomLevelRef.current = camera.z
			zoomLifecycleStateRef.current = 'zooming'
			lastZoomEventRef.current = 'zoom entered'

			gestureLog(
				'zoom',
				'Zoom gesture became active',
				{ gestureId: ZOOM_GESTURE_ID, anchorScreenPoint, anchorPagePoint, controlPoint },
				{
					debugMode: GESTURE_DEBUG_MODE,
				}
			)
			gestureLog('zoom', 'Cursor frozen for zoom anchor', { anchorScreenPoint }, {
				debugMode: GESTURE_DEBUG_MODE,
			})
		}

		const updateZoomSession = (controlPoint: GesturePoint) => {
			const zoomStartY = lastZoomStartControlYRef.current
			const zoomStartLevel = lastZoomStartLevelRef.current

			if (zoomStartY === null || zoomStartLevel === null) {
				lastZoomEventRef.current = 'zoom anchor unavailable'
				gestureLog('zoom', 'Zoom anchor unavailable during update', undefined, {
					debugMode: GESTURE_DEBUG_MODE,
					level: 'warn',
				})
				return
			}

			const deltaY = controlPoint.y - zoomStartY
			const effectiveDeltaY =
				Math.abs(deltaY) > GESTURE_THRESHOLDS.zoomDeadzonePx
					? deltaY - Math.sign(deltaY) * GESTURE_THRESHOLDS.zoomDeadzonePx
					: 0
			const nextZoom = clamp(
				zoomStartLevel - effectiveDeltaY * GESTURE_THRESHOLDS.zoomSensitivity,
				GESTURE_THRESHOLDS.zoomMin,
				GESTURE_THRESHOLDS.zoomMax
			)
			const camera = editor.getCamera()

			editor.setCamera({
				x: camera.x,
				y: camera.y,
				z: nextZoom,
			})

			lastZoomControlPointRef.current = controlPoint
			lastZoomDeltaYRef.current = effectiveDeltaY
			lastZoomLevelRef.current = nextZoom
			lastZoomEventRef.current = effectiveDeltaY === 0 ? 'zoom holding' : 'zoom updated'
		}

		const finishZoomSession = (reason: string) => {
			if (zoomLifecycleStateRef.current === 'idle' && !stableZoomActiveRef.current) return

			zoomLifecycleStateRef.current = 'idle'
			lastZoomEventRef.current = reason
			lastZoomAnchorScreenPointRef.current = null
			lastZoomAnchorPagePointRef.current = null
			lastZoomControlPointRef.current = null
			lastZoomStartControlYRef.current = null
			lastZoomStartLevelRef.current = null
			lastZoomDeltaYRef.current = null
			lastZoomLevelRef.current = editor.getCamera().z

			gestureLog('zoom', 'Zoom session ended', { reason }, {
				debugMode: GESTURE_DEBUG_MODE,
			})
			gestureLog('zoom', 'Cursor tracking resumed after zoom', { reason }, {
				debugMode: GESTURE_DEBUG_MODE,
			})
		}

		const startPanSession = (screenPoint: GesturePoint) => {
			lastPanAnchorPointRef.current = screenPoint
			lastPanDeltaRef.current = { x: 0, y: 0 }
			panLifecycleStateRef.current = 'panning'
			lastPanEventRef.current = 'pan entered'
			gestureLog('pan', 'Pan gesture became active', { screenPoint }, {
				debugMode: GESTURE_DEBUG_MODE,
			})
		}

		const updatePanSession = (screenPoint: GesturePoint) => {
			const previousAnchor = lastPanAnchorPointRef.current
			if (!previousAnchor) {
				lastPanAnchorPointRef.current = screenPoint
				lastPanDeltaRef.current = { x: 0, y: 0 }
				return
			}

			const delta = {
				x: screenPoint.x - previousAnchor.x,
				y: screenPoint.y - previousAnchor.y,
			}
			const distance = Math.hypot(delta.x, delta.y)
			if (distance > GESTURE_THRESHOLDS.panReanchorDistance) {
				lastPanAnchorPointRef.current = screenPoint
				lastPanDeltaRef.current = { x: 0, y: 0 }
				lastPanEventRef.current = 'pan reanchored'
				gestureLog('pan', 'Pan anchor reanchored after large jump', { screenPoint, distance }, {
					debugMode: GESTURE_DEBUG_MODE,
					level: 'warn',
				})
				return
			}

			const camera = editor.getCamera()
			editor.setCamera({
				x: camera.x - (delta.x / camera.z) * GESTURE_THRESHOLDS.panSensitivity,
				y: camera.y - (delta.y / camera.z) * GESTURE_THRESHOLDS.panSensitivity,
				z: camera.z,
			})
			lastPanAnchorPointRef.current = screenPoint
			lastPanDeltaRef.current = delta
			lastPanEventRef.current = 'pan updated'
		}

		const finishPanSession = (reason: string) => {
			if (panLifecycleStateRef.current === 'idle' && !stablePanActiveRef.current) return

			panLifecycleStateRef.current = 'idle'
			lastPanEventRef.current = reason
			lastPanAnchorPointRef.current = null
			lastPanDeltaRef.current = null
			gestureLog('pan', 'Pan session ended', { reason }, {
				debugMode: GESTURE_DEBUG_MODE,
			})
		}

		const dispatchGesturePointer = (name: TLPointerEventInfo['name'], screenPoint: GesturePoint) => {
			editor.focus({ focusContainer: false })
			editor.updatePointer({
				point: screenPoint,
				pointerId: GESTURE_POINTER_ID,
				button: 0,
				isPen: true,
				immediate: true,
			})
			editor.dispatch(buildGesturePointerEvent(name, screenPoint))
			syncDispatchDiagnostics(name, screenPoint)

			if (name !== 'pointer_move') {
				const namespace = activePointerToolRef.current ?? 'draw'
				gestureLog(
					namespace,
					'Dispatched native pointer event',
					{ name, screenPoint },
					{ debugMode: GESTURE_DEBUG_MODE }
				)
			}
		}

		const startNativePointerToolSession = (toolId: PointerToolId, screenPoint: GesturePoint) => {
			if (activePointerToolRef.current) return

			previousToolIdRef.current = editor.getCurrentToolId()
			activePointerToolRef.current = toolId
			strokeStateRef.current = 'arming'
			setPointerToolLifecycle(toolId, toolId === 'draw' ? 'drawing' : 'erasing')
			setPointerToolEvent(toolId, `arming native ${toolId} session`)

			if (editor.getCurrentToolId() !== toolId) {
				editor.setCurrentTool(toolId)
			}

			dispatchGesturePointer('pointer_down', screenPoint)
			lastPointerToolPointRef.current = screenPoint
			strokeStateRef.current = 'pointerDownSent'
			setPointerToolEvent(toolId, `native ${toolId} started`)
		}

		const streamNativePointerToolSession = (screenPoint: GesturePoint) => {
			if (!activePointerToolRef.current) return

			const previousPoint = lastPointerToolPointRef.current
			if (previousPoint) {
				const distance = Math.hypot(
					screenPoint.x - previousPoint.x,
					screenPoint.y - previousPoint.y
				)
				if (distance < GESTURE_THRESHOLDS.pointerToolMinPointDistance) {
					return
				}
			}

			dispatchGesturePointer('pointer_move', screenPoint)
			lastPointerToolPointRef.current = screenPoint
			strokeStateRef.current = 'streaming'
			setPointerToolEvent(activePointerToolRef.current, `native ${activePointerToolRef.current} streaming`)
		}

		const finishNativePointerToolSession = (reason: string) => {
			const activeToolId = activePointerToolRef.current
			if (!activeToolId) return

			const screenPoint = lastDispatchScreenPointRef.current ?? cursorRef.current
			strokeStateRef.current = 'finishing'
			setPointerToolLifecycle(activeToolId, activeToolId === 'draw' ? 'drawEnding' : 'eraseEnding')

			if (screenPoint) {
				dispatchGesturePointer('pointer_up', screenPoint)
			}

			activePointerToolRef.current = null
			lastPointerToolPointRef.current = null
			restorePreviousTool()
			setPointerToolLifecycle(activeToolId, 'idle')
			strokeStateRef.current = 'idle'
			setPointerToolEvent(activeToolId, reason)
		}

		const cancelNativePointerToolSession = (reason: string) => {
			const activeToolId = activePointerToolRef.current
			if (!activeToolId) return

			editor.cancel()
			activePointerToolRef.current = null
			lastPointerToolPointRef.current = null
			syncDispatchDiagnostics('cancel', lastDispatchScreenPointRef.current)
			setPointerToolLifecycle(activeToolId, 'idle')
			strokeStateRef.current = 'cancelled'
			setPointerToolEvent(activeToolId, reason)
			restorePreviousTool()

			gestureLog(activeToolId, `Cancelled native ${activeToolId} session`, { reason }, {
				debugMode: GESTURE_DEBUG_MODE,
				level: 'warn',
			})
		}

		const isContinuousGestureActive = () =>
			stableEraserActiveRef.current ||
			stableDrawActiveRef.current ||
			stableZoomActiveRef.current ||
			stablePanActiveRef.current

		const tryFireCommand = (
			commandId: GestureCommandId,
			commandGestureId: number,
			cooldownMs: number,
			callback: (() => GestureCommandResult) | undefined,
			lastTriggeredAtRef: { current: number | null }
		) => {
			const label = labelsRef.current[commandGestureId] ?? `Gesture ${commandGestureId}`
			const now = performance.now()
			const lastTriggeredAt = lastTriggeredAtRef.current
			if (lastTriggeredAt !== null && now - lastTriggeredAt < cooldownMs) {
				commandLatchRef.current = commandId
				setCommandDiagnostics(commandId, label, 'cooldown', 'Command cooldown active', now)
				return
			}

			const result = callback?.() ?? {
				applied: false,
				reason: 'No command handler configured',
			}
			commandLatchRef.current = commandId
			setCommandDiagnostics(
				commandId,
				label,
				result.applied ? 'fired' : 'blocked',
				result.reason,
				now
			)

			if (result.applied) {
				lastTriggeredAtRef.current = now
				gestureLog('command', 'Gesture command fired', { commandId, label, reason: result.reason }, {
					debugMode: GESTURE_DEBUG_MODE,
				})
				return
			}

			gestureLog(
				'command',
				'Gesture command blocked',
				{ commandId, label, reason: result.reason },
				{ debugMode: GESTURE_DEBUG_MODE, level: 'warn' }
			)
		}

		const processDiscreteCommand = (
			commandId: GestureCommandId,
			commandGestureId: number,
			gestureActive: boolean,
			hitsRef: { current: number },
			missesRef: { current: number },
			stableFrames: number,
			cooldownMs: number,
			callback: (() => GestureCommandResult) | undefined,
			lastTriggeredAtRef: { current: number | null }
		) => {
			const label = labelsRef.current[commandGestureId] ?? `Gesture ${commandGestureId}`

			if (isContinuousGestureActive()) {
				hitsRef.current = 0
				missesRef.current = 0
				return
			}

			if (gestureActive) {
				hitsRef.current += 1
				missesRef.current = 0
			} else {
				hitsRef.current = 0
				missesRef.current += 1
				if (
					commandLatchRef.current === commandId &&
					missesRef.current >= GESTURE_THRESHOLDS.commandMissFrames
				) {
					commandLatchRef.current = null
					setCommandDiagnostics(commandId, label, 'released', 'Command rearmed after release')
				}
				return
			}

			if (commandLatchRef.current === commandId) {
				return
			}

			if (hitsRef.current < stableFrames) {
				return
			}

			tryFireCommand(commandId, commandGestureId, cooldownMs, callback, lastTriggeredAtRef)
		}

		const cleanup = () => {
			cancelNativePointerToolSession('gesture runtime cleanup')
			finishZoomSession('gesture runtime cleanup')
			finishPanSession('gesture runtime cleanup')

			if (animationFrameRef.current !== null) {
				cancelAnimationFrame(animationFrameRef.current)
				animationFrameRef.current = null
			}

			handLandmarkerRef.current?.close()
			handLandmarkerRef.current = null
			classifierRef.current = null
			tfRuntimeRef.current = null

			if (videoRef.current) {
				videoRef.current.pause()
				videoRef.current.srcObject = null
				videoRef.current = null
			}

			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) {
					track.stop()
				}
				streamRef.current = null
			}

			cursorRef.current = null
			lastSeenHandAtRef.current = null
			cursorStableHitsRef.current = 0
			cursorStableMissesRef.current = 0
			zoomStableHitsRef.current = 0
			zoomStableMissesRef.current = 0
			panStableHitsRef.current = 0
			panStableMissesRef.current = 0
			drawStableHitsRef.current = 0
			drawStableMissesRef.current = 0
			eraserStableHitsRef.current = 0
			eraserStableMissesRef.current = 0
			fitViewStableHitsRef.current = 0
			fitViewStableMissesRef.current = 0
			micToggleStableHitsRef.current = 0
			micToggleStableMissesRef.current = 0
			rawGestureIdRef.current = null
			rawZoomGestureActiveRef.current = false
			stableCursorActiveRef.current = false
			stableZoomActiveRef.current = false
			stablePanActiveRef.current = false
			stableDrawActiveRef.current = false
			stableEraserActiveRef.current = false
			activePointerToolRef.current = null
			trackingStateRef.current = 'no-hand'
			labelWarningRef.current = null
			zoomLifecycleStateRef.current = 'idle'
			panLifecycleStateRef.current = 'idle'
			drawLifecycleStateRef.current = 'idle'
			eraseLifecycleStateRef.current = 'idle'
			strokeStateRef.current = 'idle'
			lastZoomAnchorScreenPointRef.current = null
			lastZoomAnchorPagePointRef.current = null
			lastZoomControlPointRef.current = null
			lastZoomStartControlYRef.current = null
			lastZoomStartLevelRef.current = null
			lastZoomDeltaYRef.current = null
			lastZoomEventRef.current = null
			lastZoomLevelRef.current = null
			lastPanAnchorPointRef.current = null
			lastPanDeltaRef.current = null
			lastPanEventRef.current = null
			previousToolIdRef.current = null
			lastDispatchedEventRef.current = null
			lastDispatchScreenPointRef.current = null
			lastDispatchPagePointRef.current = null
			lastDrawEventRef.current = null
			lastEraseEventRef.current = null
			lastPointerToolPointRef.current = null
			commandLatchRef.current = null
			lastFitViewCommandAtRef.current = null
			lastMicToggleCommandAtRef.current = null
			lastCommandIdRef.current = null
			lastCommandLabelRef.current = null
			lastCommandStatusRef.current = null
			lastCommandReasonRef.current = null
			lastCommandAtRef.current = null
		}

		async function initialize() {
			try {
				gestureLog('host', 'Initializing gesture runtime', undefined, {
					debugMode: GESTURE_DEBUG_MODE,
				})

				setState((previous) => ({
					...previous,
					enabled: true,
					initializing: true,
					error: null,
					warning: null,
					cameraState: 'requesting',
					modelState: 'loading',
				}))

				const stream = await navigator.mediaDevices.getUserMedia({
					video: {
						width: GESTURE_THRESHOLDS.cameraWidth,
						height: GESTURE_THRESHOLDS.cameraHeight,
						facingMode: 'user',
					},
					audio: false,
				})

				if (cancelled) {
					for (const track of stream.getTracks()) {
						track.stop()
					}
					return
				}

				streamRef.current = stream
				gestureLog('camera', 'Camera stream acquired', undefined, {
					debugMode: GESTURE_DEBUG_MODE,
				})

				const video = document.createElement('video')
				video.autoplay = true
				video.muted = true
				video.playsInline = true
				video.srcObject = stream
				videoRef.current = video

				await video.play()
				await waitForVideoMetadata(video)

				const videoSize = {
					width: video.videoWidth,
					height: video.videoHeight,
				}

				const vision = await FilesetResolver.forVisionTasks(GESTURE_ASSETS.mediapipeWasmPath)
				const handLandmarker = await HandLandmarker.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath: GESTURE_ASSETS.handLandmarkerModelPath,
					},
					numHands: 1,
					runningMode: 'VIDEO',
					minHandDetectionConfidence: 0.7,
					minTrackingConfidence: 0.5,
				})

				const tfRuntime = await loadTfLiteRuntime()
				await tfRuntime.tf.setBackend('cpu')
				await tfRuntime.tf.ready()
				tfRuntime.tflite.setWasmPath(GESTURE_ASSETS.tfliteWasmPath)

				const [classifier, labels] = await Promise.all([
					tfRuntime.tflite.loadTFLiteModel(GESTURE_ASSETS.classifierModelPath, { numThreads: 1 }),
					loadLabels(),
				])

				if (cancelled) {
					handLandmarker.close()
					return
				}

				handLandmarkerRef.current = handLandmarker
				tfRuntimeRef.current = tfRuntime
				classifierRef.current = classifier
				labelsRef.current = labels

				gestureLog(
					'classifier',
					'Gesture classifier ready',
					{ labels: labels.length },
					{ debugMode: GESTURE_DEBUG_MODE }
				)

				setState((previous) => ({
					...previous,
					enabled: true,
					initializing: false,
					error: null,
					warning: null,
					cameraState: 'ready',
					modelState: 'ready' as ModelState,
					stream,
					videoSize,
				}))

				const tick = async () => {
					if (cancelled) return

					const videoElement = videoRef.current
					const canvasElement = canvasRef.current
					const currentHandLandmarker = handLandmarkerRef.current
					const tfRuntime = tfRuntimeRef.current
					const classifierModel = classifierRef.current

					if (!videoElement || !canvasElement || !currentHandLandmarker || !classifierModel || !tfRuntime) {
						animationFrameRef.current = requestAnimationFrame(() => {
							void tick()
						})
						return
					}

					const frameAt = performance.now()

					if (videoElement.readyState < 2) {
						animationFrameRef.current = requestAnimationFrame(() => {
							void tick()
						})
						return
					}

					const handInferenceStart = performance.now()
					const handResult = currentHandLandmarker.detectForVideo(videoElement, frameAt)
					const handInferenceMs = performance.now() - handInferenceStart
					const firstHand = handResult.landmarks[0]

					if (!firstHand) {
						const lastSeenHandAt = lastSeenHandAtRef.current
						const cursorFrozen =
							lastSeenHandAt !== null &&
							cursorRef.current !== null &&
							frameAt - lastSeenHandAt <= GESTURE_THRESHOLDS.cursorFreezeMs

						if (trackingStateRef.current !== 'lost') {
							gestureLog('tracking', 'Hand tracking lost', undefined, {
								debugMode: GESTURE_DEBUG_MODE,
							})
						}

						trackingStateRef.current = 'lost'
						cursorStableHitsRef.current = 0
						cursorStableMissesRef.current = 0
						zoomStableHitsRef.current = 0
						zoomStableMissesRef.current = 0
						panStableHitsRef.current = 0
						panStableMissesRef.current = 0
						drawStableHitsRef.current = 0
						drawStableMissesRef.current = 0
						eraserStableHitsRef.current = 0
						eraserStableMissesRef.current = 0
						fitViewStableHitsRef.current = 0
						fitViewStableMissesRef.current = 0
						micToggleStableHitsRef.current = 0
						micToggleStableMissesRef.current = 0
						rawZoomGestureActiveRef.current = false
						stableCursorActiveRef.current = false

						if (stableZoomActiveRef.current) {
							stableZoomActiveRef.current = false
							zoomLifecycleStateRef.current = 'zoomEnding'
							finishZoomSession('tracking lost during zoom')
							gestureLog('zoom', 'Tracking lost during zoom', undefined, {
								debugMode: GESTURE_DEBUG_MODE,
								level: 'warn',
							})
						}

						if (stablePanActiveRef.current) {
							stablePanActiveRef.current = false
							panLifecycleStateRef.current = 'panEnding'
							finishPanSession('tracking lost during pan')
							gestureLog('pan', 'Tracking lost during pan', undefined, {
								debugMode: GESTURE_DEBUG_MODE,
								level: 'warn',
							})
						}

						if (
							stableDrawActiveRef.current &&
							lastSeenHandAt !== null &&
							frameAt - lastSeenHandAt > GESTURE_THRESHOLDS.drawFinalizeLossMs
						) {
							stableDrawActiveRef.current = false
							cancelNativePointerToolSession('tracking lost during draw')
							gestureLog('draw', 'Tracking lost during draw', undefined, {
								debugMode: GESTURE_DEBUG_MODE,
							})
						}

						if (
							stableEraserActiveRef.current &&
							lastSeenHandAt !== null &&
							frameAt - lastSeenHandAt > GESTURE_THRESHOLDS.drawFinalizeLossMs
						) {
							stableEraserActiveRef.current = false
							cancelNativePointerToolSession('tracking lost during erase')
							gestureLog('eraser', 'Tracking lost during erase', undefined, {
								debugMode: GESTURE_DEBUG_MODE,
							})
						}

						setState((previous) => ({
							...previous,
							handPresent: false,
							trackingState: 'lost',
							interactionMode: getInteractionMode(),
							cursorLockReason: getCursorLockReason(cursorFrozen),
							rawGestureId: null,
							rawGestureLabel: null,
							rawConfidence: null,
							stableGestureId: null,
							stableGestureLabel: null,
							rawZoomGestureActive: false,
							stableZoomGestureActive: stableZoomActiveRef.current,
							zoomLifecycleState: zoomLifecycleStateRef.current,
							lastZoomAnchorScreenPoint: lastZoomAnchorScreenPointRef.current,
							lastZoomAnchorPagePoint: lastZoomAnchorPagePointRef.current,
							lastZoomControlPoint: lastZoomControlPointRef.current,
							lastZoomDeltaY: lastZoomDeltaYRef.current,
							lastZoomEvent: lastZoomEventRef.current,
							lastZoomLevel: lastZoomLevelRef.current,
							rawPanGestureActive: false,
							stablePanGestureActive: stablePanActiveRef.current,
							panLifecycleState: panLifecycleStateRef.current,
							lastPanAnchorPoint: lastPanAnchorPointRef.current,
							lastPanDelta: lastPanDeltaRef.current,
							lastPanEvent: lastPanEventRef.current,
							rawDrawGestureActive: false,
							stableDrawGestureActive: stableDrawActiveRef.current,
							drawLifecycleState: drawLifecycleStateRef.current,
							rawEraserGestureActive: false,
							stableEraserGestureActive: stableEraserActiveRef.current,
							eraseLifecycleState: eraseLifecycleStateRef.current,
							strokeState: strokeStateRef.current,
							nativeSessionActive: activePointerToolRef.current !== null,
							activePointerId: activePointerToolRef.current ? GESTURE_POINTER_ID : null,
							currentToolId: editor.getCurrentToolId(),
							previousToolId: previousToolIdRef.current,
							lastDispatchedEvent: lastDispatchedEventRef.current,
							lastDispatchScreenPoint: lastDispatchScreenPointRef.current,
							lastDispatchPagePoint: lastDispatchPagePointRef.current,
							lastDrawEvent: lastDrawEventRef.current,
							lastEraseEvent: lastEraseEventRef.current,
							micMuted: micMutedRef.current,
							lastCommandId: lastCommandIdRef.current,
							lastCommandLabel: lastCommandLabelRef.current,
							lastCommandStatus: lastCommandStatusRef.current,
							lastCommandReason: lastCommandReasonRef.current,
							lastCommandAt: lastCommandAtRef.current,
							cursorVisibility: cursorFrozen ? 'frozen' : 'hidden',
							rawCursorPoint: null,
							cursorPoint: cursorFrozen ? cursorRef.current : null,
							metrics: {
								...previous.metrics,
								lastFrameAt: frameAt,
								lastHandInferenceMs: handInferenceMs,
								lastClassifierInferenceMs: null,
								preprocessedVectorLength: null,
							},
						}))

						animationFrameRef.current = requestAnimationFrame(() => {
							void tick()
						})
						return
					}

					lastSeenHandAtRef.current = frameAt
					if (trackingStateRef.current !== 'tracking') {
						gestureLog('tracking', 'Hand detected', undefined, {
							debugMode: GESTURE_DEBUG_MODE,
						})
					}
					trackingStateRef.current = 'tracking'

					const { pixelLandmarks, preprocessed } = preprocessLandmarksForClassifier(
						firstHand,
						videoElement.videoWidth,
						videoElement.videoHeight
					)

					const classifierInferenceStart = performance.now()
					const inputTensor = tfRuntime.tf.tensor([preprocessed], [1, preprocessed.length], 'float32')
					const prediction = classifierModel.predict(inputTensor)
					const outputTensor = Array.isArray(prediction) ? prediction[0] : prediction
					const rawScores = Array.from(await outputTensor.data())
					inputTensor.dispose()
					outputTensor.dispose()
					const classifierInferenceMs = performance.now() - classifierInferenceStart

					const { index: rawGestureId, value: rawConfidence } = getArgMax(rawScores)
					if (labelsRef.current.length !== rawScores.length && labelWarningRef.current === null) {
						labelWarningRef.current = `Gesture label file has ${labelsRef.current.length} labels for ${rawScores.length} model outputs.`
						gestureLog(
							'classifier',
							'Gesture label count mismatch detected',
							{
								labelCount: labelsRef.current.length,
								outputCount: rawScores.length,
							},
							{
								debugMode: GESTURE_DEBUG_MODE,
								level: 'warn',
							}
						)
					}
					const rawGestureLabel =
						labelsRef.current[rawGestureId] ?? `Gesture ${rawGestureId}`
					const canvasRect = canvasElement.getBoundingClientRect()
					const indexTip = pixelLandmarks[8]
					const rawCursorLandmark = indexTip ?? pixelLandmarks[0]
					const rawCanvasPoint = rawCursorLandmark
						? toCanvasPoint(
								{ width: canvasRect.width, height: canvasRect.height },
								{ width: videoElement.videoWidth, height: videoElement.videoHeight },
								rawCursorLandmark
						  )
						: null
					const zoomControlCanvasPoint = rawCanvasPoint
					const rawZoomGestureActive = rawGestureId === ZOOM_GESTURE_ID
					rawZoomGestureActiveRef.current = rawZoomGestureActive

					if (rawGestureIdRef.current !== rawGestureId) {
						gestureLog(
							'classifier',
							'Raw gesture changed',
							{ rawGestureId, rawGestureLabel, rawConfidence },
							{ debugMode: GESTURE_DEBUG_MODE }
						)
					}
					rawGestureIdRef.current = rawGestureId

					const cursorGestureActive =
						rawGestureId === CURSOR_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.cursorConfidence
					const zoomGestureActive =
						rawGestureId === ZOOM_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.zoomConfidence
					const panGestureActive =
						rawGestureId === PAN_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.panConfidence
					const drawGestureActive =
						rawGestureId === DRAW_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.drawConfidence
					const eraserGestureActive =
						rawGestureId === ERASER_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.eraserConfidence
					const fitViewGestureActive =
						rawGestureId === FIT_VIEW_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.fitViewConfidence
					const micToggleGestureActive =
						rawGestureId === MIC_TOGGLE_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.micToggleConfidence

					if (cursorGestureActive) {
						cursorStableHitsRef.current += 1
						cursorStableMissesRef.current = 0
					} else {
						cursorStableHitsRef.current = 0
						cursorStableMissesRef.current += 1
					}

					if (
						zoomGestureActive &&
						(stableZoomActiveRef.current ||
							(!stablePanActiveRef.current &&
								!stableDrawActiveRef.current &&
								!stableEraserActiveRef.current))
					) {
						zoomStableHitsRef.current += 1
						zoomStableMissesRef.current = 0
					} else {
						zoomStableHitsRef.current = 0
						zoomStableMissesRef.current += 1
					}

					if (stableZoomActiveRef.current) {
						panStableHitsRef.current = 0
						panStableMissesRef.current = 0
					} else if (panGestureActive) {
						panStableHitsRef.current += 1
						panStableMissesRef.current = 0
					} else {
						panStableHitsRef.current = 0
						panStableMissesRef.current += 1
					}

					if (stableZoomActiveRef.current) {
						drawStableHitsRef.current = 0
						drawStableMissesRef.current = 0
					} else if (drawGestureActive) {
						drawStableHitsRef.current += 1
						drawStableMissesRef.current = 0
					} else {
						drawStableHitsRef.current = 0
						drawStableMissesRef.current += 1
					}

					if (stableZoomActiveRef.current) {
						eraserStableHitsRef.current = 0
						eraserStableMissesRef.current = 0
					} else if (eraserGestureActive) {
						eraserStableHitsRef.current += 1
						eraserStableMissesRef.current = 0
					} else {
						eraserStableHitsRef.current = 0
						eraserStableMissesRef.current += 1
					}

					if (!stableCursorActiveRef.current &&
						cursorStableHitsRef.current >= GESTURE_THRESHOLDS.cursorStableFrames
					) {
						stableCursorActiveRef.current = true
						gestureLog(
							'stability',
							'Cursor gesture became stable',
							{ rawConfidence },
							{ debugMode: GESTURE_DEBUG_MODE }
						)
					}

					if (stableCursorActiveRef.current &&
						cursorStableMissesRef.current >= GESTURE_THRESHOLDS.cursorMissFrames
					) {
						stableCursorActiveRef.current = false
						gestureLog('stability', 'Cursor gesture exited', undefined, {
							debugMode: GESTURE_DEBUG_MODE,
						})
					}

					if (
						!stableZoomActiveRef.current &&
						!stablePanActiveRef.current &&
						!stableDrawActiveRef.current &&
						!stableEraserActiveRef.current &&
						zoomStableHitsRef.current >= GESTURE_THRESHOLDS.zoomStableFrames
					) {
						stableZoomActiveRef.current = true
						zoomLifecycleStateRef.current = 'zoomArming'
						lastZoomEventRef.current = 'zoom gesture stable entered'
						gestureLog(
							'zoom',
							'Zoom gesture became stable',
							{ rawConfidence, zoomGestureId: ZOOM_GESTURE_ID },
							{ debugMode: GESTURE_DEBUG_MODE }
						)
					}

					if (
						stableZoomActiveRef.current &&
						zoomStableMissesRef.current >= GESTURE_THRESHOLDS.zoomMissFrames
					) {
						stableZoomActiveRef.current = false
						zoomLifecycleStateRef.current = 'zoomEnding'
						lastZoomEventRef.current = 'zoom gesture released'
						finishZoomSession('zoom gesture released')
					}

					if (!stablePanActiveRef.current &&
						!stableZoomActiveRef.current &&
						!stableDrawActiveRef.current &&
						!stableEraserActiveRef.current &&
						panStableHitsRef.current >= GESTURE_THRESHOLDS.panStableFrames
					) {
						stablePanActiveRef.current = true
						panLifecycleStateRef.current = 'panArming'
						lastPanEventRef.current = 'pan stable entered'
						gestureLog(
							'pan',
							'Pan gesture became stable',
							{ rawConfidence, panGestureId: PAN_GESTURE_ID },
							{ debugMode: GESTURE_DEBUG_MODE }
						)
					}

					if (stablePanActiveRef.current &&
						panStableMissesRef.current >= GESTURE_THRESHOLDS.panMissFrames
					) {
						stablePanActiveRef.current = false
						panLifecycleStateRef.current = 'panEnding'
						lastPanEventRef.current = 'pan stable exited'
						finishPanSession('pan gesture released')
					}

					if (!stableDrawActiveRef.current &&
						!stableZoomActiveRef.current &&
						!stablePanActiveRef.current &&
						!stableEraserActiveRef.current &&
						drawStableHitsRef.current >= GESTURE_THRESHOLDS.drawStableFrames
					) {
						stableDrawActiveRef.current = true
						drawLifecycleStateRef.current = 'drawArming'
						lastDrawEventRef.current = 'draw stable entered'
						gestureLog(
							'draw',
							'Draw gesture became stable',
							{ rawConfidence },
							{ debugMode: GESTURE_DEBUG_MODE }
						)
					}

					if (stableDrawActiveRef.current &&
						drawStableMissesRef.current >= GESTURE_THRESHOLDS.drawMissFrames
					) {
						stableDrawActiveRef.current = false
						drawLifecycleStateRef.current = 'drawEnding'
						lastDrawEventRef.current = 'draw stable exited'
						gestureLog('draw', 'Draw gesture exited', undefined, {
							debugMode: GESTURE_DEBUG_MODE,
						})
						finishNativePointerToolSession('draw gesture released')
					}

					if (!stableEraserActiveRef.current &&
						!stableZoomActiveRef.current &&
						!stablePanActiveRef.current &&
						!stableDrawActiveRef.current &&
						eraserStableHitsRef.current >= GESTURE_THRESHOLDS.eraserStableFrames
					) {
						stableEraserActiveRef.current = true
						eraseLifecycleStateRef.current = 'eraseArming'
						lastEraseEventRef.current = 'erase stable entered'
						gestureLog(
							'eraser',
							'Eraser gesture became stable',
							{ rawConfidence },
							{ debugMode: GESTURE_DEBUG_MODE }
						)
					}

					if (stableEraserActiveRef.current &&
						eraserStableMissesRef.current >= GESTURE_THRESHOLDS.eraserMissFrames
					) {
						stableEraserActiveRef.current = false
						eraseLifecycleStateRef.current = 'eraseEnding'
						lastEraseEventRef.current = 'erase stable exited'
						gestureLog('eraser', 'Eraser gesture exited', undefined, {
							debugMode: GESTURE_DEBUG_MODE,
						})
						finishNativePointerToolSession('erase gesture released')
					}

					processDiscreteCommand(
						'fit-view',
						FIT_VIEW_GESTURE_ID,
						fitViewGestureActive,
						fitViewStableHitsRef,
						fitViewStableMissesRef,
						GESTURE_THRESHOLDS.fitViewStableFrames,
						GESTURE_THRESHOLDS.fitViewCooldownMs,
						fitViewCallbackRef.current,
						lastFitViewCommandAtRef
					)
					processDiscreteCommand(
						'toggle-mic-mute',
						MIC_TOGGLE_GESTURE_ID,
						micToggleGestureActive,
						micToggleStableHitsRef,
						micToggleStableMissesRef,
						GESTURE_THRESHOLDS.commandStableFrames,
						GESTURE_THRESHOLDS.micToggleCooldownMs,
						toggleMicMuteCallbackRef.current,
						lastMicToggleCommandAtRef
					)

					const stableGestureId = stableEraserActiveRef.current
						? ERASER_GESTURE_ID
						: stableDrawActiveRef.current
						? DRAW_GESTURE_ID
						: stableZoomActiveRef.current
							? ZOOM_GESTURE_ID
							: stablePanActiveRef.current
								? PAN_GESTURE_ID
							: stableCursorActiveRef.current
								? CURSOR_GESTURE_ID
								: null
					const stableGestureLabel =
						stableGestureId !== null
							? labelsRef.current[stableGestureId] ?? `Gesture ${stableGestureId}`
							: null

					const trackedPointerActive =
						!stableZoomActiveRef.current &&
						(stableCursorActiveRef.current ||
							stablePanActiveRef.current ||
							stableDrawActiveRef.current ||
							stableEraserActiveRef.current)
					const nextTrackedCursorPoint =
						rawCanvasPoint && trackedPointerActive
							? smoothPoint(
									cursorRef.current,
									rawCanvasPoint,
									GESTURE_THRESHOLDS.cursorSmoothingAlpha
							  )
							: cursorRef.current

					if (trackedPointerActive && nextTrackedCursorPoint) {
						cursorRef.current = nextTrackedCursorPoint
					}

					if (stableZoomActiveRef.current) {
						const zoomAnchorScreenPoint =
							lastZoomAnchorScreenPointRef.current ??
							cursorRef.current ??
							rawCanvasPoint ??
							zoomControlCanvasPoint

						if (zoomAnchorScreenPoint && zoomControlCanvasPoint) {
							if (zoomLifecycleStateRef.current !== 'zooming') {
								startZoomSession(zoomAnchorScreenPoint, zoomControlCanvasPoint)
							} else {
								updateZoomSession(zoomControlCanvasPoint)
							}
						}
					} else if (stablePanActiveRef.current && nextTrackedCursorPoint) {
						if (panLifecycleStateRef.current !== 'panning') {
							startPanSession(nextTrackedCursorPoint)
						} else {
							updatePanSession(nextTrackedCursorPoint)
						}
					} else if (stableEraserActiveRef.current && nextTrackedCursorPoint) {
						if (activePointerToolRef.current !== 'eraser') {
							startNativePointerToolSession('eraser', nextTrackedCursorPoint)
						} else {
							streamNativePointerToolSession(nextTrackedCursorPoint)
						}
					} else if (stableDrawActiveRef.current && nextTrackedCursorPoint) {
						if (activePointerToolRef.current !== 'draw') {
							startNativePointerToolSession('draw', nextTrackedCursorPoint)
						} else {
							streamNativePointerToolSession(nextTrackedCursorPoint)
						}
					}

					const displayCursorPoint = stableZoomActiveRef.current
						? lastZoomAnchorScreenPointRef.current ?? cursorRef.current
						: trackedPointerActive
							? cursorRef.current
							: null
					const displayCursorVisibility = stableZoomActiveRef.current
						? 'frozen'
						: trackedPointerActive && displayCursorPoint
							? 'visible'
							: 'hidden'

					setState((previous) => ({
						...previous,
						enabled: true,
						handPresent: true,
						warning: labelWarningRef.current,
						trackingState: 'tracking',
						interactionMode: getInteractionMode(),
						cursorLockReason: getCursorLockReason(false),
						rawGestureId,
						rawGestureLabel,
						rawConfidence,
						stableGestureId,
						stableGestureLabel,
						rawZoomGestureActive,
						stableZoomGestureActive: stableZoomActiveRef.current,
						zoomLifecycleState: zoomLifecycleStateRef.current,
						lastZoomAnchorScreenPoint: lastZoomAnchorScreenPointRef.current,
						lastZoomAnchorPagePoint: lastZoomAnchorPagePointRef.current,
						lastZoomControlPoint: lastZoomControlPointRef.current,
						lastZoomDeltaY: lastZoomDeltaYRef.current,
						lastZoomEvent: lastZoomEventRef.current,
						lastZoomLevel: lastZoomLevelRef.current,
						rawPanGestureActive: rawGestureId === PAN_GESTURE_ID,
						stablePanGestureActive: stablePanActiveRef.current,
						panLifecycleState: panLifecycleStateRef.current,
						lastPanAnchorPoint: lastPanAnchorPointRef.current,
						lastPanDelta: lastPanDeltaRef.current,
						lastPanEvent: lastPanEventRef.current,
						rawDrawGestureActive: rawGestureId === DRAW_GESTURE_ID,
						stableDrawGestureActive: stableDrawActiveRef.current,
						drawLifecycleState: drawLifecycleStateRef.current,
						rawEraserGestureActive: rawGestureId === ERASER_GESTURE_ID,
						stableEraserGestureActive: stableEraserActiveRef.current,
						eraseLifecycleState: eraseLifecycleStateRef.current,
						strokeState: strokeStateRef.current,
						nativeSessionActive: activePointerToolRef.current !== null,
						activePointerId: activePointerToolRef.current ? GESTURE_POINTER_ID : null,
						currentToolId: editor.getCurrentToolId(),
						previousToolId: previousToolIdRef.current,
						lastDispatchedEvent: lastDispatchedEventRef.current,
						lastDispatchScreenPoint: lastDispatchScreenPointRef.current,
						lastDispatchPagePoint: lastDispatchPagePointRef.current,
						lastDrawEvent: lastDrawEventRef.current,
						lastEraseEvent: lastEraseEventRef.current,
						micMuted: micMutedRef.current,
						lastCommandId: lastCommandIdRef.current,
						lastCommandLabel: lastCommandLabelRef.current,
						lastCommandStatus: lastCommandStatusRef.current,
						lastCommandReason: lastCommandReasonRef.current,
						lastCommandAt: lastCommandAtRef.current,
						rawCursorPoint: rawCanvasPoint,
						cursorPoint: displayCursorPoint,
						cursorVisibility: displayCursorVisibility,
						metrics: {
							lastFrameAt: frameAt,
							lastHandInferenceMs: handInferenceMs,
							lastClassifierInferenceMs: classifierInferenceMs,
							preprocessedVectorLength: preprocessed.length,
						},
					}))

					animationFrameRef.current = requestAnimationFrame(() => {
						void tick()
					})
				}

				animationFrameRef.current = requestAnimationFrame(() => {
					void tick()
				})
			} catch (error) {
				const message =
					error instanceof Error ? error.message : 'Unknown gesture runtime error'

				if (
					error instanceof DOMException &&
					(error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
				) {
					setState((previous) => ({
						...previous,
						enabled: true,
						initializing: false,
						error: message,
						warning: labelWarningRef.current,
						cameraState: 'denied',
						modelState: previous.modelState === 'loading' ? 'uninitialized' : previous.modelState,
					}))
				} else {
					setState((previous) => ({
						...previous,
						enabled: true,
						initializing: false,
						error: message,
						warning: labelWarningRef.current,
						cameraState:
							previous.cameraState === 'requesting' ? 'error' : previous.cameraState,
						modelState: 'error',
					}))
				}

				gestureLog('host', 'Gesture runtime initialization failed', error, {
					debugMode: GESTURE_DEBUG_MODE,
					level: 'error',
				})
				cleanup()
			}
		}

		void initialize()

		return () => {
			cancelled = true
			cleanup()
		}
	}, [canvasRef, editor, enabled, isSupported])

	return state
}
