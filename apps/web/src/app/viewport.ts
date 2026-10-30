// Keep the app frame inside the visible viewport, including when the iOS
// keyboard opens. Scrollable content belongs to the panes inside this frame.
const viewport = window.visualViewport;
const native = (globalThis as { Capacitor?: { isNativePlatform(): boolean } }).Capacitor?.isNativePlatform();
let frame = 0;
function updateViewport() {
  frame = 0;
  // Pinch zoom must not resize/reflow the page being magnified.
  if (viewport && viewport.scale !== 1) return;
  // Capacitor Keyboard already resizes the native view. Using its visual
  // viewport as well would apply the keyboard reduction a second time.
  const height = Math.round(native ? window.innerHeight : viewport?.height ?? window.innerHeight);
  if (height > 0) document.documentElement.style.setProperty('--app-height', `${height}px`);
}
function scheduleViewportUpdate() {
  if (!frame) frame = requestAnimationFrame(updateViewport);
}
updateViewport();
viewport?.addEventListener('resize', scheduleViewportUpdate);
window.addEventListener('resize', scheduleViewportUpdate);
