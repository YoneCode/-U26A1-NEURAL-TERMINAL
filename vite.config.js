import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/bradbury-api': {
        target: 'https://explorer-bradbury.genlayer.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bradbury-api/, ''),
      },
      '/standard-api': {
        target: 'https://explorer-api.testnet-chain.genlayer.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/standard-api/, ''),
      },
    },
  },
});
