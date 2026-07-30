import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

export function initWindowState(windowName: string, defaultWidth: number, defaultHeight: number) {
  const userDataPath = app.getPath('userData');
  const stateFilePath = path.join(userDataPath, `window-state-${windowName}.json`);

  let state: WindowState = {
    width: defaultWidth,
    height: defaultHeight,
  };

  try {
    if (fs.existsSync(stateFilePath)) {
      state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading window state:', err);
  }

  function saveState(window: BrowserWindow) {
    try {
      const bounds = window.getBounds();
      state.isMaximized = window.isMaximized();
      if (!state.isMaximized) {
        state.x = bounds.x;
        state.y = bounds.y;
        state.width = bounds.width;
        state.height = bounds.height;
      }
      fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving window state:', err);
    }
  }

  return {
    get x() { return state.x; },
    get y() { return state.y; },
    get width() { return state.width; },
    get height() { return state.height; },
    get isMaximized() { return state.isMaximized; },
    saveState,
  };
}
