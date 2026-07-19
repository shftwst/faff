# PRD — stash: Ephemeral File Drops

- **Container:** stash
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver an anonymous, ephemeral file-sharing service: upload one or more files, get an unguessable share link, and trust the expiry — when a drop expires, its objects are actually deleted from storage, not hidden. The architectural core: file bytes flow directly between the client and object storage; the application server never relays content.

## Goals & success metrics

- Sharing feels effortless: drag files in, copy the link.
- Expiry is real — storage provably empties.
- Nothing uploaded can execute or leak on the service's origin.

## Non-goals

- Accounts or upload history.
- Virus/malware scanning.
- Resumable or chunked upload protocols.
- Previews or thumbnails — download only.
- Quotas beyond the stated size caps.

## Users

Anyone sending files too big or too transient for email; recipients holding a link (and possibly a passphrase).

## Requirements

- A drop is one or more files uploaded anonymously; per-file and per-drop size caps exist, are enforced server-side, and are stated in the UI.
- File bytes transfer directly between the client and object storage via short-lived scoped/presigned URLs — upload and download bytes never pass through the application server.
- Drop URLs are unguessable: identifiers carry at least 128 bits of randomness.
- The drop page lists file names and sizes with per-file downloads, and shows time remaining.
- Expiry: the uploader picks from offered durations; on expiry the drop page is gone and the underlying objects are deleted from storage.
- Optional passphrase, set at creation: without it, no file names, sizes, or content are revealed.
- Optional burn-after-download for single-file drops: the first completed download consumes the drop.
- Downloads are served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, so uploaded content never executes on the service's origin.
- Drop metadata lives in a persistent database and survives restarts; objects live in object storage (R2 is available).
- A verification harness driving the full lifecycle against a running instance: upload, checksum-verified download, passphrase refusal, expiry, a storage-level deletion check, and the burn race (two concurrent downloads, exactly one winner).
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given files within the caps, When uploaded, Then a drop link MUST be returned and each file MUST download byte-identical to what was uploaded.
- Given a file over the per-file cap or a drop over the per-drop cap, When upload is attempted, Then it MUST be rejected server-side, regardless of any client-side check.
- File bytes MUST NOT transit the application server in either direction; transfers MUST go direct to object storage under short-lived scoped URLs.
- Drop identifiers MUST contain at least 128 bits of randomness.
- Given a passphrase-protected drop, When opened without the passphrase, Then no file name, size, or content may be revealed.
- Given a wrong passphrase, When submitted, Then access MUST be refused.
- Given an expired drop, When its link is opened, Then it MUST be gone; and When storage is inspected after expiry processing, Then the drop's objects MUST NOT exist.
- Given a single-file drop with burn-after-download, When two downloads race, Then exactly one MUST complete and the drop MUST then be gone.
- Given any download, Then it MUST carry `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- Given an uploaded HTML file, When its download URL is opened in a browser, Then it MUST NOT render on the service's origin.
- Given a service restart, Then existing unexpired drops MUST remain downloadable.
- The repository MUST include the lifecycle harness, and running it MUST report per-check results.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

Most criteria are objective and directly probeable. Three lean on the harness — storage-level deletion after expiry, the burn race, and byte-identity — because inspection alone only confirms the code intends them. The direct-transfer criterion is verified by watching where the bytes actually go (the application server's traffic), not by reading the code's claims. The residual duty is confirming the harness inspects real storage state rather than the app's own metadata database. "Effortless" upload UX is a human judgement, not a gate.

## Open questions

- Exact size caps and the offered expiry durations are left to implementation.
- Passphrase attempt limiting is left to implementation.
- Whether expiry deletion is a sweep or a storage lifecycle rule is left to implementation — the storage-level check must pass either way.
