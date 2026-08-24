// Package migrations embeds the versioned SQL migration files so they ship
// inside the static binary and apply deterministically at startup.
//
// At this epic the set is a baseline no-op: the golang-migrate machinery is
// wired so downstream epics add their table migrations without changing the
// startup path.
package migrations

import "embed"

// FS holds the embedded *.sql migration files, consumed by the iofs source
// driver in the db package.
//
//go:embed *.sql
var FS embed.FS
