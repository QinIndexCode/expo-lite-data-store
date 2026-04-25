import { bytesToHex } from '../byteEncoding';

describe('byteEncoding', () => {
  test('bytesToHex returns lowercase hexadecimal output', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff');
  });

  test('bytesToHex returns an empty string for empty input', () => {
    expect(bytesToHex(new Uint8Array())).toBe('');
  });
});
