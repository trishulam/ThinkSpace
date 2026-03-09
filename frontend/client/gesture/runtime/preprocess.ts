import { clamp } from '../utils/math'

export interface PixelLandmark {
	x: number
	y: number
}

export interface NormalizedLandmarkLike {
	x: number
	y: number
}

export interface PreprocessLandmarksResult {
	pixelLandmarks: PixelLandmark[]
	preprocessed: number[]
}

export function toPixelLandmarks(
	landmarks: NormalizedLandmarkLike[],
	videoWidth: number,
	videoHeight: number
): PixelLandmark[] {
	return landmarks.map((landmark) => ({
		// Match the mirrored Python pipeline.
		x: clamp(Math.round((1 - landmark.x) * videoWidth), 0, Math.max(videoWidth - 1, 0)),
		y: clamp(Math.round(landmark.y * videoHeight), 0, Math.max(videoHeight - 1, 0)),
	}))
}

export function preProcessLandmarks(landmarks: PixelLandmark[]): number[] {
	const tempLandmarks = landmarks.map((point) => [point.x, point.y])

	let baseX = 0
	let baseY = 0

	for (let index = 0; index < tempLandmarks.length; index++) {
		const point = tempLandmarks[index]
		if (!point) continue

		if (index === 0) {
			baseX = point[0]
			baseY = point[1]
		}

		point[0] = point[0] - baseX
		point[1] = point[1] - baseY
	}

	const flattened = tempLandmarks.flat()
	const maxValue = Math.max(...flattened.map((value) => Math.abs(value)))

	if (!Number.isFinite(maxValue) || maxValue === 0) {
		return flattened.map(() => 0)
	}

	return flattened.map((value) => value / maxValue)
}

export function preprocessLandmarksForClassifier(
	landmarks: NormalizedLandmarkLike[],
	videoWidth: number,
	videoHeight: number
): PreprocessLandmarksResult {
	const pixelLandmarks = toPixelLandmarks(landmarks, videoWidth, videoHeight)
	return {
		pixelLandmarks,
		preprocessed: preProcessLandmarks(pixelLandmarks),
	}
}
