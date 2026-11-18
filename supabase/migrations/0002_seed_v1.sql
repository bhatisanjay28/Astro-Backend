-- ============================================================================
-- Vyotish-Astro — Seed V1 (Epic 0.4)
-- ALL content rows are clearly-marked SAMPLE data (is_sample = true) per
-- PRD §15 — never presented as real. Cities are a GeoNames-derived subset.
-- Idempotent-ish: guard on slug/key so re-runs do not duplicate.
-- ============================================================================

-- cities: major Indian cities (subset; full GeoNames import is a later story)
insert into cities (slug, name, name_hi, country_code, admin1, latitude, longitude, timezone, geonames_id, population)
values
  ('new-delhi',    'New Delhi',    'नई दिल्ली',      'IN', 'Delhi',          28.613900, 77.209000, 'Asia/Kolkata',      1273294, 257000000),
  ('mumbai',       'Mumbai',       'मुंबई',          'IN', 'Maharashtra',    19.076000, 72.877700, 'Asia/Kolkata',      1275339, 124000000),
  ('kolkata',      'Kolkata',      'कोलकाता',        'IN', 'West Bengal',    22.572600, 88.363900, 'Asia/Kolkata',      1275004, 4500000),
  ('chennai',      'Chennai',      'चेन्नई',         'IN', 'Tamil Nadu',     13.082700, 80.270700, 'Asia/Kolkata',      1267279, 7100000),
  ('bengaluru',    'Bengaluru',    'बेंगलुरु',       'IN', 'Karnataka',      12.971600, 77.594600, 'Asia/Kolkata',      1277333, 8400000),
  ('hyderabad',    'Hyderabad',    'हैदराबाद',       'IN', 'Telangana',      17.385000, 78.486700, 'Asia/Kolkata',      1269843, 6800000),
  ('pune',         'Pune',         'पुणे',           'IN', 'Maharashtra',    18.520400, 73.856700, 'Asia/Kolkata',      1259229, 3100000),
  ('ahmedabad',    'Ahmedabad',    'अहमदाबाद',       'IN', 'Gujarat',        23.022500, 72.571400, 'Asia/Kolkata',      1279236, 5500000),
  ('jaipur',       'Jaipur',       'जयपुर',          'IN', 'Rajasthan',      26.912400, 75.787300, 'Asia/Kolkata',      1274746, 3000000),
  ('lucknow',      'Lucknow',      'लखनऊ',           'IN', 'Uttar Pradesh',  26.846700, 80.946200, 'Asia/Kolkata',      1264733, 2800000),
  ('varanasi',     'Varanasi',     'वाराणसी',        'IN', 'Uttar Pradesh',  25.317600, 82.973900, 'Asia/Kolkata',      1273313, 1200000),
  ('prayagraj',    'Prayagraj',    'प्रयागराज',      'IN', 'Uttar Pradesh',  25.435800, 81.846300, 'Asia/Kolkata',      1273457, 1100000),
  ('patna',        'Patna',        'पटना',           'IN', 'Bihar',          25.594100, 85.137600, 'Asia/Kolkata',      1260086, 2100000),
  ('bhopal',       'Bhopal',       'भोपाल',          'IN', 'Madhya Pradesh', 23.259900, 77.412600, 'Asia/Kolkata',      1275059, 1800000),
  ('indore',       'Indore',       'इंदौर',          'IN', 'Madhya Pradesh', 22.719600, 75.857700, 'Asia/Kolkata',      1269784, 2000000),
  ('nagpur',       'Nagpur',       'नागपुर',         'IN', 'Maharashtra',    21.145800, 79.088200, 'Asia/Kolkata',      1261482, 2400000),
  ('surat',        'Surat',        'सूरत',           'IN', 'Gujarat',        21.170200, 72.831100, 'Asia/Kolkata',      1255364, 4600000),
  ('kochi',        'Kochi',        'कोच्चि',         'IN', 'Kerala',         9.931200,  76.267300, 'Asia/Kolkata',      1272321, 600000),
  ('guwahati',     'Guwahati',     'गुवाहाटी',       'IN', 'Assam',          26.144500, 91.736200, 'Asia/Kolkata',      1271725, 960000),
  ('chandigarh',   'Chandigarh',   'चंडीगढ़',        'IN', 'Chandigarh',     30.733300, 76.779400, 'Asia/Kolkata',      1274250, 1050000),
  ('amritsar',     'Amritsar',     'अमृतसर',         'IN', 'Punjab',         31.634000, 74.872300, 'Asia/Kolkata',      1272575, 1150000),
  ('dehradun',     'Dehradun',     'देहरादून',       'IN', 'Uttarakhand',    30.316500, 78.032200, 'Asia/Kolkata',      1270926, 580000),
  ('shimla',       'Shimla',       'शिमला',          'IN', 'Himachal Pradesh', 31.104800, 77.173400, 'Asia/Kolkata',    1256506, 170000),
  ('udaipur',      'Udaipur',      'उदयपुर',         'IN', 'Rajasthan',      24.585400, 73.712500, 'Asia/Kolkata',      1254260, 450000),
  ('goa-panaji',   'Panaji',       'पणजी',           'IN', 'Goa',            15.490900, 73.827800, 'Asia/Kolkata',      1260239, 115000),
  ('london',       'London',       'लंदन',           'GB', 'England',        51.507400, -0.127800, 'Europe/London',     2643743, 8900000),
  ('new-york',     'New York',     'न्यूयॉर्क',      'US', 'New York',       40.712800, -74.006000, 'America/New_York', 5128581, 8400000),
  ('dubai',        'Dubai',        'दुबई',           'AE', 'Dubai',          25.204800, 55.270800, 'Asia/Dubai',        292223,  3300000),
  ('singapore',    'Singapore',    'सिंगापुर',       'SG', null,             1.352100,  103.819800, 'Asia/Singapore',   1880252, 5600000),
  ('kathmandu',    'Kathmandu',    'काठमांडू',       'NP', 'Bagmati',        27.717200, 85.324000, 'Asia/Kathmandu',    1209606, 1000000)
on conflict (slug) do nothing;

-- site_settings (public.* keys are readable by anyone via RLS)
insert into site_settings (key, value) values
  ('public.gemstones_site_url', '""'::jsonb),      -- empty → Gemstones tab shows Coming soon..! (PRD §5.8)
  ('public.contact_email', '"vyotish@gmail.com"'::jsonb),
  ('public.contact_whatsapp', '""'::jsonb),           -- placeholder P15
  ('public.notify_launch_date', '"2027-01-01"'::jsonb)
on conflict (key) do nothing;

-- astrologers: SAMPLE ONLY (P8)
insert into astrologers (slug, name, expertise, languages, experience_years, price_per_minute, about, is_sample) values
  ('sample-astrologer-1', 'Sample Astrologer One',
   array['kundli','muhurat'], array['hindi','english'], 12, 25.00,
   'SAMPLE DATA — replace with real astrologer profiles before launch (P8).', true),
  ('sample-astrologer-2', 'Sample Astrologer Two',
   array['vastu','career'], array['hindi','english','marathi'], 8, 20.00,
   'SAMPLE DATA — replace with real astrologer profiles before launch (P8).', true),
  ('sample-astrologer-3', 'Sample Astrologer Three',
   array['matchmaking','numerology'], array['hindi','english'], 15, 30.00,
   'SAMPLE DATA — replace with real astrologer profiles before launch (P8).', true)
on conflict (slug) do nothing;

-- pujas: SAMPLE ONLY (P9)
insert into pujas (slug, name, name_hi, category, purpose, samagri, duration, mode, sample_price, is_sample) values
  ('graha-shanti-puja', 'Graha Shanti Puja', 'ग्रह शांति पूजा', 'graha_shanti',
   'Pacifying planetary influences. SAMPLE — respectful wording only, no guaranteed-outcome claims (PRD §5.6/§15).',
   '["ghee diya","flowers","kumkum","prasad items"]'::jsonb, '2-3 hours', array['online','home'], 5100.00, true),
  ('satyanarayan-puja', 'Satyanarayan Puja', 'सत्यनारायण पूजा', 'satyanarayan',
   'Traditional Satyanarayan Katha. SAMPLE DATA (P9).',
   '["panchamrit","banana","sheera prasad","tulsi"]'::jsonb, '3 hours', array['home'], 4100.00, true),
  ('rudrabhishek-puja', 'Rudrabhishek', 'रुद्राभिषेक', 'rudrabhishek',
   'Rudrabhishek abhisheka. SAMPLE DATA (P9).',
   '["milk","honey","ghee","belpatra","water pot"]'::jsonb, '2 hours', array['temple'], 6100.00, true)
on conflict (slug) do nothing;

-- festivals: SAMPLE subset (mark is_sample; full calendar is a later story)
insert into festivals (name, name_hi, date, description, is_sample) values
  ('Makar Sankranti', 'मकर संक्रांति', '2027-01-14', 'Sun enters sidereal Capricorn. SAMPLE date — engine-verified in Epic 1 (P16).', true),
  ('Diwali', 'दीपावली', '2026-11-08', 'Festival of lights. SAMPLE DATA (P10).', true),
  ('Navaratri', 'नवरात्रि', '2026-10-11', 'Nine nights of Devi worship. SAMPLE DATA (P10).', true)
on conflict do nothing;

-- muhurat_rules: SAMPLE rules with source placeholders — Jyotishi review REQUIRED (P11)
insert into muhurat_rules (event_type, rule_name, conditions, source_doc, is_active) values
  ('marriage', 'avoid-mars-ruled-tithi-sample',
   '{"tithi_not_in": [4, 6, 8, 9, 12, 14], "note": "SAMPLE structure — values pending Jyotishi verification"}'::jsonb,
   'SOURCE PLACEHOLDER — classical muhurat references to be documented and reviewed by a qualified Jyotishi before launch (P11).', true),
  ('griha_pravesh', 'avoid-tuesday-sample',
   '{"vaar_not_in": ["mangalvara"], "note": "SAMPLE structure — values pending Jyotishi verification"}'::jsonb,
   'SOURCE PLACEHOLDER — to be documented and reviewed (P11).', true),
  ('travel', 'avoid-rahu-kaal-sample',
   '{"avoid_windows": ["rahu_kaal"], "note": "Standard practice; exact span computation validated in engine"}'::jsonb,
   'SOURCE PLACEHOLDER — to be documented and reviewed (P11).', true)
on conflict do nothing;

-- horoscopes: none seeded — admin enters content (PRD §5.2: sample seeds only when needed)
