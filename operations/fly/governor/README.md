# Commissaire governor on Fly

Deployment config for running the Commissaire governor as its own Fly app. The steps, the checks to run before every redeploy and the reasons behind each file are in the runbook: [Run the governor as its own Fly app](../../../docs/guide/unattended.md#run-the-governor-as-its-own-fly-app).

| File | Purpose |
|---|---|
| `fly.toml` | One machine, one volume at `/data`, no services, no public IP |
| `Dockerfile` | Non-root `commissaire` user, root-owned read-only code under `/opt/commissaire/<commit>` |
| `entrypoint.sh` | Prepares the key directory on the volume, then starts the governor |
| `governor-config.json` | Who may call the governor's local socket; copied onto the volume at every start |
