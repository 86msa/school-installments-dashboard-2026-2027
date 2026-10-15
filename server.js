'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { buildDashboard } = require('./metrics');
const { createReport, toCsv } = require('./public/report-data');
const { createZip } = require('./backup');
const { toXlsx } = require('./xlsx');

const host = '127.0.0.1';
const port = Number(process.env.DASHBOARD_PORT ?? 4178);
let actualPort = port;
const publicDir = path.join(__dirname, 'public');
const scriptDir = __dirname.includes('app.asar') ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
const powershell = 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';
const adjacentDatabasePath = path.resolve(__dirname, '..', 'ابتدائي 2027', 'data', 'alaa.mdb');
const defaultDatabasePath = fs.existsSync(adjacentDatabasePath) ? adjacentDatabasePath : '';
const dataDir = process.env.DASHBOARD_DATA_DIR || __dirname;
fs.mkdirSync(dataDir, { recursive: true });
const settingsFile = path.join(dataDir, 'dashboard-settings.json');
const defaultTheme = { primary: '#197652', sidebar: '#153f38' };
const defaultSchoolName = 'لوحة الأقساط';
const validSchoolName = value => typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 80 && !/[\x00-\x1f\x7f-\x9f<>]/.test(value);
const cacheMs = 15_000;
let savedSettings = { databasePath: defaultDatabasePath, schoolName: defaultSchoolName, theme: defaultTheme, logoFile: null, programPath: null };
try {
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  if (typeof saved.databasePath === 'string' && path.isAbsolute(saved.databasePath)) savedSettings.databasePath = saved.databasePath;
  if (validSchoolName(saved.schoolName)) savedSettings.schoolName = saved.schoolName.trim().replace(/\s+/g, ' ');
  if (saved.theme && /^#[0-9a-f]{6}$/i.test(saved.theme.primary) && /^#[0-9a-f]{6}$/i.test(saved.theme.sidebar)) savedSettings.theme = saved.theme;
  if (['logo.png', 'logo.jpg'].includes(saved.logoFile)) savedSettings.logoFile = saved.logoFile;
  if (typeof saved.programPath === 'string' && path.isAbsolute(saved.programPath)) savedSettings.programPath = saved.programPath;
} catch (error) {
  if (error.code !== 'ENOENT') console.error('تعذر قراءة الإعدادات:', error.message);
}
let databasePath = savedSettings.databasePath;
let cache = null;
let cacheTime = 0;
let cachePath = null;
let loading = null;
let loadingPath = null;
let selecting = null;

function baghdadToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readDatabase(selectedPath) {
  return new Promise((resolve, reject) => {
    if (!selectedPath) return reject(new Error('اختر قاعدة البيانات من الإعدادات أولاً.'));
    const besideDatabase = path.join(path.dirname(path.dirname(selectedPath)), 'Ahleat School.exe');
    const adjacentProgram = path.join(path.dirname(path.dirname(adjacentDatabasePath)), 'Ahleat School.exe');
    const programPath = [besideDatabase, savedSettings.programPath, adjacentProgram].find(candidate => candidate && fs.existsSync(candidate));
    if (!programPath) return reject(new Error('ملف البرنامج الأصلي غير موجود بجوار قاعدة البيانات.'));
    execFile(powershell, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptDir, 'read-data.ps1'),
      '-DatabasePath', selectedPath, '-ProgramPath', programPath
    ], { cwd: scriptDir, timeout: 20_000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
    (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim()));
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); }
      catch (parseError) { reject(new Error(`تعذر تفسير بيانات البرنامج: ${parseError.message}`)); }
    });
  });
}

async function dashboard(force = false) {
  const selectedPath = databasePath;
  if (!force && cache && cachePath === selectedPath && Date.now() - cacheTime < cacheMs) return cache;
  if (loading && loadingPath === selectedPath) return loading;
  const task = readDatabase(selectedPath).then(raw => {
    const result = buildDashboard(raw, baghdadToday());
    if (databasePath === selectedPath) {
      cache = result;
      cachePath = selectedPath;
      cacheTime = Date.now();
    }
    return result;
  }).finally(() => { if (loading === task) loading = null; });
  loading = task;
  loadingPath = selectedPath;
  return loading;
}

function settings() {
  return {
    databasePath, schoolName: savedSettings.schoolName, isDefault: databasePath === defaultDatabasePath,
    exists: !!databasePath && fs.existsSync(databasePath), theme: savedSettings.theme,
    logoUrl: savedSettings.logoFile && fs.existsSync(path.join(dataDir, savedSettings.logoFile)) ? '/api/logo' : null
  };
}

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(savedSettings, null, 2), 'utf8');
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 16_384) {
        reject(new Error('الطلب أكبر من الحد المسموح'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function readBinaryBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('حجم الشعار أكبر من الحد المسموح'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function readTextBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('المستند أكبر من الحد المسموح')); request.destroy(); }
      else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function darkEnough(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] < 0.28;
}

function backupArchive() {
  if (!databasePath || !fs.existsSync(databasePath)) throw new Error('قاعدة البيانات غير موجودة');
  const before = fs.statSync(databasePath);
  const data = fs.readFileSync(databasePath);
  const after = fs.statSync(databasePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('تغير ملف القاعدة أثناء النسخ. أعد المحاولة.');
  const entries = [
    ['database.mdb', data],
    ['settings.json', JSON.stringify({ schoolName: savedSettings.schoolName, theme: savedSettings.theme, databaseFile: 'database.mdb', logoFile: savedSettings.logoFile }, null, 2)],
    ['README.txt', 'نسخة احتياطية من لوحة الأقساط للعام الدراسي 2026-2027.\r\nأغلق برنامج المدرسة قبل استعادة قاعدة البيانات.\r\n']
  ];
  if (savedSettings.logoFile) {
    const logoPath = path.join(dataDir, savedSettings.logoFile);
    if (fs.existsSync(logoPath)) entries.push([savedSettings.logoFile, fs.readFileSync(logoPath)]);
  }
  return createZip(entries);
}

function selectDatabase() {
  if (selecting) return selecting;
  selecting = new Promise((resolve, reject) => {
    execFile(powershell, [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptDir, 'select-database.ps1'),
      '-InitialPath', databasePath
    ], { cwd: scriptDir, timeout: 120_000, maxBuffer: 4096, encoding: 'utf8', windowsHide: true },
    (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim())) : resolve(stdout.replace(/^\uFEFF/, '').trim()));
  }).finally(() => { selecting = null; });
  return selecting;
}

function respond(response, status, type, body) {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
  response.end(body);
}

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/report-data.js', ['report-data.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/print.css', ['print.css', 'text/css; charset=utf-8']],
  ['/fonts/NotoNaskhArabic.ttf', ['fonts/NotoNaskhArabic.ttf', 'font/ttf']]
]);

const server = http.createServer(async (request, response) => {
  if (!new Set([`${host}:${actualPort}`, `localhost:${actualPort}`]).has(request.headers.host)) {
    return respond(response, 403, 'text/plain; charset=utf-8', 'الوصول محلي فقط');
  }
  const url = new URL(request.url, `http://${host}:${actualPort}`);
  if (request.method === 'POST' && url.pathname === '/api/export/table') {
    const origin = request.headers.origin;
    if (origin && !new Set([`http://${host}:${actualPort}`, `http://localhost:${actualPort}`]).has(origin)) {
      return respond(response, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'مصدر الطلب غير مسموح' }));
    }
    try {
      const format = url.searchParams.get('format');
      if (!['xlsx', 'csv'].includes(format)) throw new Error('صيغة التصدير غير مدعومة');
      const report = JSON.parse(await readTextBody(request, 5 * 1024 * 1024));
      if (typeof report.title !== 'string' || report.title.length > 100 || !Array.isArray(report.headers) || !report.headers.length || report.headers.length > 30 || !report.headers.every(item => typeof item === 'string' && item.length <= 100) || !Array.isArray(report.rows) || report.rows.length > 5000 || !report.rows.every(row => Array.isArray(row) && row.length === report.headers.length && row.every(value => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 1000 || value === null))) throw new Error('بيانات الجدول غير صالحة');
      const body = format === 'xlsx' ? toXlsx(report) : toCsv(report);
      const filename = `${report.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 90)}.${format}`;
      response.writeHead(200, {
        'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
        'Content-Length': Buffer.byteLength(body), 'Content-Disposition': `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      return response.end(body);
    } catch (error) {
      console.error('تعذر تصدير الجدول:', error.message);
      return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'تعذر تصدير الجدول المحدد.' }));
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/export/pdf') {
    const origin = request.headers.origin;
    if (origin && !new Set([`http://${host}:${actualPort}`, `http://localhost:${actualPort}`]).has(origin)) {
      return respond(response, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'مصدر الطلب غير مسموح' }));
    }
    if (process.versions.electron) return respond(response, 501, 'application/json; charset=utf-8', JSON.stringify({ error: 'استخدم زر الحفظ في نافذة التطبيق.' }));
    let folder;
    try {
      const html = await readTextBody(request, 5 * 1024 * 1024);
      if (!html.startsWith('<!doctype html>') || !html.includes('id="print-document"')) throw new Error('مستند الطباعة غير صالح');
      const orientation = url.searchParams.get('orientation') === 'portrait' ? 'portrait' : 'landscape';
      const title = (url.searchParams.get('title') || 'تقرير الأقساط').replace(/[\\/:*?"<>|]/g, '').slice(0, 90);
      folder = fs.mkdtempSync(path.join(os.tmpdir(), 'school-pdf-'));
      const htmlPath = path.join(folder, 'document.html');
      const pdfPath = path.join(folder, 'document.pdf');
      const stylesheet = fs.readFileSync(path.join(publicDir, 'print.css'), 'utf8')
        .replaceAll('__ORIENTATION__', orientation).replaceAll('__PRIMARY__', savedSettings.theme.primary)
        .replace("url('/fonts/NotoNaskhArabic.ttf')", `url('data:font/ttf;base64,${fs.readFileSync(path.join(publicDir, 'fonts', 'NotoNaskhArabic.ttf')).toString('base64')}')`);
      let printable = html.replace(/<link rel="stylesheet" href="\/print\.css\?orientation=(?:portrait|landscape)">/, `<style>${stylesheet}</style>`);
      if (printable === html) throw new Error('تنسيق المستند غير مكتمل');
      if (savedSettings.logoFile) {
        const logo = fs.readFileSync(path.join(dataDir, savedSettings.logoFile));
        const mime = savedSettings.logoFile.endsWith('.png') ? 'image/png' : 'image/jpeg';
        printable = printable.replace('src="/api/logo"', `src="data:${mime};base64,${logo.toString('base64')}"`);
      }
      printable = printable.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`);
      fs.writeFileSync(htmlPath, printable, 'utf8');
      const electronExecutable = require('electron');
      await new Promise((resolve, reject) => execFile(electronExecutable, [path.join(__dirname, 'pdf-worker.js'), htmlPath, pdfPath, orientation],
        { windowsHide: true, timeout: 90_000, maxBuffer: 64 * 1024, cwd: __dirname },
        (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim())) : resolve()));
      const pdf = fs.readFileSync(pdfPath);
      response.writeHead(200, {
        'Content-Type': 'application/pdf', 'Content-Length': pdf.length,
        'Content-Disposition': `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(`${title}.pdf`)}`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      return response.end(pdf);
    } catch (error) {
      console.error('تعذر إنشاء الملف القابل للطباعة:', error.message);
      return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'تعذر إنشاء الملف. أعد المحاولة.' }));
    } finally {
      if (folder) {
        for (const name of ['document.html', 'document.pdf']) {
          try { fs.unlinkSync(path.join(folder, name)); } catch {}
        }
        try { fs.rmdirSync(folder); } catch {}
      }
    }
  }
  if (request.method === 'POST' && url.pathname.startsWith('/api/settings/')) {
    const origin = request.headers.origin;
    if (origin && !new Set([`http://${host}:${actualPort}`, `http://localhost:${actualPort}`]).has(origin)) {
      return respond(response, 403, 'application/json; charset=utf-8', JSON.stringify({ error: 'مصدر الطلب غير مسموح' }));
    }
    if (url.pathname === '/api/settings/database/select') {
      try {
        const selected = await selectDatabase();
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(selected ? { path: selected } : { cancelled: true }));
      } catch (error) {
        console.error('تعذر اختيار الملف:', error.message);
        return respond(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'تعذر فتح نافذة اختيار الملف. يمكنك كتابة المسار مباشرة.' }));
      }
    }
    if (url.pathname === '/api/settings/database') {
      try {
        const body = JSON.parse(await readBody(request));
        if (typeof body.path !== 'string' || !body.path.trim()) throw new Error('اكتب مسار قاعدة البيانات أولاً.');
        const candidate = path.resolve(body.path.trim());
        if (candidate.includes(';') || path.extname(candidate).toLowerCase() !== '.mdb' || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
          throw new Error('اختر ملف قاعدة بيانات موجوداً بامتداد مناسب.');
        }
        const validated = buildDashboard(await readDatabase(candidate), baghdadToday());
        savedSettings.databasePath = candidate;
        const candidateProgram = path.join(path.dirname(path.dirname(candidate)), 'Ahleat School.exe');
        if (fs.existsSync(candidateProgram)) savedSettings.programPath = candidateProgram;
        saveSettings();
        databasePath = candidate;
        cache = validated;
        cachePath = candidate;
        cacheTime = Date.now();
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(settings()));
      } catch (error) {
        console.error('تعذر حفظ قاعدة البيانات:', error.message);
        const message = /^(اكتب مسار|اختر ملف)/.test(error.message) ? error.message : 'تعذر قراءة الملف أو جداول الطلاب والأقساط المطلوبة منه.';
        return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: message }));
      }
    }
    if (url.pathname === '/api/settings/theme') {
      try {
        const theme = JSON.parse(await readBody(request));
        if (!['primary', 'sidebar'].every(key => typeof theme[key] === 'string' && /^#[0-9a-f]{6}$/i.test(theme[key]) && darkEnough(theme[key]))) {
          throw new Error('اختر ألواناً داكنة حتى تبقى الكتابة واضحة.');
        }
        savedSettings.theme = { primary: theme.primary.toLowerCase(), sidebar: theme.sidebar.toLowerCase() };
        saveSettings();
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(settings()));
      } catch (error) {
        return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
      }
    }
    if (url.pathname === '/api/settings/name') {
      try {
        const body = JSON.parse(await readBody(request));
        if (!validSchoolName(body.schoolName)) throw new Error('اكتب اسم مدرسة بين حرفين و80 حرفاً دون رموز غير صالحة.');
        savedSettings.schoolName = body.schoolName.trim().replace(/\s+/g, ' ');
        saveSettings();
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(settings()));
      } catch (error) {
        return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
      }
    }
    if (url.pathname === '/api/settings/logo') {
      try {
        const data = await readBinaryBody(request, 2 * 1024 * 1024);
        const isPng = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const isJpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
        if (!isPng && !isJpeg) throw new Error('اختر صورة بصيغة مناسبة للشعار.');
        const name = isPng ? 'logo.png' : 'logo.jpg';
        const previousLogo = savedSettings.logoFile;
        fs.writeFileSync(path.join(dataDir, name), data);
        savedSettings.logoFile = name;
        saveSettings();
        if (previousLogo && previousLogo !== name) {
          try { fs.unlinkSync(path.join(dataDir, previousLogo)); } catch {}
        }
        return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(settings()));
      } catch (error) {
        return respond(response, 400, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
      }
    }
    if (url.pathname === '/api/settings/logo/remove') {
      const oldLogo = savedSettings.logoFile;
      savedSettings.logoFile = null;
      saveSettings();
      if (oldLogo) {
        try { fs.unlinkSync(path.join(dataDir, oldLogo)); } catch {}
      }
      return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(settings()));
    }
  }
  if (request.method !== 'GET') return respond(response, 405, 'text/plain; charset=utf-8', 'الطلب غير مدعوم');
  if (url.pathname === '/api/settings') {
    return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(settings()));
  }
  if (url.pathname === '/api/logo') {
    if (!savedSettings.logoFile) return respond(response, 404, 'text/plain; charset=utf-8', 'الشعار غير موجود');
    try {
      const file = path.join(dataDir, savedSettings.logoFile);
      return respond(response, 200, savedSettings.logoFile.endsWith('.png') ? 'image/png' : 'image/jpeg', fs.readFileSync(file));
    } catch { return respond(response, 404, 'text/plain; charset=utf-8', 'الشعار غير موجود'); }
  }
  if (url.pathname === '/api/backup') {
    try {
      const archive = backupArchive();
      const name = `school-installments-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      response.writeHead(200, {
        'Content-Type': 'application/zip', 'Content-Length': archive.length,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      return response.end(archive);
    } catch (error) {
      console.error('تعذر إنشاء النسخة الاحتياطية:', error.message);
      return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: error.message }));
    }
  }
  if (url.pathname === '/api/dashboard') {
    try {
      const data = await dashboard(url.searchParams.has('refresh'));
      return respond(response, 200, 'application/json; charset=utf-8', JSON.stringify(data));
    } catch (error) {
      console.error('تعذر قراءة البيانات:', error.message);
      return respond(response, 503, 'application/json; charset=utf-8', JSON.stringify({ error: 'تعذر قراءة قاعدة بيانات البرنامج. تأكد من وجودها وإمكانية فتحها.' }));
    }
  }
  if (url.pathname === '/api/export') {
    try {
      const format = url.searchParams.get('format') || 'csv';
      if (!['csv', 'xlsx'].includes(format)) throw new Error('صيغة التصدير غير مدعومة');
      const report = createReport(await dashboard(), url.searchParams.get('type') || 'classes', url.searchParams.get('search') || '', {
        className: url.searchParams.get('class') || 'all', year: url.searchParams.get('year') || 'all',
        from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || ''
      });
      const fileName = `${report.title}${report.type.startsWith('previous') ? '' : ' - 2026-2027'}.${format}`;
      const body = format === 'xlsx' ? toXlsx(report) : toCsv(report);
      response.writeHead(200, {
        'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report.${format}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      return response.end(body);
    } catch (error) {
      console.error('تعذر تصدير التقرير:', error.message);
      return respond(response, 503, 'text/plain; charset=utf-8', 'تعذر تصدير التقرير');
    }
  }
  if (url.pathname === '/health') return respond(response, 200, 'text/plain; charset=utf-8', 'جاهز');
  if (url.pathname === '/print.css') {
    const orientation = url.searchParams.get('orientation') === 'portrait' ? 'portrait' : 'landscape';
    return respond(response, 200, 'text/css; charset=utf-8', fs.readFileSync(path.join(publicDir, 'print.css'), 'utf8').replaceAll('__ORIENTATION__', orientation).replaceAll('__PRIMARY__', savedSettings.theme.primary));
  }
  const file = files.get(url.pathname);
  if (!file) return respond(response, 404, 'text/plain; charset=utf-8', 'الصفحة غير موجودة');
  try {
    return respond(response, 200, file[1], fs.readFileSync(path.join(publicDir, file[0])));
  } catch {
    return respond(response, 500, 'text/plain; charset=utf-8', 'تعذر فتح الواجهة');
  }
});

function startServer(openBrowser = false) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      actualPort = server.address().port;
      console.log(`لوحة الأقساط جاهزة: http://${host}:${actualPort}`);
      if (openBrowser) {
        execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process 'http://${host}:${actualPort}'`], { windowsHide: true }, () => {});
      }
      resolve(actualPort);
    });
  });
}

if (require.main === module) startServer(process.argv.includes('--open')).catch(error => {
  console.error('تعذر تشغيل اللوحة:', error.message);
  process.exitCode = 1;
});

module.exports = { startServer, server };
