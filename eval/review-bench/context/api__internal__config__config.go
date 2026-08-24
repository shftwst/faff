// Package config loads all runtime configuration from the environment
// (12-factor). Nothing is hardcoded; a missing required variable is a
// fail-fast error rather than a degraded default.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config is the fully-resolved runtime configuration for the api.
type Config struct {
	// ListenAddr is the TCP address the HTTP server binds, e.g. ":8080".
	ListenAddr string
	// MigrationDatabaseURL is the DSN used only by the startup migration
	// step, under the DDL-holding migration role.
	MigrationDatabaseURL string
	// RuntimeDatabaseURL is the DSN used by the request-serving pool, under
	// the least-privilege runtime role (no DDL).
	RuntimeDatabaseURL string
	// StartupRetryWindow bounds how long connect/migrate transient retries
	// run before the api gives up and exits non-zero.
	StartupRetryWindow time.Duration
	// StartupRetryInterval is the fixed backoff between startup retries.
	StartupRetryInterval time.Duration
}

// Load reads and validates configuration from the environment. It returns a
// clear error naming the first missing required variable; it never falls back
// to a default DSN.
func Load() (Config, error) {
	cfg := Config{
		ListenAddr:           ":" + getenvDefault("API_PORT", "8080"),
		MigrationDatabaseURL: os.Getenv("MIGRATION_DATABASE_URL"),
		RuntimeDatabaseURL:   os.Getenv("RUNTIME_DATABASE_URL"),
	}

	if cfg.MigrationDatabaseURL == "" {
		return Config{}, fmt.Errorf("required environment variable MIGRATION_DATABASE_URL is not set")
	}
	if cfg.RuntimeDatabaseURL == "" {
		return Config{}, fmt.Errorf("required environment variable RUNTIME_DATABASE_URL is not set")
	}

	window, err := getenvSeconds("STARTUP_RETRY_WINDOW_SECONDS", 30)
	if err != nil {
		return Config{}, err
	}
	interval, err := getenvSeconds("STARTUP_RETRY_INTERVAL_SECONDS", 1)
	if err != nil {
		return Config{}, err
	}
	cfg.StartupRetryWindow = window
	cfg.StartupRetryInterval = interval

	return cfg, nil
}

func getenvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvSeconds(key string, fallback int) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return time.Duration(fallback) * time.Second, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, fmt.Errorf("environment variable %s must be a non-negative integer, got %q", key, v)
	}
	return time.Duration(n) * time.Second, nil
}
