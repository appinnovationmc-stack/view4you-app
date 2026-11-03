-- Repair price ranges shown on buyer reports. STARTER VALUES drafted for a typical SA workshop (parts + labour,
-- standard vehicle, ZAR incl. VAT). They are estimates and must be reviewed against real workshop quotes; edit rows freely.
-- premium_factor multiplies both ends for premium makes (BMW, Mercedes-Benz, Audi, Volvo, Land Rover, Jaguar, Porsche, Lexus).
create table if not exists public.repair_estimates (
  key text primary key,            -- 'section.component' | 'test.brake|shock|slip' | 'tyre.replace'
  label text not null,             -- what the repair is, in plain words
  low integer,                     -- null low+high = "quote needed"
  high integer,
  premium_factor numeric not null default 1.5 check (premium_factor >= 1),
  updated_at timestamptz not null default now(),
  check ((low is null and high is null) or (low is not null and high is not null and low >= 0 and high >= low))
);
alter table public.repair_estimates enable row level security;
drop policy if exists "repair_estimates read" on public.repair_estimates;
create policy "repair_estimates read" on public.repair_estimates for select to authenticated using (true);

insert into public.repair_estimates (key, label, low, high, premium_factor) values
 ('drive_system.brake_lines','Replace brake line or hose',800,2500,1.4),
 ('drive_system.brake_calipers','Replace brake caliper',1200,3500,1.5),
 ('drive_system.handbrake','Adjust or replace hand brake cable',500,1500,1.3),
 ('drive_system.steering_rack','Replace or recondition steering rack',4500,12000,1.6),
 ('drive_system.tie_rods','Replace tie rod ends',700,2000,1.4),
 ('drive_system.ball_joint','Replace ball joints',900,2500,1.4),
 ('drive_system.wheel_bearings','Replace wheel bearing',1000,3000,1.5),
 ('drive_system.shocks','Replace shock absorbers (pair)',2500,6500,1.6),
 ('drive_system.exhaust','Repair or replace exhaust section',800,4500,1.5),
 ('drive_system.cv_joints','Replace CV joint or boot',1200,3500,1.5),
 ('drive_system.engine_mountings','Replace engine mountings',1500,4500,1.5),
 ('drive_system.radiator','Replace radiator',2000,5500,1.5),
 ('drive_system.coolant_hoses','Replace coolant hoses',400,1500,1.4),
 ('drive_system.control_arm','Replace control arm',1500,4500,1.6),
 ('drive_system.bushings','Replace suspension bushes',800,2500,1.5),
 ('drive_system.links','Replace stabiliser links',500,1500,1.4),
 ('drive_system.gearbox','Recondition or replace gearbox',12000,35000,1.5),
 ('drive_system.chassis','Chassis repair (needs a specialist quote)',null,null,1.5),
 ('drive_system.smoke_emission','Engine diagnosis (needs a mechanic quote)',null,null,1.5),
 ('drive_system.fuel_system','Fuel system repair (needs a mechanic quote)',null,null,1.5),
 ('engine.brake_fluid','Flush and replace brake fluid',400,900,1.3),
 ('engine.belts','Replace drive belt',600,1800,1.5),
 ('engine.battery','Replace battery',1300,3000,1.3),
 ('engine.alternator','Replace alternator',2500,6500,1.5),
 ('engine.oil','Oil and filter service',700,2200,1.5),
 ('engine.coolant','Flush and refill coolant',400,1000,1.4),
 ('exterior.windscreen','Replace windscreen',2500,7000,1.6),
 ('exterior.wipers','Replace wiper blades',200,600,1.3),
 ('exterior.headlights','Replace headlight unit',800,6000,1.8),
 ('exterior.main_beams','Replace bulbs or unit',150,1500,1.5),
 ('exterior.brake_lights','Replace brake light bulbs or unit',150,2000,1.5),
 ('exterior.indicators','Replace indicator bulbs or unit',150,1500,1.5),
 ('exterior.tail_lights','Replace tail light cluster',400,3500,1.6),
 ('exterior.side_mirrors','Replace side mirror',600,3500,1.6),
 ('exterior.body_panels','Panel repair and respray (per panel)',2500,8000,1.5),
 ('exterior.crumple_zones','Accident repair (needs a panel beater quote)',null,null,1.5),
 ('interior.seatbelts','Replace seatbelt',1500,4000,1.5),
 ('interior.aircon','Aircon regas, or compressor if worse',700,9000,1.6),
 ('interior.warning_lights','Diagnostic scan to find the cause',500,1200,1.3),
 ('interior.hooter','Replace hooter',200,600,1.3),
 ('interior.pedals','Replace pedal rubbers',150,500,1.3),
 ('test_drive.braking','Brake inspection and repair',1200,4000,1.5),
 ('test_drive.gear_selection','Clutch or gearbox service',4500,15000,1.5),
 ('test_drive.steering','Steering inspection and repair',700,4500,1.5),
 ('test_drive.noises','Diagnosis of noise or vibration',500,2500,1.5),
 ('test_drive.performance','Engine service and diagnosis',1200,5000,1.5),
 ('wheels.wheel_nuts','Replace wheel nuts or studs',200,800,1.3),
 ('tyre.replace','Replace tyre',900,3500,1.5),
 ('test.brake','Brake repair on that axle (pads, discs or caliper)',1200,4000,1.5),
 ('test.shock','Replace shock absorbers on that axle',2500,6500,1.6),
 ('test.slip','Wheel alignment',450,900,1.3)
on conflict (key) do nothing;
