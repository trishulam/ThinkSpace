import { GestureDebugMode } from './types'

export const GESTURE_DEBUG_MODE: GestureDebugMode = 'basic'

export const GESTURE_ASSETS = {
	mediapipeWasmPath: '/vendor/mediapipe/wasm',
	handLandmarkerModelPath: '/models/mediapipe/hand_landmarker.task',
	classifierModelPath: '/models/gesture/keypoint_classifier.tflite',
	classifierLabelsPath: '/models/gesture/keypoint_classifier_label.csv',
	tfliteWasmPath: '/vendor/tfjs-tflite/wasm/',
} as const

export const CURSOR_GESTURE_ID = 2
export const PAN_GESTURE_ID = 1
export const ZOOM_GESTURE_ID = 3
export const DRAW_GESTURE_ID = 6

export const GESTURE_THRESHOLDS = {
	cursorConfidence: 0.6,
	cursorStableFrames: 3,
	cursorMissFrames: 2,
	cursorSmoothingAlpha: 0.35,
	cursorFreezeMs: 500,
	zoomConfidence: 0.45,
	zoomStableFrames: 2,
	zoomMissFrames: 2,
	zoomDeadzonePx: 18,
	zoomSensitivity: 0.0035,
	zoomMin: 0.2,
	zoomMax: 6,
	panConfidence: 0.55,
	panStableFrames: 2,
	panMissFrames: 2,
	panSensitivity: 1.15,
	panReanchorDistance: 120,
	drawConfidence: 0.45,
	drawStableFrames: 1,
	drawMissFrames: 3,
	drawMinPointDistance: 4,
	drawFinalizeLossMs: 220,
	cameraWidth: 960,
	cameraHeight: 540,
} as const
