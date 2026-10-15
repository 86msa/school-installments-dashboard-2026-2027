'use strict';

const state = { data: null, view: 'overview', loading: false, loadingPromise: null, studentsPage: 1, receiptsPage: 1, discountsPage: 1, detail: null, printTitle: '' };
const pageSize = 100;
const $ = id => document.getElementById(id);
const isolateNumber = value => `\u2066${value}\u2069`;
const schoolYear = isolateNumber('2026–2027');
const money = value => isolateNumber(new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value || 0));
const plainNumber = value => new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 0 }).format(value || 0);
const latinDigits = value => String(value ?? '').replace(/[٠-٩۰-۹]/g, digit => {
  const code = digit.charCodeAt(0);
  return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
});
const percent = value => isolateNumber(new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(value || 0));
const dateLabel = value => value ? isolateNumber(value.split('-').reverse().map(Number).map(plainNumber).join('/')) : '—';
const amount = value => `${money(value)} د.ع`;
const shortMoney = amount;
const baghdadDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const escapeHtml = value => latinDigits(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const matchesFields = (fields, query) => window.ReportData.matchesFields(fields, query);

function card(label, value, help = '', icon = '◇', type = '') {
  return `<div class="stat-card ${type} ${value.includes('د.ع') ? 'currency-card' : ''}"><div class="stat-label"><span>${escapeHtml(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-help">${escapeHtml(help)}</div></div>`;
}

function table(headers, rows, empty = 'لا توجد سجلات مطابقة') {
  if (!rows.length) return `<div class="empty">${escapeHtml(empty)}</div>`;
  return `<table class="data-table"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => {
    const content = typeof cell === 'object' && cell !== null ? (cell.html ?? escapeHtml(cell.value)) : escapeHtml(cell);
    const numeric = typeof cell === 'object' && cell !== null && cell.numeric ? ' class="numeric"' : '';
    return `<td${numeric}>${content}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}

function statusBadge(item) {
  if (item.overdue) return '<span class="badge overdue">متأخر</span>';
  const labels = { paid: 'مسدد', partial: 'جزئي', unpaid: 'غير مدفوع' };
  return `<span class="badge ${item.status}">${labels[item.status]}</span>`;
}

function renderOverview() {
  const { summary: s, byClass, paymentMonths, students, previousDebts } = state.data;
  $('overview-cards').innerHTML = [
    card('الطلاب النشطون', money(s.students), 'طالب ضمن السنة الحالية', '♙'),
    card('صافي الأقساط', shortMoney(s.net), `بعد خصومات ${shortMoney(s.discount)}`, '▧'),
    card('إجمالي الخصومات', amount(s.discount), `من الأقساط قبل الخصم: ${percent(s.discountRate)}`, '%'),
    card('الطلاب المستفيدون', money(s.discountedStudents), `${percent(s.discountedStudentRate)} من الطلاب النشطين`, '♙'),
    card('نسبة الخصومات', percent(s.discountRate), 'إجمالي الخصومات ÷ إجمالي الأقساط قبل الخصم', '%'),
    card('المبلغ المقبوض', shortMoney(s.paid), `نسبة التحصيل ${percent(s.collectionRate)}`, '↗', 'primary'),
    card('المبلغ المتبقي', shortMoney(s.balance), 'على الطلاب النشطين', '◴'),
    card('أقساط متأخرة', money(s.overdue), 'طلاب تجاوزوا موعد الاستحقاق', '!', 'warn')
  ].join('');

  const discountAngle = Math.max(0, Math.min(360, s.discountRate * 360));
  $('discount-chart').innerHTML = `<div class="donut-area discount-donut"><div class="donut"><div class="donut-inner"><strong>${percent(s.discountRate)}</strong><small>نسبة الخصومات</small></div></div><div class="legend"><div class="legend-item"><i class="legend-dot legend-discount"></i> الخصومات <strong>${amount(s.discount)}</strong></div><div class="legend-item"><i class="legend-dot legend-unpaid"></i> الصافي <strong>${amount(s.net)}</strong></div><div class="stat-help">قبل الخصم: ${amount(s.gross)}<br>المستفيدون: ${money(s.discountedStudents)} طالب</div></div></div>`;
  $('discount-chart').querySelector('.donut').style.background = `conic-gradient(#9464bc 0deg ${discountAngle}deg, #e7eee9 ${discountAngle}deg 360deg)`;
  $('discount-class-chart').innerHTML = byClass.length ? byClass.map(row => `<div class="discount-class-row"><span>${escapeHtml(row.className)}</span><strong>${amount(row.discount)} · ${percent(row.discountRate)}</strong><div class="class-track"><div class="discount-bar" data-width="${Math.max(0, Math.min(100, row.discountRate * 100))}"></div></div><small>${money(row.discountedStudents)} مستفيد من ${money(row.count)} طالب</small></div>`).join('') : '<div class="empty">لا توجد صفوف</div>';
  $('discount-class-chart').querySelectorAll('[data-width]').forEach(bar => { bar.style.width = `${bar.dataset.width}%`; });

  const max = Math.max(1, ...paymentMonths.map(row => row.amount));
  $('monthly-chart').innerHTML = paymentMonths.length ? paymentMonths.map(row => {
    const [year, month] = row.month.split('-');
    return `<div class="month-column" title="${escapeHtml(`${dateLabel(`${year}-${month}-01`)} — ${amount(row.amount)}`)}"><span class="month-amount">${escapeHtml(amount(row.amount))}</span><div class="month-track"><div class="month-bar" data-height="${Math.max(3, row.amount / max * 100)}"></div></div><span class="month-label" dir="ltr">${plainNumber(Number(month))}/${plainNumber(Number(year))}</span></div>`;
  }).join('') : '<div class="empty">لا توجد وصولات</div>';
  $('monthly-chart').querySelectorAll('.month-bar').forEach(bar => { bar.style.height = `${bar.dataset.height}%`; });

  const paidAngle = s.students ? s.fullyPaid / s.students * 360 : 0;
  const partialAngle = s.students ? (s.fullyPaid + s.partial) / s.students * 360 : 0;
  $('status-chart').innerHTML = `<div class="donut-area"><div class="donut"><div class="donut-inner"><strong>${money(s.students)}</strong><small>طالب</small></div></div><div class="legend"><div class="legend-item"><i class="legend-dot legend-paid"></i> مسدد <strong>${money(s.fullyPaid)}</strong></div><div class="legend-item"><i class="legend-dot legend-partial"></i> جزئي <strong>${money(s.partial)}</strong></div><div class="legend-item"><i class="legend-dot legend-unpaid"></i> غير مدفوع <strong>${money(s.unpaid)}</strong></div></div></div>`;
  $('status-chart').querySelector('.donut').style.background = `conic-gradient(#2ba36f 0deg ${paidAngle}deg, #f0b765 ${paidAngle}deg ${partialAngle}deg, #dce9e2 ${partialAngle}deg 360deg)`;

  $('class-chart').innerHTML = byClass.map(row => {
    const paidWidth = row.net ? row.paid / row.net * 100 : 0;
    const balanceWidth = row.net ? row.balance / row.net * 100 : 0;
    return `<div class="class-row"><div class="class-name" title="${escapeHtml(row.className)}">${escapeHtml(row.className)}</div><div class="class-track" title="مقبوض: ${amount(row.paid)}، متبقٍ: ${amount(row.balance)}"><div class="class-paid" data-width="${Math.min(100, paidWidth)}"></div><div class="class-balance" data-width="${Math.min(100, balanceWidth)}"></div></div><div class="class-numbers">${escapeHtml(shortMoney(row.paid))} مقبوض</div></div>`;
  }).join('') + '<div class="chart-legend"><span><i class="legend-dot legend-paid"></i> مقبوض</span><span><i class="legend-dot legend-balance"></i> متبقٍ</span></div>';
  $('class-chart').querySelectorAll('[data-width]').forEach(bar => { bar.style.width = `${bar.dataset.width}%`; });

  $('previous-preview').innerHTML = `<div class="previous-big">${shortMoney(s.previousBalance)}</div><div class="previous-caption">عدد الطلاب المدينين: ${money(s.previousDebtStudents)} · سنة 2025–2026</div>`;
  const overdue = students.filter(student => student.overdue).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate)).slice(0, 8);
  $('overdue-preview').innerHTML = table(['الطالب', 'الصف', 'موعد القسط', 'المتبقي', 'الحالة'], overdue.map(student => [
    { html: `<button class="row-button" data-student="${student.id}">${escapeHtml(student.name)}</button>` },
    student.className, dateLabel(student.nextDueDate), { value: amount(student.balance), numeric: true }, statusBadge(student) ? { html: statusBadge(student) } : ''
  ]), 'لا توجد أقساط متأخرة');
}

function fillSelect(id, values, allLabel, formatLabel = value => value) {
  const select = $(id);
  const current = select.value;
  select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(formatLabel(value))}</option>`).join('');
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

function prepareFilters() {
  const classes = state.data.byClass.map(row => row.className);
  fillSelect('students-class', classes, 'كل الصفوف');
  fillSelect('discounts-class', classes, 'كل الصفوف');
  fillSelect('receipts-class', classes, 'كل الصفوف');
  fillSelect('report-class', classes, 'كل الصفوف');
}

function filteredStudents() {
  const query = $('students-search').value;
  const className = $('students-class').value;
  const status = $('students-status').value;
  const minimum = $('students-min').value === '' ? null : Number($('students-min').value);
  const maximum = $('students-max').value === '' ? null : Number($('students-max').value);
  return state.data.students.filter(row =>
    matchesFields([row.name, row.id, row.className, row.section, row.fatherMobile, row.motherMobile], query) &&
    (className === 'all' || row.className === className) &&
    (status === 'all' || (status === 'overdue' ? row.overdue : row.status === status)) &&
    (minimum === null || row.balance >= minimum) && (maximum === null || row.balance <= maximum)
  );
}

function renderStudents() {
  if (!state.data) return;
  const rows = filteredStudents();
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.studentsPage = Math.min(state.studentsPage, pages);
  const visible = rows.slice((state.studentsPage - 1) * pageSize, state.studentsPage * pageSize);
  $('student-count').textContent = `${money(rows.length)} من ${money(state.data.students.length)} طالب`;
  $('students-table').innerHTML = table(['الطالب', 'الصف', 'الإجمالي', 'الخصم', 'الصافي', 'المقبوض', 'المتبقي', 'القسط القادم', 'الحالة'], visible.map(row => [
    { html: `<button class="row-button" data-student="${row.id}">${escapeHtml(row.name)}</button>` }, row.className,
    { value: amount(row.gross), numeric: true }, { value: amount(row.discount), numeric: true },
    { value: amount(row.net), numeric: true }, { value: amount(row.paid), numeric: true },
    { value: amount(row.balance), numeric: true }, dateLabel(row.nextDueDate), { html: statusBadge(row) }
  ]));
  $('students-pager').innerHTML = pager('students', state.studentsPage, pages);
}

function discountFilters() {
  return { className: $('discounts-class').value, minRate: $('discounts-min-rate').value, maxRate: $('discounts-max-rate').value };
}

function filteredDiscounts() {
  return window.ReportData.selectDiscounts(state.data, $('discounts-search').value, discountFilters());
}

function renderDiscounts() {
  if (!state.data) return;
  const rows = filteredDiscounts();
  const total = rows.reduce((sum, row) => sum + row.discount, 0);
  const gross = rows.reduce((sum, row) => sum + row.gross, 0);
  $('discount-cards').innerHTML = [
    card('خصومات النتائج المعروضة', amount(total), 'مجموع الخصومات بعد البحث والفلترة', '%', 'primary'),
    card('الطلاب المستفيدون', money(rows.length), `من ${money(state.data.summary.discountedStudents)} مستفيد في السنة الحالية`, '♙'),
    card('نسبة خصومات النتائج', percent(gross > 0 ? total / gross : 0), 'من إجمالي أقساط الطلاب الظاهرين قبل الخصم', '%')
  ].join('');
  $('discount-count').textContent = `${money(rows.length)} من ${money(state.data.summary.discountedStudents)} مستفيد`;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.discountsPage = Math.min(state.discountsPage, pages);
  $('discounts-table').innerHTML = table(['الطالب', 'الصف', 'الشعبة', 'القسط قبل الخصم', 'الخصم', 'نسبة الخصم', 'سبب الخصم', 'الصافي', 'المقبوض', 'المتبقي'], rows.slice((state.discountsPage - 1) * pageSize, state.discountsPage * pageSize).map(row => [
    { html: `<button class="row-button" data-student="${row.id}">${escapeHtml(row.name)}</button>` }, row.className, row.section || '—',
    { value: amount(row.gross), numeric: true }, { value: amount(row.discount), numeric: true },
    { value: percent(row.discountRate), numeric: true }, { html: `<span class="discount-reason">${escapeHtml(row.discountReason || 'غير مسجل')}</span>` }, { value: amount(row.net), numeric: true },
    { value: amount(row.paid), numeric: true }, { value: amount(row.balance), numeric: true }
  ]), 'لا يوجد طلاب حاصلون على خصومات ضمن هذه الفلاتر');
  $('discounts-pager').innerHTML = pager('discounts', state.discountsPage, pages);
}

function filteredReceipts() {
  const query = $('receipts-search').value;
  const className = $('receipts-class').value;
  const from = $('receipts-from').value;
  const to = $('receipts-to').value;
  return state.data.receipts.filter(row =>
    matchesFields([row.student, row.number, row.studentId, row.className, row.notes], query) &&
    (className === 'all' || row.className === className) && (!from || row.date >= from) && (!to || row.date <= to)
  );
}

function renderReceipts() {
  if (!state.data) return;
  const rows = filteredReceipts();
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  state.receiptsPage = Math.min(state.receiptsPage, pages);
  const visible = rows.slice((state.receiptsPage - 1) * pageSize, state.receiptsPage * pageSize);
  $('receipt-count').textContent = `${money(rows.length)} من ${money(state.data.receipts.length)} وصل · ${amount(rows.reduce((sum, row) => sum + row.amount, 0))}`;
  $('receipts-table').innerHTML = table(['رقم الوصل', 'التاريخ', 'الطالب', 'الصف', 'المبلغ', 'ملاحظات'], visible.map(row => [
    { value: row.number, numeric: true }, dateLabel(row.date),
    { html: `<button class="row-button" data-student="${row.studentId}">${escapeHtml(row.student)}</button>` },
    row.className, { value: amount(row.amount), numeric: true }, row.notes || '—'
  ]));
  $('receipts-pager').innerHTML = pager('receipts', state.receiptsPage, pages);
}

function pager(target, page, pages) {
  if (pages <= 1) return '';
  return `<button type="button" data-page-target="${target}" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>السابق</button><span>صفحة ${money(page)} من ${money(pages)}</span><button type="button" data-page-target="${target}" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>التالي</button>`;
}

function filteredPrevious() {
  const query = $('previous-search').value;
  const status = $('previous-status').value;
  const minimum = $('previous-min').value === '' ? null : Number($('previous-min').value);
  return state.data.previousDebts.filter(row =>
    matchesFields([row.name, row.id, row.year, row.className], query) &&
    (status === 'all' || (status === 'open' ? row.balance > 0 : row.balance <= 0)) &&
    (minimum === null || row.balance >= minimum)
  );
}

function renderPrevious() {
  if (!state.data) return;
  const all = state.data.previousDebts;
  const open = all.filter(row => row.balance > 0);
  const scope = 'السنة 2025–2026';
  $('previous-cards').innerHTML = [
    card('الرصيد السابق القائم', shortMoney(open.reduce((sum, row) => sum + row.balance, 0)), scope, '◴', 'primary'),
    card('طلاب عليهم دين سابق', money(open.length), scope, '♙'),
    card('المقبوض من السجلات السابقة', shortMoney(all.reduce((sum, row) => sum + row.paid, 0)), scope, '↗')
  ].join('');
  const rows = filteredPrevious();
  $('previous-count').textContent = `${money(rows.length)} من ${money(all.length)} سجل · ${scope}`;
  $('previous-table').innerHTML = table(['السنة الدراسية', 'الطالب', 'الصف السابق', 'القسط', 'الخصم', 'المقبوض', 'المتبقي', 'آخر وصل', 'الحالة'], rows.map(row => [
    latinDigits(row.year), { html: `<button class="row-button" data-previous="${row.id}">${escapeHtml(row.name)}</button>` },
    row.className, { value: amount(row.gross), numeric: true }, { value: amount(row.discount), numeric: true },
    { value: amount(row.paid), numeric: true }, { value: amount(row.balance), numeric: true },
    dateLabel(row.lastReceiptDate), { html: statusBadge(row) }
  ]));
}

function reportDefinition() {
  return window.ReportData.createReport(state.data, $('report-type').value, $('report-search').value, {
    className: $('report-class').value, year: '2025–2026',
    from: $('report-from').value, to: $('report-to').value
  });
}

function renderReports() {
  if (!state.data) return;
  const type = $('report-type').value;
  const previous = type.startsWith('previous');
  $('report-class-wrap').hidden = previous;
  $('report-from-wrap').hidden = type !== 'receipts';
  $('report-to-wrap').hidden = type !== 'receipts';
  const report = reportDefinition();
  const total = window.ReportData.createReport(state.data, type).rows.length;
  $('report-title').textContent = report.title;
  $('report-meta').textContent = `${money(report.rows.length)} من ${money(total)} سجل · ${report.type.startsWith('previous') ? 'ديون سنة 2025–2026' : `العام الدراسي ${schoolYear}`} · تاريخ التقرير ${dateLabel(baghdadDate())}`;
  $('report-table').innerHTML = table(report.headers, report.rows.map(row => row.map((value, index) => {
    if (typeof value === 'number') {
      const monetary = ['الإجمالي', 'الخصومات', 'الخصم', 'الصافي', 'المقبوض', 'المتبقي', 'المبلغ', 'قيمة القسط القادم'].includes(report.headers[index]);
      return { value: monetary ? amount(value) : money(value), numeric: true };
    }
    if (report.type.startsWith('previous') && index === 0) return latinDigits(value);
    if (typeof value === 'string' && /^\d+(\.\d+)?%$/.test(value)) return percent(Number(value.slice(0, -1)) / 100);
    return value;
  })));
}

function renderAll() {
  if (!state.data) return;
  prepareFilters();
  renderOverview(); renderStudents(); renderDiscounts(); renderReceipts(); renderPrevious(); renderReports();
  const when = state.data.readAt ? new Date(state.data.readAt).toLocaleString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' }) : 'الآن';
  $('last-updated').textContent = `آخر قراءة من قاعدة البرنامج: ${when}`;
  const warnings = state.data.warnings;
  const count = warnings.currentBalanceMismatch + warnings.previousBalanceMismatch + warnings.unmatchedCurrentReceipts + warnings.unmatchedPreviousReceipts;
  if (count) showMessage(`توجد ${money(count)} حالات تحتاج مراجعة تطابق الأرصدة أو ربط الوصولات.`, false);
  else hideMessage();
}

function showMessage(text, error) { const message = $('message'); message.textContent = text; message.className = `message${error ? ' error' : ''}`; message.hidden = false; }
function hideMessage() { $('message').hidden = true; }

async function load(force = false) {
  if (state.loading) {
    await state.loadingPromise;
    if (force) return load(true);
    return;
  }
  state.loading = true;
  $('refresh-button').disabled = true;
  state.loadingPromise = (async () => {
    try {
      const response = await fetch(`/api/dashboard${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error || 'تعذر جلب البيانات');
      state.data = await response.json();
      renderAll();
    } catch (error) { showMessage(error.message || 'تعذر تحديث البيانات', true); }
    finally { state.loading = false; $('refresh-button').disabled = false; }
  })();
  return state.loadingPromise;
}

function renderSettings(settings) {
  state.settings = settings;
  const schoolName = settings.schoolName || 'لوحة الأقساط';
  $('brand-name').textContent = schoolName;
  $('school-name').value = schoolName;
  $('brand-logo').alt = `شعار ${schoolName}`;
  document.title = `${schoolName} | 2026–2027`;
  $('database-current').textContent = settings.databasePath;
  $('database-path').value = settings.databasePath;
  $('database-state').textContent = settings.exists ? 'الملف موجود' : 'الملف غير موجود';
  applyTheme(settings.theme);
  $('theme-primary').value = settings.theme.primary;
  $('theme-sidebar').value = settings.theme.sidebar;
  const hasLogo = !!settings.logoUrl;
  $('brand-logo').hidden = !hasLogo;
  $('brand-mark').hidden = hasLogo;
  $('logo-remove').disabled = !hasLogo;
  if (hasLogo) {
    const url = `${settings.logoUrl}?v=${Date.now()}`;
    $('brand-logo').src = url;
    $('logo-preview').innerHTML = `<img src="${url}" alt="معاينة الشعار">`;
  } else $('logo-preview').textContent = '◈';
}

function applyTheme(theme) {
  document.documentElement.style.setProperty('--brand-primary', theme.primary);
  document.documentElement.style.setProperty('--brand-sidebar', theme.sidebar);
}

async function saveSchoolName(event) {
  event.preventDefault();
  const button = $('school-name-save');
  button.disabled = true;
  $('school-name-feedback').textContent = 'جارٍ حفظ الاسم…';
  try {
    const response = await fetch('/api/settings/name', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolName: $('school-name').value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderSettings(result);
    $('school-name-feedback').textContent = 'تم حفظ اسم المدرسة.';
  } catch (error) { $('school-name-feedback').textContent = error.message || 'تعذر حفظ الاسم.'; }
  finally { button.disabled = false; }
}

async function saveTheme() {
  $('theme-feedback').textContent = 'جارٍ حفظ الألوان…';
  try {
    const response = await fetch('/api/settings/theme', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary: $('theme-primary').value, sidebar: $('theme-sidebar').value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderSettings(result);
    $('theme-feedback').textContent = 'تم حفظ الألوان.';
  } catch (error) { $('theme-feedback').textContent = error.message || 'تعذر حفظ الألوان'; }
}

async function saveLogo() {
  const file = $('logo-input').files[0];
  if (!file) return $('logo-feedback').textContent = 'اختر صورة الشعار أولاً.';
  if (file.size > 2 * 1024 * 1024) return $('logo-feedback').textContent = 'حجم الصورة كبير؛ الحد الأقصى 2 ميغابايت.';
  $('logo-feedback').textContent = 'جارٍ حفظ الشعار…';
  try {
    const response = await fetch('/api/settings/logo', { method: 'POST', body: file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderSettings(result);
    $('logo-input').value = '';
    $('logo-file-name').textContent = 'لم تُحدد صورة';
    $('logo-feedback').textContent = 'تم حفظ الشعار.';
  } catch (error) { $('logo-feedback').textContent = error.message || 'تعذر حفظ الشعار'; }
}

async function removeLogo() {
  try {
    const response = await fetch('/api/settings/logo/remove', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderSettings(result);
    $('logo-feedback').textContent = 'تمت إزالة الشعار.';
  } catch (error) { $('logo-feedback').textContent = error.message || 'تعذر إزالة الشعار'; }
}

async function downloadBackup() {
  $('backup-button').disabled = true;
  $('backup-feedback').textContent = 'جارٍ تجهيز النسخة الاحتياطية…';
  try {
    const response = await fetch('/api/backup', { cache: 'no-store' });
    if (!response.ok) throw new Error((await response.json()).error || 'تعذر إنشاء النسخة الاحتياطية');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `نسخة-الأقساط-${baghdadDate()}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    $('backup-feedback').textContent = 'تم تجهيز النسخة للتنزيل.';
  } catch (error) { $('backup-feedback').textContent = error.message; }
  finally { $('backup-button').disabled = false; }
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings', { cache: 'no-store' });
    if (!response.ok) throw new Error('تعذر قراءة الإعدادات');
    const settings = await response.json();
    renderSettings(settings);
    if (!settings.exists && state.view !== 'settings') navigate('settings');
  } catch (error) { $('database-feedback').textContent = error.message; }
}

async function browseDatabase() {
  const button = $('database-browse');
  button.disabled = true;
  $('database-feedback').textContent = 'جارٍ فتح نافذة اختيار الملف…';
  try {
    const response = await fetch('/api/settings/database/select', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'تعذر اختيار الملف');
    if (result.path) {
      $('database-path').value = result.path;
      $('database-feedback').textContent = 'تم اختيار الملف. اضغط حفظ مصدر البيانات لاعتماده.';
    } else $('database-feedback').textContent = '';
  } catch (error) { $('database-feedback').textContent = error.message; }
  finally { button.disabled = false; }
}

async function saveDatabase(event) {
  event.preventDefault();
  const button = $('database-save');
  button.disabled = true;
  $('database-feedback').textContent = 'جارٍ فحص قاعدة البيانات…';
  try {
    const response = await fetch('/api/settings/database', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: $('database-path').value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'تعذر حفظ مصدر البيانات');
    renderSettings(result);
    $('database-feedback').textContent = 'تم حفظ مصدر البيانات وتحديث اللوحة.';
    await load(true);
  } catch (error) { $('database-feedback').textContent = error.message; }
  finally { button.disabled = false; }
}

function navigate(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active', section.id === view));
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const names = { overview: ['نظرة عامة على الأقساط', `متابعة التحصيل والاستحقاقات للعام الدراسي ${schoolYear}`], students: ['الطلاب والأقساط', 'تفاصيل الحسابات والحالات المستحقة'], receipts: ['وصولات القبض', 'حركة التحصيل من قاعدة بيانات البرنامج'], previous: ['ديون سنة 2025–2026', 'الأرصدة ووصولات سدادها لهذه السنة فقط'], reports: ['التقارير التفصيلية', 'كشوف قابلة للطباعة والتصدير'], settings: ['الإعدادات', 'اختيار قاعدة البيانات التي تغذي اللوحة'] };
  names.discounts = ['الخصومات', 'مبالغ الخصومات ونسبها والطلاب المستفيدون لسنة 2026–2027'];
  $('page-title').textContent = names[view][0];
  $('page-subtitle').textContent = names[view][1];
  $('print-current').hidden = view === 'settings';
  $('export-wrap').hidden = view === 'settings';
  closeExportMenu();
  if (view === 'settings') loadSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showStudent(id) {
  const row = state.data.students.find(student => String(student.id) === String(id));
  if (!row) return;
  state.detail = { type: 'student', id: row.id };
  $('detail-print').textContent = '▧ معاينة وطباعة ملف الطالب';
  const receiptList = row.receipts.length ? row.receipts.map(r => `<div><span>وصل ${escapeHtml(r.number)} · ${dateLabel(r.date)}</span><strong>${amount(r.amount)}</strong></div>`).join('') : '<p class="detail-note">لا توجد وصولات قبض مسجلة.</p>';
  const discountDetails = row.discount > 0 ? `<h3>تفاصيل الخصم</h3><div class="detail-list"><div><span>نسبة الخصم</span><strong>${percent(row.discountRate)}</strong></div><div><span>سبب الخصم</span><strong>${escapeHtml(row.discountReason || 'غير مسجل')}</strong></div></div>` : '';
  $('detail-content').innerHTML = `<div class="detail-kicker">ملف الطالب · السنة الحالية</div><h2 id="detail-title">${escapeHtml(row.name)}</h2><div class="detail-sub">${escapeHtml(row.className)} · رقم الطالب ${escapeHtml(row.id)}</div><div class="detail-summary"><div class="detail-mini"><small>صافي القسط</small><strong>${amount(row.net)}</strong></div><div class="detail-mini"><small>الخصم</small><strong>${amount(row.discount)}</strong></div><div class="detail-mini"><small>المقبوض</small><strong>${amount(row.paid)}</strong></div><div class="detail-mini"><small>المتبقي</small><strong>${amount(row.balance)}</strong></div></div>${discountDetails}<h3>الاستحقاق القادم</h3><div class="detail-list"><div><span>التاريخ</span><strong>${dateLabel(row.nextDueDate)}</strong></div><div><span>قيمة القسط</span><strong>${amount(row.nextDueAmount)}</strong></div><div><span>الحالة</span>${statusBadge(row)}</div></div><h3>وصولات القبض</h3><div class="detail-list">${receiptList}</div><h3>بيانات الاتصال</h3><div class="detail-list"><div><span>هاتف الأب</span><strong>${escapeHtml(row.fatherMobile || '—')}</strong></div><div><span>هاتف الأم</span><strong>${escapeHtml(row.motherMobile || '—')}</strong></div></div><p class="detail-note">تُعرض ديون 2025–2026 في تقرير مستقل.</p>`;
  openDetail();
}

function showPrevious(id) {
  const row = state.data.previousDebts.find(student => String(student.id) === String(id));
  if (!row) return;
  state.detail = { type: 'previous', id: row.id };
  $('detail-print').textContent = '▧ معاينة وطباعة ملف الدين';
  const receipts = row.receipts.length ? row.receipts.map(r => `<div><span>وصل ${escapeHtml(r.number)} · ${dateLabel(r.date)}</span><strong>${amount(r.amount)}</strong></div>`).join('') : '<p class="detail-note">لا توجد وصولات قبض مسجلة.</p>';
  $('detail-content').innerHTML = `<div class="detail-kicker">ملف دين سابق · ${escapeHtml(latinDigits(row.year))}</div><h2 id="detail-title">${escapeHtml(row.name)}</h2><div class="detail-sub">${escapeHtml(row.className)} · رقم الأرشيف ${escapeHtml(row.id)}</div><div class="detail-summary"><div class="detail-mini"><small>القسط الأصلي</small><strong>${amount(row.gross)}</strong></div><div class="detail-mini"><small>الخصم</small><strong>${amount(row.discount)}</strong></div><div class="detail-mini"><small>المقبوض</small><strong>${amount(row.paid)}</strong></div><div class="detail-mini"><small>الدين المتبقي</small><strong>${amount(row.balance)}</strong></div></div><h3>وصولات هذا الدين</h3><div class="detail-list">${receipts}</div><p class="detail-note">رقم الأرشيف مستقل عن رقم الطالب في السنة الحالية؛ لا تُجمع الحسابات تلقائياً.</p>`;
  openDetail();
}

function openDetail() { $('detail-overlay').hidden = false; $('detail-close').focus(); document.body.style.overflow = 'hidden'; }
function closeDetail() { $('detail-overlay').hidden = true; state.detail = null; if ($('print-preview').hidden) document.body.style.overflow = ''; }

function exportReport() {
  const format = $('export-format').value;
  if (format === 'pdf') return printCurrent();
  const params = new URLSearchParams({
    type: $('report-type').value, search: $('report-search').value, format,
    class: $('report-class').value, year: '2025–2026',
    from: $('report-from').value, to: $('report-to').value
  });
  const link = document.createElement('a');
  link.href = `/api/export?${params}`;
  document.body.append(link); link.click(); link.remove();
}

function sectionExportReport() {
  if (state.view === 'overview') return window.ReportData.createReport(state.data, 'classes');
  if (state.view === 'discounts') return window.ReportData.createReport(state.data, 'discounts', $('discounts-search').value, discountFilters());
  if (state.view === 'students') return {
    title: 'كشف الطلاب والأقساط',
    headers: ['رقم الطالب', 'الاسم', 'الصف', 'الإجمالي', 'الخصم', 'الصافي', 'المقبوض', 'المتبقي', 'موعد القسط القادم', 'الحالة'],
    rows: filteredStudents().map(row => [row.id, row.name, row.className, row.gross, row.discount, row.net, row.paid, row.balance, row.nextDueDate, row.overdue ? 'متأخر' : row.status === 'paid' ? 'مسدد' : row.status === 'partial' ? 'جزئي' : 'غير مدفوع'])
  };
  if (state.view === 'receipts') return {
    title: 'وصولات القبض', headers: ['رقم الوصل', 'التاريخ', 'الطالب', 'الصف', 'المبلغ', 'ملاحظات'],
    rows: filteredReceipts().map(row => [row.number, row.date, row.student, row.className, row.amount, row.notes || ''])
  };
  if (state.view === 'previous') return {
    title: 'ديون سنة 2025–2026', headers: ['السنة', 'رقم الأرشيف', 'الطالب', 'الصف', 'الإجمالي', 'الخصم', 'الصافي', 'المقبوض', 'المتبقي', 'آخر وصل'],
    rows: filteredPrevious().map(row => [row.year, row.id, row.name, row.className, row.gross, row.discount, row.net, row.paid, row.balance, row.lastReceiptDate])
  };
  return reportDefinition();
}

function closeExportMenu() { $('export-menu').hidden = true; $('export-current').setAttribute('aria-expanded', 'false'); }

async function exportSection(format) {
  closeExportMenu();
  if (format === 'pdf') return printCurrent();
  if (!state.data) return showMessage('انتظر حتى تكتمل قراءة البيانات.', true);
  const report = sectionExportReport();
  try {
    const response = await fetch(`/api/export/table?format=${format}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report)
    });
    if (!response.ok) throw new Error((await response.json()).error || 'تعذر التصدير');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.title}.${format}`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showMessage(`تم تجهيز ${report.title} للتنزيل.`, false);
  } catch (error) { showMessage(error.message || 'تعذر التصدير', true); }
}

function printTable(headers, rows, moneyColumns = []) {
  const cells = rows.map(row => `<tr>${row.map((value, index) => {
    const display = typeof value === 'number' ? (moneyColumns.includes(index) ? amount(value) : money(value))
      : /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? dateLabel(value) : latinDigits(value || '—');
    return `<td${moneyColumns.includes(index) || typeof value === 'number' ? ' class="print-number"' : ''}>${escapeHtml(display)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="print-table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${cells}</tbody></table>`;
}

function wrapPrint(title, subtitle, content) {
  const printedAt = new Date().toLocaleString('ar-IQ-u-nu-latn', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' });
  const logo = state.settings?.logoUrl ? '<img src="/api/logo" alt="شعار المدرسة">' : '<span>◈</span>';
  return `<header class="print-header"><div class="print-brand">${logo}<div><strong>${escapeHtml(state.settings?.schoolName || 'لوحة الأقساط')}</strong><small>العام الدراسي ${schoolYear}</small></div></div><div class="print-date">تاريخ الطباعة: ${escapeHtml(printedAt)}</div></header><div class="print-title"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${content}<footer class="print-footer"><span>المبالغ بالدينار العراقي · مصدر البيانات: برنامج المدرسة</span></footer>`;
}

function showPrintPreview(title, markup, orientation = 'landscape') {
  state.printTitle = title;
  $('print-document').innerHTML = markup;
  $('print-document').className = orientation;
  $('preview-title').textContent = `معاينة: ${title}`;
  $('preview-subtitle').textContent = 'راجع المستند واختر اتجاه الصفحة قبل الطباعة أو الحفظ.';
  $('preview-feedback').textContent = '';
  document.querySelector(`input[name="print-orientation"][value="${orientation}"]`).checked = true;
  $('print-preview').hidden = false;
  document.body.style.overflow = 'hidden';
  refreshPrintFrame();
}

function refreshPrintFrame() {
  const orientation = document.querySelector('input[name="print-orientation"]:checked').value;
  $('print-document').className = orientation;
  const frame = $('print-frame');
  $('preview-print').disabled = true;
  $('preview-pdf').disabled = true;
  frame.onload = () => { $('preview-print').disabled = false; $('preview-pdf').disabled = false; };
  frame.srcdoc = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(state.printTitle)}</title><link rel="stylesheet" href="/print.css?orientation=${orientation}"></head><body class="${orientation}"><section id="print-document">${$('print-document').innerHTML}</section></body></html>`;
}

function closePrintPreview() {
  $('print-preview').hidden = true;
  $('print-frame').srcdoc = '';
  $('print-document').innerHTML = '';
  if ($('detail-overlay').hidden) document.body.style.overflow = '';
}

function printPreview() {
  const frame = $('print-frame');
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

async function savePreviewPdf() {
  $('preview-pdf').disabled = true;
  $('preview-feedback').textContent = 'جارٍ تجهيز الملف…';
  try {
    const orientation = document.querySelector('input[name="print-orientation"]:checked').value;
    if (window.desktop?.savePdf) {
      const result = await window.desktop.savePdf({ title: state.printTitle, orientation });
      $('preview-feedback').textContent = result.saved ? 'تم حفظ الملف بنجاح.' : 'أُلغي الحفظ.';
    } else {
      const params = new URLSearchParams({ title: state.printTitle, orientation });
      const response = await fetch(`/api/export/pdf?${params}`, { method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: $('print-frame').srcdoc });
      if (!response.ok) throw new Error((await response.json()).error || 'تعذر تجهيز الملف.');
      const link = document.createElement('a');
      const url = URL.createObjectURL(await response.blob());
      link.href = url;
      link.download = `${state.printTitle.replace(/[\\/:*?"<>|]/g, '')}.pdf`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      $('preview-feedback').textContent = 'تم تجهيز الملف للتنزيل.';
    }
  } catch (error) { $('preview-feedback').textContent = error.message || 'تعذر حفظ الملف.'; }
  finally { $('preview-pdf').disabled = false; }
}

function printDetail() {
  if (!state.detail) return;
  const previous = state.detail.type === 'previous';
  const row = (previous ? state.data.previousDebts : state.data.students).find(item => String(item.id) === String(state.detail.id));
  if (!row) return;
  const title = previous ? `ملف دين سابق: ${row.name}` : `ملف الطالب: ${row.name}`;
  const summary = `<div class="print-summary"><div>الإجمالي<strong>${amount(row.gross)}</strong></div><div>الخصم<strong>${amount(row.discount)}</strong></div><div>الصافي<strong>${amount(row.net)}</strong></div><div>المقبوض<strong>${amount(row.paid)}</strong></div><div>المتبقي<strong>${amount(row.balance)}</strong></div></div>`;
  const details = previous ? [
    ['السنة الدراسية', latinDigits(row.year)], ['رقم الأرشيف', row.id], ['الصف السابق', row.className]
  ] : [
    ...(row.discount > 0 ? [['سبب الخصم', row.discountReason || 'غير مسجل'], ['نسبة الخصم', percent(row.discountRate)]] : []),
    ['رقم الطالب', row.id], ['الصف', row.className], ['الشعبة', row.section], ['موعد القسط القادم', dateLabel(row.nextDueDate)], ['قيمة القسط القادم', amount(row.nextDueAmount)], ['هاتف الأب', row.fatherMobile], ['هاتف الأم', row.motherMobile]
  ];
  const receiptRows = row.receipts.map(receipt => [receipt.number, receipt.date, receipt.amount]);
  const content = `${summary}<h2 class="print-section-title">بيانات ${previous ? 'الدين' : 'الطالب'}</h2>${printTable(['البيان', 'التفاصيل'], details)}<h2 class="print-section-title">وصولات القبض</h2>${receiptRows.length ? printTable(['رقم الوصل', 'التاريخ', 'المبلغ'], receiptRows, [2]) : '<p>لا توجد وصولات قبض مسجلة.</p>'}`;
  showPrintPreview(title, wrapPrint(title, previous ? `السنة ${latinDigits(row.year)}` : `العام الدراسي ${schoolYear}`, content), 'portrait');
}

function printDiscountVisuals() {
  const { summary: s, byClass } = state.data;
  const angle = Math.max(0, Math.min(360, s.discountRate * 360));
  const classes = byClass.map(row => `<div class="print-discount-class"><span>${escapeHtml(row.className)}</span><strong>${amount(row.discount)} · ${percent(row.discountRate)}</strong><div class="print-class-track"><i style="background:#9464bc;width:${Math.max(0, Math.min(100, row.discountRate * 100))}%"></i></div><small>${money(row.discountedStudents)} مستفيد</small></div>`).join('');
  return `<div class="print-chart-grid"><section class="print-chart-card"><h2>الخصومات من إجمالي الأقساط</h2><p>الخصومات ÷ الأقساط قبل الخصم · سنة 2026–2027</p><div class="print-status"><div class="print-donut" style="background:conic-gradient(#9464bc 0deg ${angle}deg, #e7eee9 ${angle}deg 360deg)"><div>${percent(s.discountRate)}<small>نسبة الخصومات</small></div></div><div class="print-legend"><span>الخصومات <strong>${amount(s.discount)}</strong></span><span>الصافي <strong>${amount(s.net)}</strong></span><span>المستفيدون <strong>${money(s.discountedStudents)}</strong></span></div></div></section><section class="print-chart-card"><h2>الخصومات حسب الصف</h2><p>المبلغ ونسبته من إجمالي أقساط كل صف قبل الخصم</p><div class="print-classes">${classes}</div></section></div>`;
}

function printOverviewVisuals() {
  const { summary: s, paymentMonths, byClass, students } = state.data;
  const maxMonth = Math.max(1, ...paymentMonths.map(row => row.amount));
  const months = paymentMonths.map(row => {
    const [year, month] = row.month.split('-');
    const height = Math.max(3, row.amount / maxMonth * 100);
    return `<div class="print-month"><span>${escapeHtml(amount(row.amount))}</span><div class="print-month-track"><i style="height:${height}%"></i></div><small>${plainNumber(Number(month))}/${year}</small></div>`;
  }).join('') || '<p>لا توجد وصولات قبض.</p>';
  const paidAngle = s.students ? s.fullyPaid / s.students * 360 : 0;
  const partialAngle = s.students ? (s.fullyPaid + s.partial) / s.students * 360 : 0;
  const status = `<div class="print-status"><div class="print-donut" style="background:conic-gradient(#2ba36f 0deg ${paidAngle}deg, #f0b765 ${paidAngle}deg ${partialAngle}deg, #dce9e2 ${partialAngle}deg 360deg)"><div>${money(s.students)}<small>طالب</small></div></div><div class="print-legend"><span><i class="print-dot print-paid"></i> مسدد <strong>${money(s.fullyPaid)}</strong></span><span><i class="print-dot print-partial"></i> جزئي <strong>${money(s.partial)}</strong></span><span><i class="print-dot print-unpaid"></i> غير مدفوع <strong>${money(s.unpaid)}</strong></span></div></div>`;
  const classes = byClass.map(row => {
    const paidWidth = row.net ? Math.min(100, row.paid / row.net * 100) : 0;
    const balanceWidth = row.net ? Math.min(100 - paidWidth, row.balance / row.net * 100) : 0;
    return `<div class="print-class-row"><span>${escapeHtml(row.className)}</span><div class="print-class-track"><i class="print-class-paid" style="width:${paidWidth}%"></i><i class="print-class-balance" style="width:${balanceWidth}%"></i></div><small>${escapeHtml(amount(row.paid))} مقبوض</small></div>`;
  }).join('');
  const overdue = students.filter(row => row.overdue).sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate)).slice(0, 8);
  const overdueTable = overdue.length ? printTable(['الطالب', 'الصف', 'الاستحقاق', 'المتبقي'], overdue.map(row => [row.name, row.className, row.nextDueDate, row.balance]), [3]) : '<p>لا توجد أقساط متأخرة.</p>';
  return `<div class="print-chart-grid"><section class="print-chart-card"><h2>التحصيل الشهري</h2><p>المبالغ المقبوضة بحسب تاريخ الوصل</p><div class="print-monthly">${months}</div></section><section class="print-chart-card"><h2>حالة سداد الطلاب</h2><p>وفق صافي القسط بعد الخصم</p>${status}</section><section class="print-chart-card print-wide"><h2>التحصيل حسب الصف</h2><p>المقبوض والمتبقي من صافي الأقساط</p><div class="print-classes">${classes}</div><div class="print-key"><span><i class="print-dot print-paid"></i> مقبوض</span><span><i class="print-dot print-balance"></i> متبقٍ</span></div></section></div><div class="print-overview-bottom"><section><h2 class="print-section-title">ديون سنة 2025–2026</h2><p>المتبقي ${amount(s.previousBalance)} · عدد الطلاب المدينين: ${money(s.previousDebtStudents)}</p></section><section><h2 class="print-section-title">أقساط متأخرة</h2>${overdueTable}</section></div>`;
}

function printCurrent() {
  if (!state.data) return showMessage('انتظر حتى تكتمل قراءة البيانات قبل الطباعة.', true);
  if (state.view === 'settings') return;
  let title, subtitle = '', headers, rows, monetary = [], summary = '', visuals = '';
  if (state.view === 'overview') {
    title = 'ملخص الأقساط';
    const s = state.data.summary;
    summary = `<div class="print-summary"><div>الطلاب النشطون<strong>${money(s.students)}</strong></div><div>صافي الأقساط<strong>${amount(s.net)}</strong></div><div>المقبوض<strong>${amount(s.paid)}</strong></div><div>المتبقي<strong>${amount(s.balance)}</strong></div><div>ديون 2025–2026<strong>${amount(s.previousBalance)}</strong></div></div>`;
    summary += `<div class="print-summary"><div>إجمالي الخصومات<strong>${amount(s.discount)}</strong></div><div>نسبة الخصومات قبل الخصم<strong>${percent(s.discountRate)}</strong></div><div>الطلاب المستفيدون<strong>${money(s.discountedStudents)}</strong></div><div>نسبتهم من الطلاب<strong>${percent(s.discountedStudentRate)}</strong></div></div>`;
    visuals = printDiscountVisuals() + printOverviewVisuals();
    const report = window.ReportData.createReport(state.data, 'classes');
    headers = report.headers; rows = report.rows; monetary = [2, 3, 4, 5, 6];
    subtitle = 'ملخص التحصيل حسب الصف';
  } else if (state.view === 'students') {
    title = 'كشف الطلاب والأقساط';
    const selected = filteredStudents();
    subtitle = `${money(selected.length)} طالب · المقبوض ${amount(selected.reduce((sum, row) => sum + row.paid, 0))} · المتبقي ${amount(selected.reduce((sum, row) => sum + row.balance, 0))}`;
    headers = ['الطالب', 'الصف', 'الإجمالي', 'الخصم', 'المقبوض', 'المتبقي', 'القسط القادم', 'الحالة'];
    rows = selected.map(row => [row.name, row.className, row.gross, row.discount, row.paid, row.balance, row.nextDueDate, row.overdue ? 'متأخر' : row.status === 'paid' ? 'مسدد' : row.status === 'partial' ? 'جزئي' : 'غير مدفوع']);
    monetary = [2, 3, 4, 5];
  } else if (state.view === 'discounts') {
    const report = sectionExportReport();
    title = report.title;
    headers = report.headers; rows = report.rows; monetary = [4, 5, 7, 8, 9];
    const selected = filteredDiscounts();
    const discount = selected.reduce((sum, row) => sum + row.discount, 0);
    const gross = selected.reduce((sum, row) => sum + row.gross, 0);
    subtitle = 'سنة 2026–2027 · نتائج البحث والفلترة الحالية · نسبة كل طالب من قسطه قبل الخصم';
    summary = `<div class="print-summary"><div>المستفيدون<strong>${money(selected.length)}</strong></div><div>إجمالي الخصومات<strong>${amount(discount)}</strong></div><div>إجمالي الأقساط قبل الخصم<strong>${amount(gross)}</strong></div><div>نسبة خصومات النتائج<strong>${percent(gross > 0 ? discount / gross : 0)}</strong></div></div>`;
  } else if (state.view === 'receipts') {
    title = 'وصولات القبض';
    const selected = filteredReceipts();
    subtitle = `${money(selected.length)} وصل · الإجمالي ${amount(selected.reduce((sum, row) => sum + row.amount, 0))}`;
    headers = ['رقم الوصل', 'التاريخ', 'الطالب', 'الصف', 'المبلغ', 'ملاحظات'];
    rows = selected.map(row => [row.number, row.date, row.student, row.className, row.amount, row.notes]);
    monetary = [4];
  } else if (state.view === 'previous') {
    title = 'ديون سنة 2025–2026';
    const selected = filteredPrevious();
    subtitle = `${money(selected.length)} سجل · المتبقي ${amount(selected.reduce((sum, row) => sum + row.balance, 0))}`;
    headers = ['السنة', 'الطالب', 'الصف', 'القسط', 'الخصم', 'المقبوض', 'المتبقي', 'آخر وصل'];
    rows = selected.map(row => [row.year, row.name, row.className, row.gross, row.discount, row.paid, row.balance, row.lastReceiptDate]);
    monetary = [3, 4, 5, 6];
  } else {
    const report = reportDefinition();
    title = report.title;
    subtitle = `${money(report.rows.length)} سجل`;
    headers = report.headers;
    rows = report.rows;
    monetary = headers.map((header, index) => ['الإجمالي', 'الخصومات', 'الخصم', 'الصافي', 'المقبوض', 'المتبقي', 'المبلغ', 'قيمة القسط القادم'].includes(header) ? index : -1).filter(index => index >= 0);
  }
  showPrintPreview(title, wrapPrint(title, subtitle, `${summary}${visuals}${state.view === 'overview' ? '<h2 class="print-section-title">تفاصيل الصفوف</h2>' : ''}${printTable(headers, rows, monetary)}`));
}

function clearFilters(section) {
  const fields = {
    students: ['students-search', 'students-min', 'students-max'],
    discounts: ['discounts-search', 'discounts-min-rate', 'discounts-max-rate'],
    receipts: ['receipts-search', 'receipts-from', 'receipts-to'],
    previous: ['previous-search', 'previous-min'],
    reports: ['report-search', 'report-from', 'report-to']
  }[section];
  fields.forEach(id => { $(id).value = ''; });
  if (section === 'students') { $('students-class').value = 'all'; $('students-status').value = 'all'; state.studentsPage = 1; renderStudents(); }
  if (section === 'discounts') { $('discounts-class').value = 'all'; state.discountsPage = 1; renderDiscounts(); }
  if (section === 'receipts') { $('receipts-class').value = 'all'; state.receiptsPage = 1; renderReceipts(); }
  if (section === 'previous') { $('previous-status').value = 'open'; renderPrevious(); }
  if (section === 'reports') { $('report-class').value = 'all'; renderReports(); }
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-view]');
  if (nav) navigate(nav.dataset.view);
  const go = event.target.closest('[data-go]');
  if (go) navigate(go.dataset.go);
  const student = event.target.closest('[data-student]');
  if (student) showStudent(student.dataset.student);
  const previous = event.target.closest('[data-previous]');
  if (previous) showPrevious(previous.dataset.previous);
  const page = event.target.closest('[data-page-target]');
  if (page && !page.disabled) {
    const panel = page.closest('.table-panel');
    state[`${page.dataset.pageTarget}Page`] = Number(page.dataset.page);
    if (page.dataset.pageTarget === 'students') renderStudents(); else if (page.dataset.pageTarget === 'discounts') renderDiscounts(); else renderReceipts();
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (event.target.closest('[data-close-detail]')) closeDetail();
  if (event.target.closest('[data-close-preview]')) closePrintPreview();
  const clear = event.target.closest('[data-clear]');
  if (clear) clearFilters(clear.dataset.clear);
  const sectionExport = event.target.closest('[data-section-export]');
  if (sectionExport) exportSection(sectionExport.dataset.sectionExport);
  if (!event.target.closest('.export-wrap')) closeExportMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('print-preview').hidden) closePrintPreview(); else if (!$('detail-overlay').hidden) closeDetail(); else closeExportMenu(); } });
$('detail-close').addEventListener('click', closeDetail);
$('detail-print').addEventListener('click', printDetail);
$('export-current').addEventListener('click', () => { const opening = $('export-menu').hidden; $('export-menu').hidden = !opening; $('export-current').setAttribute('aria-expanded', String(opening)); });
$('refresh-button').addEventListener('click', () => load(true));
for (const id of ['students-search', 'students-class', 'students-status', 'students-min', 'students-max']) $(id).addEventListener('input', () => { state.studentsPage = 1; renderStudents(); });
for (const id of ['receipts-search', 'receipts-class', 'receipts-from', 'receipts-to']) $(id).addEventListener('input', () => { state.receiptsPage = 1; renderReceipts(); });
for (const id of ['previous-search', 'previous-status', 'previous-min']) $(id).addEventListener('input', renderPrevious);
for (const id of ['discounts-search', 'discounts-class', 'discounts-min-rate', 'discounts-max-rate']) $(id).addEventListener('input', () => { state.discountsPage = 1; renderDiscounts(); });
for (const id of ['report-type', 'report-search', 'report-class', 'report-from', 'report-to']) $(id).addEventListener('input', renderReports);
$('export-button').addEventListener('click', exportReport);
$('print-button').addEventListener('click', printCurrent);
$('print-current').addEventListener('click', printCurrent);
$('preview-print').addEventListener('click', printPreview);
$('preview-pdf').addEventListener('click', savePreviewPdf);
$('preview-close').addEventListener('click', closePrintPreview);
document.querySelectorAll('input[name="print-orientation"]').forEach(input => input.addEventListener('change', refreshPrintFrame));
$('database-browse').addEventListener('click', browseDatabase);
$('database-form').addEventListener('submit', saveDatabase);
$('school-name-form').addEventListener('submit', saveSchoolName);
$('theme-save').addEventListener('click', saveTheme);
$('theme-reset').addEventListener('click', () => { $('theme-primary').value = '#197652'; $('theme-sidebar').value = '#153f38'; saveTheme(); });
$('logo-save').addEventListener('click', saveLogo);
$('logo-input').addEventListener('change', () => { $('logo-file-name').textContent = $('logo-input').files[0]?.name || 'لم تُحدد صورة'; });
$('logo-remove').addEventListener('click', removeLogo);
$('backup-button').addEventListener('click', downloadBackup);
load();
loadSettings();
setInterval(() => { if (!document.hidden) load(); }, 60_000);
