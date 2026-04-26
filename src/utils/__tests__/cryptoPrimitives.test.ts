import { createHash, createHmac, hkdfSync, pbkdf2Sync } from 'node:crypto';
import { hashBytesSync, hashHexSync, hkdfBytesSync, hmacBytesSync, pbkdf2BytesSync } from '../cryptoPrimitives';

describe('cryptoPrimitives', () => {
  test('pbkdf2BytesSync matches node crypto sha256 output', () => {
    const password = 'test-password';
    const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const iterations = 2048;
    const dkLen = 48;

    const actual = pbkdf2BytesSync(password, salt, iterations, dkLen, 'sha256');
    const expected = pbkdf2Sync(password, salt, iterations, dkLen, 'sha256');

    expect(Buffer.from(actual).toString('hex')).toBe(expected.toString('hex'));
  });

  test('hkdfBytesSync matches node crypto sha256 output', () => {
    const ikm = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88]);
    const salt = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
    const dkLen = 42;

    const actual = hkdfBytesSync(ikm, salt, dkLen);
    const expected = hkdfSync('sha256', ikm, salt, Buffer.alloc(0), dkLen);

    expect(Buffer.from(actual).toString('hex')).toBe(Buffer.from(expected).toString('hex'));
  });

  test('hmacBytesSync matches node crypto sha512 output', () => {
    const key = new Uint8Array([5, 4, 3, 2, 1]);
    const actual = hmacBytesSync('payload', key, 'SHA-512');
    const expected = createHmac('sha512', key).update('payload').digest();

    expect(Buffer.from(actual).toString('hex')).toBe(expected.toString('hex'));
  });

  test('hash helpers match node crypto sha256 output', () => {
    const expectedHex = createHash('sha256').update('hello-world').digest('hex');
    expect(hashHexSync('hello-world', 'SHA-256')).toBe(expectedHex);
    expect(Buffer.from(hashBytesSync('hello-world', 'SHA-256')).toString('hex')).toBe(expectedHex);
  });
});
