import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react-swc'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { zodLocalePlugin } from './scripts/vite-zod-locale-plugin.js'

// https://vitejs.dev/config/
export default defineConfig(() => {
	return {
		plugins: [
			zodLocalePlugin(fileURLToPath(new URL('./scripts/zod-locales-shim.js', import.meta.url))),
			cloudflare(),
			react(),
		],
		// WebSocket proxy doesn't work here because the Cloudflare Vite
		// plugin intercepts upgrade requests. The frontend connects directly
		// to the backend via VITE_AGENT_BACKEND_URL (default ws://localhost:8000).
	}
})