import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), basicSsl()],
	server: {
		proxy: {
			'/ws-room': {
				target: 'ws://localhost:8787',
				ws: true,
				rewrite: (path) => path.replace(/^\/ws-room/, '')
			}
		}
	}
});
