-- Company names and careers-page metadata are public catalog data. Allow
-- unauthenticated signup pages to read entries for autocomplete and validation.
grant select on public.company_catalog to anon;
create policy "Company catalog is readable during signup"
  on public.company_catalog for select to anon using (true);
