// Single source of truth for the web bundle's version string.
// Injected by Vite via the `define` plugin reading apps/web/package.json
// at config-load time (see apps/web/vite.config.ts).
//
// At build time `__APP_VERSION__` is replaced with a string literal;
// at type-check time it's declared in src/vite-env.d.ts.
export const APP_VERSION: string = __APP_VERSION__;
