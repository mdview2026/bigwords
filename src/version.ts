// The version baked into the build from the repo's VERSION file: the single
// version source for every artifact of a release. vite.config.ts
// defines __BW_VERSION__; the prerender passes the same number into
// galleryMarkup() from the file directly (vite-plugin-docs.ts).
declare const __BW_VERSION__: string;

/** Shown in the chooser footer, so the running version is visible at a glance. */
export const APP_VERSION: string = __BW_VERSION__;
