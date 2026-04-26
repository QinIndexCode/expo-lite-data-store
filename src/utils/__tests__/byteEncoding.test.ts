import { bytesToHex, hexToBytes } from '../byteEncoding';

describe('byteEncoding', () => {
  test('bytesToHex returns lowercase hexadecimal output', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff');
  });

  test('bytesToHex returns an empty string for empty input', () => {
    expect(bytesToHex(new Uint8Array())).toBe('');
  });

  test('hexToBytes round-trips lowercase hexadecimal input', () => {
    expect(hexToBytes('000fa0ff')).toEqual(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]));
  });

  test('hexToBytes rejects odd-length input', () => {
    expect(() => hexToBytes('abc')).toThrow('Hex input must have an even length');
  });
});
