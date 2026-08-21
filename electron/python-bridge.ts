import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';
import { app } from 'electron';

let pythonProcess: ChildProcess | null = null;
let pythonPort = 5000;
let processExitError: string | null = null;
const startupLogs: string[] = [];

function recordStartupLog(line: string) {
  startupLogs.push(line);
  if (startupLogs.length > 50) {
    startupLogs.shift();
  }
}

export async function startPythonBackend(): Promise<number> {
  const isDev = !app.isPackaged;
  processExitError = null;
  startupLogs.length = 0;

  if (isDev) {
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
      cwd: path.dirname(appPyPath),
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonProcess.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      console.log(`[Python Backend]: ${msg}`);
      recordStartupLog(`[stdout] ${msg}`);
    });

    pythonProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg.includes('waitress') || msg.includes('Task queue depth')) {
        console.log(`[Python Backend Info]: ${msg}`);
      } else {
        console.error(`[Python Backend Error]: ${msg}`);
      }
      recordStartupLog(`[stderr] ${msg}`);
    });

    pythonProcess.on('error', (err) => {
      processExitError = `Failed to start Python backend process: ${err.message}`;
      console.error(`[Python Bridge] ${processExitError}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`[Python Bridge] Process exited with code ${code}`);
      if (code !== 0 && code !== null) {
        processExitError = `Python backend process terminated unexpectedly with code ${code}. Recent logs:\n${startupLogs.slice(-10).join('\n')}`;
      }
      pythonProcess = null;
    });

    await waitForHealthy(pythonPort);
    return pythonPort;
  }

  // Production: find a free port and spawn the bundled services.exe hidden.
  pythonPort = await findFreePort(5000, 5050);
  console.log(`[Python Bridge] Selected port: ${pythonPort}`);

  const exeDir = path.dirname(app.getPath('exe'));
  const resourcesDir = process.resourcesPath || path.join(exeDir, 'resources');

  const candidates = [
    path.join(resourcesDir, 'backend', 'studio_backend.exe'),
    path.join(resourcesDir, 'backend', 'dist', 'studio_backend.exe'),
    path.join(resourcesDir, 'backend', 'services.exe'),
    path.join(resourcesDir, 'backend', 'dist', 'services.exe'),
    path.join(exeDir, 'resources', 'backend', 'studio_backend.exe'),
    path.join(exeDir, 'resources', 'backend', 'services.exe'),
    path.join(exeDir, 'backend', 'studio_backend.exe'),
    path.join(exeDir, 'backend', 'services.exe'),
    path.join(exeDir, 'backend', 'dist', 'studio_backend.exe'),
    path.join(exeDir, 'backend', 'dist', 'services.exe'),
    path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'backend', 'studio_backend.exe'),
    path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'backend', 'services.exe'),
    path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'backend', 'dist', 'studio_backend.exe'),
    path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'backend', 'dist', 'services.exe'),
  ];

  const execPath = candidates.find((p) => fs.existsSync(p));
  if (!execPath) {
    const inspected = candidates.map((p) => ` - ${p}`).join('\n');
    throw new Error(`[Python Bridge] Backend executable 'services.exe' was not found. Checked locations:\n${inspected}`);
  }

  console.log(`[Python Bridge] Spawning production backend: ${execPath} --port ${pythonPort}`);
  const backendCwd = path.dirname(execPath);

  pythonProcess = spawn(execPath, ['--port', pythonPort.toString()], {
    cwd: backendCwd,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    shell: false,
    windowsHide: true, // Hidden background window
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    console.log(`[Python Backend]: ${msg}`);
    recordStartupLog(`[stdout] ${msg}`);
  });

  pythonProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg.includes('waitress') || msg.includes('Task queue depth')) {
      console.log(`[Python Backend Info]: ${msg}`);
    } else {
      console.error(`[Python Backend Error]: ${msg}`);
    }
    recordStartupLog(`[stderr] ${msg}`);
  });

  pythonProcess.on('error', (err) => {
    processExitError = `Failed to start backend process (${execPath}): ${err.message}`;
    console.error(`[Python Bridge] ${processExitError}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`[Python Bridge] Process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      processExitError = `Backend process terminated prematurely with exit code ${code}.\n${startupLogs.slice(-10).join('\n')}`;
    }
    pythonProcess = null;
  });

  await waitForHealthy(pythonPort);
  return pythonPort;
}

export function stopPythonBackend() {
  if (pythonProcess) {
    console.log('[Python Bridge] Terminating Python backend...');
    try {
      pythonProcess.kill();
    } catch (_) {}
    pythonProcess = null;
  }
}

export function getPythonPort(): number {
  return pythonPort;
}

async function waitForHealthy(port: number, maxRetries = 90, delay = 500): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    // Fail fast if backend process already exited/crashed
    if (processExitError) {
      throw new Error(`[Python Bridge] Backend startup failed: ${processExitError}`);
    }

    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1000 }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(res.statusCode === 200 && JSON.parse(body).status === 'ok');
            } catch {
              resolve(false);
            }
          });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) {
        console.log(`[Python Bridge] Backend healthy on port ${port} (took ${(i + 1) * delay}ms)`);
        return;
      }
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const logsSummary = startupLogs.length > 0 ? `\nRecent output:\n${startupLogs.slice(-10).join('\n')}` : '';
  throw new Error(
    `[Python Bridge] Backend did not become healthy on port ${port} after ${(maxRetries * delay) / 1000}s.${logsSummary}`
  );
}

async function findFreePort(start: number, end: number): Promise<number> {
  const net = require('net');
  const checkPort = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, '127.0.0.1');
    });

  for (let port = start; port <= end; port++) {
    if (await checkPort(port)) return port;
  }
  return start;
}
