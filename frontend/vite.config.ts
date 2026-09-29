import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`        -> http://localhost:5173 (desenvolvimento no computador)
// `npm run dev:phone`  -> https://<ip-da-máquina>:5173 na rede local. Câmera e WebXR
//                         no celular exigem HTTPS; aceite o certificado autoassinado.
export default defineConfig(({ mode }) => ({
  base: '/',
  plugins: mode === 'phone' ? [basicSsl()] : [],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
}));
