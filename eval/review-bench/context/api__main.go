// Command api is the link-shortener HTTP service. At this epic it stands up
// the walking skeleton: read config from the environment, apply schema
// migrations under the migration role, open the least-privilege runtime pool,
// and serve GET /healthz. Product routes are added by downstream epics.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/shftwst/link-shortener/internal/config"
	"github.com/shftwst/link-shortener/internal/db"
	"github.com/shftwst/link-shortener/internal/dsn"
	"github.com/shftwst/link-shortener/internal/httpapi"
)

func main() {
	logger := log.New(os.Stdout, "", log.LstdFlags|log.LUTC)

	// `api healthcheck` is the in-container liveness probe used by the compose
	// healthcheck, so the minimal (distroless) image needs no curl/wget.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		if err := healthcheck(); err != nil {
			logger.Printf("healthcheck failed: %v", err)
			os.Exit(1)
		}
		return
	}

	if err := run(logger); err != nil {
		// run logs the specifics (masked); this is the terminal exit.
		logger.Printf("startup failed: %v", err)
		os.Exit(1)
	}
}

// healthcheck performs a localhost GET /healthz and returns an error unless it
// gets a 200. It reads the same API_PORT the server binds.
func healthcheck() error {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &healthcheckError{status: resp.StatusCode}
	}
	return nil
}

type healthcheckError struct{ status int }

func (e *healthcheckError) Error() string {
	return "unexpected status " + strconv.Itoa(e.status)
}

func run(logger *log.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		// Missing/invalid config: fail fast, never serve degraded.
		return err
	}

	policy := db.RetryPolicy{
		Window:   cfg.StartupRetryWindow,
		Interval: cfg.StartupRetryInterval,
	}

	// Step 3: apply migrations under the DDL-holding migration role, before
	// the api serves. Terminal on failure (never serve a half-migrated schema).
	migCtx, cancelMig := context.WithTimeout(context.Background(), cfg.StartupRetryWindow+5*time.Second)
	defer cancelMig()
	if err := db.ApplyMigrations(migCtx, cfg.MigrationDatabaseURL, policy); err != nil {
		// Log only non-secret metadata about the target; never the DSN/password.
		logger.Printf("migration step failed against %s", dsn.SafeMetadata(cfg.MigrationDatabaseURL))
		return err
	}
	logger.Printf("migrations applied against %s", dsn.SafeMetadata(cfg.MigrationDatabaseURL))

	// Step 4: open the request-serving pool under the least-privilege runtime
	// role (no DDL).
	connCtx, cancelConn := context.WithTimeout(context.Background(), cfg.StartupRetryWindow+5*time.Second)
	defer cancelConn()
	pool, err := db.ConnectRuntimePool(connCtx, cfg.RuntimeDatabaseURL, policy)
	if err != nil {
		logger.Printf("runtime datastore unreachable at %s", dsn.SafeMetadata(cfg.RuntimeDatabaseURL))
		return err
	}
	defer pool.Close()
	logger.Printf("runtime pool connected to %s", dsn.SafeMetadata(cfg.RuntimeDatabaseURL))

	// Step 5: register the router and begin listening. From here /healthz
	// returns 200.
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.NewRouter(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Graceful shutdown on SIGTERM/SIGINT so compose stop is clean.
	shutdownErr := make(chan error, 1)
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		shutdownErr <- srv.Shutdown(ctx)
	}()

	logger.Printf("listening on %s", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return <-shutdownErr
}
