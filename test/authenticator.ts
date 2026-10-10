// A software passkey that speaks the real wire format, so the tests drive @simplewebauthn/server's own
// verification (no mocking of verify*): `none` attestation on create, an ES256 assertion on get.
import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers';

const toBuffer = isoBase64URL.toBuffer;
const fromBuffer = (bytes: Uint8Array) => isoBase64URL.fromBuffer(bytes as Uint8Array<ArrayBuffer>);
const FLAGS = { UP: 0x01, UV: 0x04, AT: 0x40 };

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

// WebCrypto signs as r||s; WebAuthn carries ECDSA signatures as ASN.1 DER.
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0] & 0x80) v = isoUint8Array.concat([new Uint8Array([0]), v]);
    return isoUint8Array.concat([new Uint8Array([0x02, v.length]), v]);
  };
  const body = isoUint8Array.concat([int(raw.slice(0, 32)), int(raw.slice(32))]);
  return isoUint8Array.concat([new Uint8Array([0x30, body.length]), body]);
}

export type AuthenticatorOpts = { rpId?: string; origin?: string };

export class Authenticator {
  credentialId = fromBuffer(crypto.getRandomValues(new Uint8Array(32)));
  counter = 0;
  userHandle: string | undefined;
  private keys!: CryptoKeyPair;
  private rpId: string;
  private origin: string;

  constructor(opts: AuthenticatorOpts = {}) {
    this.rpId = opts.rpId ?? 'arboretum.test';
    this.origin = opts.origin ?? 'https://arboretum.test';
  }

  private clientData(type: string, challenge: string) {
    return new TextEncoder().encode(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  private async authData(flags: number, attested: Uint8Array = new Uint8Array()) {
    return isoUint8Array.concat([await sha256(new TextEncoder().encode(this.rpId)), new Uint8Array([flags]), u32(this.counter), attested] as Uint8Array<ArrayBuffer>[]);
  }

  // `options` is what /register-options (or /add-passkey-options) returned; `challenge` overrides it, to sign the wrong one.
  async create(options: { challenge: string; user: { id: string } }, challenge = options.challenge) {
    this.keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    this.userHandle = options.user.id;
    const jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey;
    const cosePublicKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, toBuffer(jwk.x!)],
        [-3, toBuffer(jwk.y!)],
      ]),
    );
    const credId = toBuffer(this.credentialId);
    const attested = isoUint8Array.concat([new Uint8Array(16), new Uint8Array([credId.length >> 8, credId.length & 255]), credId, cosePublicKey]);
    const authData = await this.authData(FLAGS.UP | FLAGS.UV | FLAGS.AT, attested);
    const attestationObject = isoCBOR.encode(new Map<string, any>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as any);
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: fromBuffer(this.clientData('webauthn.create', challenge)),
        attestationObject: fromBuffer(attestationObject),
        transports: ['internal'],
      },
    };
  }

  async get(options: { challenge: string }, challenge = options.challenge) {
    this.counter += 1;
    const clientDataJSON = this.clientData('webauthn.get', challenge);
    const authData = await this.authData(FLAGS.UP | FLAGS.UV);
    const signed = isoUint8Array.concat([authData, await sha256(clientDataJSON)]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, signed as BufferSource));
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: fromBuffer(clientDataJSON),
        authenticatorData: fromBuffer(authData),
        signature: fromBuffer(derSignature(raw)),
        userHandle: this.userHandle,
      },
    };
  }
}
