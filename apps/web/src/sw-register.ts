/** SW 仅在安全上下文注册(http://IP 下自动跳过,iOS PWA 需 HTTPS,见 RUNBOOK) */
if (import.meta.env.PROD && 'serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => { console.error('离线缓存注册失败', error); });
  });
}
