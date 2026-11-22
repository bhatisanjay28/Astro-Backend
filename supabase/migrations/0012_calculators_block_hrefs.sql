-- 0012 — Fix Featured-calculators card hrefs on the /calculators hub
-- (owner report 2026-11-22): the Nakshatra card linked to /calculators/rashi
-- and the Lagna / Vimshottari Dasha cards still linked to /kundli — leftovers
-- from before the dedicated Tier-1 calculator pages (Epic 14). Also narrows
-- the Rashi card copy to Moon sign only: Nakshatra has its own card and its
-- own calculator page now.
--
-- Title-keyed jsonb rebuild: order-preserving and resilient to array-index
-- drift. No-op rows keep their payload untouched.

update content_blocks
set payload = (
    select jsonb_agg(
        case elem->>'title'
          when 'Nakshatra Calculator' then
            jsonb_set(elem, '{href}', '"/calculators/nakshatra"')
          when 'Rising Sign (Lagna)' then
            jsonb_set(elem, '{href}', '"/calculators/lagna"')
          when 'Vimshottari Dasha' then
            jsonb_set(elem, '{href}', '"/calculators/vimshottari-dasha"')
          when 'Rashi Calculator (चंद्र राशि)' then
            jsonb_set(elem, '{text}',
              '"Find your exact Moon sign (Rashi) for accurate Vedic horoscopes."')
          else elem
        end
        order by ord
    )
    from jsonb_array_elements(payload) with ordinality as t(elem, ord)
),
updated_at = now()
where block_key = 'calculators' and lang = 'en';
