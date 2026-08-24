import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 密封后的凭据材料：密文 + 所用 key version；明文只在调用方进程内存中存在。 */
export interface SealedSecret {
  readonly ciphertext: Buffer;
  readonly keyVersion: number;
}

/** 密封后端契约：本地 keyring 与生产 Secret Manager 实现可互换，调用方不感知后端形态。 */
export interface SecretBackend {
  /** 密封明文；后端不可用（缺主密钥/配置错误）时抛 SecretBackendUnavailableError，绝不降级明文。 */
  seal(plaintext: string): SealedSecret;
  /** 按记录的 key version 解密；版本对应密钥不在配置中时抛 SecretBackendUnavailableError。 */
  open(sealed: SealedSecret): string;
  /** 非敏感模式标识（如 local-aes-gcm），用于 /readyz；不含任何密钥材料或指纹。 */
  describe(): { readonly mode: 'local-aes-gcm' | 'unavailable' };
}

export class SecretBackendUnavailableError extends Error {
  readonly code = 'SECRET_BACKEND_UNAVAILABLE';
  constructor(message: string) { super(message); this.name = 'SecretBackendUnavailableError'; }
}

export const SECRET_MASTER_KEY_ENV = 'SAGE_SECRET_MASTER_KEY';
const KEY_LENGTH_BYTES = 32;
const CIPHER = 'aes-256-gcm';
const VERSION_BYTES = 4;

const decodeKey = (value: string): Buffer => {
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) throw new SecretBackendUnavailableError('SAGE_SECRET_MASTER_KEY must be base64 of 32 bytes');
  return key;
};

const encodeVersion = (version: number): Buffer => {
  const buffer = Buffer.alloc(VERSION_BYTES);
  buffer.writeUInt32BE(version);
  return buffer;
};

/**
 * 本地 AES-256-GCM 后端：密文布局 = keyVersion(4B BE) ‖ nonce(12B) ‖ authTag(16B) ‖ ciphertext。
 * keyVersion 即密钥表位置（current = 表长 - 1），密文内显式携带版本以支持后续轮换演进。
 */
export class LocalAesGcmSecretBackend implements SecretBackend {
  private readonly keys: readonly Buffer[];

  constructor(keys: readonly Buffer[]) {
    if (keys.length === 0 || keys.some((key) => key.length !== KEY_LENGTH_BYTES)) {
      throw new SecretBackendUnavailableError('secret keyring requires at least one 32-byte key');
    }
    this.keys = keys;
  }

  seal(plaintext: string): SealedSecret {
    const version = this.keys.length - 1;
    const nonce = randomBytes(12);
    const cipher = createCipheriv(CIPHER, this.keys[version]!, nonce);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: Buffer.concat([encodeVersion(version), nonce, cipher.getAuthTag(), body]),
      keyVersion: version
    };
  }

  open(sealed: SealedSecret): string {
    const data = sealed.ciphertext;
    if (data.length < VERSION_BYTES + 12 + 16) throw new SecretBackendUnavailableError('sealed secret is truncated');
    const version = data.readUInt32BE(0);
    const key = this.keys[version];
    if (key === undefined) throw new SecretBackendUnavailableError(`key version ${sealed.keyVersion}/${version} is not configured`);
    const nonce = data.subarray(VERSION_BYTES, VERSION_BYTES + 12);
    const tag = data.subarray(VERSION_BYTES + 12, VERSION_BYTES + 28);
    const body = data.subarray(VERSION_BYTES + 28);
    const decipher = createDecipheriv(CIPHER, key, nonce);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretBackendUnavailableError('sealed secret failed authentication');
    }
  }

  describe(): { readonly mode: 'local-aes-gcm' } {
    return { mode: 'local-aes-gcm' };
  }
}

/** 从受信 env 构造本地后端；缺主密钥或格式错误返回 undefined（调用方 fail-closed 而非抛出）。 */
export const createLocalSecretBackendFromEnv = (source: Record<string, string | undefined> = process.env): SecretBackend | undefined => {
  const raw = source[SECRET_MASTER_KEY_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  try {
    return new LocalAesGcmSecretBackend([decodeKey(raw)]);
  } catch {
    return undefined;
  }
};
