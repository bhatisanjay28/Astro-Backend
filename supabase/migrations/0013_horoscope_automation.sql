-- 0013_horoscope_automation.sql
-- Horoscope Upgrade Step 4 storage (library-structure §1):
--   A. horoscope_library — Paige's phrase bank (slot × condition × lang × variant_no)
--   B. horoscopes.payload — generated page payloads the API serves (additive column)
--   C. horoscope_run_log — one row per generation run (validation + alerting surface)
--   D. content_blocks horoscope.* — fixed strings from style-guide §7 (single source of truth)
-- All additive; no existing column or row is modified except the seeded blocks below.

-- A. phrase library -----------------------------------------------------------------
create table if not exists horoscope_library (
  id         uuid primary key default gen_random_uuid(),
  slot       text not null,        -- 'daily.health', 'monthly.overview', 'yearly.love', …
  condition  text not null,        -- 'rating=good.pb=unfav.retro=none'  (§3)
  lang       text not null check (lang in ('en', 'hi')),
  variant_no int  not null,
  text       text not null,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (slot, condition, lang, variant_no)
);
create index if not exists horoscope_library_lookup_idx
  on horoscope_library (slot, condition, lang) where is_active;

-- B. generated payloads --------------------------------------------------------------
alter table horoscopes add column if not exists payload jsonb;

-- C. run log -------------------------------------------------------------------------
create table if not exists horoscope_run_log (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  status      text not null check (status in ('success', 'partial', 'failed')),
  published   integer not null default 0,
  violations  jsonb not null default '[]'::jsonb,
  duration_ms integer not null default 0
);

-- D. fixed strings (style-guide §7) ---------------------------------------------------
insert into content_blocks (block_key, lang, payload, is_sample, status) values
  ('horoscope.disclaimer', 'en', $${
    "text": "This horoscope is shared for guidance and general reflection only. It is based on traditional Vedic Moon-sign transit principles and is not a substitute for professional medical, legal, or financial advice."
  }$$, false, 'published'),
  ('horoscope.disclaimer', 'hi', $${
    "text": "यह राशिफल केवल मार्गदर्शन एवं चिंतन के लिए है। यह पारंपरिक वैदिक चंद्र-राशि गोचर सिद्धांतों पर आधारित है और किसी भी प्रकार की चिकित्सकीय, कानूनी या वित्तीय सलाह का विकल्प नहीं है।"
  }$$, false, 'published'),
  ('horoscope.disclosure', 'en', $${
    "text": "How we compute this: We take each planet's sidereal position (Lahiri ayanamsha) at 00:05 IST, count the house it occupies from your Vedic Moon sign, and apply classical gochara (transit) favourability tables — including vedha (obstruction) adjustments. Lucky colour, number, direction, mantra and deity follow the day's ruling planet by a fixed traditional mapping. Planetary nodes are computed by the standard mean-node method. Ratings are band labels, not scores; they describe timing tendencies, not outcomes."
  }$$, false, 'published'),
  ('horoscope.disclosure', 'hi', $${
    "text": "यह कैसे निकाला जाता है: हम 00:05 IST पर प्रत्येक ग्रह की साइडरियल स्थिति (लाहिड़ी अयनांश) लेते हैं, आपकी वैदिक चंद्र राशि से उसका भाव गिनते हैं, और शास्त्रीय गोचर अनुकूलता तालिकाओं — वेध समायोजन सहित — को लागू करते हैं। शुभ रंग, अंक, दिशा, मंत्र और देवता दिन के शासक ग्रह की निश्चित पारंपरिक मैपिंग से आते हैं। राहु-केतु मानक मीन-नोड विधि से गणना किए जाते हैं। रेटिंग केवल समय-प्रवृत्ति बताती है, परिणाम नहीं।"
  }$$, false, 'published'),
  ('horoscope.rating_labels', 'en', $${
    "labels": {
      "excellent": { "label": "Excellent", "glyph": "▲▲" },
      "good": { "label": "Good", "glyph": "▲" },
      "moderate": { "label": "Moderate", "glyph": "◆" },
      "challenging": { "label": "Challenging", "glyph": "▼" }
    }
  }$$, false, 'published'),
  ('horoscope.rating_labels', 'hi', $${
    "labels": {
      "excellent": { "label": "उत्तम", "glyph": "▲▲" },
      "good": { "label": "अच्छा", "glyph": "▲" },
      "moderate": { "label": "मध्यम", "glyph": "◆" },
      "challenging": { "label": "चुनौतीपूर्ण", "glyph": "▼" }
    }
  }$$, false, 'published'),
  ('horoscope.lucky_why', 'en', $${
    "planet_of_day": "{{planet}} leads today's sky for {{sign}}",
    "weekday": "It's {{planet}}'s weekday — the traditional weekday ruler supplies today's lucky triad",
    "sign_lord": "{{planet}} is your sign's ruling lord — the steady basis for today's lucky triad"
  }$$, false, 'published'),
  ('horoscope.lucky_why', 'hi', $${
    "planet_of_day": "आज {{sign_hi}} राशि के लिए {{planet_hi}} प्रमुख ग्रह हैं",
    "weekday": "आज {{planet_hi}} का वार है — पारंपरिक वार-स्वामी आज का शुभ त्रिक देते हैं",
    "sign_lord": "{{planet_hi}} आपकी राशि के स्वामी हैं — आज के शुभ त्रिक का स्थिर आधार"
  }$$, false, 'published'),
  ('horoscope.sadesati_note', 'en', $${
    "text": "Saturn is moving through your {{phase}} during {{months}}. In tradition this is a phase that rewards steady effort, patience and simple routines — slow building, not sudden change."
  }$$, false, 'published'),
  ('horoscope.sadesati_note', 'hi', $${
    "text": "{{months}} के दौरान शनि आपकी {{phase}} से गुज़र रहे हैं। परंपरा में यह ऐसा समय माना जाता है जो धीरे-धीरे, लगातार मेहनत और संतुलित दिनचर्या को फल देता है — अचानक बदलाव से नहीं, धीरज से।"
  }$$, false, 'published'),
  ('horoscope.chandrashtama_tag', 'en', $${
    "text": "The Moon passes your 8th house today — tradition suggests quiet, rest and unhurried routines."
  }$$, false, 'published'),
  ('horoscope.chandrashtama_tag', 'hi', $${
    "text": "आज चंद्रमा आपके आठवें भाव से गुज़र रहे हैं — परंपरा शांति, विश्राम और बिना जल्दबाज़ी की दिनचर्या सुझाती है।"
  }$$, false, 'published'),
  ('horoscope.headers', 'en', $${
    "overview": "Overview",
    "thought_of_day": "Thought of the day",
    "dos_heading": "Do",
    "donts_heading": "Avoid",
    "lucky_heading": "Lucky today",
    "disclosure_title": "How we compute this",
    "monthly_overview": "This month's overview",
    "best_days": "Best days",
    "testing_day": "Testing day",
    "sky_block": "This month's sky",
    "year_overview": "Year overview",
    "month_table": "Month by month",
    "outlook_col": "Outlook"
  }$$, false, 'published'),
  ('horoscope.headers', 'hi', $${
    "overview": "सारांश",
    "thought_of_day": "आज का विचार",
    "dos_heading": "करें",
    "donts_heading": "बचें",
    "lucky_heading": "आज के शुभ",
    "disclosure_title": "यह कैसे निकाला जाता है",
    "monthly_overview": "इस माह का सारांश",
    "best_days": "शुभ दिन",
    "testing_day": "सावधानी का दिन",
    "sky_block": "इस माह का आकाश",
    "year_overview": "वर्ष का सारांश",
    "month_table": "महीना दर महीना",
    "outlook_col": "संभावना"
  }$$, false, 'published'),
  ('horoscope.area_names', 'en', $${
    "health": "Health",
    "education": "Education",
    "career": "Career",
    "money": "Money",
    "love": "Love",
    "family": "Family",
    "career_money": "Career & Money",
    "business": "Business",
    "wealth": "Wealth",
    "marriage": "Marriage",
    "children": "Children"
  }$$, false, 'published'),
  ('horoscope.area_names', 'hi', $${
    "health": "स्वास्थ्य",
    "education": "शिक्षा",
    "career": "करियर",
    "money": "धन",
    "love": "प्रेम",
    "family": "परिवार",
    "career_money": "करियर और धन",
    "business": "व्यापार",
    "wealth": "संपत्ति",
    "marriage": "विवाह",
    "children": "संतान"
  }$$, false, 'published'),
  ('horoscope.month_clause_intro', 'en', $${
    "text": "Each row blends the month's leading planets with the overall tone."
  }$$, false, 'published'),
  ('horoscope.month_clause_intro', 'hi', $${
    "text": "हर पंक्ति माह के प्रमुख ग्रहों और समग्र स्वर को मिलाकर बनती है।"
  }$$, false, 'published')
on conflict (block_key, lang) do update
  set payload = excluded.payload, is_sample = false, updated_at = now();

-- E. RLS — deny-by-default (0001 invariant: RLS enabled on EVERY table).
-- No policies: only the service role (the Worker) touches these tables; the
-- anon key gets neither read nor write. Library rows are visitor-facing copy
-- pools, so anonymous writes here would leak into published pages.
alter table horoscope_library enable row level security;
alter table horoscope_run_log enable row level security;
