-- ============================================================================
-- LemonCheck — seed data (demo vehicles matching the original design mock)
-- Run AFTER schema.sql.
--
-- profiles, inspections, bookings, notifications, and report_purchases all
-- reference real auth.users ids and can't be meaningfully seeded until real
-- accounts exist — RLS expects auth.uid() to match, which a raw SQL insert
-- as the service role bypasses but the actual app flow will not. Once you
-- have real accounts (buyer + a few inspectors), use the app itself to
-- generate that data: sign up as an inspector, go online, then book +
-- complete an inspection as a buyer.
-- ============================================================================

insert into vehicles (vin, make, model, year, colour, mileage, engine, transmission) values
  ('ABC123GP','Toyota','Corolla',2019,'Silver',87500,'1.8L Petrol','Automatic'),
  ('XYZ789WC','Volkswagen','Polo',2021,'White',42000,'1.0T TSI','Manual'),
  ('DEF456GP','BMW','3 Series',2018,'Black',112000,'2.0L Petrol','Automatic');

insert into vehicle_history (vin, found, source, owners, first_registered, province, stolen, taxi_history, colour_changes, outstanding_finance, finance_house) values
  ('ABC123GP', true, 'eNaTIS + TransUnion', 2, 'Mar 2019', 'Gauteng', false, false, 0, false, null),
  ('XYZ789WC', true, 'eNaTIS + TransUnion', 1, 'Jan 2021', 'Western Cape', false, false, 0, true, 'FNB Vehicle Finance'),
  ('DEF456GP', true, 'eNaTIS + TransUnion', 3, 'Jun 2018', 'Gauteng', false, false, 1, false, null);

insert into vehicle_accidents (vin, date, severity, description) values
  ('ABC123GP', '2021-06-01', 'Minor', 'Rear-end collision. Panel damage. Santam insurance claim.'),
  ('DEF456GP', '2020-11-01', 'Major', 'Front-end collision. Structural damage. MFC insurance claim.'),
  ('DEF456GP', '2022-03-01', 'Minor', 'Side swipe. Door panel replaced.');

insert into vehicle_odometer_readings (vin, date, km) values
  ('ABC123GP','2024-11-01',87500), ('ABC123GP','2023-02-01',61200), ('ABC123GP','2022-01-01',38900),
  ('XYZ789WC','2024-09-01',42000),
  ('DEF456GP','2024-10-01',112000), ('DEF456GP','2022-10-01',78400);
