import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');

function runCommand(command, cwd) {
  console.log(`[Build Python] Running: ${command} in ${cwd}`);
  execSync(command, { cwd, stdio: 'inherit' });
}

function build() {
  try {
    // Kill any running studio_backend instances to avoid Windows file locks
    try {
      execSync('python -c "import psutil, os; cur = os.path.abspath(\'backend\'); [p.kill() for p in psutil.process_iter([\'pid\', \'exe\']) if p.info[\'exe\'] and cur.lower() in p.info[\'exe\'].lower()]"', { cwd: rootDir, stdio: 'ignore' });
    } catch (_) { }

    // 1. Ensure pip requirements are installed
    console.log('[Build Python] Checking and installing Python requirements...');
    runCommand('pip install -r requirements.txt', backendDir);

    // 2. Install PyInstaller if not installed
    console.log('[Build Python] Ensuring PyInstaller is installed...');
    runCommand('pip install pyinstaller', backendDir);

    // 3. Compile Python backend to single executable using spec file
    console.log('[Build Python] Bundling Python backend into executable...');
    runCommand('pyinstaller --clean app.spec', backendDir);

    const exePath = path.join(backendDir, 'dist', 'studio_backend.exe');
    if (fs.existsSync(exePath)) {
      console.log(`[Build Python] Successfully compiled studio_backend.exe at: ${exePath}`);
      fs.copyFileSync(exePath, path.join(backendDir, 'services.exe'));
      fs.copyFileSync(exePath, path.join(backendDir, 'studio_backend.exe'));
      console.log('[Build Python] Synced to backend/services.exe and backend/studio_backend.exe');
    } else {
      throw new Error(`Executable not found at ${exePath} after compilation`);
    }
  } catch (err) {
    console.error('[Build Python] Compilation failed:', err);
    process.exit(1);
  }
}

build();
