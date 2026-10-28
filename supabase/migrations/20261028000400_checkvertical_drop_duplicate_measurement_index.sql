-- The table's unique constraint already owns an identical index; remove only the redundant standalone index.
drop index if exists public.report_measurements_inspection_test_position_uidx;
