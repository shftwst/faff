# Spec — FAFF-661: correct RESULTS.md's exceptions_are_complete (seven emit sites, not five)

> Spec: faffter-dark-nlspec · 2026-08-02 · interactive · confidence: high. Full spec on Linear FAFF-661.

## 1. WHY — problem and principle

`records/spikes/2026-07-26-FAFF-654/RESULTS.md`'s `## Structural guarantee` names **five** byte-emitting exceptions and asserts `exceptions_are_complete: nothing else in the probe writes bytes obtained from a measured file`. That count is false against the instrument.

Enumerated against `probe.sh` on `main` (the correct method — read the instrument, not the list), the probe has **seven** continuation-block emit sites: `:334` (mount table), `:403` (pid-1 environ key names), `:420` (`/proc/1/cgroup`), `:424` (`/proc/1/comm`), `:453` (work-directory listing), `:467` (home entries), `:519` (container-check plain). Two are absent from the exception list:

- **`/proc/1/cgroup` continuation** — classified at `probe.sh:417`, printed verbatim by an inline `while … printf '  | %s'` loop at `:419–420`.
- **`/proc/1/comm` continuation** — classified at `:422`, printed at `:423–424`.

Both files are world-readable on any Linux, so both blocks print on **every run of every shape** — no dispatch input, mode flag, or shape suppresses them. The record's own test makes them exceptions: a file the probe classifies whose bytes it then prints is content from a measured file — identical to `exception_3` (the pid-1 `container` value). Neither file is high-value (`/proc/1/comm` is pid 1's executable name; `/proc/1/cgroup` under cgroup v2 is normally `0::/`) — **this is not an exposure incident.** It matters because `RESULTS.md` is a findings record whose defence against publishing content rests on an *enumerated* guarantee, and FAFF-646 will cite it: a record that states a complete set and is wrong about it undermines its own usability as evidence.

## 2. WHAT — design

**Chosen: add the two missing sites as `exception_6` (`/proc/1/cgroup` continuation) and `exception_7` (`/proc/1/comm` continuation)**, each in the same form as the existing five — naming its emit line and its classify line.

**Chosen: correct the `exceptions_are_complete` line to state seven**, true against `probe.sh` as merged.

**Chosen: record the enumeration method in the section** — the set was derived by enumerating `emit_block` calls (`probe.sh:40–44`) plus the inline `while … printf '  | %s'` continuation loops, giving the seven sites above — so the next reader checks against the instrument rather than re-reading the list. (This is the exact failure mode that let the wrong count survive FAFF-654's twelve review passes and FAFF-657's spec: every check read the list for internal consistency instead of against the emit sites.)

**Chosen: correct FAFF-654's design spec** (`records/specs/2026-07-26-FAFF-654-the-probe-and-what-a-github-hosted-actions-job-exposes-design.md`) — it carries the five-exception bound **definitively, in ~7 places**, not as a contingency: the "five-exception guarantee" line (~:234), the "exactly five exceptions … the complete list" enumeration (~:378–386), the "structural guarantee … with its five named exceptions" reference (~:411), the DoD line (~:590), and a self-test-assertion line "the only file-derived content in stdout is the five named exceptions" (~:622). Bring all of them to seven, matching the corrected `RESULTS.md`.

**Note the enumeration is by emit site, not by list slot.** The seven *continuation-block emit sites* do not map one-to-one to the exception *list*: `exception_4` (long-listing lines) covers two sites (`:453` work-dir listing + `:467` home entries), and `exception_3` (the pid-1 `container` value) is a single-value `emit` at `:406`, not a continuation block, so it is not one of the seven sites. The correct fix is to add the two genuinely-unlisted continuation blocks — `/proc/1/cgroup` and `/proc/1/comm` — as `exception_6` and `exception_7`; that makes the list name seven exceptions and cover all seven emit sites. Derive and check by the emit sites, never by counting list slots.

**Assumes: `probe.sh` is byte-unchanged.** This is a correction to a record *about* the instrument, not to the instrument (FAFF-654 owns `probe.sh`). The change touches only `RESULTS.md` and, if it carries the bound, FAFF-654's design spec.

## 3. HOW — acceptance

- The `## Structural guarantee` section names seven sites, each with its emit line and its classify line.
- The `exceptions_are_complete` line states seven and is true against the instrument as merged.
- The section records the enumeration method, not just the result.
- FAFF-654's design spec is checked for the same bound and corrected if it carries one (and the check itself is recorded, so a null result is distinguishable from an unchecked one).
- `probe.sh` byte-unchanged.

### Scenarios

```
Given probe.sh on main is re-enumerated for continuation-block emitters
When the Structural guarantee section is checked against that enumeration
Then it names all seven sites and exceptions_are_complete states seven.
```

```
Given /proc/1/cgroup and /proc/1/comm are world-readable and printed every run
When any shape's transcript is inspected
Then both continuation blocks appear, and both are named exceptions in the record.
```

## 4. DONE — definition of done

- [ ] `## Structural guarantee` names seven exceptions (adds cgroup + comm continuations), each with emit + classify line.
- [ ] `exceptions_are_complete` states seven, true against `probe.sh`.
- [ ] The enumeration method (emit_block + inline printf-loop call sites) is recorded in the section.
- [ ] FAFF-654's design spec checked for the bound; corrected if present, and the check recorded either way.
- [ ] `probe.sh` byte-unchanged.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
