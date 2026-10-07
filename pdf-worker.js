'use strict';

const fs = require('node:fs/promises');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const [, , htmlPath, pdfPath, orientation] = process.argv;
  if (!htmlPath || !pdfPath) throw new Error('ملفات التصدير غير مكتملة');
  const window = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  await window.loadFile(htmlPath);
  await new Promise(resolve => setTimeout(resolve, 450));
  const pdf = await window.webContents.printToPDF({
    pageSize: 'A4', landscape: orientation === 'landscape', printBackground: true,
    preferCSSPageSize: false
  });
  await fs.writeFile(pdfPath, pdf);
  window.destroy();
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
