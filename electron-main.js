'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let window = null;
  let localServer = null;

  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.school.installments.dashboard');
    process.env.DASHBOARD_DATA_DIR = app.getPath('userData');
    process.env.DASHBOARD_PORT = '0';
    const { startServer, server } = require('./server');
    localServer = server;
    const port = await startServer(false);
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      width: 1320, height: 850, minWidth: 760, minHeight: 560,
      title: 'لوحة الأقساط 2026-2027',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.js') }
    });
    window.webContents.on('page-title-updated', (_event, title) => window.setTitle(title));
    ipcMain.handle('save-pdf', async (event, options) => {
      if (event.sender !== window.webContents) throw new Error('طلب غير مسموح');
      const orientation = options?.orientation === 'portrait' ? 'portrait' : 'landscape';
      const title = String(options?.title || 'تقرير الأقساط').replace(/[\\/:*?"<>|]/g, '').slice(0, 90) || 'تقرير الأقساط';
      const pdf = await window.webContents.printToPDF({ pageSize: 'A4', landscape: orientation === 'landscape', printBackground: true, preferCSSPageSize: false });
      const result = await dialog.showSaveDialog(window, {
        title: 'حفظ التقرير', defaultPath: path.join(app.getPath('documents'), `${title}.pdf`),
        filters: [{ name: 'ملف للطباعة', extensions: ['pdf'] }]
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await fs.writeFile(result.filePath, pdf);
      return { saved: true };
    });
    window.once('ready-to-show', () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      if (!target.startsWith(`http://127.0.0.1:${port}/`)) event.preventDefault();
    });
    await window.loadURL(`http://127.0.0.1:${port}/`);
  }).catch(error => {
    console.error('تعذر تشغيل التطبيق:', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (localServer?.listening) localServer.close();
    app.quit();
  });
}
