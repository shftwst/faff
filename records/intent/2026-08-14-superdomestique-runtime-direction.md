# SuperDomestique runtime direction

Status: statement of intent
Date: 2026-08-14
Decision owner: project maintainer

## Purpose

This record captures the intended product direction for SuperDomestique as of
the date above. It records direction, not a shipped-capability claim or an
implementation specification.

## Intended direction

SuperDomestique is intended to grow from governed, unattended software delivery
into a system for safe progressive autonomy. The product should let people
delegate longer-running and consequential work while retaining clear authority,
evidence, recovery, and acceptance boundaries.

The intended direction is to:

- keep execution and governance separate: workers and runtimes perform work,
  while Commissaire decides what may begin, continue, take effect, or be
  accepted under agreed terms;
- preserve a durable and reconstructable account of delegated work so that an
  interruption or replacement of an executor does not erase the state of the
  work or the basis for later decisions;
- make accountability explicit, including who produced material evidence, what
  authority applied, which consequential actions were permitted, and why an
  outcome was accepted or rejected;
- govern work that was initiated or executed outside SuperDomestique, without
  requiring SuperDomestique to schedule or perform that work;
- treat Software Delivery as the first product domain package and expand
  SuperDomestique through additional domain packages for other kinds of
  delegated work; and
- grant autonomy per workload and per set of proven controls, rather than as a
  blanket property of an agent or system.

## How the direction will be pursued

Development will proceed from the working software-delivery product. The
current path will be strengthened and measured before broader product claims
are made. Governance will be tested separately from coordination, and both will
be compared with simpler approaches. These activities inform sequencing and
design; they do not determine whether the broader direction exists.

The intended destination is a broader, protocol-driven SuperDomestique runtime
with reusable Commissaire governance and a family of product domain packages.
Software Delivery is the first of those packages, not the outer boundary of the
product. Further domain packages are intended to extend SuperDomestique into
other fields of delegated work while sharing the runtime and governance model.

## Boundaries of this statement

This direction does not commit the project to a hosted control plane, a
long-running service, a universal workflow language, a marketplace, a particular
technical package layout, or a new public product. Those implementation and
packaging choices remain open.

SuperDomestique remains the product name, Commissaire remains its governance
system, and `faff` remains the current technical name for the repository, CLI,
commands, configuration, and related implementation identifiers.

This statement records project intent at a point in time. It does not assert
that every idea described here is unique, implemented, patentable, or otherwise
subject to a particular form of legal protection.
