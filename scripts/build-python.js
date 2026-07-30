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
    // 1. Ensure pip requirements are installed
    console.log('[Build Python] Checking and installing Python requirements...');
    runCommand('pip install -r requirements.txt', backendDir);
    
    // 2. Install PyInstaller if not installed
    console.log('[Build Python] Ensuring PyInstaller is installed...');
    runCommand('pip install pyinstaller', backendDir);

    // 3. Compile Python backend to single executable using spec file
    console.log('[Build Python] Bundling Python backend into executable...');
    runCommand('pyinstaller --clean app.spec', backendDir);
    
    const exePath = path.join(backendDir, 'dist', 'services.exe');
    if (fs.existsSync(exePath)) {
      console.log(`[Build Python] Successfully compiled services.exe at: ${exePath}`);
    } else {
      throw new Error(`Executable not found at ${exePath} after compilation`);
    }
  } catch (err) {
    console.error('[Build Python] Compilation failed:', err);
    process.exit(1);
  }
}

build();
