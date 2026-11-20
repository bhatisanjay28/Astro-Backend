-- 0010_content_home_accuracy_copy.sql
-- Epic 7.3 trust-copy correction: the seeded home content (0004) attributed the
-- calculation engine to "Swiss Ephemeris", which Vyotish does not use — the
-- engine is the open-source astronomy-engine library behind Vyotish's own
-- Lahiri sidereal layer (DECISIONS.md D5; frontend footer/utility-bar copy was
-- corrected in the same change). This migration rewrites the three seeded rows
-- so the API-served home content matches reality. Rows stay is_sample=true
-- (P21 unchanged — owner review of home copy still pending).
--
-- Idempotent: plain UPDATEs, safe to re-run.

-- 1. FAQ answer — "How accurate is the online Janam Kundli generation?"
update faq_items
set answer = 'Vyotish computes planetary longitudes with the open-source astronomy-engine library and the Lahiri Ayanamsha (Chitra Paksha), the Government of India standard. True local sunrise, coordinates, and historical daylight-saving shifts come from the IANA time zone database, giving minute-level precision for all charts.'
where section = 'home'
  and lang = 'en'
  and question = 'How accurate is the online Janam Kundli generation?'
  and answer like '%Swiss Ephemeris%';

-- 2. Trust cards — first card title/text
update content_blocks
set payload = '[
  {"icon":"science","accent":"primary","title":"Astronomical Precision","text":"We compute planetary longitudes using high-precision open astronomical algorithms (astronomy-engine) combined with the Government of India standard Lahiri Ayanamsha (Chitra Paksha)."},
  {"icon":"privacy_tip","accent":"secondary","title":"Strict Privacy & DPDP Act","text":"Birth details, contact information, and consultation notes are strictly personal data. We never share or sell records, and delete information upon simple user request."},
  {"icon":"gavel","accent":"primary","title":"No Superstition or Panic","text":"Astrological guidance provides self-knowledge and cosmic context. It is never a substitute for certified medical, legal, or financial professional advice."}
]'::jsonb
where block_key = 'trust_cards'
  and lang = 'en'
  and payload::text like '%Swiss Ephemeris%';

-- 3. Hero trust chip — "Instant Swiss Ephemeris output"
update content_blocks
set payload = '[
  {"icon":"lock","tone":"success","text":"Zero OTP required • 100% Private"},
  {"icon":"verified_user","tone":"accent","text":"No fear tactics or miracle claims"},
  {"icon":"speed","tone":"primary","text":"Instant astronomical precision"}
]'::jsonb
where block_key = 'hero_trust'
  and lang = 'en'
  and payload::text like '%Swiss Ephemeris%';
