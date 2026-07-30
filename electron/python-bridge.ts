import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as http from 'http';
import { app } from 'electron';

let pythonProcess: ChildProcess | null = null;
let pythonPort = 5000;

export async function startPythonBackend(): Promise<number> {
  const isDev = !app.isPackaged;

  if (isDev) {
    const fs = require('fs');
    const projectRoot = path.join(app.getAppPath(), '..');
    const venvPythonPath = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
    const appPyPath = path.join(app.getAppPath(), 'backend', 'app.py');

    let execPath = 'python';
    if (fs.existsSync(venvPythonPath)) {
      execPath = venvPythonPath;
    }

    pythonPort = 5000;
    console.log(`[Python Bridge] Dev mode — spawning: ${execPath} ${appPyPath} --port ${pythonPort}`);

    pythonProcess = spawn(execPath, [appPyPath, '--port', pythonPort.toString()], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonProcess.stdout?.on('data', (data) => {
      console.log(`[Python Backend]: ${data.toString().trim()}`);
    });

    pythonProcess.stderr?.on('data', (data) => {
      console.error(`[Python Backend Error]: ${data.toString().trim()}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`[Python Bridge] Process exited with code ${code}`);
      pythonProcess = null;
    });

    await waitForHealthy(pythonPort);
    return pythonPort;
  }

  // Production: find a free port and spawn the bundled app.exe hidden.
  pythonPort = await findFreePort(5000, 5050);
  console.log(`[Python Bridge] Selected port: ${pythonPort}`);

  const fs = require('fs');
  const exeDir = path.dirname(app.getPath('exe'));
  
  // Packaged app: backend is copied into resources/backend/services.exe via extraResources
  let execPath = path.join(exeDir, 'resources', 'backend', 'services.exe');

  // Fallbacks if not found at default location
  if (!fs.existsSync(execPath)) {
    const candidates = [
      path.join(exeDir, 'resources', 'backend', 'dist', 'services.exe'),
      path.join(exeDir, 'backend', 'services.exe'),
      path.join(exeDir, 'backend', 'dist', 'services.exe'),
      path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'backend', 'dist', 'services.exe'),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (found) {
      execPath = found;
    } else {
      console.error(`[Python Bridge] Backend binary not found at candidates. Attempting fallback: ${execPath}`);
    }
  }

  console.log(`[Python Bridge] Spawning: ${execPath} --port ${pythonPort}`);

  pythonProcess = spawn(execPath, ['--port', pythonPort.toString()], {
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    shell: false,
    windowsHide: true,              // No console window on Windows
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProcess.stdout?.on('data', (data) => {
    console.log(`[Python Backend]: ${data.toString().trim()}`);
  });

  pythonProcess.stderr?.on('data', (data) => {
    console.error(`[Python Backend Error]: ${data.toString().trim()}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Python Bridge] Process exited with code ${code}`);
    pythonProcess = null;
  });

  await waitForHealthy(pythonPort);
  return pythonPort;
}

export function stopPythonBackend() {
  if (pythonProcess) {
    console.log('[Python Bridge] Terminating Python backend...');
    pythonProcess.kill();
    pythonProcess = null;
  }
}

export function getPythonPort(): number {
  return pythonPort;
}

async function waitForHealthy(port: number, maxRetries = 30, delay = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1000 }, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => {
            try { resolve(res.statusCode === 200 && JSON.parse(body).status === 'ok'); }
            catch { resolve(false); }
          });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (ok) { console.log(`[Python Bridge] Backend healthy on port ${port}`); return; }
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`[Python Bridge] Backend did not become healthy on port ${port} after ${maxRetries} retries.`);
}

async function findFreePort(start: number, end: number): Promise<number> {
  const net = require('net');
  const checkPort = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(port);
    });

  for (let port = start; port <= end; port++) {
    if (await checkPort(port)) return port;
  }
  return start;
}
