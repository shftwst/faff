// Package db owns the datastore connection and the startup migration step.
// Both use a bounded-backoff retry so a datastore that accepts TCP a beat
// before it accepts queries does not crash-loop the api, while a genuinely
// unreachable datastore still fails fast once the window is exhausted.
package db

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RetryPolicy bounds startup retries: attempts run at Interval until Window
// elapses, then the operation fails.
type RetryPolicy struct {
	Window   time.Duration
	Interval time.Duration
}

// ConnectRuntimePool opens the request-serving pool using the runtime DSN
// (the least-privilege, no-DDL role) and verifies reachability with a bounded
// retry. On success the caller owns the returned pool and must Close it.
//
// The DSN is never logged here; connection-failure metadata is the caller's
// responsibility via the dsn package, so the raw DSN and password never leak.
func ConnectRuntimePool(ctx context.Context, runtimeDSN string, policy RetryPolicy) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, runtimeDSN)
	if err != nil {
		return nil, err
	}

	err = retry(ctx, policy, func() error {
		return pool.Ping(ctx)
	})
	if err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// retry runs op at policy.Interval until it succeeds, the context is
// cancelled, policy.Window elapses, or op returns a non-transient error.
// A non-transient error is returned immediately (fail fast on a real fault);
// a transient error is retried until the window closes.
func retry(ctx context.Context, policy RetryPolicy, op func() error) error {
	deadline := time.Now().Add(policy.Window)
	var lastErr error
	for {
		lastErr = op()
		if lastErr == nil {
			return nil
		}
		if !isTransient(lastErr) {
			return lastErr
		}
		if time.Now().Add(policy.Interval).After(deadline) {
			return lastErr
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(policy.Interval):
		}
	}
}

// isTransient reports whether err is a datastore-still-coming-up condition
// that is worth retrying within the startup window, as opposed to a terminal
// fault (bad SQL, auth failure, a genuine version conflict) that must not be
// retried.
func isTransient(err error) bool {
	if err == nil {
		return false
	}
	// Postgres signalling it is not yet ready to accept connections.
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "57P03", // cannot_connect_now (still starting / recovering)
			"57P01", // admin_shutdown / terminating
			"08006", // connection_failure
			"08001", // sqlclient_unable_to_establish_sqlconnection
			"08004": // sqlserver_rejected_establishment_of_sqlconnection
			return true
		}
		// Any other PgError is a real server-side error: terminal.
		return false
	}
	// A pgconn.ConnectError (TCP refused, DNS not yet resolvable, etc.) is
	// the datastore not yet listening — transient during startup.
	var connErr *pgconn.ConnectError
	return errors.As(err, &connErr)
}
