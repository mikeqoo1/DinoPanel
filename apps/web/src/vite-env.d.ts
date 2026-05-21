/// <reference types="vite/client" />

// Injected at build time by Vite via the `define` plugin reading
// apps/web/package.json (see apps/web/vite.config.ts). Use the
// re-export from '@/lib/version' instead of touching this global.
declare const __APP_VERSION__: string;
