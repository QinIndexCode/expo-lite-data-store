import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";

export class SingleFileHandler {
  constructor(private file: File) {}

  async write(data: Record<string, any>[]) {
    const content = JSON.stringify(data);
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
    await this.file.write(JSON.stringify({ data, hash }));
  }

  async read(): Promise<Record<string, any>[]> {
    const info = await this.file.info();
    if (!info.exists) return [];

    const text = await this.file.text();
    const parsed = JSON.parse(text);
    const expected = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(parsed.data));
    if (expected !== parsed.hash) throw new Error("Data corrupted");
    return parsed.data;
  }

  async delete() {
     await this.file.delete();
  }
}