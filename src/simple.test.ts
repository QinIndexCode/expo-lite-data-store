// Simple test to verify Jest is working

describe('Simple Test', () => {
  it('should pass a simple test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle strings correctly', () => {
    expect('hello').toBe('hello');
  });

  it('should handle arrays correctly', () => {
    expect([1, 2, 3]).toEqual([1, 2, 3]);
  });
});
