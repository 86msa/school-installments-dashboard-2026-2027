'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboard, discountAmount, schoolYear } = require('./metrics');
const { createReport, toCsv, matchesFields } = require('./public/report-data');

test('discounts and receipts reconcile against the stored balance', () => {
  const raw = {
    students: [
      { ID: 10, StName: 'طالب', Class: 'الاول', QstAll: 3_000_000, DisCount: '10%', Baqi: '1,700,000', DateNextQst: '2026-09-01', Deleted: false },
      { ID: 11, StName: 'محذوف', Class: 'الاول', QstAll: 3_000_000, DisCount: '', Baqi: '3,000,000', Deleted: true }
    ],
    receipts: [
      { IDMain: 1, ID: 1, idd: '10', WslValue: 1_000_000, WslDate: '2026-08-01' },
      { IDMain: 2, ID: 2, idd: '11', WslValue: 100_000, WslDate: '2026-08-02' }
    ],
    previousStudents: [], previousReceipts: []
  };
  const result = buildDashboard(raw, '2026-10-06');
  assert.equal(result.summary.students, 1);
  assert.equal(result.summary.discount, 300_000);
  assert.equal(result.summary.net, 2_700_000);
  assert.equal(result.summary.paid, 1_000_000);
  assert.equal(result.summary.balance, 1_700_000);
  assert.equal(result.summary.overdue, 1);
  assert.equal(result.warnings.currentBalanceMismatch, 0);
  assert.equal(result.warnings.unmatchedCurrentReceipts, 1);
});

test('archive IDs remain separate from current student IDs', () => {
  const raw = {
    students: [{ ID: 7, StName: 'حالي', Class: 'الثاني', QstAll: 1000, DisCount: '', Baqi: '600', Deleted: false }],
    receipts: [{ IDMain: 1, ID: 1, idd: '7', WslValue: 400, WslDate: '2026-08-01' }],
    previousStudents: [{ ID: 7, sn: ' 2026 / 2025 ', StName: 'سابق', Class: 'الاول', QstAll: 2000, DisCount: '', Baqi: '1500', Deleted: false }],
    previousReceipts: [{ ID: 9, idd: '7', WslValue: 500, WslDate: '2026-07-01' }]
  };
  const result = buildDashboard(raw, '2026-10-06');
  assert.equal(result.summary.paid, 400);
  assert.equal(result.summary.balance, 600);
  assert.equal(result.summary.previousBalance, 1500);
  assert.equal(result.previousDebts[0].year, '2025–2026');
  assert.equal(result.warnings.previousBalanceMismatch, 0);
});

test('previous debt totals and reports include only 2025–2026', () => {
  const raw = {
    students: [], receipts: [],
    previousStudents: [
      { ID: 1, sn: '2024 / 2023', StName: 'دين أقدم', Class: 'الاول', QstAll: 7000, Baqi: 7000, Deleted: false },
      { ID: 2, sn: '2026 / 2025', StName: 'الدين المطلوب', Class: 'الثاني', QstAll: 2000, Baqi: 1500, Deleted: false }
    ],
    previousReceipts: [{ ID: 1, idd: '2', WslValue: 500, WslDate: '2026-07-01' }]
  };
  const data = buildDashboard(raw, '2026-10-06');
  assert.equal(data.previousDebts.length, 1);
  assert.equal(data.previousDebts[0].year, '2025–2026');
  assert.equal(data.summary.previousBalance, 1500);
  assert.equal(data.summary.previousDebtStudents, 1);
  assert.equal(createReport(data, 'previous').rows.length, 1);
  assert.equal(createReport(data, 'previous-open').rows.length, 1);
});

test('parses amount and percentage discounts', () => {
  assert.equal(discountAmount('420,000', 3_200_000), 420_000);
  assert.equal(discountAmount('5%', 3_200_000), 160_000);
  assert.equal(discountAmount('١٠٪', 3_200_000), 320_000);
  assert.equal(discountAmount('۵％', 3_200_000), 160_000);
  assert.equal(discountAmount('١٢٫٥٪', 3_200_000), 400_000);
  assert.equal(schoolYear('2024 / 2023'), '2023–2024');
});

test('discount totals use weighted gross fees and keep deleted and prior-year students out', () => {
  const data = buildDashboard({
    students: [
      { ID: 1, StName: 'طالب تجريبي أ', Class: 'الاول', QstAll: 1000, DisCount: '10٪', Baqi: 900 },
      { ID: 2, StName: 'طالب تجريبي ب', Class: 'الثاني', QstAll: 3000, DisCount: '600', Baqi: 2400 },
      { ID: 3, StName: 'دون خصم', Class: 'الاول', QstAll: 1000, DisCount: '', Baqi: 1000 },
      { ID: 4, StName: 'محذوف', Class: 'الاول', QstAll: 10000, DisCount: '50%', Deleted: true }
    ], receipts: [],
    previousStudents: [{ ID: 1, sn: '2025 / 2026', QstAll: 10000, DisCount: '50%' }], previousReceipts: []
  });
  assert.equal(data.summary.discount, 700);
  assert.equal(data.summary.discountRate, 0.14);
  assert.equal(data.summary.discountedStudents, 2);
  assert.equal(data.summary.discountedStudentRate, 2 / 3);
  assert.equal(data.students[0].discountRate, 0.1);
  assert.equal(data.byClass[0].discountRate, 0.05);
  assert.equal(data.byClass[0].discountedStudents, 1);
  assert.equal(data.summary.gross - data.summary.discount, data.summary.net);
  const report = createReport(data, 'discounts');
  assert.deepEqual(report.rows.map(row => row[0]), [2, 1]);
  assert.equal(report.rows[0][6], '20.0%');
  assert.equal(createReport(data, 'discounts', 'تجريبي أ', { className: 'الاول' }).rows.length, 1);
  assert.equal(createReport(data, 'discounts', '', { minRate: 15, maxRate: 25 }).rows.length, 1);
  assert.equal(createReport(data, 'discounts', '', { className: 'الثالث' }).rows.length, 0);
  assert.equal(createReport(data, 'discounts', '', { minRate: 25, maxRate: 15 }).rows.length, 0);
  assert.match(toCsv(report), /نسبة الخصم/);
});

test('empty data and full discounts produce finite rates', () => {
  const empty = buildDashboard({});
  assert.equal(empty.summary.discountRate, 0);
  assert.equal(empty.summary.discountedStudentRate, 0);
  assert.deepEqual(createReport(empty, 'discounts').rows, []);
  const full = buildDashboard({ students: [{ ID: 1, QstAll: 1000, DisCount: '100%' }, { ID: 2, QstAll: 0 }] });
  assert.equal(full.students[0].net, 0);
  assert.equal(full.students[0].discountRate, 1);
  assert.equal(full.students[1].discountRate, 0);
  assert.equal(full.summary.discountRate, 1);
});

test('detailed reports keep previous debts separate and produce Arabic CSV', () => {
  const raw = {
    students: [{ ID: 1, StName: 'طالب', Class: 'الاول', QstAll: 1000, DisCount: '', Baqi: '1000', DateNextQst: '2026-09-01', Deleted: false }],
    receipts: [],
    previousStudents: [{ ID: 1, sn: '2026 / 2025', StName: 'سابق', Class: 'الاول', QstAll: 500, DisCount: '', Baqi: '500', Deleted: false }],
    previousReceipts: []
  };
  const data = buildDashboard(raw, '2026-10-06');
  assert.equal(createReport(data, 'unpaid').rows.length, 1);
  assert.equal(createReport(data, 'overdue').rows.length, 1);
  assert.equal(createReport(data, 'previous-open').rows.length, 1);
  const csv = toCsv(createReport(data, 'previous-open'));
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /"السنة"/);
  assert.match(csv, /"سابق"/);
});

test('multi-word Arabic search and report filters narrow the exported rows', () => {
  const student = { id: 15, name: 'طالب تجريبي افتراضي', className: 'الثالث الابتدائي', section: 'أ', fatherMobile: '', motherMobile: '00000000000', gross: 3200000, discount: 0, net: 3200000, paid: 0, balance: 3200000, overdue: true, status: 'unpaid', nextDueDate: '2026-04-28', nextDueAmount: 1200000 };
  const data = {
    students: [student],
    receipts: [{ number: 9, date: '2026-09-15', studentId: 15, student: student.name, className: student.className, amount: 500000, notes: 'القسط الأول' }],
    previousDebts: [{ id: 3, year: '2025–2026', name: 'طالب سابق', className: 'الثاني', gross: 1000000, discount: 0, net: 1000000, paid: 0, balance: 1000000, lastReceiptDate: '' }]
  };
  assert.equal(matchesFields([student.name, student.id], 'طالب افتراضي ١٥'), true);
  assert.equal(createReport(data, 'students', 'طالب افتراضي', { className: student.className }).rows.length, 1);
  assert.equal(createReport(data, 'students', 'طالب افتراضي', { className: 'الرابع الابتدائي' }).rows.length, 0);
  assert.equal(createReport(data, 'receipts', 'القسط', { from: '2026-09-01', to: '2026-09-30' }).rows.length, 1);
  assert.equal(createReport(data, 'receipts', '', { from: '2026-10-01' }).rows.length, 0);
  assert.equal(createReport(data, 'previous', '', { year: '2025–2026' }).rows.length, 1);
  assert.equal(createReport(data, 'previous', '', { year: '2023–2024' }).rows.length, 0);
});
