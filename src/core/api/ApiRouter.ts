/** Resolves requested API versions against an immutable supported-version set. */
export class ApiRouter {
  private readonly supportedVersions: string[];
  private readonly defaultVersion: string;

  constructor(
    options: {
      defaultVersion?: string;
      supportedVersions?: string[];
    } = {}
  ) {
    const supportedVersions = [...new Set(options.supportedVersions ?? ['1.0.0', '2.0.0'])];
    if (supportedVersions.length === 0) {
      throw new Error('ApiRouter requires at least one supported API version');
    }

    const defaultVersion = options.defaultVersion ?? supportedVersions[supportedVersions.length - 1];
    if (!supportedVersions.includes(defaultVersion)) {
      throw new Error('ApiRouter defaultVersion must be included in supportedVersions');
    }

    this.supportedVersions = supportedVersions;
    this.defaultVersion = defaultVersion;
  }

  getApiVersion(version?: string): string {
    const requestedVersion = version || this.defaultVersion;

    if (this.supportedVersions.includes(requestedVersion)) {
      return requestedVersion;
    }

    return this.defaultVersion;
  }

  getSupportedVersions(): string[] {
    return [...this.supportedVersions];
  }

  getDefaultVersion(): string {
    return this.defaultVersion;
  }

  isVersionSupported(version: string): boolean {
    return this.supportedVersions.includes(version);
  }
}
