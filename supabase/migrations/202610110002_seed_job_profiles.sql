-- Seed the two profile templates from the candidate details in the project brief.
-- Compensation, preferred cities, exclusions, and relocation remain unset because
-- the brief did not provide personal values for them.

insert into public.job_profiles (user_id, name, category, enabled, filters)
select u.id, seed.name, seed.category, true, seed.filters
from auth.users as u
cross join (values
  (
    'India Product Companies',
    'india_product',
    '{"countries":["India"],"preferred_cities":[],"target_roles":["Senior Software Engineer","Senior Backend Engineer","Lead Engineer","Technical Lead","Software Architect"],"minimum_experience":7,"skills":["Java","Spring Boot","REST APIs","microservices","AWS","PostgreSQL","MySQL","Kafka","Redis","Docker","Kubernetes","Terraform","CI/CD","Prometheus","Grafana"],"additional_interests":["AI/ML","GenAI","system design","software architecture"],"sponsorship_required":false,"relocation_preference":null,"minimum_compensation":null,"compensation_currency":null,"target_companies":["Amazon","Flipkart","Walmart Global Tech India","Google","Microsoft","Adobe","Atlassian","Uber","Intuit","Salesforce","Oracle","PayPal","PhonePe","Razorpay","Swiggy","Zomato","Meesho","Myntra","Groww","CRED","Freshworks","Zoho","Postman","BrowserStack"],"excluded_companies":[]}'::jsonb
  ),
  (
    'Global Visa-Sponsored',
    'global_sponsored',
    '{"countries":["Germany","Switzerland","Singapore","Australia","Ireland"],"preferred_cities":[],"target_roles":["Senior Software Engineer","Senior Backend Engineer","Lead Engineer","Technical Lead","Software Architect"],"minimum_experience":7,"skills":["Java","Spring Boot","REST APIs","microservices","AWS","PostgreSQL","MySQL","Kafka","Redis","Docker","Kubernetes","Terraform","CI/CD","Prometheus","Grafana"],"additional_interests":["AI/ML","GenAI","system design","software architecture"],"sponsorship_required":true,"relocation_preference":null,"minimum_compensation":null,"compensation_currency":null,"target_companies":[],"excluded_companies":[]}'::jsonb
  )
) as seed(name, category, filters)
where not exists (
  select 1 from public.job_profiles as existing
  where existing.user_id = u.id and existing.name = seed.name
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''));
  insert into public.agent_settings (user_id) values (new.id);
  insert into public.job_profiles (user_id, name, category, filters) values
    (new.id, 'India Product Companies', 'india_product',
     '{"countries":["India"],"preferred_cities":[],"target_roles":["Senior Software Engineer","Senior Backend Engineer","Lead Engineer","Technical Lead","Software Architect"],"minimum_experience":7,"skills":["Java","Spring Boot","REST APIs","microservices","AWS","PostgreSQL","MySQL","Kafka","Redis","Docker","Kubernetes","Terraform","CI/CD","Prometheus","Grafana"],"additional_interests":["AI/ML","GenAI","system design","software architecture"],"sponsorship_required":false,"relocation_preference":null,"minimum_compensation":null,"compensation_currency":null,"target_companies":["Amazon","Flipkart","Walmart Global Tech India","Google","Microsoft","Adobe","Atlassian","Uber","Intuit","Salesforce","Oracle","PayPal","PhonePe","Razorpay","Swiggy","Zomato","Meesho","Myntra","Groww","CRED","Freshworks","Zoho","Postman","BrowserStack"],"excluded_companies":[]}'::jsonb),
    (new.id, 'Global Visa-Sponsored', 'global_sponsored',
     '{"countries":["Germany","Switzerland","Singapore","Australia","Ireland"],"preferred_cities":[],"target_roles":["Senior Software Engineer","Senior Backend Engineer","Lead Engineer","Technical Lead","Software Architect"],"minimum_experience":7,"skills":["Java","Spring Boot","REST APIs","microservices","AWS","PostgreSQL","MySQL","Kafka","Redis","Docker","Kubernetes","Terraform","CI/CD","Prometheus","Grafana"],"additional_interests":["AI/ML","GenAI","system design","software architecture"],"sponsorship_required":true,"relocation_preference":null,"minimum_compensation":null,"compensation_currency":null,"target_companies":[],"excluded_companies":[]}'::jsonb);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
