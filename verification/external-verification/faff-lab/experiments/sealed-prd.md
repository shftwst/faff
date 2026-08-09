# PRD — sealed: Zero-Knowledge Encrypted Drops

- **Container:** sealed
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver an encrypted file-sharing service the operator cannot read: files are encrypted in the browser before upload, the key travels only in the URL fragment, and the server and object storage ever hold only ciphertext — file names included. The claim "we can't see your files" is architectural, not policy, and the deliverable must prove it: a harness that inspects what the server actually receives and what storage actually holds, not what the code intends.

## Goals & success metrics

- Nothing legible ever reaches the operator: no plaintext bytes, no file names, no key material — demonstrated by inspection of server traffic, database, and storage.
- Tampering is loud: a modified ciphertext fails decryption explicitly, never yielding corrupted output presented as the file.
- Sharing still feels effortless: encrypt, upload, copy one link.

## Non-goals

- Accounts or upload history.
- Recipient identity or end-to-end sender/receiver key exchange — possession of the link (plus passphrase where set) is access.
- Resumable or chunked upload protocols.
- Hiding file sizes or upload timing from the operator — content and names are protected; traffic shape is not.
- Virus/malware scanning (nothing legible exists to scan).

## Users

Anyone sharing files that must stay unreadable to the service itself; recipients holding a link (and possibly a passphrase).

## Requirements

- A drop is one or more files encrypted client-side in the browser before any byte leaves it, using an authenticated encryption scheme (AEAD) via a standard library or Web Crypto — no hand-rolled primitives; per-file and per-drop size caps exist, are enforced, and are stated in the UI.
- The decryption key is generated client-side and carried only in the URL fragment; it is never sent to the server in any request — path, query, header, or body — and never stored server-side in any form.
- File names and any other user-meaningful metadata are encrypted client-side too; the server's database holds only ciphertext, opaque identifiers, sizes, and expiry times.
- Ciphertext transfers directly between the client and object storage via short-lived scoped/presigned URLs — content bytes never pass through the application server (R2 is available).
- The drop page downloads ciphertext and decrypts in the browser; decrypted names and content exist only client-side; downloads land byte-identical to the original plaintext.
- Tampered or truncated ciphertext MUST fail AEAD authentication and surface an explicit integrity error — no partial or corrupted plaintext is ever offered as the file.
- A wrong key (mangled fragment) or wrong passphrase yields an explicit refusal, revealing nothing about names or content.
- Optional passphrase at creation, run through a memory-hard key-derivation function client-side; the server never sees the passphrase or anything derived from it that would decrypt the drop.
- Expiry: the uploader picks from offered durations; on expiry the drop page is gone and the ciphertext objects are deleted from storage.
- Drop identifiers carry at least 128 bits of randomness; drop metadata survives server restarts.
- A verification harness driving a real browser headless against a running instance, with all server-bound traffic captured through an interception proxy: it uploads seeded plaintext containing distinctive marker bytes and unique marker file names, then asserts — from the captured traffic, the server database, and object storage directly — that no marker appears anywhere server-side and no fragment/key material appears in any request; plus checksum-verified round-trip, the tamper case, wrong-key and wrong-passphrase refusals, expiry with a storage-level deletion check, and restart persistence — reporting per-check results.
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given files within the caps, When uploaded and the link opened, Then each file MUST decrypt in the browser byte-identical to the original.
- Given the harness's marker plaintext and marker file names, When server-bound traffic, the database, and object storage are inspected, Then no marker bytes and no marker names may appear in any of them.
- Given every request the client makes, When captured traffic is inspected, Then the key material and URL fragment MUST NOT appear in any path, query, header, or body.
- Content bytes MUST NOT transit the application server in either direction; transfers MUST go direct to object storage under short-lived scoped URLs.
- Encryption MUST be an AEAD scheme from a standard library or Web Crypto; no hand-rolled cryptographic primitives may appear.
- Given ciphertext tampered with or truncated at the storage layer, When a recipient opens the drop, Then decryption MUST fail with an explicit integrity error and no partial output.
- Given a wrong key or wrong passphrase, When submitted, Then access MUST be refused and no file name or content revealed.
- Given a passphrase-protected drop, When the passphrase is set or entered, Then derivation MUST run client-side via a memory-hard KDF and the passphrase MUST NOT appear in captured server-bound traffic.
- Given an expired drop, When its link is opened, Then it MUST be gone; and When storage is inspected after expiry processing, Then its objects MUST NOT exist.
- Drop identifiers MUST contain at least 128 bits of randomness.
- Given a server restart, Then existing unexpired drops MUST remain retrievable and decryptable.
- Size caps MUST be enforced and stated in the UI.
- The repository MUST include the harness (browser-driving, traffic-capturing), and running it MUST report per-check results.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

The central claims are negative — nothing legible reaches the server — and negatives are exactly what code inspection cannot establish; a single stray analytics call or error log can void them. The traffic capture, database inspection, and storage inspection are the instrument. Residual duties: confirm the proxy captures all server-bound traffic (not just the API's happy path), that storage and database are inspected directly rather than through the application's own API, and that the tamper case modifies real stored ciphertext rather than in-memory data. Reviewing the crypto choices (scheme, KDF parameters, nonce handling) is a human duty the harness cannot discharge — the harness proves the architecture, not the cryptography. Upload UX is a human judgement, not a gate.

## Open questions

- Cipher suite, KDF, and key-encoding format in the fragment are left to implementation — documented in the README.
- Exact size caps and offered expiry durations are left to implementation.
- Whether multi-file drops use one key per drop or per file is left to implementation.
- Burn-after-download is left to implementation; if offered, it MUST be covered by a harness case including the two-download race.
