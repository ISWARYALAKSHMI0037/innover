const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const host = '127.0.0.1';
const port = 4170;
const root = __dirname;
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
const apps = {
  yolo: { name: 'YOLO Object Detection' },
  signSpeak: { name: 'Sign Speak' },
  offerCheck: { name: 'OfferCheck' },
  emotionStudio: { name: 'Expression Studio' },
};
const processes = new Map();
let offerCheckApiPort = 5000;

function startProcess(key, command, args, cwd, env = {}) {
  const existing = processes.get(key);
  if (existing && existing.exitCode === null && !existing.killed) return existing;

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entry = { child, output: '', error: '', startedAt: Date.now() };
  processes.set(key, entry);

  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (chunk) => {
      const text = chunk.toString();
      entry.output = `${entry.output}${text}`.slice(-3000);
      if (stream === 'stderr') entry.error = `${entry.error}${text}`.slice(-1500);
    });
  }

  child.on('error', (error) => {
    entry.spawnError = error.message;
    entry.error = `${entry.error}${error.message}`.slice(-1500);
  });
  child.on('close', (code, signal) => {
    entry.exitCode = code;
    entry.signal = signal;
  });

  return entry;
}

function sanitizeErrorText(text, fallback = 'The app failed to start.') {
  const cleaned = (text || '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '') 
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return fallback;

  const match = cleaned.match(/(?:ModuleNotFoundError: .*|No module named .*|ConnectionError: .*|Failed to read images from .*|Error: .*|Traceback \(most recent call last\):.*?\n(?:\s+File .*\n)+\s*(?:[A-Za-z_][\w.]*Error|Exception): .*|.*?YOLO.*?)/i);
  const selected = match ? match[0].replace(/\s{2,}/g, ' ') : cleaned;
  return selected.length > 220 ? `${selected.slice(0, 217).trim()}…` : selected;
}

function processState(key) {
  const entry = processes.get(key);
  if (!entry) return { running: false };
  if (entry.external) return { running: true };
  const running = !entry.spawnError && entry.child.exitCode === null && !entry.child.killed;
  return {
    running,
    ...(running ? {} : { exitCode: entry.exitCode, signal: entry.signal }),
    ...(entry.error ? {
      error: key === 'yolo'
        ? describePythonError(entry)
        : sanitizeErrorText(entry.error, 'The app failed to start.'),
    } : {}),
  };
}

async function waitForApp(url, appName, processKey) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = processState(processKey);
    if (!state.running) {
      throw new Error(state.error || `${appName} exited before it became available.`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The development server is expected to refuse connections until it starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${appName} did not become available within 30 seconds.`);
}

function npmProcess(key, cwd, args, env = {}) {
  const command = `npm.cmd ${args.join(' ')}`;
  return startProcess(key, process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], cwd, env);
}

function nodeScriptProcess(key, cwd, script, args = [], env = {}) {
  return startProcess(key, process.execPath, [script, ...args], cwd, env);
}

function stopProcess(key) {
  const entry = processes.get(key);
  if (!entry || entry.external || entry.child.exitCode !== null || entry.child.killed) return false;
  return entry.child.kill();
}

async function getAvailablePort(preferred) {
  for (let port = preferred; port < preferred + 20; port += 1) {
    const available = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, host, () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`Could not find an available local port near ${preferred}.`);
}

async function isProjectReady(url, title) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const html = await response.text();
    return html.toLowerCase().includes(title.toLowerCase());
  } catch {
    return false;
  }
}

async function isOfferCheckApiReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${offerCheckApiPort}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    return (await response.json()).ok === true;
  } catch {
    return false;
  }
}

function describePythonError(state) {
  const error = state.error || '';
  const clean = sanitizeErrorText(error, 'Python exited before YOLO could start.');

  if (/No module named ['"]?ultralytics/i.test(error)) {
    return 'YOLO needs the ultralytics package. Install it with: py -m pip install ultralytics';
  }
  if (/No module named ['"]?cv2/i.test(error)) {
    return 'YOLO needs OpenCV. Install it with: py -m pip install opencv-python';
  }
  if (/Failed to read images from 0|could not find a webcam|No webcam/i.test(clean)) {
    return 'YOLO could not find a webcam or video source. Connect a camera and launch again.';
  }
  if (/Traceback|ConnectionError|Error:/i.test(clean)) {
    return clean.includes('ConnectionError') || clean.includes('Failed to read images')
      ? 'YOLO could not find a webcam or video source. Connect a camera and launch again.'
      : 'YOLO could not start. Check the Python environment and camera connection.';
  }
  return clean || 'Python exited before YOLO could start. Check that Python and the YOLO dependencies are installed.';
}

async function launchApp(id) {
  if (id === 'yolo') {
    const script = path.join(root, '1.py');
    if (!fs.existsSync(script)) throw new Error('Could not find 1.py in the project folder.');
    startProcess('yolo', 'py.exe', ['-3', script], root);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const state = processState('yolo');
    if (!state.running) {
      throw new Error(describePythonError(state));
    }
    return { message: 'YOLO Object Detection started with Python.' };
  }

  if (id === 'signSpeak') {
    const cwd = path.join(root, 'sign speak');
    if (await isProjectReady('http://127.0.0.1:5174/', 'sign-speak')) {
      processes.set('signSpeak', { external: true });
      return { url: 'http://127.0.0.1:5174/' };
    }
    const port = await getAvailablePort(5174);
    npmProcess('signSpeak', cwd, ['run', 'dev', '--', '--host', host, '--port', String(port), '--strictPort']);
    const url = `http://127.0.0.1:${port}/`;
    await waitForApp(url, apps[id].name, 'signSpeak');
    return { url };
  }

  if (id === 'emotionStudio') {
    const cwd = path.join(root, 'emotion studio');
    if (await isProjectReady('http://127.0.0.1:5175/', 'Expression Studio')) {
      processes.set('emotionStudio', { external: true });
      return { url: 'http://127.0.0.1:5175/' };
    }
    const port = await getAvailablePort(5175);
    nodeScriptProcess(
      'emotionStudio',
      cwd,
      path.join(cwd, 'node_modules', 'vite', 'bin', 'vite.js'),
      ['--host', host, '--port', String(port), '--strictPort']
    );
    const url = `http://127.0.0.1:${port}/`;
    await waitForApp(url, apps[id].name, 'emotionStudio');
    return { url };
  }

  if (id === 'offerCheck') {
    const appRoot = path.join(root, 'offercheck');
    if (await isProjectReady('http://127.0.0.1:5173/', 'offercheck')) {
      processes.set('offerCheckWeb', { external: true });
      if (await isOfferCheckApiReady()) processes.set('offerCheckApi', { external: true });
      return { url: 'http://127.0.0.1:5173/' };
    }
    const webPort = await getAvailablePort(5173);
    const apiPort = await getAvailablePort(5000);
    offerCheckApiPort = apiPort;
    const clientOrigins = `http://127.0.0.1:${webPort},http://localhost:${webPort}`;
    npmProcess('offerCheckApi', path.join(appRoot, 'server'), ['run', 'dev'], {
      PORT: String(apiPort),
      CLIENT_ORIGIN: clientOrigins,
    });
    npmProcess('offerCheckWeb', path.join(appRoot, 'client'), ['run', 'dev', '--', '--host', host, '--port', String(webPort), '--strictPort'], {
      VITE_API_PROXY: `http://127.0.0.1:${apiPort}`,
    });
    const url = `http://127.0.0.1:${webPort}/`;
    await waitForApp(url, apps[id].name, 'offerCheckWeb');
    return { url };
  }

  throw new Error('Unknown app.');
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${host}:${port}`);

  if (requestUrl.pathname === '/api/status' && request.method === 'GET') {
    if (!processState('offerCheckApi').running && await isOfferCheckApiReady()) {
      processes.set('offerCheckApi', { external: true });
    }
    const offerCheckWeb = processState('offerCheckWeb');
    const offerCheckApi = processState('offerCheckApi');
    return sendJson(response, 200, {
      yolo: processState('yolo'),
      signSpeak: processState('signSpeak'),
      emotionStudio: processState('emotionStudio'),
      offerCheck: {
        running: offerCheckWeb.running,
        apiRunning: offerCheckApi.running,
        ...(offerCheckApi.error ? { apiError: offerCheckApi.error } : {}),
      },
    });
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/stop/emotionStudio') {
    const requestHost = request.headers.host;
    let localOrigin = false;
    try {
      const origin = new URL(request.headers.origin);
      localOrigin = origin.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(origin.hostname);
    } catch {
      localOrigin = false;
    }
    if (!localOrigin ||
        (requestHost !== `${host}:${port}` && requestHost !== `localhost:${port}`)) {
      return sendJson(response, 403, { error: 'Requests must come from a local project page.' });
    }
    stopProcess('emotionStudio');
    return sendJson(response, 200, { stopped: true });
  }

  if (request.method === 'POST' && requestUrl.pathname.startsWith('/api/launch/')) {
    const origin = request.headers.origin;
    const requestHost = request.headers.host;
    if ((origin && origin !== `http://${host}:${port}`) ||
        (requestHost !== `${host}:${port}` && requestHost !== `localhost:${port}`)) {
      return sendJson(response, 403, { error: 'Requests must come from this local hub.' });
    }
    try {
      const result = await launchApp(requestUrl.pathname.slice('/api/launch/'.length));
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, 500, { error: error.message });
    }
  }

  const asset = request.method === 'GET' && assets[requestUrl.pathname];
  if (asset) {
    const [filename, contentType] = asset;
    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:",
    });
    return fs.createReadStream(path.join(root, filename)).pipe(response);
  }

  sendJson(response, 404, { error: 'Not found.' });
});

server.listen(port, host, () => {
  console.log(`Project hub ready at http://${host}:${port}`);
});

server.on('error', (error) => {
  console.error(`Could not start the project hub: ${error.message}`);
  process.exitCode = 1;
});
