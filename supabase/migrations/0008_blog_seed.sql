-- 0008 — Blog seed (Epic 6.3): two launch categories and two original,
-- computation-first starter articles so the public blog renders from day
-- one. Content is written for Vyotish (original educational prose); the
-- admin team can edit or replace everything through the admin API.

insert into blog_categories (slug, name)
values ('basics', 'Astrology Basics'), ('panchang-guides', 'Panchang Guides')
on conflict (slug) do nothing;

insert into blog_tags (slug, name)
values ('panchang', 'panchang'), ('rashi', 'rashi'), ('vedic-basics', 'vedic basics'),
       ('nakshatra', 'nakshatra'), ('time-keeping', 'time keeping')
on conflict (slug) do nothing;

insert into blog_posts (slug, title, content_md, excerpt, status, publish_at, reading_minutes, category_id)
values
(
  'how-the-vedic-panchang-works',
  'How the Vedic Panchang Works: Tithi, Nakshatra, Yoga and Karana',
  E'## What a panchang actually is\n\nA panchang is the traditional Hindu almanac of the day. The word means "five limbs" (pancha + anga): **tithi**, **nakshatra**, **yoga**, **karana** and the **vara** (weekday). Each limb is a reading of where the Moon and Sun sit against the sky at a given moment, expressed in the way classical Indian astronomy measures the sky.\n\nThe key idea is that every limb is *computed*, not guessed. Vyotish derives all five from planetary longitudes calculated with modern ephemeris science, converted into the sidereal zodiac with the Lahiri ayanamsha.\n\n## Tithi — the Moon-Sun distance\n\nA tithi is one-thirtieth of the synodic month: the time the Moon takes to gain exactly 12 degrees of separation from the Sun. Fifteen tithis carry the Moon from new moon to full moon (the bright half, shukla paksha), and fifteen more return it to new moon (the dark half, krishna paksha).\n\nTo find today''s tithi the engine computes the angular difference `Moon - Sun`, divides by 12, and reads the index in the classical list: Pratipada, Dwitiya, Tritiya and so on up to Purnima (full) or Amavasya (new).\n\n## Nakshatra — the Moon''s mansion\n\nThe zodiac is divided into 27 nakshatras of exactly 13°20'' each, starting from Ashwini at the vernal point. The Moon''s sidereal longitude, divided by 13°20'', names the running nakshatra. Each nakshatra also has a *pada* (quarter) of 3°20'', which is why the panchang can report both "Moon in Rohini" and "Rohini pada 2" — and why the same numbering underpins the birth-star used in kundli matching.\n\n## Yoga and Karana — the finer subdivisions\n\n- **Yoga** adds the Sun and Moon longitudes and divides the sum into 27 parts. The thirteenth, Vyaghata, and similar "harsh" yogas are flagged in traditional calendars for caution.\n- **Karana** halves a tithi: eleven karanas repeat eight times across the lunar month, plus four fixed ones at the joints. There are sixty karanas in every synodic month.\n\n## Why sunrise matters\n\nAll of the above boundaries are instants of time — but a *day* in the panchang runs from sunrise to sunrise, not midnight. That is why the same date can show different tithis in Delhi and New York: the engine always evaluates which limb is running **at local sunrise** for your city. This is exactly what the [city panchang pages](/panchang) do, using IANA timezones and precise sunrise equations.\n\n## Reading a panchang day sensibly\n\n| Limb | What it answers |\n| --- | --- |\n| Tithi | Where are we in the lunar month? |\n| Nakshatra | Which lunar mansion does the Moon occupy? |\n| Yoga | What is the combined Sun+Moon arc? |\n| Karana | Which half-tithi is running now? |\n| Vara | Which weekday (planetary ruler) is it? |\n\nTreat the panchang as a precise astronomical calendar first. Auspiciousness judgements (muhurta) build on top of it — and those belong to tradition and the astrologer, not to the arithmetic. That division of labour is deliberate: Vyotish computes the limbs exactly and leaves interpretation honest.',
  'The five limbs of the panchang — tithi, nakshatra, yoga, karana and vara — explained from the arithmetic up: how Vyotish computes each from sidereal longitudes and local sunrise.',
  'published', now(), 4,
  (select id from blog_categories where slug = 'panchang-guides')
),
(
  'the-twelve-rashis-a-computation-first-introduction',
  'The Twelve Rashis: A Computation-First Introduction',
  E'## Signs as divisions, not personalities\n\nThe twelve rashis (Mesha, Vrishabha, Mithuna, Karka, Simha, Kanya, Tula, Vrishchika, Dhanu, Makara, Kumbha, Meena) are, before anything else, **equal 30-degree divisions of the sidereal zodiac**. When a kundli says "Moon in Karka", it is making a precise positional claim: the Moon''s sidereal longitude lies between 90° and 120° from the fixed reference point.\n\nThat reference point is what separates Vedic from Western tropical astrology. Vyotish uses the **Lahiri ayanamsha** — the offset between the moving equinox and the fixed stellar frame — which currently runs a little over 24 degrees. The same planet can sit in a different sign in the two systems for that reason alone.\n\n## The three qualities and four elements\n\nClassical texts group the rashis two ways:\n\n- **Elements** — fire (Mesha, Simha, Dhanu), earth (Vrishabha, Kanya, Makara), air (Mithuna, Tula, Kumbha), water (Karka, Vrishchika, Meena).\n- **Modalities** — movable (chara), fixed (sthira) and dual (dwiswabhava), cycling through the zodiac in order.\n\nThese groupings are descriptive scaffolding for interpretation; the computation underneath is always the same longitude arithmetic.\n\n## Lords of the signs\n\nEach rashi is ruled by a graha: Sun (Simha), Moon (Karka), Mars (Mesha, Vrishchika), Mercury (Mithuna, Kanya), Jupiter (Dhanu, Meena), Venus (Vrishabha, Tula) and Saturn (Makara, Kumbha). Rahu and Ketu, the lunar nodes, own no sign but colour the signs they occupy in a chart.\n\nThe lordship mapping matters far beyond the sign itself — it is what the classical system uses to connect planets to houses in a kundli, which is exactly what our [free kundli tool](/kundli) computes.\n\n## Where the ascendant fits\n\nThe lagna (ascendant) is the rashi rising on the eastern horizon at the birth moment, computed from the local sidereal time. It changes roughly every two hours, which is why accurate birth time matters so much in Vedic practice. A ten-minute error can move the lagna; the Moon, which spends about 2.5 days in a sign, is far more forgiving.\n\n## What the sign does and does not tell you\n\n| Question | Sun sign alone | Full chart |\n| --- | --- | --- |\n| Where was the Sun at birth? | Yes | Yes |\n| Which house does the Sun own and occupy? | No | Yes |\n| Dasha periods and transits? | No | Yes |\n| Compatibility (guna milan)? | Partly | Yes |\n\nNewspaper horoscopes compress all of this to the Sun sign. The Vedic tradition, and Vyotish, start from the **Moon sign (rashi)** and the lagna instead — which is why the [daily horoscope](/horoscope) pages are organised by rashi, not by tropical month.\n\n## Try it with real numbers\n\nEvery claim in this article is checkable: generate your [kundli](/kundli) to see your sidereal positions, or use the [rashi calculator](/calculators/rashi) to find your Moon sign from birth details. The arithmetic is transparent and the results are yours to interpret.',
  'What the twelve rashis really are under the hood: equal 30-degree sidereal divisions, the Lahiri ayanamsha offset, sign lords, and why Vedic astrology reads the Moon sign first.',
  'published', now(), 5,
  (select id from blog_categories where slug = 'basics')
)
on conflict (slug) do nothing;

-- link tags to posts through post_tags
insert into post_tags (post_id, tag_id)
select p.id, t.id from blog_posts p, blog_tags t
where (p.slug = 'how-the-vedic-panchang-works' and t.slug in ('panchang', 'nakshatra', 'time-keeping'))
   or (p.slug = 'the-twelve-rashis-a-computation-first-introduction' and t.slug in ('rashi', 'vedic-basics'))
on conflict (post_id, tag_id) do nothing;
