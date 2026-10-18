-- Avoid the PL/pgSQL output parameter normalized_name conflicting with the
-- table column in ON CONFLICT. Apply this after migration 009.
create or replace function public.add_company_catalog_entry(
  p_name text,
  p_website_domain text,
  p_careers_url text
)
returns table (
  id uuid,
  name text,
  normalized_name text,
  website_domain text,
  careers_url text,
  source_platform text,
  logo_url text,
  created boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(p_name);
  v_domain text := lower(btrim(p_website_domain));
  v_url text := btrim(p_careers_url);
  v_normalized text;
  v_host text;
  v_row public.company_catalog%rowtype;
  v_created boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to add a company.' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) < 2 or length(v_name) > 100
     or v_name !~ '[[:alnum:]]' then
    raise exception 'Enter a company name between 2 and 100 characters.' using errcode = '22023';
  end if;

  if v_domain is null or length(v_domain) > 253
     or v_domain !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'
     or v_domain ~ '(^|\.)(localhost|local|internal|test)$' then
    raise exception 'Enter a public website domain such as example.com, without a path.' using errcode = '22023';
  end if;

  if v_url is null or length(v_url) > 2048
     or v_url !~* '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?(:443)?([/?#]|$)' then
    raise exception 'Enter a public HTTPS careers-page URL.' using errcode = '22023';
  end if;

  v_host := lower(split_part(split_part(split_part(regexp_replace(v_url, '^https://', '', 'i'), '/', 1), '?', 1), '#', 1));
  v_host := regexp_replace(v_host, ':443$', '');
  if v_host = '' or v_host ~ '(^|\.)(localhost|local|internal|test)$'
     or not (
       v_host = v_domain or right(v_host, length(v_domain) + 1) = '.' || v_domain
       or v_host in ('boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.eu.lever.co', 'jobs.ashbyhq.com', 'jobs.eu.ashbyhq.com', 'careers.smartrecruiters.com', 'jobs.smartrecruiters.com')
       or v_host like '%.myworkdayjobs.com'
     ) then
    raise exception 'The careers URL must use the company domain or a supported public hiring platform.' using errcode = '22023';
  end if;

  v_normalized := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  if v_normalized = '' then
    raise exception 'The company name must contain English letters or numbers.' using errcode = '22023';
  end if;

  insert into public.company_catalog as catalog (
    name, normalized_name, website_domain, careers_url, source_platform, logo_url
  ) values (
    v_name, v_normalized, v_domain, v_url, 'auto',
    'https://www.google.com/s2/favicons?domain=' || v_domain || '&sz=128'
  ) on conflict on constraint company_catalog_normalized_name_key do nothing
  returning * into v_row;
  v_created := found;

  if not v_created then
    select * into v_row from public.company_catalog as catalog
    where catalog.normalized_name = v_normalized;
  end if;

  return query select v_row.id, v_row.name, v_row.normalized_name, v_row.website_domain,
    v_row.careers_url, v_row.source_platform, v_row.logo_url, v_created;
end;
$$;

notify pgrst, 'reload schema';
