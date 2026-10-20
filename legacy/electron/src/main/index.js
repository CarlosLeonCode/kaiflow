const { app, BrowserWindow, ipcMain } = require('electron/main');
const path = require('node:path');

// State management
let mainWindow;
let isTracking = false;
let trackingInterval;
const TRACKING_INTERVAL_MS = 2000; // Check every 2 seconds
const intervalInSeconds = TRACKING_INTERVAL_MS / 1000;

// tracks data like: { 'AppName': { totalTime: X, 'WindowTitle1': Y, 'WindowTitle2': Z } }
let trackedData = {};

let activeWin;
import('active-win').then((module) => {
  activeWin = module.default;
});

const createWindow = () => {
  // Fallback for webpack constants when they're not properly injected
  const preloadPath = typeof MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY !== 'undefined' 
    ? MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY 
    : path.join(__dirname, 'preload.js');
  
  const appURL = typeof MAIN_WINDOW_WEBPACK_ENTRY !== 'undefined'
    ? MAIN_WINDOW_WEBPACK_ENTRY
    : path.join(__dirname, '../renderer/index.html');

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Check if appURL is a file path or URL
  if (appURL.startsWith('http')) {
    mainWindow.loadURL(appURL);
  } else {
    mainWindow.loadFile(appURL);
  }
  
  // IPC LISTENERS FOR WINDOW CONTROLS
  ipcMain.on('minimize-window', () => mainWindow.minimize());
  ipcMain.on('maximize-window', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('close-window', () => mainWindow.close());
};

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());

// --- Core Tracking Logic (Updated) ---

async function trackActivity() {
  if (!activeWin) return;

  try {
    const window = await activeWin();
    if (window && window.owner && window.owner.name) {
      const appName = window.owner.name;
      const windowTitle = window.title || 'Unknown Title'; // Use title for tabs

      // Initialize app entry if it doesn't exist
      if (!trackedData[appName]) {
        trackedData[appName] = { totalTime: 0 };
      }
      
      // Increment total time for the app
      trackedData[appName].totalTime = (trackedData[appName].totalTime || 0) + intervalInSeconds;
      
      // Increment time for the specific window title
      trackedData[appName][windowTitle] = (trackedData[appName][windowTitle] || 0) + intervalInSeconds;

      mainWindow.webContents.send('update-data', trackedData);
    }
  } catch (error) {
    console.error('Could not get active window:', error);
  }
}

function startTracking() {
  isTracking = true;
  trackedData = {}; // Reset on start
  console.log('Tracking started...');
  trackActivity();
  trackingInterval = setInterval(trackActivity, TRACKING_INTERVAL_MS);
}

function stopTracking() {
  isTracking = false;
  clearInterval(trackingInterval);
  console.log('Tracking stopped. Final report:', trackedData);
  mainWindow.webContents.send('update-data', trackedData);
}

ipcMain.on('toggle-tracking', () => {
  if (isTracking) {
    stopTracking();
  } else {
    startTracking();
  }
});
