-- 0003: seed evergreen daily horoscope content (Epic 5.1 minimal, home design §5.2)
-- 12 signs × en/hi, date_key='rolling', published, marked is_sample=true —
-- sample content pending real editorial content via admin (Epic 6.4 / P8).
-- Idempotent: upsert on the natural key (sign, period, date_key, lang).

insert into horoscopes (sign, period, date_key, lang, overview, status, is_sample)
values
  ('aries',      'daily', 'rolling', 'en', 'New beginnings in financial ventures; planetary support in career.', 'published', true),
  ('taurus',     'daily', 'rolling', 'en', 'Harmony in domestic affairs; favorable day for investments.', 'published', true),
  ('gemini',     'daily', 'rolling', 'en', 'Clear communications will resolve pending commercial disputes swiftly.', 'published', true),
  ('cancer',     'daily', 'rolling', 'en', 'Intuitive insights bring peaceful clarity to personal family matters.', 'published', true),
  ('leo',        'daily', 'rolling', 'en', 'Leadership abilities recognized; health stays vibrant and steady.', 'published', true),
  ('virgo',      'daily', 'rolling', 'en', 'Analytical focus leads to solid breakthroughs in your work tasks.', 'published', true),
  ('libra',      'daily', 'rolling', 'en', 'Balance restored in relationships; peaceful evening with loved ones.', 'published', true),
  ('scorpio',    'daily', 'rolling', 'en', 'Deep spiritual curiosity ignited; auspicious travel possible.', 'published', true),
  ('sagittarius','daily', 'rolling', 'en', 'Guru''s aspect brings wise counsel and optimism in endeavors.', 'published', true),
  ('capricorn',  'daily', 'rolling', 'en', 'Patient disciplined effort yields concrete milestones at work.', 'published', true),
  ('aquarius',   'daily', 'rolling', 'en', 'Community collaboration and friendship flourish today with joy.', 'published', true),
  ('pisces',     'daily', 'rolling', 'en', 'Serene meditative focus; creative inspiration is peaked.', 'published', true),
  ('aries',      'daily', 'rolling', 'hi', 'आर्थिक कार्यों में नई शुरुआत; करियर में ग्रहों का सहयोग।', 'published', true),
  ('taurus',     'daily', 'rolling', 'hi', 'घरेलू मामलों में सामंजस्य; निवेश के लिए अनुकूल दिन।', 'published', true),
  ('gemini',     'daily', 'rolling', 'hi', 'स्पष्ट संवाद से लंबित वाणिज्यिक विवादों का शीघ्र समाधान।', 'published', true),
  ('cancer',     'daily', 'rolling', 'hi', 'अंतर्दृष्टि से पारिवारिक मामलों में शांतिपूर्ण स्पष्टता।', 'published', true),
  ('leo',        'daily', 'rolling', 'hi', 'नेतृत्व क्षमता की पहचान; स्वास्थ्य बना रहेगा।', 'published', true),
  ('virgo',      'daily', 'rolling', 'hi', 'विश्लेषणात्मक दृष्टि से कार्यक्षेत्र में ठोस उपलब्धियाँ।', 'published', true),
  ('libra',      'daily', 'rolling', 'hi', 'संबंधों में संतुलन; प्रियजनों के साथ सुखद संध्या।', 'published', true),
  ('scorpio',    'daily', 'rolling', 'hi', 'आध्यात्मिक जिज्ञासा जागृत; शुभ यात्रा संभव।', 'published', true),
  ('sagittarius','daily', 'rolling', 'hi', 'गुरु की दृष्टि से समझदार परामर्श और आशावाद।', 'published', true),
  ('capricorn',  'daily', 'rolling', 'hi', 'धैर्यपूर्ण परिश्रम से कार्यक्षेत्र में ठोस मील के पत्थर।', 'published', true),
  ('aquarius',   'daily', 'rolling', 'hi', 'सामुदायिक सहयोग और मित्रता में खुशहाली।', 'published', true),
  ('pisces',     'daily', 'rolling', 'hi', 'शांत ध्यान और रचनात्मक प्रेरणा।', 'published', true)
on conflict (sign, period, date_key, lang) do update
  set overview   = excluded.overview,
      status     = excluded.status,
      is_sample  = excluded.is_sample,
      updated_at = now();
