import { join, sep } from 'path';

describe('Simple Test', () => {
  it('should pass', () => {
    expect(join('a', 'b')).toBe(`a${sep}b`);
  });
});
