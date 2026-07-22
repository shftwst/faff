# PRD — bookend: Timezone-Correct Booking

- **Container:** bookend
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a booking service for shared resources — rooms, courts, machines — where an owner defines recurring weekly availability in the resource's own timezone and visitors book slots from anywhere in the world. The surface is a calendar; the substance is time: daylight-saving transitions that move, skip, and repeat wall-clock hours, offsets that aren't whole hours, bookings that race for the last slot, and an iCal export that other software actually agrees with. Wrong answers here are quiet — a booking an hour off looks fine until someone stands outside a locked door.

## Goals & success metrics

- A window defined as local wall time stays at that local wall time through every DST transition, in every timezone offered.
- A slot can never be double-booked, no matter how simultaneous the attempts.
- What the export says is what the service meant — byte-level agreement with an independent parser.

## Non-goals

- Payments, pricing, or deposits.
- Approval workflows — booking a free slot succeeds immediately.
- Notifications of any kind.
- Recurring bookings — availability recurs; individual bookings do not.
- Sub-slot granularity — bookings fill whole offered slots.

## Users

Resource owners defining availability; visitors booking and cancelling slots.

## Requirements

- An owner creates a resource with a name, an IANA timezone, a slot length, and weekly recurring availability windows expressed as local wall-clock times in that timezone (e.g. Tuesdays 09:00–17:00), plus specific exception dates that remove availability; management is by a separate unguessable owner link (identifiers carry at least 128 bits of randomness).
- Timezone arithmetic uses the IANA tz database — never hardcoded offsets; offered timezones MUST include at least one with a non-whole-hour offset and one whose DST shift is not one hour.
- DST semantics, applied and documented: windows track local wall time across transitions; a wall-clock time that does not exist on a transition day (spring forward) and one that occurs twice (fall back) resolve per a documented deterministic rule, pinned by corpus cases.
- Visitors see availability rendered in their own timezone, book a free slot, and cancel via a per-booking unguessable link; a cancelled slot becomes bookable again.
- No double-booking, server-enforced: of N concurrent attempts on the same slot, exactly one succeeds — regardless of client behavior.
- Bookings and availability persist in a database; a restart or redeploy changes nothing a visitor can see.
- Each resource serves an iCal (RFC 5545) export of its bookings, correct across DST boundaries, that an independent parser reads back to exactly the service's own record of each booking's instant.
- A committed reference corpus: availability definitions and expected slot instants (as UTC) spanning spring-forward and fall-back transitions in at least three zones — including the non-whole-hour-offset and non-one-hour-shift zones — plus the nonexistent- and ambiguous-time rules; a headless harness evaluates the corpus through the service's own slot computation and reports per-case pass/fail.
- The harness also drives a running instance: the concurrent-booking race (N simultaneous attempts, exactly one winner), cancellation reopening, restart persistence, and the iCal round-trip through an independent parser.
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a window defined as local wall time, When slots are computed for weeks before and after a DST transition, Then every slot MUST start at the defined local wall time in the resource's timezone.
- Given a transition day where the defined wall-clock time does not exist, Then the documented rule MUST apply, matching its corpus case.
- Given a transition day where the defined wall-clock time occurs twice, Then the documented rule MUST apply, matching its corpus case.
- Given a resource in a timezone with a non-whole-hour offset, When its slots are computed, Then the corpus cases for that zone MUST pass.
- Given a visitor in a different timezone, When availability is displayed, Then slot times MUST be rendered in the visitor's timezone and book the same underlying instant.
- Given N concurrent booking attempts on one free slot, When all resolve, Then exactly one MUST succeed and the rest MUST be refused.
- Given a booked slot is cancelled, Then it MUST become bookable again.
- Given an exception date, Then no slot on it may be offered or bookable.
- Given only a visitor-facing URL, When used, Then availability management MUST NOT be reachable; owner and booking identifiers MUST contain at least 128 bits of randomness.
- Given the iCal export, When read by an independent parser, Then every event MUST resolve to exactly the instant the service records for that booking, including bookings that span or straddle DST transitions.
- Timezone computation MUST use the IANA tz database; hardcoded UTC offsets MUST NOT appear in slot arithmetic.
- Given a restart or redeploy, Then all resources, availability, and bookings MUST be intact.
- The repository MUST include the corpus and harness; running the harness MUST report per-case and per-check results, and every case MUST pass.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

The corpus makes the time-domain criteria mechanical — and the evaluator should extend it: add a case in a zone the corpus doesn't cover and re-run, since correct tz handling passes cases its authors never saw. Residual duties: confirm the corpus evaluates through the service's real slot computation (not a parallel reimplementation in the harness), that the round-trip parser is genuinely independent of the code that wrote the export, and that the race check's attempts truly overlap in time. The nonexistent/ambiguous-time rules are implementation's choice, but the choice must be documented and the corpus must pin it — an undocumented behavior is a fail even if consistent. Calendar legibility is a human judgement, not a gate.

## Open questions

- Slot lengths offered, the booking horizon (how far ahead), and the offered timezone list beyond the two mandated properties are left to implementation.
- The nonexistent- and ambiguous-time resolution rules are left to implementation — documented and pinned by corpus cases.
- Whether a visitor booking requires a name/label on the slot is left to implementation.
- iCal export scope (bookings only, or availability too) is left to implementation; whatever is exported must round-trip.
