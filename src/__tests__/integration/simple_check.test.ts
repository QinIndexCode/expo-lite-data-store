
import { join } from 'path';

describe('Simple Test', () => {
  it('should pass', () => {
    expect(join('a', 'b')).toBe('a\\b'); // Windows path separator
  });
});
