-- 0004 — Epic 9.1 (D12): home content data plane. Owner directive: ALL page
-- data lives in Supabase (RLS on every table), served only through backend
-- APIs. Extends the V1 schema ADDITIVELY (astrologers/pujas already exist
-- with public-read RLS on is_active = true); creates the two missing tables
-- (faq_items, content_blocks) with the same policy pattern. Sample seeds
-- transcribed verbatim from the D11 design mockup, marked is_sample = true
-- (placeholders register P8/P9/P21).
--
-- Applied once via Supabase MCP against vyotish-dev (owgszyhxvyomxyxhoeed).
-- Do NOT re-run.

-- ---- Astrologers: additive columns for the home design surface ----
alter table astrologers
  add column if not exists title text not null default '',
  add column if not exists availability_label text not null default '',
  add column if not exists is_available boolean not null default false,
  add column if not exists sort_order integer not null default 0,
  add column if not exists accent text not null default 'primary'
    check (accent in ('primary','secondary'));

-- ---- Poojas (V1 spelling): additive accent hint for the design surface ----
alter table pujas
  add column if not exists sort_order integer not null default 0,
  add column if not exists accent text not null default 'primary'
    check (accent in ('primary','secondary')),
  add column if not exists includes jsonb not null default '[]'::jsonb;

-- ---- FAQ items (JSON-LD FAQPage source later, Epic 7.1) ----
create table if not exists faq_items (
  id         uuid primary key default gen_random_uuid(),
  section    text not null default 'home',
  lang       text not null default 'en' check (lang in ('en','hi')),
  question   text not null,
  answer     text not null,
  is_sample  boolean not null default true,
  status     text not null default 'published' check (status in ('draft','published')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Generic keyed content blocks (marketing copy / card lists per locale) ----
create table if not exists content_blocks (
  id         uuid primary key default gen_random_uuid(),
  block_key  text not null,
  lang       text not null default 'en' check (lang in ('en','hi')),
  payload    jsonb not null default '{}'::jsonb,
  is_sample  boolean not null default true,
  status     text not null default 'published' check (status in ('draft','published')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (block_key, lang)
);

alter table faq_items      enable row level security;
alter table content_blocks enable row level security;

drop policy if exists "faq_items_public_read" on faq_items;
create policy "faq_items_public_read" on faq_items
  for select using (status = 'published');
drop policy if exists "content_blocks_public_read" on content_blocks;
create policy "content_blocks_public_read" on content_blocks
  for select using (status = 'published');

-- ---- Seeds (verbatim from the D11 mockup home; is_sample = true) ----

-- Astrologers (V1 table; public read gates on is_active = true)
insert into astrologers
  (slug, name, title, about, expertise, languages, experience_years,
   price_per_minute, is_available, availability_label, accent, is_sample, is_active, sort_order) values
  ('vidyadhar-shastri', 'Pt. Vidyadhar Shastri', 'Vedic Jyotish & Muhurat Expert',
   'Traditional Varanasi lineage scholar specializing in Janam Kundli analysis, career direction, and auspicious Vivah Muhurat selection.',
   '{"Janam Kundli","Career","Vivah Muhurat"}', '{"Hindi","Sanskrit","English"}', 18,
   45, true, 'Available for Booking', 'primary', true, true, 0),
  ('ananya-dave', 'Acharya Ananya Dave', 'Kundli Matching & Prashna Shastra',
   'Renowned for compassionate, empathetic marriage compatibility analysis and instant horary (Prashna) queries for urgent decisions.',
   '{"Kundli Matching","Prashna"}', '{"English","Hindi","Gujarati"}', 12,
   40, true, 'Available for Booking', 'secondary', true, true, 1),
  ('rakesh-mishra', 'Dr. Rakesh Mishra', 'Vedic Vastu & Corporate Astrology',
   'Doctorate in Jyotish Shastra. Advises startups, business founders, and families on property energy alignment and commercial launch timings.',
   '{"Vastu","Corporate Astrology"}', '{"Hindi","English"}', 22,
   60, false, 'Next slot 4:00 PM', 'primary', true, true, 2)
on conflict (slug) do nothing;

-- Poojas (V1 table `pujas`; category constrained to V1 enum values)
insert into pujas
  (slug, name, category, purpose, description, duration, mode, sample_price,
   muhurat_note, accent, includes, is_sample, is_active, sort_order) values
  ('navagraha-shanti', 'Navagraha Shanti Pooja', 'navagraha',
   'Graha Shanti',
   'Harmonizes malefic planetary influences and strengthens benefic grahas in your natal chart.',
   '2.5 hrs', '{home,online}', 3500, null, 'primary',
   '["Mode: At Home or Online Sankalp","Samagri: Complete sacred dravya included"]'::jsonb,
   true, true, 0),
  ('maha-rudrabhishek', 'Maha Rudrabhishek Pooja', 'rudrabhishek',
   'Shiva Aradhana',
   'Consecrated abhishek of Shiva with Panchamrit and Shukla Yajurveda Rudrashtadhyayi mantras.',
   '3 hrs', '{temple,home}', 5100, 'Ideal Timing: Pradosh or Somwar', 'secondary',
   '["Mode: Temple Consecration or Home","Ideal Timing: Pradosh or Somwar"]'::jsonb,
   true, true, 1),
  ('griha-pravesh-vastu', 'Griha Pravesh & Vastu Shanti', 'griha_pravesh',
   'Vastu & Home',
   'Purification of new dwelling, Havan, and Vastu Purusha invocation for domestic peace and abundance.',
   '4 hrs', '{home}', 7500, 'Custom Muhurat at premises', 'primary',
   '["Mode: At Premises (Custom Muhurat)","Complete Vastu mandala & Havan samagri"]'::jsonb,
   true, true, 2)
on conflict (slug) do nothing;

-- FAQ items (home, English)
insert into faq_items (section, lang, question, answer, is_sample, sort_order) values
  ('home', 'en',
   'Why is my Moon Sign (Rashi) different from my Western Zodiac Sign?',
   'Western astrology uses the Tropical zodiac based on the vernal equinox, whereas Vedic astrology (Jyotish) uses the Sidereal zodiac (Nirayana) aligned with actual fixed star constellations. Due to the precession of equinoxes (Ayanamsha), there is currently an approximately 24-degree difference, placing your Moon sign one sign back in most cases.',
   true, 0),
  ('home', 'en',
   'How accurate is the online Janam Kundli generation?',
   'Vyotish implements the exact mathematical algorithms used by the Swiss Ephemeris and the Indian National Calendar. Coordinates, true local sunrise, and historical daylight saving time shifts are taken from the IANA time zone database, ensuring minute-level precision for all charts.',
   true, 1),
  ('home', 'en',
   'Can I book a consultation without making an immediate online payment?',
   'Yes. In Phase 1, our consultation system works on a confirmed booking request model. You submit your preferred date, time, and questions. Our administrative team coordinates directly with the astrologer and confirms your appointment via phone/WhatsApp prior to any session.',
   true, 2)
on conflict do nothing;

-- Content blocks (keyed, per locale)
insert into content_blocks (block_key, lang, payload, is_sample) values
  ('calculators', 'en', '[
    {"icon":"brightness_2","title":"Rashi Calculator (चंद्र राशि)","text":"Find your exact Moon sign and lunar constellation for accurate Vedic horoscopes.","cta":"Calculate Rashi →","href":"/calculators"},
    {"icon":"stars","title":"Nakshatra Calculator","text":"Discover which of the 27 lunar mansions ruled your moment of birth and your birth pada.","cta":"Calculate Nakshatra →","href":"/calculators"},
    {"icon":"north_east","title":"Rising Sign (Lagna)","text":"Determines the eastern horizon sign at your exact birth minute—the anchor of all houses.","cta":"Calculate Lagna →","href":"/kundli"},
    {"icon":"timelapse","title":"Shani Sade Sati","text":"Check Saturn''s 7.5-year transit relative to your Moon sign: rising, peak, or setting phase.","cta":"Check Sade Sati →","href":"/calculators"},
    {"icon":"local_fire_department","title":"Mangal Dosha Check","text":"Evaluates Mars placement in 1st, 2nd, 4th, 7th, 8th or 12th house with traditional cancellations.","cta":"Evaluate Mars →","href":"/kundli"},
    {"icon":"stream","title":"Kaal Sarp Yoga","text":"Determines if all planets are hemmed between Rahu and Ketu, and identifies the specific type.","cta":"Check Kaal Sarp →","href":"/kundli"},
    {"icon":"pin","title":"Vedic Numerology","text":"Calculate your Mulank (Birth Number), Bhagyank (Destiny Number), and Namank (Name Number).","cta":"Calculate Numbers →","href":"/calculators"},
    {"icon":"schedule","title":"Vimshottari Dasha","text":"View your active planetary major period (Mahadasha) and current sub-period transitions.","cta":"View Dasha →","href":"/kundli"}
  ]'::jsonb, true),
  ('trust_cards', 'en', '[
    {"icon":"science","accent":"primary","title":"Swiss Ephemeris Accuracy","text":"We compute planetary longitudes using high-precision Swiss Ephemeris algorithms combined with the Government of India standard Lahiri Ayanamsha (Chitra Paksha)."},
    {"icon":"privacy_tip","accent":"secondary","title":"Strict Privacy & DPDP Act","text":"Birth details, contact information, and consultation notes are strictly personal data. We never share or sell records, and delete information upon simple user request."},
    {"icon":"gavel","accent":"primary","title":"No Superstition or Panic","text":"Astrological guidance provides self-knowledge and cosmic context. It is never a substitute for certified medical, legal, or financial professional advice."}
  ]'::jsonb, true),
  ('blog_teasers', 'en', '[
    {"tag":"Panchang Guide","accent":"primary","read":"6 min read","title":"Why Does the Vedic Day Begin at Sunrise Rather Than Midnight?","text":"An explanation of Surya Siddhanta, Ahoratra cycles, and why city-specific sunrise calculation is the essential foundation of all authentic astrological timings.","author":"By Pt. Vidyadhar Shastri","date":"18 Nov 2026"},
    {"tag":"Kundli Science","accent":"secondary","read":"8 min read","title":"Demystifying Manglik Dosha: Myths, Reality & True Exceptions","text":"Separating fear-based commercial myths from classical Brihat Parashara principles. When does Mars actually cause dosha, and which planetary combinations neutralize it?","author":"By Acharya Ananya Dave","date":"15 Nov 2026"},
    {"tag":"Muhurat Shastra","accent":"primary","read":"5 min read","title":"How to Use Choghadiya & Abhijit Muhurat for Everyday Decisions","text":"A practical guide to the 7 daytime and nighttime Choghadiyas (Amrit, Shubh, Labh, Char, Rog, Kaal, Udveg) and how to time important journeys and contracts.","author":"By Dr. Rakesh Mishra","date":"12 Nov 2026"}
  ]'::jsonb, true),
  ('hero_trust', 'en', '[
    {"icon":"lock","tone":"success","text":"Zero OTP required • 100% Private"},
    {"icon":"verified_user","tone":"accent","text":"No fear tactics or miracle claims"},
    {"icon":"speed","tone":"primary","text":"Instant Swiss Ephemeris output"}
  ]'::jsonb, true),
  ('gemstones_teaser', 'en', '{
    "kicker":"Gemstones Portal — Coming soon..!",
    "title":"100% Natural, Unheated Vedic Gemstones Energized for Your Chart"
  }'::jsonb, true)
on conflict (block_key, lang) do nothing;

-- ---- Soft-retire the generic V1 placeholder rows (0002): the home surface
--      serves the D11 design-verbatim set above; keep old rows for admin
--      history without publishing them. ----
update astrologers set is_active = false where slug like 'sample-astrologer-%';
update pujas set is_active = false
  where slug in ('graha-shanti-puja', 'satyanarayan-puja', 'rudrabhishek-puja');
