-- Add a starter employer list to India profiles without overwriting a list
-- the account owner has already edited.
update public.job_profiles
set filters = jsonb_set(
  coalesce(filters, '{}'::jsonb),
  '{target_companies}',
  '["Amazon","Flipkart","Walmart Global Tech India","Google","Microsoft","Adobe","Atlassian","Uber","Intuit","Salesforce","Oracle","PayPal","PhonePe","Razorpay","Swiggy","Zomato","Meesho","Myntra","Groww","CRED","Freshworks","Zoho","Postman","BrowserStack"]'::jsonb,
  true
),
updated_at = now()
where category = 'india_product'
  and case
    when jsonb_typeof(coalesce(filters -> 'target_companies', '[]'::jsonb)) = 'array'
    then jsonb_array_length(coalesce(filters -> 'target_companies', '[]'::jsonb)) = 0
    else false
  end;
