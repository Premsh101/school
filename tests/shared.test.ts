import { describe, expect, it } from 'vitest';
import { matchClassName, parseCsv, tableToImportRows, toCsv } from '../src/shared/csv';
import {
  formatDate,
  isValidDate,
  parseLooseDate,
  sessionMonths,
  sessionName,
  sessionStartYearFor,
  todayIST,
} from '../src/shared/dates';
import { formatINR } from '../src/shared/format';
import { can, manageableRoles } from '../src/shared/permissions';

describe('dates', () => {
  it('uses India time for today', () => {
    expect(todayIST(new Date('2026-11-19T18:29:59Z'))).toBe('2026-11-19');
    expect(todayIST(new Date('2026-11-19T18:30:00Z'))).toBe('2026-11-20');
  });
  it('names sessions and finds the session of a date', () => {
    expect(sessionName(2026)).toBe('2026-27');
    expect(sessionName(2099)).toBe('2099-00');
    expect(sessionStartYearFor('2026-04-01')).toBe(2026);
    expect(sessionStartYearFor('2027-03-31')).toBe(2026);
    expect(sessionStartYearFor('2026-03-31')).toBe(2025);
  });
  it('lists session months from April to March', () => {
    const months = sessionMonths(2026);
    expect(months[0]).toEqual({ year: 2026, month: 4 });
    expect(months[8]).toEqual({ year: 2026, month: 12 });
    expect(months[11]).toEqual({ year: 2027, month: 3 });
  });
  it('validates and reads dates the way offices write them', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(parseLooseDate('23/08/2015')).toBe('2015-08-23');
    expect(parseLooseDate('3-4-15')).toBe('2015-04-03');
    expect(parseLooseDate('2015.08.23')).toBe('2015-08-23');
    expect(parseLooseDate('31/02/2015')).toBeNull();
    expect(parseLooseDate('yesterday')).toBeNull();
    expect(formatDate('2026-11-09')).toBe('9 Nov 2026');
  });
});

describe('money format', () => {
  it('groups rupees the Indian way', () => {
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(700)).toBe('₹700');
    expect(formatINR(1800)).toBe('₹1,800');
    expect(formatINR(290075)).toBe('₹2,90,075');
    expect(formatINR(12345678)).toBe('₹1,23,45,678');
    expect(formatINR(-1500)).toBe('-₹1,500');
    expect(() => formatINR(10.5)).toThrow();
  });
});

describe('permissions', () => {
  it('gives each role only its own powers', () => {
    expect(can('admin', 'school.manage')).toBe(true);
    expect(can('principal', 'students.promote')).toBe(true);
    expect(can('principal', 'school.manage')).toBe(false);
    expect(can('principal', 'backup.manage')).toBe(false);
    expect(can('accountant', 'students.view')).toBe(true);
    expect(can('accountant', 'students.edit')).toBe(false);
    expect(can('staff', 'students.view')).toBe(false);
    expect(manageableRoles('principal')).toEqual(['accountant', 'teacher', 'staff']);
    expect(manageableRoles('teacher')).toEqual([]);
  });
});

describe('csv', () => {
  it('parses quotes, commas and line breaks', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', '2'],
    ]);
    expect(parseCsv(toCsv([['a,b', 'c"d', null, 5]]))).toEqual([['a,b', 'c"d', '', '5']]);
  });
  it('maps headings to import fields', () => {
    const { rows, unknownHeadings, missingHeadings } = tableToImportRows([
      ['Adm No', 'Student Name', "Father's Name", 'Mobile', 'Class', 'Sec', 'Roll', 'Bus'],
      ['101', 'Asha', 'Ram', '9999999999', '5', 'A', '1', 'yes'],
      ['', '', '', '', '', '', '', ''],
    ]);
    expect(unknownHeadings).toEqual(['Bus']);
    expect(missingHeadings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line: 2,
      admission_no: '101',
      name: 'Asha',
      father_name: 'Ram',
      phone: '9999999999',
      class: '5',
      section: 'A',
      roll_no: '1',
    });
    expect(tableToImportRows([['Phone'], ['1']]).missingHeadings).toEqual(['Name', 'Class']);
  });
  it('matches class names', () => {
    const names = ['Nursery', 'KG 1', 'KG 2', 'Class 1', 'Class 5', 'Class 10', 'Class 12'];
    expect(matchClassName('5', names)).toBe('Class 5');
    expect(matchClassName('Class 5', names)).toBe('Class 5');
    expect(matchClassName('V', names)).toBe('Class 5');
    expect(matchClassName('5th', names)).toBe('Class 5');
    expect(matchClassName('XII', names)).toBe('Class 12');
    expect(matchClassName('nur', names)).toBe('Nursery');
    expect(matchClassName('LKG', names)).toBe('KG 1');
    expect(matchClassName('kg 2', names)).toBe('KG 2');
    expect(matchClassName('13', names)).toBeNull();
  });
});
