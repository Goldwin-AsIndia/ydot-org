import { CountPipe, countOf, verbFor } from './count.pipe';

describe('countOf', () => {
  it('uses the singular for one and the plural otherwise', () => {
    expect(countOf(1, 'attempt')).toBe('1 attempt');
    expect(countOf(0, 'attempt')).toBe('0 attempts');
    expect(countOf(3, 'attempt')).toBe('3 attempts');
  });

  it('takes an irregular plural', () => {
    expect(countOf(2, 'person', 'people')).toBe('2 people');
    expect(new CountPipe().transform(4, 'dependency', 'dependencies')).toBe('4 dependencies');
  });

  it('treats a missing count as none', () => {
    expect(countOf(null, 'record')).toBe('0 records');
  });

  it('picks the verb that agrees', () => {
    expect(verbFor(1, 'is', 'are')).toBe('is');
    expect(verbFor(2, 'is', 'are')).toBe('are');
  });
});
