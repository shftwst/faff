package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	migratepg "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver

	"github.com/shftwst/link-shortener/internal/migrations"
)

// ApplyMigrations applies all embedded schema migrations to the current
// version using the migration DSN (the DDL-holding migration role), before
// the api begins serving.
//
// Reachability is retried with bounded backoff on transient conditions only
// (Postgres still completing crash recovery / not yet accepting). A
// non-transient error (bad SQL, a genuine version conflict) is terminal on
// first occurrence and is never retried. An already-current schema is a no-op.
func ApplyMigrations(ctx context.Context, migrationDSN string, policy RetryPolicy) error {
	sqlDB, err := sql.Open("pgx", migrationDSN)
	if err != nil {
		return fmt.Errorf("open migration connection: %w", err)
	}
	defer sqlDB.Close()

	// Bounded connection retry: the datastore may accept TCP a beat before it
	// accepts queries even behind the compose healthcheck gate.
	if err := retry(ctx, policy, func() error { return sqlDB.PingContext(ctx) }); err != nil {
		return fmt.Errorf("migration datastore unreachable within retry window: %w", err)
	}

	driver, err := migratepg.WithInstance(sqlDB, &migratepg.Config{})
	if err != nil {
		return fmt.Errorf("init migration driver: %w", err)
	}

	source, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("load embedded migrations: %w", err)
	}

	m, err := migrate.NewWithInstance("iofs", source, "pgx", driver)
	if err != nil {
		return fmt.Errorf("init migrator: %w", err)
	}

	// Retry Up only on transient errors within the same bounded window; a
	// non-transient migration error returns immediately.
	err = retry(ctx, policy, func() error {
		upErr := m.Up()
		if upErr == nil || errors.Is(upErr, migrate.ErrNoChange) {
			return nil
		}
		return upErr
	})
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
