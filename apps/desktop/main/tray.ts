/**
 * System Tray — Shows current Aevoy status
 *
 * States:
 * - idle: Ready for tasks
 * - working: Processing a task
 * - paused: User paused
 * - stopped: Panic triggered
 */

import { Tray, Menu, BrowserWindow, nativeImage } from "electron";
import path from "path";

let tray: Tray | null = null;
let currentStatus: "idle" | "working" | "paused" | "stopped" = "idle";

const STATUS_LABELS: Record<string, string> = {
  idle: "Aevoy — Ready",
  working: "Aevoy — Working...",
  paused: "Aevoy — Paused",
  stopped: "Aevoy — Stopped",
};

export function initTray(mainWindow: BrowserWindow): void {
  // Create a simple tray icon (1x1 transparent as placeholder)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  tray.setToolTip("Aevoy Desktop");

  updateTrayMenu(mainWindow);
}

export function updateTrayStatus(status: "idle" | "working" | "paused" | "stopped"): void {
  currentStatus = status;
  if (tray) {
    tray.setToolTip(STATUS_LABELS[status] || "Aevoy");
  }
}

function updateTrayMenu(mainWindow: BrowserWindow): void {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: STATUS_LABELS[currentStatus], enabled: false },
    { type: "separator" },
    {
      label: "Show Window",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: "Panic Stop (Cmd+Shift+X)",
      click: () => {
        mainWindow.webContents.send("panic-triggered", {
          message: "Panic triggered from tray",
        });
      },
    },
    { type: "separator" },
    {
      label: "Quit Aevoy",
      click: () => {
        mainWindow.destroy();
        if (tray) tray.destroy();
        process.exit(0);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}
