// Package httpapi holds the HTTP handlers and router for the api service.
package httpapi

import (
	"encoding/json"
	"net/http"
)

// healthBody is the fixed liveness payload. It carries no runtime internals
// (no versions, migration state, host metrics, or connection-state text), so
// /healthz is a constant signal, not a reconnaissance surface.
type healthBody struct {
	Status string `json:"status"`
}

// Healthz returns the liveness handler. It answers 200 with the constant
// body {"status":"ok"}. The handler is only registered after startup succeeds
// (config valid, datastore reachable, migrations applied), so a 200 is a
// truthful signal that the api can serve.
func Healthz() http.HandlerFunc {
	// Encode once; the body is constant.
	body, _ := json.Marshal(healthBody{Status: "ok"})
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
}

// NewRouter builds the api's HTTP router. Downstream epics register their
// product routes here alongside /healthz.
func NewRouter() *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("GET /healthz", Healthz())
	return mux
}
