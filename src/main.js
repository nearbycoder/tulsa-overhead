// Tulsa Overhead boot.
const params = new URLSearchParams(location.search);
const bootMsg = (m) => { const el = document.getElementById('boot-msg'); if (el) el.textContent = m; };
window.addEventListener('error', (e) => { bootMsg('Error: ' + e.message); console.error(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { bootMsg('Error: ' + (e.reason && e.reason.message || e.reason)); console.error(e.reason); });

const start = params.has('viewer') ? import('./viewer.js').then(module => module.viewer())
  : import('./game/boot.js').then(module => module.boot());
start.catch(e => { bootMsg('Error: ' + e.message); console.error(e); });
