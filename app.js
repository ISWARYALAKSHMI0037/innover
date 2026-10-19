const buttons = [...document.querySelectorAll('[data-launch]')];
const launchLabels = new Map(buttons.map((button) => [button.dataset.launch, button.querySelector('span').textContent]));

function setStatus(id, message, state = 'ready') {
  const container = document.querySelector(`[data-status="${id}"]`);
  if (!container) return;
  container.querySelector('.status-text').textContent = message;
  container.classList.toggle('is-running', state === 'running');
  container.classList.toggle('has-error', state === 'error');
  container.title = state === 'error' ? message : '';
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) return;
    const status = await response.json();
    for (const id of ['yolo', 'signSpeak', 'offerCheck', 'emotionStudio']) {
      const app = status[id];
      if (app.running) {
        if (id === 'offerCheck' && !app.apiRunning && app.apiError) {
          setStatus(id, `API error: ${app.apiError}`, 'error');
        } else {
          const detail = id === 'offerCheck' && !app.apiRunning ? 'Web ready · API starting' : 'Running on this device';
          setStatus(id, detail, 'running');
        }
      } else if (app.error) {
        setStatus(id, app.error, 'error');
      }
    }
  } catch {
    // The hub may be starting up when the page first loads.
  }
}

for (const button of buttons) {
  button.addEventListener('click', async () => {
    const id = button.dataset.launch;
    const originalLabel = launchLabels.get(id);
    const appWindow = id === 'yolo' ? null : window.open('about:blank', '_blank');
    if (appWindow) appWindow.opener = null;
    button.disabled = true;
    button.querySelector('span').textContent = id === 'yolo' ? 'Starting Python…' : 'Starting project…';
    setStatus(id, 'Starting up…');

    try {
      const response = await fetch(`/api/launch/${id}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The project could not be started.');
      if (result.url && appWindow) appWindow.location.replace(result.url);
      setStatus(id, result.message || 'Running on this device', 'running');
    } catch (error) {
      if (appWindow) appWindow.close();
      const message = error.message || 'The project could not be started.';
      setStatus(id, message, 'error');
    } finally {
      button.disabled = false;
      button.querySelector('span').textContent = originalLabel;
      refreshStatus();
    }
  });
}

refreshStatus();
window.setInterval(refreshStatus, 3000);
