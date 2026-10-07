-- LemonCheck detailed report tables. Run AFTER schema.sql.
-- ASSUMPTIONS (check against your inspections table): inspections.id is uuid,
-- and inspections.inspector_id = auth.uid() for the inspector who owns the job.

alter table inspections
  add column if not exists report_number text unique,
  add column if not exists odometer_km integer,
  add column if not exists roadworthy_status text check (roadworthy_status in ('pass','fail')),
  add column if not exists faults jsonb not null default '[]',
  add column if not exists warnings jsonb not null default '[]',
  add column if not exists submitted_at timestamptz;

create table if not exists report_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  section text not null,
  component text not null,
  condition text not null check (condition in ('good','as_expected','fair','poor','na')),
  explanation text,
  roadworthy_relevant boolean not null default false,
  unique (inspection_id, section, component)
);

create table if not exists report_measurements (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  test text not null check (test in ('brake','shock','slip')),
  position text not null,            -- 'Front Axle' | 'Rear Axle' | 'Parking Brake'
  right_value numeric,
  left_value numeric,
  diff_pct numeric,
  result text,
  unique (inspection_id, test, position)
);

create table if not exists report_tyres (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  position text not null,            -- 'Front Left' ... 'Spare'
  size text, load_speed text, make text, model text, tyre_type text,
  tread_mm numeric,
  unique (inspection_id, position)
);

create table if not exists report_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  section text not null,             -- 'overview' | 'drive_system' | 'engine' | 'exterior' | 'interior' | 'wheels' | 'tyres'
  storage_path text not null,
  caption text,
  sort integer not null default 0
);

create index if not exists report_items_insp on report_items(inspection_id);
create index if not exists report_photos_insp on report_photos(inspection_id);

-- RLS: read follows whatever the user can already see on the inspection; write = owning inspector only.
do $$
declare t text;
begin
  foreach t in array array['report_items','report_measurements','report_tyres','report_photos'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "%1$s_select" on %1$I for select to authenticated
      using (exists (select 1 from inspections i where i.id = %1$I.inspection_id))$p$, t);
    execute format($p$create policy "%1$s_write" on %1$I for all to authenticated
      using (exists (select 1 from inspections i where i.id = %1$I.inspection_id and i.inspector_id = auth.uid()))
      with check (exists (select 1 from inspections i where i.id = %1$I.inspection_id and i.inspector_id = auth.uid()))$p$, t);
  end loop;
end $$;

-- Private photo bucket; path convention: <inspection_id>/<filename>
insert into storage.buckets (id, name, public) values ('report-photos', 'report-photos', false)
on conflict (id) do nothing;

create policy "report photos read" on storage.objects for select to authenticated
  using (bucket_id = 'report-photos' and exists (select 1 from inspections i where i.id::text = (storage.foldername(name))[1]));
create policy "report photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos' and exists (select 1 from inspections i where i.id::text = (storage.foldername(name))[1] and i.inspector_id = auth.uid()));
