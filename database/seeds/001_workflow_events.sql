INSERT INTO workflow_event (code, name, description) VALUES
  ('booking.cancellation_requested', 'Booking cancellation requested', 'Sales coordinator requests cancellation'),
  ('booking.confirmed', 'Booking confirmed', 'Unit booking confirmed'),
  ('unit.price_updated', 'Unit price updated', 'Sale price changed on a unit')
ON CONFLICT (code) DO NOTHING;
