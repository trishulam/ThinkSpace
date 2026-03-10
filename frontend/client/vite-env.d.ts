/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_AGENT_BACKEND_URL?: string
	readonly VITE_SESSION_API_BASE_URL?: string
	readonly VITE_TLDRAW_AGENT_STREAM_URL?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
