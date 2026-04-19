-- Seed predefined system events (reference list for template triggers).
-- Adjust IDs if you merge with existing seed data.

INSERT INTO workflow_event (code, name, description) VALUES
  ('booking.cancellation_requested', 'Booking cancellation requested', 'Buyer or agent requested cancellation'),
  ('booking.confirmed', 'Booking confirmed', 'Unit booking was confirmed'),
  ('unit.price_updated', 'Unit price updated', 'Sale price changed on a unit')
ON CONFLICT (code) DO NOTHING;
