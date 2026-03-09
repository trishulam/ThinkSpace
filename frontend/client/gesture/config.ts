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
export const DRAW_GESTURE_ID = 6

export const GESTURE_THRESHOLDS = {
	cursorConfidence: 0.6,
	cursorStableFrames: 3,
	cursorMissFrames: 2,
	cursorSmoothingAlpha: 0.35,
	cursorFreezeMs: 500,
	drawConfidence: 0.45,
	drawStableFrames: 1,
	drawMissFrames: 3,
	drawMinPointDistance: 4,
	drawFinalizeLossMs: 220,
	cameraWidth: 960,
	cameraHeight: 540,
} as const
