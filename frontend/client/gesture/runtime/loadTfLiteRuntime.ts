declare global {
	interface Window {
		tf?: {
			setBackend: (backend: string) => Promise<boolean>
			ready: () => Promise<void>
			tensor: (
				values: number[][],
				shape: [number, number],
				dtype: 'float32'
			) => {
				dispose: () => void
			}
		}
		tflite?: {
			setWasmPath: (path: string) => void
			loadTFLiteModel: (
				modelPath: string,
				options?: {
					numThreads?: number
					enableProfiling?: boolean
				}
			) => Promise<{
				predict: (
					input: unknown
				) => {
					data: () => Promise<Float32Array>
					dispose: () => void
				} | Array<{
					data: () => Promise<Float32Array>
					dispose: () => void
				}>
			}>
		}
	}
}

const loadedScripts = new Map<string, Promise<void>>()

function loadScript(src: string) {
	const existing = loadedScripts.get(src)
	if (existing) return existing

	const promise = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script')
		script.src = src
		script.async = true
		script.onload = () => resolve()
		script.onerror = () => reject(new Error(`Failed to load runtime script: ${src}`))
		document.head.appendChild(script)
	})

	loadedScripts.set(src, promise)
	return promise
}

export async function loadTfLiteRuntime() {
	await loadScript('/vendor/tfjs/tf-core.min.js')
	await loadScript('/vendor/tfjs/tf-backend-cpu.min.js')
	await loadScript('/vendor/tfjs-tflite/dist/tf-tflite.min.js')

	if (!window.tf || !window.tflite) {
		throw new Error('TensorFlow runtime scripts loaded but globals were not initialized.')
	}

	return {
		tf: window.tf,
		tflite: window.tflite,
	}
}
