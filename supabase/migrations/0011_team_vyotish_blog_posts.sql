-- 0011_team_vyotish_blog_posts.sql
-- S-TB (owner request 2026-11-22), two asks:
--
-- 1. "change the name of writer to Team Vyotish in Articles & Vedic Studies":
--    the home content block `blog_teasers` (seeded 0004) carried fictional
--    astrologer bylines. Every real blog post already bylines "Team Vyotish"
--    server-side (routes/v1/blog.ts), so the teaser block was the last
--    sample-persona surface. Each teaser also gains an `href` to the full
--    article added in (2), so the home cards stop being dead ends.
--
-- 2. "add these articles in Blog as well with proper category section":
--    the three teaser topics become full, published posts (original
--    computation-first Vyotish prose, in the 0008 voice) under proper
--    categories — sunrise → Panchang Guides (existing), manglik →
--    Kundli Science (new), choghadiya → Muhurat Shastra (new). Category
--    chips + /blog/category/* pages pick them up on the next frontend build.
--
-- Dates/reading-minutes mirror the teaser cards (18/15/12 Nov 2026, 6/8/5)
-- so card and article agree. is_sample stays true on the block (P21 owner
-- review of home copy is separate; this change IS the owner's copy call for
-- the bylines). Idempotent: guarded UPDATE + ON CONFLICT inserts.
--
-- Content note: interpretive sections are framed as tradition-dependent;
-- engine-computable claims (sunrise geometry, house placement, segment
-- arithmetic) are kept exact. Internal links point only at routes that exist.

-- 1. Teaser bylines → Team Vyotish (+ href to the new posts)
update content_blocks
set payload = '[
  {"tag":"Panchang Guide","accent":"primary","read":"6 min read","title":"Why Does the Vedic Day Begin at Sunrise Rather Than Midnight?","text":"An explanation of Surya Siddhanta, Ahoratra cycles, and why city-specific sunrise calculation is the essential foundation of all authentic astrological timings.","author":"By Team Vyotish","date":"18 Nov 2026","href":"/blog/why-the-vedic-day-begins-at-sunrise"},
  {"tag":"Kundli Science","accent":"secondary","read":"8 min read","title":"Demystifying Manglik Dosha: Myths, Reality & True Exceptions","text":"Separating fear-based commercial myths from classical Brihat Parashara principles. When does Mars actually cause dosha, and which planetary combinations neutralize it?","author":"By Team Vyotish","date":"15 Nov 2026","href":"/blog/demystifying-manglik-dosha"},
  {"tag":"Muhurat Shastra","accent":"primary","read":"5 min read","title":"How to Use Choghadiya & Abhijit Muhurat for Everyday Decisions","text":"A practical guide to the 7 daytime and nighttime Choghadiyas (Amrit, Shubh, Labh, Char, Rog, Kaal, Udveg) and how to time important journeys and contracts.","author":"By Team Vyotish","date":"12 Nov 2026","href":"/blog/choghadiya-abhijit-muhurat-everyday-decisions"}
]'::jsonb
where block_key = 'blog_teasers'
  and lang = 'en'
  and payload::text like '%Shastri%';

-- 2a. Categories for the two teaser topics without one yet
insert into blog_categories (slug, name)
values ('kundli-science', 'Kundli Science'), ('muhurat-shastra', 'Muhurat Shastra')
on conflict (slug) do nothing;

-- 2b. Tags (reuse panchang/time-keeping from 0008)
insert into blog_tags (slug, name)
values ('sunrise', 'sunrise'), ('kundli', 'kundli'), ('manglik', 'manglik'),
       ('dosha', 'dosha'), ('muhurat', 'muhurat'), ('choghadiya', 'choghadiya')
on conflict (slug) do nothing;

-- 2c. The three full articles behind the teasers
insert into blog_posts (slug, title, content_md, excerpt, status, publish_at, reading_minutes, category_id)
values
(
  'why-the-vedic-day-begins-at-sunrise',
  'Why Does the Vedic Day Begin at Sunrise Rather Than Midnight?',
  E'## Two definitions of a day\n\nMost of the modern world counts a day from midnight — a civil convention fixed by law and time zones. The Vedic calendar counts it from **sunrise**, an astronomical event that happens at a different minute in every city and shifts a little every day of the year.\n\nThat one difference explains a lot of "why does my panchang disagree with that app" moments: a date, a tithi, a festival day — all of them are anchored to the sunrise at *your* location, not to the calendar page.\n\n## Ahoratra — the day-and-night whole\n\nClassical time-keeping (the Surya Siddhanta tradition) treats the **ahoratra** — "day-and-night" — as one continuous unit running from sunrise to the next sunrise. The daylight span (sunrise to sunset) and the night span (sunset to the next sunrise) are the two halves of one whole.\n\nEverything the panchang labels "today" — tithi, nakshatra, yoga, karana, vara — belongs to the ahoratra that *began at this morning''s sunrise*. If a tithi ends at 3 a.m., it counts as today''s tithi only if it is still running at sunrise; the tithi running at the next sunrise is what tomorrow''s calendar shows.\n\n## Why the vara changes at sunrise, not midnight\n\nThe weekday (vara) is named after the planet ruling the first hour after sunrise. The first hour of a Sunday belongs to the Sun, so the whole ahoratra until the next sunrise is "Sunday" — even though the civil clock may have called it Saturday for the hours after midnight. A planetary day therefore starts before or after the civil date changes, which is why traditional muhurat work never mixes the two clocks.\n\n## Sunrise is a computation, not a lookup\n\nSunrise is the instant the Sun''s upper limb appears above the horizon as seen from your spot on Earth. To compute it, an engine must account for:\n\n- the **semi-diameter** of the solar disc (about 16 arc-minutes),\n- atmospheric **refraction** near the horizon (about 34 arc-minutes), which lifts the apparent Sun,\n- the standard convention that sunrise begins when the Sun''s centre is about **50 arc-minutes below** the geometric horizon,\n- your **latitude and longitude**, which set both the time of sunrise and its daily drift, and\n- the **IANA time zone** (including historical daylight-saving shifts) that maps the instant back to clock time.\n\nTwo cities an hour apart by clock can share one sunrise; two cities on the same longitude can still see different sunrise times. This is why every sunrise-anchored value on Vyotish is computed per city — the same arithmetic that powers our [city panchang pages](/panchang).\n\n## What this changes in practice\n\n| Situation | Midnight calendar | Sunrise (panchang) calendar |\n| --- | --- | --- |\n| Tithi for a vrat | The tithi running at 00:00 | The tithi running at sunrise |\n| Weekday for a muhurat | Changes at 00:00 | Changes at local sunrise |\n| Festival date | One fixed civil date | City-specific civil date |\n\nA festival like Ekadashi or Karva Chauth can therefore fall on a different Gregorian date in Delhi and New York — not because the tradition differs, but because the two cities began their ahoratra at different instants.\n\n## The arithmetic is the point\n\nNone of this is mysticism — it is geometry. The panchang is a precise astronomical calendar whose "day" is defined by a physical event rather than a legal convention. Vyotish computes every limb of the day from sidereal longitudes and true local sunrise, so the reading you see is the reading your sky supports. Auspiciousness judgements build on top of that foundation — see [muhurat](/muhurat) for how we apply it.',
  'Why the Vedic day runs sunrise to sunrise — the ahoratra, the planetary day-lord, and the horizon geometry (semi-diameter, refraction) that makes every panchang reading city-specific.',
  'published', '2026-11-18 06:30:00+05:30', 6,
  (select id from blog_categories where slug = 'panchang-guides')
),
(
  'demystifying-manglik-dosha',
  'Demystifying Manglik Dosha: Myths, Reality & True Exceptions',
  E'## What "Manglik" actually means mechanically\n\nIn a kundli, Manglik (Mangal) dosha is one specific positional claim: **Mars occupies one of a short list of houses from the ascendant** — classically the 1st, 2nd, 4th, 7th, 8th or 12th — counted in the sidereal zodiac with whole-sign houses. That is the entire computation. It is not a curse, not a diagnosis, and not a verdict on a person; it is a placement flag that classical texts associate with friction in the significations those houses carry — most prominently marriage (7th) and domestic life (4th).\n\nBecause it is a placement flag, it is checkable: generate your [kundli](/kundli) and see exactly which house Mars occupies, with the ayanamsha shown.\n\n## Why those houses?\n\nEach flagged house touches a domain of life that Mars'' fiery, assertive temperament can disturb when unrefined:\n\n| House from lagna | Signification Mars can strain | Classical concern |\n| --- | --- | --- |\n| 1st | Self, temperament | Impulsive or dominating presence |\n| 2nd | Family, speech | Sharp speech, family friction |\n| 4th | Home, mother, comfort | Domestic unrest |\n| 7th | Marriage, partnership | Conflict in the partnership itself |\n| 8th | Longevity, in-laws, shared assets | Health and shared-resource friction |\n| 12th | Expenditure, distant places | Expenses, separation-type significations |\n\nThe dosha''s reputation comes from the 7th and 8th rows — marriage and longevity are the most emotionally loaded domains, so the flag got amplified far beyond its classical weight.\n\n## The exceptions the classics actually give\n\nThe same classical tradition that lists the dosha also lists cancellations. Well-established ones:\n\n- **Mars in its own sign (Mesha, Vrishchika) or exalted (Makara)**: Mars behaves as a dignified planet, and the dosha flag is traditionally reduced or nullified for the house concerned.\n- **Jupiter''s aspect on Mars**: Jupiter aspecting Mars (5th, 7th or 9th from Jupiter) is a standard softener in classical practice.\n- **Mutual cancellation**: if both charts carry Manglik placement, the flag is traditionally considered balanced — this is exactly what [kundli matching](/matching) evaluates, rather than rejecting a match on one flag alone.\n- **Reference-point differences**: some traditions read the dosha from the Moon (Chandra Manglik) or Venus instead of, or in addition to, the lagna, and the house list itself varies slightly between schools. Different reference points can give different answers — a genuine tradition-dependent reading, not a contradiction.\n\n## Myths the classics do not support\n\nA fear-driven industry has added rules with little textual grounding:\n\n- *"A Manglik marriage causes the partner''s death"* — classical texts describe friction and health strains, not deterministic fatality. No classical source supports the death claim.\n- *"The dosha expires after age 28"* — widely quoted, not found in the core texts. Age alone does not move Mars.\n- *"Every Manglik needs a puja or kumbh-vivah"* — remedies are tradition-specific counselling choices, not engine-computable facts; Vyotish does not sell fear.\n\n## What the engine computes — and what it leaves honest\n\nVyotish''s engine computes Mars'' sidereal longitude, places it in whole-sign houses from the lagna, and reports the placement plus the standard cancellations it can check (sign dignity, Jupiter aspect). What it deliberately does **not** compute is fate: whether a placement "will" harm a marriage is interpretation, and interpretation belongs to tradition and the astrologer, stated with proportion. Exact arithmetic, honest interpretation — that division of labour is the whole design.\n\n## How matching handles it\n\nIn [guna milan](/matching), the Manglik check is one input among several, evaluated in both charts together. A single flag in one chart — especially with dignified Mars or Jupiter''s aspect — does not outweigh the rest of the matching picture. If a tool tells you otherwise, or prices a "remedy" on the spot, treat that as a commercial signal, not an astrological one.',
  'What Manglik dosha actually computes — Mars in houses 1, 2, 4, 7, 8 or 12 — the cancellations the classics give, and the fear-based myths that have no textual grounding.',
  'published', '2026-11-15 06:30:00+05:30', 8,
  (select id from blog_categories where slug = 'kundli-science')
),
(
  'choghadiya-abhijit-muhurat-everyday-decisions',
  'How to Use Choghadiya & Abhijit Muhurat for Everyday Decisions',
  E'## Small windows, big tradition\n\nMost muhurat literature is aimed at weddings and griha pravesh. But most real decisions are smaller: signing a contract, starting a journey, a first client meeting. For these, the tradition keeps two lightweight, computation-friendly tools: the **choghadiya** — eight rolling segments of the day — and the **Abhijit muhurat**, the mid-day window considered auspicious even on otherwise neutral days.\n\nBoth derive from the same two instants: true local sunrise and sunset. That makes them exactly the kind of quantity an engine can compute per city — see [muhurat](/muhurat) and the [panchang](/panchang).\n\n## How choghadiya segments are formed\n\nThe daylight span (sunrise to sunset) is divided into **eight equal parts**, and the night span into eight more. Because day-length changes through the year, a day-choghadiya in June is longer than one in December — the segments breathe with the season instead of staying fixed on the clock.\n\nEach segment carries one of seven names, set by its ruling planet:\n\n| Choghadiya | Ruling tone | Traditional use |\n| --- | --- | --- |\n| Amrit | Nectar — best | Begin anything important |\n| Shubh | Auspicious | Good beginnings, purchases |\n| Labh | Gain | Business, contracts, investment |\n| Char | Movement | Travel, change, routine work |\n| Rog | Disease | Avoid for auspicious starts |\n| Kaal | Time/death | Avoid for auspicious starts |\n| Udveg | Anxiety | Avoid for auspicious starts |\n\nThe seven names cycle in a weekday-specific order: every weekday opens its day with a fixed choghadiya and the sequence repeats around it. Printed panchangs list the order; our panchang pages compute the live sequence from your city''s sunrise and sunset.\n\n## The practical reading\n\n- Start significant, positive work in **Amrit, Shubh or Labh**.\n- Use **Char** for journeys and routine activity — movement is its theme.\n- Avoid **Rog, Kaal and Udveg** for beginnings; traditions differ on how strictly, but all agree these are the weaker windows.\n- Night choghadiyas follow the same names on a shifted cycle and are read the same way.\n\n## Abhijit muhurat — the daily safety net\n\nDivide the daylight span into fifteen equal parts; the **eighth** is Abhijit, centred near local solar noon. At the equinoxes (a roughly 12-hour day) it runs about 48 minutes, shrinking or stretching with the season as day-length changes.\n\nAbhijit''s traditional status is unusual: it is considered auspicious on every weekday — a general-purpose window when no other muhurat has been chosen. Some traditions except Wednesday, holding Abhijit weak then; where sources differ, we say so rather than pick a side. It remains unsuitable for a few specific acts (marriage among them, per most texts) — for those, a purpose-computed muhurat is the honest answer.\n\n## Computation over folklore\n\nBoth tools reduce cleanly to arithmetic: sunrise, sunset, division, weekday ruling. Nothing in a choghadiya depends on guesswork, which is why they survive engine-driven scrutiny. Use them as lightweight default windows for everyday timing, and treat the big-moment muhurats as their own computed exercise.',
  'The eight choghadiya segments and the Abhijit muhurat, derived from true local sunrise and sunset — which windows favour beginnings, journeys and contracts, and how the engine computes them.',
  'published', '2026-11-12 06:30:00+05:30', 5,
  (select id from blog_categories where slug = 'muhurat-shastra')
)
on conflict (slug) do nothing;

-- 2d. Tag links
insert into post_tags (post_id, tag_id)
select p.id, t.id from blog_posts p, blog_tags t
where (p.slug = 'why-the-vedic-day-begins-at-sunrise' and t.slug in ('panchang', 'sunrise', 'time-keeping'))
   or (p.slug = 'demystifying-manglik-dosha' and t.slug in ('kundli', 'manglik', 'dosha'))
   or (p.slug = 'choghadiya-abhijit-muhurat-everyday-decisions' and t.slug in ('muhurat', 'choghadiya', 'panchang'))
on conflict (post_id, tag_id) do nothing;
