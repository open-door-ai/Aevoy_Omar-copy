/**
 * Aevoy Desktop — Main Electron Process
 *
 * Local mode: AI controls user's computer directly via nut.js + Playwright.
 * Features:
 * - System tray with status indicator
 * - Panic hotkey (Cmd+Shift+X)
 * - Screen recording
 * - Local SQLite database
 * - Encrypted credential storage
 */

import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import path from "path";
import { initTray, updateTrayStatus } from "./tray";
import { ScreenController } from "./screen-control";
import { SafetyManager } from "./safety";
import { LocalDatabase } from "./db";
import { LocalBrowserManager } from "./local-browser";

let mainWindow: BrowserWindow | null = null;
let screenController: ScreenController | null = null;
let safetyManager: SafetyManager | null = null;
let database: LocalDatabase | null = null;
let browserManager: LocalBrowserManager | null = null;

// ---- App Lifecycle ----

app.whenReady().then(async () => {
  // Initialize core services
  database = new LocalDatabase();
  screenController = new ScreenController();
  safetyManager = new SafetyManager(database);
  browserManager = new LocalBrowserManager();

  // Create main window
  createWindow();

  // Set up system tray
  initTray(mainWindow!);
  updateTrayStatus("idle");

  // Register panic hotkey: Cmd+Shift+X (Mac) / Ctrl+Shift+X (Windows/Linux)
  const panicKey = process.platform === "darwin" ? "Command+Shift+X" : "Control+Shift+X";
  globalShortcut.register(panicKey, () => {
    console.log("[SAFETY] Panic hotkey triggered!");
    handlePanic();
  });

  console.log("[DESKTOP] Aevoy Desktop initialized");
  console.log(`[DESKTOP] Panic hotkey: ${panicKey}`);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  cleanup();
});

// ---- Window Creation ----

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: "Aevoy Desktop",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../renderer/preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---- Panic Handler ----

async function handlePanic(): Promise<void> {
  updateTrayStatus("stopped");

  // 1. Stop all browser actions
  if (browserManager) {
    await browserManager.stopAll();
  }

  // 2. Stop screen control
  if (screenController) {
    screenController.stop();
  }

  // 3. Undo last 5 actions
  if (safetyManager) {
    await safetyManager.undoLastActions(5);
  }

  // 4. Stop recording
  if (safetyManager) {
    safetyManager.stopRecording();
  }

  // 5. Notify user
  if (mainWindow) {
    mainWindow.webContents.send("panic-triggered", {
      message: "All actions stopped. Last 5 actions undone.",
      timestamp: new Date().toISOString(),
    });
  }

  console.log("[SAFETY] Panic complete — all actions stopped, last 5 undone");
}

// ---- IPC Handlers ----

ipcMain.handle("get-status", () => {
  return {
    screenControl: screenController?.isActive() || false,
    browser: browserManager?.isActive() || false,
    recording: safetyManager?.isRecording() || false,
    taskCount: database?.getActiveTaskCount() || 0,
  };
});

ipcMain.handle("submit-task", async (_event, taskText: string) => {
  if (!taskText.trim()) return { success: false, error: "Empty task" };

  updateTrayStatus("working");

  try {
    const taskId = database!.createTask(taskText);

    // Process task locally (simplified — would connect to agent server in full impl)
    console.log(`[DESKTOP] Task submitted: ${taskText.substring(0, 50)}`);

    return { success: true, taskId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: msg };
  } finally {
    updateTrayStatus("idle");
  }
});

ipcMain.handle("get-tasks", () => {
  return database?.getRecentTasks(20) || [];
});

ipcMain.handle("stop-all", () => {
  handlePanic();
  return { success: true };
});

// ---- Cleanup ----

async function cleanup(): Promise<void> {
  if (browserManager) await browserManager.stopAll();
  if (screenController) screenController.stop();
  if (safetyManager) safetyManager.stopRecording();
  if (database) database.close();
}
