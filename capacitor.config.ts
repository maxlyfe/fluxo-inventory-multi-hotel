import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lyfe.fluxo',
  appName: 'Fluxo',
  webDir: 'dist',
  server: {
    url: 'https://meridiana.netlify.app',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
