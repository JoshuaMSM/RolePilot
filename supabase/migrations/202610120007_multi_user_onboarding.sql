-- Create each new account's base profile and starter search profile from the
-- registration metadata. Every row remains owned by the new auth user and is
-- protected by the existing owner-only RLS policies.
create or replace function public.rolepilot_registration_available()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select count(*) < 5 from auth.users;
$$;

revoke all on function public.rolepilot_registration_available() from public, anon, authenticated;
grant execute on function public.rolepilot_registration_available() to anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  years numeric(4,1);
  roles text[];
  skills text[];
  target_companies text[];
  cities text[];
  other_countries text[];
  home_country text;
  needs_sponsorship boolean;
begin
  -- Serialize signups so concurrent requests cannot both claim the last slot.
  perform pg_advisory_xact_lock(817350121);
  if (select count(*) from auth.users) > 5 then
    raise exception using message = 'ROLEPILOT_ACCOUNT_LIMIT_REACHED';
  end if;

  if coalesce(metadata ->> 'experience_years', '') ~ '^[0-9]{1,2}([.][0-9])?$' then
    years := (metadata ->> 'experience_years')::numeric(4,1);
  end if;

  select coalesce(array_agg(value), '{}'::text[]) into roles
  from jsonb_array_elements_text(case when jsonb_typeof(metadata -> 'target_roles') = 'array' then metadata -> 'target_roles' else '[]'::jsonb end) as items(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(array_agg(value), '{}'::text[]) into skills
  from jsonb_array_elements_text(case when jsonb_typeof(metadata -> 'primary_skills') = 'array' then metadata -> 'primary_skills' else '[]'::jsonb end) as items(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(array_agg(value), '{}'::text[]) into target_companies
  from jsonb_array_elements_text(case when jsonb_typeof(metadata -> 'dream_companies') = 'array' then metadata -> 'dream_companies' else '[]'::jsonb end) as items(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(array_agg(value), '{}'::text[]) into cities
  from jsonb_array_elements_text(case when jsonb_typeof(metadata -> 'preferred_cities') = 'array' then metadata -> 'preferred_cities' else '[]'::jsonb end) as items(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(array_agg(value), '{}'::text[]) into other_countries
  from jsonb_array_elements_text(case when jsonb_typeof(metadata -> 'global_countries') = 'array' then metadata -> 'global_countries' else '[]'::jsonb end) as items(value)
  where nullif(btrim(value), '') is not null;

  home_country := coalesce(nullif(btrim(metadata ->> 'home_country'), ''), 'India');
  needs_sponsorship := (metadata ->> 'sponsorship_required') = 'true';

  insert into public.profiles (
    id, full_name, experience_years, primary_skills, target_roles,
    home_country, preferred_cities, global_countries, sponsorship_required
  ) values (
    new.id,
    nullif(btrim(metadata ->> 'full_name'), ''),
    years,
    skills,
    roles,
    home_country,
    cities,
    other_countries,
    needs_sponsorship
  );

  insert into public.agent_settings (user_id) values (new.id);

  insert into public.job_profiles (user_id, name, category, filters)
  values (
    new.id,
    'My Search Profile',
    'custom',
    jsonb_build_object(
      'countries', array[home_country] || other_countries,
      'preferred_cities', cities,
      'target_roles', roles,
      'minimum_experience', years,
      'skills', skills,
      'additional_interests', '[]'::jsonb,
      'sponsorship_required', needs_sponsorship,
      'relocation_preference', null,
      'minimum_compensation', null,
      'compensation_currency', null,
      'target_companies', to_jsonb(target_companies),
      'excluded_companies', '[]'::jsonb
    )
  );

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
