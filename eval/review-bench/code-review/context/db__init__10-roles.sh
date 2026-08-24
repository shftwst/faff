#!/bin/sh
# Provision the two least-privilege datastore roles (gk-20260819-wng8an).
#
# Runs once, during Postgres init (as the superuser, over the bootstrap
# socket, before the server accepts external TCP). It creates:
#   - migrator: holds DDL (CREATE on schema public) — used only by the api's
#     startup migration step.
#   - app:      no DDL (USAGE only) — used by the api's request-serving pool.
#
# Passwords come from the environment (compose supplies them from .env); they
# are passed to psql as variables so psql quotes/escapes them, never
# string-concatenated into SQL.
set -eu

psql -v ON_ERROR_STOP=1 \
	--username "$POSTGRES_USER" \
	--dbname "$POSTGRES_DB" \
	-v migrator_pw="$MIGRATOR_PASSWORD" \
	-v app_pw="$APP_PASSWORD" \
	-v dbname="$POSTGRES_DB" <<-'EOSQL'
	-- DDL-holding migration role.
	CREATE ROLE migrator LOGIN PASSWORD :'migrator_pw';
	-- Least-privilege runtime role.
	CREATE ROLE app LOGIN PASSWORD :'app_pw';

	GRANT CONNECT ON DATABASE :"dbname" TO migrator;
	GRANT CONNECT ON DATABASE :"dbname" TO app;

	-- migrator gets CREATE + USAGE on schema public (DDL rights).
	GRANT ALL ON SCHEMA public TO migrator;

	-- app gets USAGE only: it may reference objects but cannot create them
	-- (no DDL). Belt-and-braces revoke of CREATE from PUBLIC.
	GRANT USAGE ON SCHEMA public TO app;
	REVOKE CREATE ON SCHEMA public FROM PUBLIC;

	-- Tables that migrator creates in later epics are automatically usable by
	-- app for DML only (still no DDL for app).
	ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
		GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
	ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
		GRANT USAGE, SELECT ON SEQUENCES TO app;
EOSQL
