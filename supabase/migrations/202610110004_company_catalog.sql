create table if not exists public.company_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  website_domain text not null,
  careers_url text not null,
  source_platform text not null default 'auto',
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_catalog enable row level security;
revoke all on public.company_catalog from anon, authenticated;
grant select on public.company_catalog to authenticated;
create policy "Company catalog is readable by signed-in users"
  on public.company_catalog for select to authenticated using (true);

insert into public.company_catalog (name, normalized_name, website_domain, careers_url, logo_url) values
  ('Amazon', 'amazon', 'amazon.jobs', 'https://www.amazon.jobs/en/search?base_query=all&country=IND&loc_query=India', 'https://www.google.com/s2/favicons?domain=amazon.com&sz=128'),
  ('Flipkart', 'flipkart', 'flipkartcareers.com', 'https://www.flipkartcareers.com/jobslist', 'https://www.google.com/s2/favicons?domain=flipkart.com&sz=128'),
  ('Walmart Global Tech India', 'walmart-global-tech-india', 'walmart.wd504.myworkdayjobs.com', 'https://walmart.wd504.myworkdayjobs.com/walmartexternal', 'https://www.google.com/s2/favicons?domain=walmart.com&sz=128'),
  ('Google', 'google', 'google.com', 'https://www.google.com/about/careers/', 'https://www.google.com/s2/favicons?domain=google.com&sz=128'),
  ('Microsoft', 'microsoft', 'careers.microsoft.com', 'https://careers.microsoft.com/professionals/us/en/l-india', 'https://www.google.com/s2/favicons?domain=microsoft.com&sz=128'),
  ('Adobe', 'adobe', 'careers.adobe.com', 'https://careers.adobe.com/us/en', 'https://www.google.com/s2/favicons?domain=adobe.com&sz=128'),
  ('Atlassian', 'atlassian', 'atlassian.com', 'https://www.atlassian.com/company/careers', 'https://www.google.com/s2/favicons?domain=atlassian.com&sz=128'),
  ('Uber', 'uber', 'uber.com', 'https://www.uber.com/us/en/careers/list/', 'https://www.google.com/s2/favicons?domain=uber.com&sz=128'),
  ('Intuit', 'intuit', 'careers.smartrecruiters.com', 'https://careers.smartrecruiters.com/intuit2', 'https://www.google.com/s2/favicons?domain=intuit.com&sz=128'),
  ('Salesforce', 'salesforce', 'salesforce.com', 'https://www.salesforce.com/company/careers/', 'https://www.google.com/s2/favicons?domain=salesforce.com&sz=128'),
  ('Oracle', 'oracle', 'oracle.com', 'https://careers.oracle.com/', 'https://www.google.com/s2/favicons?domain=oracle.com&sz=128'),
  ('PayPal', 'paypal', 'paypal.wd1.myworkdayjobs.com', 'https://paypal.wd1.myworkdayjobs.com/en-US/jobs', 'https://www.google.com/s2/favicons?domain=paypal.com&sz=128'),
  ('PhonePe', 'phonepe', 'phonepe.com', 'https://www.phonepe.com/careers/', 'https://www.google.com/s2/favicons?domain=phonepe.com&sz=128'),
  ('Razorpay', 'razorpay', 'razorpay.com', 'https://razorpay.com/jobs/', 'https://www.google.com/s2/favicons?domain=razorpay.com&sz=128'),
  ('Swiggy', 'swiggy', 'swiggy.com', 'https://careers.swiggy.com/', 'https://www.google.com/s2/favicons?domain=swiggy.com&sz=128'),
  ('Zomato', 'zomato', 'zomato.com', 'https://www.zomato.com/careers', 'https://www.google.com/s2/favicons?domain=zomato.com&sz=128'),
  ('Meesho', 'meesho', 'meesho.io', 'https://www.meesho.io/jobs', 'https://www.google.com/s2/favicons?domain=meesho.io&sz=128'),
  ('Myntra', 'myntra', 'myntra.com', 'https://careers.myntra.com/', 'https://www.google.com/s2/favicons?domain=myntra.com&sz=128'),
  ('Groww', 'groww', 'groww.in', 'https://groww.in/careers', 'https://www.google.com/s2/favicons?domain=groww.in&sz=128'),
  ('CRED', 'cred', 'cred.club', 'https://careers.cred.club/', 'https://www.google.com/s2/favicons?domain=cred.club&sz=128'),
  ('Freshworks', 'freshworks', 'freshworks.com', 'https://careers.freshworks.com/', 'https://www.google.com/s2/favicons?domain=freshworks.com&sz=128'),
  ('Zoho', 'zoho', 'zoho.com', 'https://www.zoho.com/careers.html', 'https://www.google.com/s2/favicons?domain=zoho.com&sz=128'),
  ('Postman', 'postman', 'postman.com', 'https://www.postman.com/company/careers/', 'https://www.google.com/s2/favicons?domain=postman.com&sz=128'),
  ('BrowserStack', 'browserstack', 'browserstack.com', 'https://www.browserstack.com/careers', 'https://www.google.com/s2/favicons?domain=browserstack.com&sz=128')
on conflict (normalized_name) do update set
  name = excluded.name,
  website_domain = excluded.website_domain,
  careers_url = excluded.careers_url,
  logo_url = excluded.logo_url,
  updated_at = now();
