import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lyfe.fluxo',
  appName: 'LyFe Hoteles',
  webDir: 'dist',
  server: {
    url: 'https://lyfehoteles.com.br',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
