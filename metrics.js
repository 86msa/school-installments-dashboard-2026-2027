'use strict';

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const digits = String(value).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
    .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
  const parsed = Number(digits.replace(/[,٬\s]/g, '').replace(/٫/g, '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function discountAmount(value, gross) {
  const text = String(value ?? '').trim().replace(/[٪％]/g, '%');
  if (!text || text === '%') return 0;
  return text.endsWith('%') ? Math.round(gross * number(text.slice(0, -1)) / 100) : number(text);
}

function schoolYear(value) {
  const years = String(value ?? '').match(/20\d{2}/g) || [];
  if (years.length < 2) return String(value ?? '').trim();
  return years.map(Number).sort((a, b) => a - b).join('–');
}

function buildDashboard(raw, today = new Date()) {
  const dateKey = typeof today === 'string' ? today : localDate(today);
  const studentsById = new Map();
  const active = (raw.students || []).filter(s => s.Deleted !== true);
  for (const student of active) studentsById.set(String(student.ID), student);
  const currentReceipts = new Map();
  const paymentMonths = new Map();
  const receipts = [];
  let unmatchedCurrentReceipts = 0;

  for (const receipt of raw.receipts || []) {
    const student = studentsById.get(String(receipt.idd).trim());
    if (!student) { unmatchedCurrentReceipts++; continue; }
    const amount = number(receipt.WslValue);
    const id = String(student.ID);
    if (!currentReceipts.has(id)) currentReceipts.set(id, []);
    const item = {
      id: receipt.IDMain, number: receipt.ID, studentId: student.ID,
      student: student.StName || '', className: student.Class || '',
      date: receipt.WslDate || '', amount, notes: receipt.Notes || ''
    };
    currentReceipts.get(id).push(item);
    receipts.push(item);
    const month = item.date.slice(0, 7);
    paymentMonths.set(month, (paymentMonths.get(month) || 0) + amount);
  }

  const students = active.map(student => {
    const id = String(student.ID);
    const ownReceipts = (currentReceipts.get(id) || []).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const gross = number(student.QstAll);
    const discount = discountAmount(student.DisCount, gross);
    const net = gross - discount;
    const paid = ownReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
    const balance = Math.max(0, net - paid);
    const recordedBalance = number(student.Baqi);
    const status = balance <= 0 ? 'paid' : paid <= 0 ? 'unpaid' : 'partial';
    const nextDueDate = student.DateNextQst || '';
    return {
      id: student.ID, name: student.StName || '', className: student.Class || '',
      section: student.Shu || '', gross, discount, discountRate: gross > 0 ? discount / gross : 0, net, paid, balance,
      recordedBalance, discrepancy: net - paid - recordedBalance,
      status, nextDueDate, nextDueAmount: number(student.ValueNextQst),
      overdue: balance > 0 && Boolean(nextDueDate) && nextDueDate < dateKey,
      fatherMobile: student.FatherMobile || '', motherMobile: student.MotherMobile || '',
      receipts: ownReceipts
    };
  });

  const previousById = new Map();
  const previous = (raw.previousStudents || []).filter(s => s.Deleted !== true);
  for (const student of previous) previousById.set(String(student.ID), student);
  const previousReceiptsById = new Map();
  let unmatchedPreviousReceipts = 0;
  for (const receipt of raw.previousReceipts || []) {
    const id = String(receipt.idd).trim();
    if (!previousById.has(id)) { unmatchedPreviousReceipts++; continue; }
    if (!previousReceiptsById.has(id)) previousReceiptsById.set(id, []);
    previousReceiptsById.get(id).push({
      number: receipt.ID, date: receipt.WslDate || '', amount: number(receipt.WslValue)
    });
  }
  const previousDebts = previous.map(student => {
    const ownReceipts = (previousReceiptsById.get(String(student.ID)) || [])
      .sort((a, b) => b.date.localeCompare(a.date));
    const gross = number(student.QstAll);
    const discount = discountAmount(student.DisCount, gross);
    const net = gross - discount;
    const paid = ownReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
    const balance = Math.max(0, net - paid);
    const recordedBalance = number(student.Baqi);
    return {
      id: student.ID, year: schoolYear(student.sn), name: student.StName || '',
      className: student.Class || '', gross, discount, net, paid, balance,
      recordedBalance, discrepancy: net - paid - recordedBalance,
      status: balance <= 0 ? 'paid' : paid <= 0 ? 'unpaid' : 'partial',
      lastReceiptDate: ownReceipts[0]?.date || '', receipts: ownReceipts
    };
  }).filter(student => student.year === '2025–2026');

  const byClass = new Map();
  for (const student of students) {
    if (!byClass.has(student.className)) {
      byClass.set(student.className, { className: student.className, count: 0, gross: 0, discount: 0, net: 0, paid: 0, balance: 0, overdue: 0 });
    }
    const row = byClass.get(student.className);
    row.count++;
    for (const key of ['gross', 'discount', 'net', 'paid', 'balance']) row[key] += student[key];
    if (student.overdue) row.overdue++;
  }

  const summary = {
    students: students.length, gross: sum(students, 'gross'), discount: sum(students, 'discount'),
    net: sum(students, 'net'), paid: sum(students, 'paid'), balance: sum(students, 'balance'),
    unpaid: students.filter(s => s.status === 'unpaid').length,
    partial: students.filter(s => s.status === 'partial').length,
    fullyPaid: students.filter(s => s.status === 'paid').length,
    overdue: students.filter(s => s.overdue).length,
    previousBalance: sum(previousDebts, 'balance'),
    previousDebtStudents: previousDebts.filter(s => s.balance > 0).length,
    collectionRate: sum(students, 'net') ? sum(students, 'paid') / sum(students, 'net') : 0
  };
  summary.discountedStudents = students.filter(student => student.discount > 0).length;
  summary.discountRate = summary.gross > 0 ? summary.discount / summary.gross : 0;
  summary.discountedStudentRate = summary.students ? summary.discountedStudents / summary.students : 0;
  for (const row of byClass.values()) {
    row.discountRate = row.gross > 0 ? row.discount / row.gross : 0;
    row.discountedStudents = students.filter(student => student.className === row.className && student.discount > 0).length;
  }
  const warnings = {
    currentBalanceMismatch: students.filter(s => Math.abs(s.discrepancy) > 1).length,
    previousBalanceMismatch: previousDebts.filter(s => Math.abs(s.discrepancy) > 1).length,
    unmatchedCurrentReceipts, unmatchedPreviousReceipts
  };

  return {
    schoolYear: '2026–2027', readAt: raw.readAt || null, summary, warnings,
    byClass: [...byClass.values()].sort((a, b) => classOrder(a.className) - classOrder(b.className)),
    paymentMonths: [...paymentMonths.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount })),
    students, receipts: receipts.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    previousDebts
  };
}

function sum(items, key) { return items.reduce((total, item) => total + item[key], 0); }
function localDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function classOrder(name) {
  const order = ['الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'];
  const index = order.findIndex(word => String(name).startsWith(word));
  return index < 0 ? 99 : index;
}

module.exports = { buildDashboard, number, discountAmount, schoolYear };
