-- Submission seed: >= 2 projects, 10 units, 3 agents, 5 bookings
-- Run after 003_domain_projects_units_bookings.sql

INSERT INTO project (name, code) VALUES
  ('Marina Residences', 'MAR-2025'),
  ('Central Plaza Towers', 'CPT-2025');

INSERT INTO agent (name, email) VALUES
  ('Sarah Lim', 'sarah.lim@example.com'),
  ('James Wong', 'james.wong@example.com'),
  ('Priya Nair', 'priya.nair@example.com');

-- 10 units: 6 in project 1, 4 in project 2
INSERT INTO unit (project_id, unit_number, status) VALUES
  (1, 'A-01', 'available'),
  (1, 'A-02', 'booked'),
  (1, 'A-03', 'available'),
  (1, 'B-01', 'available'),
  (1, 'B-02', 'available'),
  (1, 'B-03', 'available'),
  (2, 'T-101', 'available'),
  (2, 'T-102', 'booked'),
  (2, 'T-103', 'available'),
  (2, 'T-104', 'available');

INSERT INTO booking (unit_id, agent_id, buyer_name, status) VALUES
  (2, 1, 'Chen Wei', 'confirmed'),
  (8, 2, 'Lee & Associates', 'confirmed'),
  (1, 1, NULL, 'pending'),
  (3, 3, 'Ng Family Trust', 'pending'),
  (7, 2, 'Patel Holdings', 'pending');
