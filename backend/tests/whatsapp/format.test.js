const F = require('../../src/services/whatsappFormat');

describe('whatsappFormat', () => {
  test('clean() makes a value Meta accepts: one line, single spaces, never empty', () => {
    expect(F.clean('  Laptop\nnot\tcharging   now ')).toBe('Laptop not charging now');
    expect(F.clean('')).toBe('—');
    expect(F.clean(null, { fallback: 'there' })).toBe('there');
    expect(F.clean('a'.repeat(100), { max: 10 })).toBe(`${'a'.repeat(9)}…`);
    expect(F.clean('x     y')).not.toMatch(/\s{2,}/);
  });

  test('names', () => {
    expect(F.firstName({ first_name: 'Priya', last_name: 'Verma' })).toBe('Priya');
    expect(F.firstName({ name: 'Anil Gupta' })).toBe('Anil');
    expect(F.firstName({})).toBe('there');
    expect(F.fullName({ first_name: 'Priya', last_name: 'Verma' })).toBe('Priya Verma');
    expect(F.fullName({})).toBe('A colleague');
  });

  test('date ranges read naturally and plain dates never shift by timezone', () => {
    expect(F.formatDate('2026-11-03')).toBe('3 Nov 2026');
    expect(F.formatDateRange('2026-11-03', '2026-11-04')).toBe('3–4 Nov 2026');
    expect(F.formatDateRange('2026-10-30', '2026-11-02')).toBe('30 Oct – 2 Nov 2026');
    expect(F.formatDateRange('2026-12-28', '2027-01-02')).toBe('28 Dec 2026 – 2 Jan 2027');
    expect(F.formatDateRange('2026-11-03', '2026-11-03')).toBe('3 Nov 2026');
    expect(F.formatDate(null)).toBe('—');
  });

  test('months, hours and years', () => {
    expect(F.formatMonth(10, 2026)).toBe('October 2026');
    expect(F.formatHours(6.1667)).toBe('6h 10m');
    expect(F.formatHours(8)).toBe('8h');
    expect(F.formatYears(1)).toBe('1 year');
    expect(F.formatYears(3)).toBe('3 years');
  });

  test('maskPhone shows only enough to recognise your own number', () => {
    expect(F.maskPhone('919876543210')).toBe('+91•••••43210');
    expect(F.maskPhone('')).toBe('');
  });

  test('decisionWord', () => {
    expect(F.decisionWord('approved')).toBe('approved');
    expect(F.decisionWord('rejected')).toBe('not approved');
    expect(F.decisionWord('resolved')).toBe('resolved');
    expect(F.decisionWord('in_progress')).toBe('in progress');
  });
});
