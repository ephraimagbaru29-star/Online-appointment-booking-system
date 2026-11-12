-- ============================================================================
-- Online Appointment Booking System — initial schema
-- Run this in the Supabase SQL Editor (or `supabase db push`).
--
-- Four main tables (proposal section 9):
--   profiles      — user ID, full name, email, role (customer | staff)
--   services      — service ID, name, description, duration (min), active flag
--   availability  — provider ID, weekday, start/end time, optional break periods
--   appointments  — appointment ID, customer, service, provider, start/end,
--                   status, customer note, reference number, timestamps
--
-- Conflict prevention (proposal section 10: "Use a database-level constraint or
-- transaction-safe booking operation"): the book_appointment / reschedule_
-- appointment functions lock the provider's row and re-check overlaps inside
-- the same transaction, so two simultaneous requests cannot double-book.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'customer'
              check (role in ('customer', 'staff')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- services
-- ----------------------------------------------------------------------------
create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(name) between 1 and 120),
  description      text,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 600),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- availability
--   breaks is an optional JSONB array of {"start":"13:00","end":"14:00"}.
-- ----------------------------------------------------------------------------
create table if not exists public.availability (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id) on delete cascade,
  weekday     text not null
              check (weekday in
                ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
  start_time  text not null,  -- 'HH:MM' 24h
  end_time    text not null,  -- 'HH:MM' 24h
  breaks      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (provider_id, weekday)
);

-- ----------------------------------------------------------------------------
-- appointments
--   status: pending | confirmed | completed | cancelled
-- ----------------------------------------------------------------------------
create sequence if not exists public.appointments_ref_seq;

create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  reference_number text not null unique
                  default ('AP-' || lpad((nextval('public.appointments_ref_seq'))::text, 6, '0')),
  customer_id     uuid not null references public.profiles (id) on delete cascade,
  service_id      uuid not null references public.services (id) on delete restrict,
  provider_id     uuid not null references public.profiles (id) on delete restrict,
  start_time      timestamptz not null,
  end_time        timestamptz not null,
  status          text not null default 'pending'
                  check (status in ('pending','confirmed','completed','cancelled')),
  customer_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_time > start_time)
);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists services_touch on public.services;
create trigger services_touch before update on public.services
  for each row execute function public.touch_updated_at();

drop trigger if exists availability_touch on public.availability;
create trigger availability_touch before update on public.availability
  for each row execute function public.touch_updated_at();

drop trigger if exists appointments_touch on public.appointments;
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Auto-create a profile on sign-up (Supabase Auth). Defaults to 'customer'.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row Level Security (proposal section 11)
--   - Customers access only their own appointment records.
--   - Staff access is role-restricted (manages services/availability/bookings).
--   - The service-role key used by the backend bypasses RLS; these policies
--     are defense-in-depth for any direct client reads.
-- ============================================================================

alter table public.profiles     enable row level security;
alter table public.services      enable row level security;
alter table public.availability  enable row level security;
alter table public.appointments  enable row level security;

-- Helper: is the current JWT user staff?
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'staff'
  );
$$;

-- profiles: a user can read/update their own row; staff can read all.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id or public.is_staff());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);

-- services: authenticated users read active ones; staff read/write all.
drop policy if exists services_select on public.services;
create policy services_select on public.services
  for select using (active is true or public.is_staff());

drop policy if exists services_staff_write on public.services;
create policy services_staff_write on public.services
  for all using (public.is_staff()) with check (public.is_staff());

-- availability: staff manage; authenticated users read (for booking UI).
drop policy if exists availability_select on public.availability;
create policy availability_select on public.availability
  for select using (public.is_staff() or auth.uid() is not null);

drop policy if exists availability_staff_write on public.availability;
create policy availability_staff_write on public.availability
  for all using (public.is_staff()) with check (public.is_staff());

-- appointments: customers read their own; staff read all.
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select using (customer_id = auth.uid() or public.is_staff());

-- ============================================================================
-- Transaction-safe booking RPC (proposal section 10)
-- Locks the provider row and re-checks overlaps inside the same transaction,
-- so two simultaneous requests cannot double-book the same slot. SECURITY
-- DEFINER lets it insert on behalf of an authenticated customer.
--
-- Working-hours validation uses the caller-supplied weekday + wall-clock
-- start/end (computed in the configured schedule time zone by the backend) so
-- the check is correct regardless of the database session time zone. The
-- authoritative overlap check uses absolute timestamps (time-zone independent).
-- ============================================================================
create or replace function public.book_appointment(
  p_customer       uuid,
  p_service        uuid,
  p_provider       uuid,
  p_start          timestamptz,
  p_duration_min   integer,
  p_customer_note  text default null,
  p_weekday        text default null,
  p_start_hhmm     text default null,
  p_end_hhmm       text default null
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_appointment public.appointments;
  v_end         timestamptz := p_start + (p_duration_min || ' minutes')::interval;
  v_active      integer;
  v_service     public.services;
  v_avail       record;
  v_break       jsonb;
begin
  if p_start < now() then
    raise exception 'in_the_past' using errcode = '20000';
  end if;

  select * into v_service from public.services where id = p_service;
  if not found then
    raise exception 'service_not_found' using errcode = '20000';
  end if;
  if not v_service.active then
    raise exception 'service_inactive' using errcode = '20000';
  end if;

  -- Lock the provider to serialise concurrent bookings for that provider.
  perform 1 from public.profiles where id = p_provider for update;
  if not found then
    raise exception 'provider_not_found' using errcode = '20000';
  end if;

  -- Working-hours check using caller-supplied wall-clock values (schedule tz).
  if p_weekday is not null and p_start_hhmm is not null and p_end_hhmm is not null then
    select * into v_avail from public.availability
      where provider_id = p_provider and weekday = p_weekday
      limit 1;
    if not found then
      raise exception 'outside_working_hours' using errcode = '20000';
    end if;
    if p_start_hhmm < v_avail.start_time or p_end_hhmm > v_avail.end_time then
      raise exception 'outside_working_hours' using errcode = '20000';
    end if;
    -- Reject slots that overlap any optional break period (half-open intervals).
    if coalesce(v_avail.breaks, '[]'::jsonb) <> '[]'::jsonb then
      for v_break in select * from jsonb_array_elements(v_avail.breaks) loop
        if (v_break->>'start') is not null and (v_break->>'end') is not null then
          if p_start_hhmm < (v_break->>'end') and (v_break->>'start') < p_end_hhmm then
            raise exception 'outside_working_hours' using errcode = '20000';
          end if;
        end if;
      end loop;
    end if;
  end if;

  -- Atomic overlap check against active (non-cancelled) appointments.
  -- Concurrency is serialised by the provider-row lock above, so this plain
  -- read sees the latest committed state when our lock is acquired.
  -- Cancelled appointments do not block the slot (proposal section 10).
  select count(*) into v_active from public.appointments
    where provider_id = p_provider
      and status <> 'cancelled'
      and tstzrange(start_time, end_time, '[]') && tstzrange(p_start, v_end, '[]');

  if v_active > 0 then
    raise exception 'slot_taken' using errcode = '20001';
  end if;

  insert into public.appointments (
    customer_id, service_id, provider_id, start_time, end_time, status, customer_note
  ) values (
    p_customer, p_service, p_provider, p_start, v_end, 'pending', p_customer_note
  )
  returning * into v_appointment;

  return v_appointment;
end; $$;

-- Reschedule: move an appointment to a new start, re-checking for conflicts
-- (excluding the appointment itself).
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_start      timestamptz,
  p_weekday        text default null,
  p_start_hhmm     text default null,
  p_end_hhmm       text default null
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_appointment public.appointments;
  v_end          timestamptz;
  v_duration_min integer;
  v_active       integer;
  v_avail        record;
  v_break        jsonb;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'not_found' using errcode = '20000';
  end if;
  if v_appointment.status = 'cancelled' then
    raise exception 'cannot_reschedule_cancelled' using errcode = '20000';
  end if;

  v_duration_min := extract(epoch from (v_appointment.end_time - v_appointment.start_time)) / 60;
  v_end := p_new_start + (v_duration_min || ' minutes')::interval;

  if p_new_start < now() then
    raise exception 'in_the_past' using errcode = '20000';
  end if;

  -- Lock the provider to serialise concurrent reschedules/bookings.
  perform 1 from public.profiles where id = v_appointment.provider_id for update;

  if p_weekday is not null and p_start_hhmm is not null and p_end_hhmm is not null then
    select * into v_avail from public.availability
      where provider_id = v_appointment.provider_id and weekday = p_weekday
      limit 1;
    if not found then
      raise exception 'outside_working_hours' using errcode = '20000';
    end if;
    if p_start_hhmm < v_avail.start_time or p_end_hhmm > v_avail.end_time then
      raise exception 'outside_working_hours' using errcode = '20000';
    end if;
    if coalesce(v_avail.breaks, '[]'::jsonb) <> '[]'::jsonb then
      for v_break in select * from jsonb_array_elements(v_avail.breaks) loop
        if (v_break->>'start') is not null and (v_break->>'end') is not null then
          if p_start_hhmm < (v_break->>'end') and (v_break->>'start') < p_end_hhmm then
            raise exception 'outside_working_hours' using errcode = '20000';
          end if;
        end if;
      end loop;
    end if;
  end if;

  -- Overlap check excluding this appointment. Concurrency is serialised by the
  -- provider-row lock above, so a plain read suffices.
  select count(*) into v_active from public.appointments
    where provider_id = v_appointment.provider_id
      and id <> p_appointment_id
      and status <> 'cancelled'
      and tstzrange(start_time, end_time, '[]') && tstzrange(p_new_start, v_end, '[]');

  if v_active > 0 then
    raise exception 'slot_taken' using errcode = '20001';
  end if;

  update public.appointments
    set start_time = p_new_start,
        end_time = v_end,
        status = 'pending'   -- a rescheduled slot needs re-confirmation
    where id = p_appointment_id
    returning * into v_appointment;

  return v_appointment;
end; $$;

grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz, integer, text, text, text, text) to authenticated;
grant execute on function public.reschedule_appointment(uuid, timestamptz, text, text, text) to authenticated;
grant execute on function public.is_staff() to authenticated;

-- ============================================================================
-- OPTIONAL: make a user the first staff/admin (proposal: "In a small deployment
-- this can be the service provider account"). After signing up once, run:
--   update public.profiles set role = 'staff' where email = 'you@example.com';
-- ============================================================================
