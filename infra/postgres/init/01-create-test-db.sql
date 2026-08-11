-- The pytest suite runs against a real Postgres instance so migrations and
-- Postgres-specific behaviour (citext, partial indexes) are exercised for real.
-- This gives it a dedicated database so tests never touch dev data.
CREATE DATABASE sidequestd_test OWNER sidequestd;
