import { bytesToHex, hexToBytes } from '../byteEncoding';

describe('byteEncoding', () => {
  it('bytesToHex returns lowercase hexadecimal output', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff');
  });

  it('bytesToHex returns an empty string for empty input', () => {
    expect(bytesToHex(new Uint8Array())).toBe('');
  });

  it('hexToBytes round-trips lowercase hexadecimal input', () => {
    expect(hexToBytes('000fa0ff')).toEqual(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]));
  });

  it('hexToBytes rejects odd-length input', () => {
    expect(() => hexToBytes('abc')).toThrow('Hex input must have an even length');
  });
});
