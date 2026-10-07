create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare v_name text; v_first text; v_init text; v_role public.user_role;
begin
 v_name:=coalesce(nullif(new.raw_user_meta_data->>'name',''),split_part(new.email,'@',1));
 v_first:=coalesce(nullif(new.raw_user_meta_data->>'first_name',''),split_part(v_name,' ',1));
 v_init:=coalesce(nullif(new.raw_user_meta_data->>'init',''),upper(left(regexp_replace(v_name,'[^A-Za-z]','','g'),2)));
 if v_init is null or v_init='' then v_init:='U'; end if;
 begin v_role:=(new.raw_user_meta_data->>'role')::public.user_role; exception when invalid_text_representation then v_role:='buyer'; end;
 insert into public.profiles(id,role,name,first_name,init,email) values(new.id,v_role,v_name,v_first,v_init,new.email)
 on conflict(id) do update set name=excluded.name,first_name=excluded.first_name,init=excluded.init,email=excluded.email;
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function public.notify_report_completed() returns trigger language plpgsql security definer set search_path='' as $$
declare v_buyer uuid;
begin
 select buyer_id into v_buyer from public.bookings where id=new.booking_id;
 if v_buyer is not null then insert into public.notifications(user_id,type,icon,title,body) values(v_buyer,'sys','🍋','Your LemonCheck report is ready','Your inspection report '||coalesce(new.report_number,'')||' is now available.'); end if;
 return new;
end $$;
drop trigger if exists trg_report_completed_notification on public.inspections;
create trigger trg_report_completed_notification after insert on public.inspections for each row execute function public.notify_report_completed();
revoke all on function public.notify_report_completed() from public,anon,authenticated;

create or replace function public.notify_report_purchased() returns trigger language plpgsql security definer set search_path='' as $$
declare v_inspector uuid; v_tracker uuid; v_vin text;
begin
 select i.inspector_id,i.vin,v.first_tracked_by into v_inspector,v_vin,v_tracker from public.inspections i join public.vehicles v on v.vin=i.vin where i.id=new.inspection_id;
 if v_tracker is not null and v_tracker<>new.buyer_id then insert into public.notifications(user_id,type,icon,title,body) values(v_tracker,'earn','🍋','Report sold again','Your vehicle report for '||v_vin||' generated R'||new.payer_earning||'.'); end if;
 if v_inspector is not null and v_inspector<>new.buyer_id then insert into public.notifications(user_id,type,icon,title,body) values(v_inspector,'earn','💰','Report resale earned','Your LemonCheck report for '||v_vin||' generated R'||new.inspector_earning||'.'); end if;
 return new;
end $$;
drop trigger if exists trg_report_purchase_notification on public.report_purchases;
create trigger trg_report_purchase_notification after insert on public.report_purchases for each row execute function public.notify_report_purchased();
revoke all on function public.notify_report_purchased() from public,anon,authenticated;

alter policy "bookings: buyer inserts own" on public.bookings with check ((select auth.uid())=buyer_id);
alter policy "bookings: buyer reads own" on public.bookings using ((select auth.uid())=buyer_id);
alter policy "bookings: buyer updates own" on public.bookings using ((select auth.uid())=buyer_id) with check ((select auth.uid())=buyer_id);
alter policy "bookings: inspector reads assigned/pending" on public.bookings using (((select auth.uid())=inspector_id) or ((inspector_id is null) and status='pending'));
alter policy "bookings: inspector updates assigned" on public.bookings using ((select auth.uid())=inspector_id) with check ((select auth.uid())=inspector_id);
alter policy "inspections: inspector inserts own" on public.inspections with check ((select auth.uid())=inspector_id);
alter policy "findings: insert via own inspection" on public.inspection_findings with check (exists(select 1 from public.inspections i where i.id=inspection_id and i.inspector_id=(select auth.uid())));