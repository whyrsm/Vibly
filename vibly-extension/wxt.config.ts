import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Vibly',
    description: 'Lightweight screen recording with webcam overlay. Record and share instantly.',
    version: '2.0.0',
    permissions: ['storage', 'tabs'],
    host_permissions: [
      'http://localhost:3000/*',
      'https://api.vibly.com/*'
    ],
    icons: {
      16: '/icon.svg',
      32: '/icon.svg',
      48: '/icon.svg',
      96: '/icon.svg',
      128: '/icon.svg',
    },
  },
});
