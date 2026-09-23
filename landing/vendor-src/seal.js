// Source of public/vendor/seal.js: libsodium-compatible sealed boxes for the page, on tweetnacl
// (public domain, audited by Cure53) and blakejs (CC0). Rebuild after changing this file:
//   cd landing/vendor-src && bun build seal.js --minify --format=iife --outfile=../public/vendor/seal.js
// (with tweetnacl@1.0.3 and blakejs@1.2.1 resolvable, e.g. `bun add --no-save tweetnacl@1.0.3 blakejs@1.2.1`).
//
// crypto_box_seal: an ephemeral X25519 key pair, nonce = blake2b-192(ephemeral pk ‖ recipient pk),
// output = ephemeral pk ‖ crypto_box(message). GitHub's secrets API takes exactly this, and the
// connect workflow seals its result to the page the same way.
import nacl from "tweetnacl";
import { blake2b } from "blakejs";

const b64 = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function nonce(epk, pk) {
  const input = new Uint8Array(64);
  input.set(epk);
  input.set(pk, 32);
  return new Uint8Array(blake2b(input, undefined, 24));
}

window.FreeagentSeal = {
  /** A one-time key pair; the secret half never leaves this page's memory. */
  keyPair() {
    const k = nacl.box.keyPair();
    return { publicKey: b64(k.publicKey), secretKey: k.secretKey };
  },
  /** Seal text to a base64 public key (GitHub's, for a secret). */
  seal(publicKeyB64, text) {
    const pk = unb64(publicKeyB64);
    if (pk.length !== 32) throw new Error("bad public key");
    const e = nacl.box.keyPair();
    const box = nacl.box(new Uint8Array(new TextEncoder().encode(text)), nonce(e.publicKey, pk), pk, e.secretKey);
    const out = new Uint8Array(32 + box.length);
    out.set(e.publicKey);
    out.set(box, 32);
    return b64(out);
  },
  /** Open a box sealed to our key pair; null when it was not sealed to us or was altered. */
  open(sealedB64, keyPair) {
    const bytes = unb64(sealedB64);
    const epk = bytes.slice(0, 32);
    const pk = unb64(keyPair.publicKey);
    const plain = nacl.box.open(bytes.slice(32), nonce(epk, pk), epk, keyPair.secretKey);
    return plain === null ? null : new TextDecoder().decode(plain);
  },
};
