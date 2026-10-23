/** Phone layout: a touch screen, a narrow window, or the Android app. */
export function phoneLayout(): boolean {
  const native = (window as Window & { BigwordsAndroid?: unknown }).BigwordsAndroid;
  if (native) return true;
  return matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 720px)').matches;
}
