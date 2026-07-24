import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Same Vite web build runs in browser and Capacitor (PB-041 / AC-045–047).
 * Native apps load `dist/` and talk to the Fastify API via VITE_API_BASE_URL
 * (bearer session token path). No reasoning logic is added in native projects.
 */
const config: CapacitorConfig = {
  appId: 'com.reasoningtutor.app',
  appName: 'Reasoning Tutor',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
