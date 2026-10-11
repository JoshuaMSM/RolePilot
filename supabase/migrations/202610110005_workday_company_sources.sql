-- Keep seeded company source URLs in the backend catalog so all user profiles
-- use the same official Workday listings.
update public.company_catalog
set website_domain = 'walmart.wd504.myworkdayjobs.com',
    careers_url = 'https://walmart.wd504.myworkdayjobs.com/walmartexternal',
    source_platform = 'workday',
    updated_at = now()
where normalized_name = 'walmart-global-tech-india';

update public.company_catalog
set website_domain = 'paypal.wd1.myworkdayjobs.com',
    careers_url = 'https://paypal.wd1.myworkdayjobs.com/en-US/jobs',
    source_platform = 'workday',
    updated_at = now()
where normalized_name = 'paypal';
