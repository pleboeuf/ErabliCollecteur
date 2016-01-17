 CREATE TABLE raw_events (
   device_id varchar(24),
   published_at timestamp,
   event_name varchar(50),
   raw_data text,
   serial_no integer
);
