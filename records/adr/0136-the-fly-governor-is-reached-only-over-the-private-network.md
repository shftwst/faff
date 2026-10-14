# ADR 0136 — The Fly governor is reached only over the private network

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-10-14
- **Issue:** FAFF-1181
## Context

ADR 0135 decision 3 authenticates callers of the governor "on Fly, by network placement and app identity". FAFF-1181 puts the governor in its own Fly app, so that decision now needs a concrete form.

The TCP listener has no transport security and no peer credentials. Anything that can open a connection to it is, in effect, the runner: `admit` hands out the producer key for any run. The check therefore has to sit at the network layer and at the source address.

Fly documents that apps on separate custom private networks cannot reach each other. It does not document whether a machine can send packets carrying another machine's address on the same network. That gap does not matter here, because the only app sharing the governor's network is the runner app, and every address a runner machine could fake is already allowed.

## Decision

The Fly governor has no public IP and no `[[services]]` or `http_service` section. It listens on its Fly 6PN address (`fly-local-6pn:7650`), and the runner connects to `<governor-app>.internal:7650`.

TCP callers are restricted in two ways:

- **Placement.** The governor and runner apps share one custom private network that holds no other app.
- **App identity.** `governor start --listen-allow-dns <runner-app>.internal` resolves that name (AAAA and A records) and closes, before reading the request, any connection whose source address is not one of the runner app's addresses.

A non-loopback `--listen` without `--listen-allow-dns` exits 2, unless `--listen-unrestricted` is also passed. A loopback `--listen` is unchanged, so Tier 2 keeps working.

Placement alone is rejected: the first app added to the network later would be able to ask for any run's producer key.

## Consequences

- The Fly governor stays always on. Starting on request through Flycast would hide the caller's source address, which the check needs. ADR 0135 decision 2 is amended accordingly (FAFF-1181).
- Two operator conditions keep the same-network question moot, and both are checked by hand: no other app is ever created on that network, and the runner app's machines hold no Fly token that can deploy to, SSH into or manage the governor app. If either fails, the identity check stops being a control and the design is reopened.
- The runner's cage must be able to reach 6PN and resolve `.internal`. Where it cannot, the operator enables IPv6 on the cage network or runs a relay on the runner machine.
- An unrestricted non-loopback listener is a deliberate, logged choice (`tcp-unrestricted`), never the silent default.
- If a later change adds an app to the network, or Fly changes its isolation guarantees, this ADR needs revisiting.
