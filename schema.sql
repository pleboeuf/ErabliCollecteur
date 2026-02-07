 CREATE TABLE raw_events (
   device_id varchar(24),
   published_at timestamp,
   raw_data text,
   generation_id integer,
   serial_no integer
);

-- Index for duplicate detection (device_id, generation_id, serial_no)
CREATE INDEX IF NOT EXISTS idx_raw_events_dedup ON raw_events (device_id, generation_id, serial_no);
