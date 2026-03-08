import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const homeAssistantTarget = env.VITE_HOME_ASSISTANT_URL?.replace(/\/$/, '')

  return {
    plugins: [react()],
    server: homeAssistantTarget
      ? {
          proxy: {
            '/__ha': {
              target: homeAssistantTarget,
              changeOrigin: true,
              secure: false,
              rewrite: (path) => path.replace(/^\/__ha/, ''),
            },
          },
        }
      : undefined,
  }
})
