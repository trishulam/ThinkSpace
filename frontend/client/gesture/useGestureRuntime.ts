import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, TLPointerEventInfo } from 'tldraw'
import {
	CURSOR_GESTURE_ID,
	DRAW_GESTURE_ID,
	GESTURE_ASSETS,
	GESTURE_DEBUG_MODE,
	GESTURE_THRESHOLDS,
} from './config'
import { loadTfLiteRuntime } from './runtime/loadTfLiteRuntime'
import { preprocessLandmarksForClassifier } from './runtime/preprocess'
import {
	DrawLifecycleState,
	GesturePoint,
	GestureRuntimeState,
	GestureVideoSize,
	ModelState,
	StrokeState,
	TrackingState,
} from './types'
import { smoothPoint } from './utils/math'
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
	handPresent: false,
	videoSize: null,
	rawGestureId: null,
	rawGestureLabel: null,
	rawConfidence: null,
	stableGestureId: null,
	stableGestureLabel: null,
	rawCursorPoint: null,
	cursorPoint: null,
	rawDrawGestureActive: false,
	stableDrawGestureActive: false,
	drawLifecycleState: 'idle',
	strokeState: 'idle',
	nativeSessionActive: false,
	activePointerId: null,
	currentToolId: null,
	previousToolId: null,
	lastDispatchedEvent: null,
	lastDispatchScreenPoint: null,
	lastDispatchPagePoint: null,
	lastDrawEvent: null,
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
		point,
		pointerId: GESTURE_POINTER_ID,
		target: 'canvas',
	}
}

export function useGestureRuntime(
	canvasRef: RefObject<HTMLDivElement | null>,
	enabled: boolean,
	editor: Editor
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
	const drawStableHitsRef = useRef(0)
	const drawStableMissesRef = useRef(0)
	const rawGestureIdRef = useRef<number | null>(null)
	const stableCursorActiveRef = useRef(false)
	const stableDrawActiveRef = useRef(false)
	const nativeDrawSessionActiveRef = useRef(false)
	const trackingStateRef = useRef<TrackingState>('no-hand')
	const labelWarningRef = useRef<string | null>(null)
	const drawLifecycleStateRef = useRef<DrawLifecycleState>('idle')
	const strokeStateRef = useRef<StrokeState>('idle')
	const previousToolIdRef = useRef<string | null>(null)
	const lastDispatchedEventRef = useRef<GestureDispatchEventName | null>(null)
	const lastDispatchScreenPointRef = useRef<GesturePoint | null>(null)
	const lastDispatchPagePointRef = useRef<GesturePoint | null>(null)
	const lastDrawEventRef = useRef<string | null>(null)

	const isSupported = useMemo(() => {
		return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
	}, [])

	useEffect(() => {
		if (!enabled) {
			setState((previous) => ({
				...INITIAL_STATE,
				isSupported,
				enabled: false,
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
				gestureLog(
					'draw',
					'Dispatched native pointer event',
					{ name, screenPoint },
					{ debugMode: GESTURE_DEBUG_MODE }
				)
			}
		}

		const startNativeDrawSession = (screenPoint: GesturePoint) => {
			if (nativeDrawSessionActiveRef.current) return

			previousToolIdRef.current = editor.getCurrentToolId()
			drawLifecycleStateRef.current = 'drawing'
			strokeStateRef.current = 'arming'
			lastDrawEventRef.current = 'arming native draw session'

			if (editor.getCurrentToolId() !== 'draw') {
				editor.setCurrentTool('draw')
			}

			dispatchGesturePointer('pointer_down', screenPoint)
			nativeDrawSessionActiveRef.current = true
			strokeStateRef.current = 'pointerDownSent'
			lastDrawEventRef.current = 'native draw started'
		}

		const streamNativeDrawSession = (screenPoint: GesturePoint) => {
			if (!nativeDrawSessionActiveRef.current) return

			dispatchGesturePointer('pointer_move', screenPoint)
			strokeStateRef.current = 'streaming'
			lastDrawEventRef.current = 'native draw streaming'
		}

		const finishNativeDrawSession = (reason: string) => {
			if (!nativeDrawSessionActiveRef.current) return

			const screenPoint = lastDispatchScreenPointRef.current ?? cursorRef.current
			strokeStateRef.current = 'finishing'
			drawLifecycleStateRef.current = 'drawEnding'

			if (screenPoint) {
				dispatchGesturePointer('pointer_up', screenPoint)
			}

			nativeDrawSessionActiveRef.current = false
			restorePreviousTool()
			drawLifecycleStateRef.current = 'idle'
			strokeStateRef.current = 'idle'
			lastDrawEventRef.current = reason
		}

		const cancelNativeDrawSession = (reason: string) => {
			if (!nativeDrawSessionActiveRef.current) return

			editor.cancel()
			nativeDrawSessionActiveRef.current = false
			syncDispatchDiagnostics('cancel', lastDispatchScreenPointRef.current)
			drawLifecycleStateRef.current = 'idle'
			strokeStateRef.current = 'cancelled'
			lastDrawEventRef.current = reason
			restorePreviousTool()

			gestureLog('draw', 'Cancelled native draw session', { reason }, {
				debugMode: GESTURE_DEBUG_MODE,
				level: 'warn',
			})
		}

		const cleanup = () => {
			cancelNativeDrawSession('gesture runtime cleanup')

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
			drawStableHitsRef.current = 0
			drawStableMissesRef.current = 0
			rawGestureIdRef.current = null
			stableCursorActiveRef.current = false
			stableDrawActiveRef.current = false
			nativeDrawSessionActiveRef.current = false
			trackingStateRef.current = 'no-hand'
			labelWarningRef.current = null
			drawLifecycleStateRef.current = 'idle'
			strokeStateRef.current = 'idle'
			previousToolIdRef.current = null
			lastDispatchedEventRef.current = null
			lastDispatchScreenPointRef.current = null
			lastDispatchPagePointRef.current = null
			lastDrawEventRef.current = null
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
						drawStableHitsRef.current = 0
						drawStableMissesRef.current = 0
						stableCursorActiveRef.current = false

						if (
							stableDrawActiveRef.current &&
							lastSeenHandAt !== null &&
							frameAt - lastSeenHandAt > GESTURE_THRESHOLDS.drawFinalizeLossMs
						) {
							stableDrawActiveRef.current = false
							cancelNativeDrawSession('tracking lost during draw')
							gestureLog('draw', 'Tracking lost during draw', undefined, {
								debugMode: GESTURE_DEBUG_MODE,
							})
						}

						setState((previous) => ({
							...previous,
							handPresent: false,
							trackingState: 'lost',
							rawGestureId: null,
							rawGestureLabel: null,
							rawConfidence: null,
							stableGestureId: null,
							stableGestureLabel: null,
							rawDrawGestureActive: false,
							stableDrawGestureActive: stableDrawActiveRef.current,
							drawLifecycleState: drawLifecycleStateRef.current,
							strokeState: strokeStateRef.current,
							nativeSessionActive: nativeDrawSessionActiveRef.current,
							activePointerId: nativeDrawSessionActiveRef.current ? GESTURE_POINTER_ID : null,
							currentToolId: editor.getCurrentToolId(),
							previousToolId: previousToolIdRef.current,
							lastDispatchedEvent: lastDispatchedEventRef.current,
							lastDispatchScreenPoint: lastDispatchScreenPointRef.current,
							lastDispatchPagePoint: lastDispatchPagePointRef.current,
							lastDrawEvent: lastDrawEventRef.current,
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
					const drawGestureActive =
						rawGestureId === DRAW_GESTURE_ID &&
						rawConfidence >= GESTURE_THRESHOLDS.drawConfidence

					if (cursorGestureActive) {
						cursorStableHitsRef.current += 1
						cursorStableMissesRef.current = 0
					} else {
						cursorStableHitsRef.current = 0
						cursorStableMissesRef.current += 1
					}

					if (drawGestureActive) {
						drawStableHitsRef.current += 1
						drawStableMissesRef.current = 0
					} else {
						drawStableHitsRef.current = 0
						drawStableMissesRef.current += 1
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

					if (!stableDrawActiveRef.current &&
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
						finishNativeDrawSession('draw gesture released')
					}

					const stableGestureId = stableDrawActiveRef.current
						? DRAW_GESTURE_ID
						: stableCursorActiveRef.current
							? CURSOR_GESTURE_ID
							: null
					const stableGestureLabel =
						stableGestureId !== null
							? labelsRef.current[stableGestureId] ?? `Gesture ${stableGestureId}`
							: null

					const rawCursorLandmark = pixelLandmarks[8] ?? pixelLandmarks[0]
					const canvasRect = canvasElement.getBoundingClientRect()
					const rawCanvasPoint = rawCursorLandmark
						? toCanvasPoint(
								{ width: canvasRect.width, height: canvasRect.height },
								{ width: videoElement.videoWidth, height: videoElement.videoHeight },
								rawCursorLandmark
						  )
						: null

					const pointerActive = stableCursorActiveRef.current || stableDrawActiveRef.current
					const nextCursorPoint =
						rawCanvasPoint && pointerActive
							? smoothPoint(
									cursorRef.current,
									rawCanvasPoint,
									GESTURE_THRESHOLDS.cursorSmoothingAlpha
							  )
							: cursorRef.current

					if (pointerActive && nextCursorPoint) {
						cursorRef.current = nextCursorPoint
					}

					if (stableDrawActiveRef.current && nextCursorPoint) {
						if (!nativeDrawSessionActiveRef.current) {
							startNativeDrawSession(nextCursorPoint)
						} else {
							streamNativeDrawSession(nextCursorPoint)
						}
					}

					setState((previous) => ({
						...previous,
						enabled: true,
						handPresent: true,
						warning: labelWarningRef.current,
						trackingState: 'tracking',
						rawGestureId,
						rawGestureLabel,
						rawConfidence,
						stableGestureId,
						stableGestureLabel,
						rawDrawGestureActive: rawGestureId === DRAW_GESTURE_ID,
						stableDrawGestureActive: stableDrawActiveRef.current,
						drawLifecycleState: drawLifecycleStateRef.current,
						strokeState: strokeStateRef.current,
						nativeSessionActive: nativeDrawSessionActiveRef.current,
						activePointerId: nativeDrawSessionActiveRef.current ? GESTURE_POINTER_ID : null,
						currentToolId: editor.getCurrentToolId(),
						previousToolId: previousToolIdRef.current,
						lastDispatchedEvent: lastDispatchedEventRef.current,
						lastDispatchScreenPoint: lastDispatchScreenPointRef.current,
						lastDispatchPagePoint: lastDispatchPagePointRef.current,
						lastDrawEvent: lastDrawEventRef.current,
						rawCursorPoint: rawCanvasPoint,
						cursorPoint: pointerActive ? nextCursorPoint : null,
						cursorVisibility: pointerActive ? 'visible' : 'hidden',
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
