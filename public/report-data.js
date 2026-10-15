'use strict';
(function () {

function searchText(value) {
  return String(value ?? '').toLowerCase().replace(/[٠-٩۰-۹]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  }).replace(/[أإآٱ]/g, 'ا').replace(/[ىئ]/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه')
    .replace(/[ًٌٍَُِّْـ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function matchesFields(fields, query) {
  const terms = searchText(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = searchText(fields.join(' '));
  return terms.every(term => haystack.includes(term));
}

function selectDiscounts(data, query = '', filters = {}) {
  const minRate = filters.minRate == null || filters.minRate === '' ? null : Number(filters.minRate);
  const maxRate = filters.maxRate == null || filters.maxRate === '' ? null : Number(filters.maxRate);
  return data.students.filter(r => r.discount > 0 &&
    (!filters.className || filters.className === 'all' || r.className === filters.className) &&
    (minRate === null || (r.gross > 0 ? r.discount / r.gross * 100 : 0) >= minRate) &&
    (maxRate === null || (r.gross > 0 ? r.discount / r.gross * 100 : 0) <= maxRate) &&
    matchesFields([r.name, r.id, r.className, r.section, r.fatherMobile, r.motherMobile], query))
    .sort((a, b) => b.discount - a.discount || String(a.name).localeCompare(String(b.name), 'ar'));
}

function createReport(data, type = 'classes', query = '', filters = {}) {
  let title, headers, rows;
  const className = filters.className || 'all';
  const year = filters.year || 'all';
  const from = filters.from || '';
  const to = filters.to || '';
  if (type === 'classes') {
    title = 'ملخص الأقساط حسب الصف';
    headers = ['الصف', 'الطلاب', 'الإجمالي', 'الخصومات', 'الصافي', 'المقبوض', 'المتبقي', 'المتأخرون', 'نسبة التحصيل', 'نسبة الخصومات', 'المستفيدون من الخصم'];
    rows = data.byClass.filter(r => (className === 'all' || r.className === className) && matchesFields([r.className], query)).map(r =>
      [r.className, r.count, r.gross, r.discount, r.net, r.paid, r.balance, r.overdue,
        r.net ? `${(r.paid / r.net * 100).toFixed(1)}%` : '0%',
        r.gross > 0 ? `${(r.discount / r.gross * 100).toFixed(1)}%` : '0%', r.discountedStudents || 0]);
  } else if (type === 'discounts') {
    title = 'كشف الطلاب الحاصلين على الخصومات';
    headers = ['رقم الطالب', 'الاسم', 'الصف', 'الشعبة', 'الإجمالي', 'الخصم', 'نسبة الخصم', 'الصافي', 'المقبوض', 'المتبقي'];
    rows = selectDiscounts(data, query, filters).map(r => [r.id, r.name, r.className, r.section,
      r.gross, r.discount, `${(r.gross > 0 ? r.discount / r.gross * 100 : 0).toFixed(1)}%`, r.net, r.paid, r.balance]);
  } else if (['students', 'overdue', 'unpaid', 'partial', 'paid'].includes(type)) {
    title = { students: 'تقرير أقساط الطلاب', overdue: 'كشف الأقساط المتأخرة',
      unpaid: 'الطلاب غير الدافعين', partial: 'المدفوع جزئياً', paid: 'المسددون بالكامل' }[type];
    headers = ['رقم الطالب', 'الاسم', 'الصف', 'الشعبة', 'الإجمالي', 'الخصم', 'الصافي', 'المقبوض', 'المتبقي', 'الحالة', 'موعد القسط القادم', 'قيمة القسط القادم', 'هاتف الأب', 'هاتف الأم'];
    rows = data.students.filter(r => (type !== 'overdue' || r.overdue) &&
      (!['unpaid', 'partial', 'paid'].includes(type) || r.status === type) &&
      (className === 'all' || r.className === className) &&
      matchesFields([r.name, r.id, r.className, r.section, r.fatherMobile, r.motherMobile], query))
      .map(r => [r.id, r.name, r.className, r.section, r.gross, r.discount, r.net, r.paid, r.balance,
        r.overdue ? 'متأخر' : r.status === 'paid' ? 'مسدد' : r.status === 'partial' ? 'جزئي' : 'غير مدفوع',
        r.nextDueDate, r.nextDueAmount, r.fatherMobile, r.motherMobile]);
  } else if (type === 'receipts') {
    title = 'تقرير وصولات القبض';
    headers = ['رقم الوصل', 'تاريخ الوصل', 'رقم الطالب', 'الطالب', 'الصف', 'المبلغ', 'ملاحظات'];
    rows = data.receipts.filter(r => (className === 'all' || r.className === className) &&
      (!from || r.date >= from) && (!to || r.date <= to) &&
      matchesFields([r.student, r.number, r.studentId, r.className, r.notes], query))
      .map(r => [r.number, r.date, r.studentId, r.student, r.className, r.amount, r.notes]);
  } else if (type === 'previous' || type === 'previous-open') {
    title = type === 'previous-open' ? 'ديون 2025–2026 القائمة' : 'كل سجلات ديون 2025–2026';
    headers = ['السنة', 'رقم الأرشيف', 'الطالب', 'الصف السابق', 'الإجمالي', 'الخصم', 'الصافي', 'المقبوض', 'المتبقي', 'آخر وصل'];
    rows = data.previousDebts.filter(r => (type !== 'previous-open' || r.balance > 0) &&
      (year === 'all' || String(r.year) === String(year)) &&
      matchesFields([r.name, r.id, r.year, r.className], query))
      .map(r => [r.year, r.id, r.name, r.className, r.gross, r.discount, r.net, r.paid, r.balance, r.lastReceiptDate]);
  } else {
    throw new Error('نوع التقرير غير معروف');
  }
  return { title, headers, rows, type };
}

function toCsv(report) {
  const protect = value => {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [report.headers, ...report.rows].map(row => row.map(protect).join(',')).join('\r\n');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createReport, toCsv, searchText, matchesFields, selectDiscounts };
if (typeof window !== 'undefined') window.ReportData = { createReport, toCsv, searchText, matchesFields, selectDiscounts };
})();
