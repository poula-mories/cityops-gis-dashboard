-- Public demo: keep a copy of the original sample requests so visitors' edits can be undone.
-- demo_seed.reset() puts them back, with dates moved forward by the time since the copy was taken,
-- so "Last 7 days" and the weekly chart look the same on any day.
CREATE SCHEMA demo_seed;
CREATE TABLE demo_seed.service_requests AS SELECT * FROM service_requests;
CREATE TABLE demo_seed.taken (at timestamptz NOT NULL);
INSERT INTO demo_seed.taken VALUES (now());

CREATE FUNCTION demo_seed.reset() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    shift interval := now() - (SELECT at FROM demo_seed.taken);
BEGIN
    DELETE FROM service_requests;
    INSERT INTO service_requests SELECT * FROM demo_seed.service_requests;
    UPDATE service_requests SET created_at = created_at + shift;
    PERFORM setval(pg_get_serial_sequence('service_requests', 'id'), (SELECT max(id) FROM service_requests));
END $$;
