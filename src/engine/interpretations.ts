/**
 * Deterministic interpretation layer (Epic 14, S14-1b).
 *
 * Plain-language meaning text for every calculator output, grounded in the
 * research corpus (_bmad-output/calculators/research/*.md) and classical
 * sources. NO runtime LLM — every string here is fixed, so outputs are
 * reproducible and testable. Routes embed these under `interpretation`.
 * All astrological readings remain `pending Jyotishi review (P11)`.
 */

export interface Interpretation {
  /** One-line headline for the verdict card. */
  verdict: string;
  /** 1–3 sentence classical grounding. */
  meaning: string;
  /** Practical next steps (0–3 bullets). */
  guidance: string[];
  /** Classical / research basis. */
  basis: string;
}

const NUMEROLOGY_ROOTS: Record<number, { lord: string; keywords: string; meaning: string }> = {
  1: {
    lord: "Sun",
    keywords: "leadership, willpower, originality",
    meaning:
      "Root 1 is ruled by the Sun — a pioneering number whose people are meant to lead rather than follow; independence and self-made authority define the path.",
  },
  2: {
    lord: "Moon",
    keywords: "sensitivity, cooperation, diplomacy",
    meaning:
      "Root 2 is ruled by the Moon — gentle, intuitive and cooperative; success comes through partnership and emotional intelligence, not force.",
  },
  3: {
    lord: "Jupiter",
    keywords: "wisdom, teaching, expansion",
    meaning:
      "Root 3 is ruled by Jupiter — the teacher's number; optimistic, expressive and learned, it thrives on sharing knowledge and guiding others.",
  },
  4: {
    lord: "Rahu",
    keywords: "unconventional, disciplined, practical",
    meaning:
      "Root 4 is ruled by Rahu (Chaldean practice also reads Uranus) — unconventional and hardworking; rewards come late but last, through method and persistence.",
  },
  5: {
    lord: "Mercury",
    keywords: "communication, versatility, commerce",
    meaning:
      "Root 5 is ruled by Mercury — the most adaptable number; quick minds, travel, trade and communication are its natural fields.",
  },
  6: {
    lord: "Venus",
    keywords: "harmony, beauty, responsibility",
    meaning:
      "Root 6 is ruled by Venus — the number of love, beauty and service; it flourishes in art, family harmony and caring responsibilities.",
  },
  7: {
    lord: "Ketu",
    keywords: "spirituality, research, introspection",
    meaning:
      "Root 7 is ruled by Ketu — the seeker's number; introspective, philosophical and analytical, it succeeds through depth rather than breadth.",
  },
  8: {
    lord: "Saturn",
    keywords: "endurance, karma, slow victory",
    meaning:
      "Root 8 is ruled by Saturn — the karmic number; delays test it early, but steady effort builds durable, often late-blooming success.",
  },
  9: {
    lord: "Mars",
    keywords: "courage, energy, service",
    meaning:
      "Root 9 is ruled by Mars — the warrior number; energetic, courageous and humanitarian, it completes the 1–9 cycle.",
  },
};

/** Interpretation for any single-digit Chaldean root (mulank / bhagyank / name root). */
export function interpretRoot(root: number, label = "Root number"): Interpretation {
  const m = NUMEROLOGY_ROOTS[root];
  if (!m) {
    return {
      verdict: "Master number reduced to a single digit",
      meaning: "The sum reduced past 9, so the classical root meanings apply to the reduced digit.",
      guidance: [],
      basis: "Chaldean numerology (research §3.1–3.3); root table pending Jyotishi review (P11)",
    };
  }
  return {
    verdict: `${label} ${root} — ruled by ${m.lord}`,
    meaning: m.meaning,
    guidance: [`Key themes: ${m.keywords}.`],
    basis: "Chaldean numerology research §3; interpretations pending Jyotishi review (P11)",
  };
}

const MOON_PHASE_MEANINGS: Record<string, string> = {
  "New Moon":
    "The Moon sits with the Sun — a seed moment. Classical muhurta keeps it for beginnings and planning rather than visible action.",
  "Waxing Crescent":
    "Light is building — favourable for starting effort that should grow with the waxing half.",
  "First Quarter":
    "Half-lit and rising — a decision point; obstacles met now are meant to be worked through, not abandoned.",
  "Waxing Gibbous": "Almost full — refine and prepare; results from actions now mature quickly.",
  "Full Moon":
    "Sun and Moon in full opposition — culmination, heightened emotion and clarity. Classical practice avoids starting new ventures; it favours completion.",
  "Waning Gibbous":
    "Light beginning to decline — gratitude, sharing results and teaching suit the moment.",
  "Last Quarter":
    "Half-lit and shrinking — release what no longer serves; classical practice favours clearing and simplifying.",
  "Waning Crescent":
    "The dark approach — rest, reflection and completion before the next new moon.",
};

export function interpretMoonPhase(phase: string): Interpretation {
  return {
    verdict: phase,
    meaning: MOON_PHASE_MEANINGS[phase] ?? "Standard lunar phase.",
    guidance: [],
    basis: "Panchang practice; research §1.6",
  };
}

const ELEMENT_MEANINGS: Record<string, string> = {
  Fire: "Fire signs move by inspiration — identity, drive and visibility are their arena.",
  Earth: "Earth signs build — substance, patience and tangible results define them.",
  Air: "Air signs connect — ideas, language and relationships are their arena.",
  Water: "Water signs feel — memory, intuition and depth define them.",
};

const SUN_SIGN_MEANINGS: Record<string, string> = {
  Aries: "Aries (Mesha): initiating, direct and competitive — the self learns through action.",
  Taurus:
    "Taurus (Vrishabha): steady, sensual and resource-building — security through consistency.",
  Gemini: "Gemini (Mithuna): curious, verbal and adaptable — the mind learns through variety.",
  Cancer: "Cancer (Karka): protective, feeling and home-centred — security through belonging.",
  Leo: "Leo (Simha): expressive, generous and commanding — identity through creative authority.",
  Virgo: "Virgo (Kanya): analytical, useful and precise — service through refinement.",
  Libra: "Libra (Tula): balanced, fair and relational — truth through the mirror of others.",
  Scorpio:
    "Scorpio (Vrishchika): intense, private and transformative — depth through surrender of control.",
  Sagittarius:
    "Sagittarius (Dhanu): expansive, principled and far-seeking — meaning through the bigger picture.",
  Capricorn: "Capricorn (Makara): disciplined, ambitious and structural — mastery through time.",
  Aquarius:
    "Aquarius (Kumbha): inventive, cause-driven and collective — individuality through the group.",
  Pisces: "Pisces (Meena): compassionate, imaginative and dissolving — meaning through letting go.",
};

export function interpretSunSign(sign: string, element: string): Interpretation {
  return {
    verdict: `${sign} sun — ${element} sign`,
    meaning: `${SUN_SIGN_MEANINGS[sign] ?? sign} ${ELEMENT_MEANINGS[element] ?? ""}`.trim(),
    guidance: [],
    basis: "Western tropical astrology; research §2.1",
  };
}

const NAKSHATRA_MEANINGS: Record<string, string> = {
  Ashwini: "swift healing and initiative (ruled by Ketu, deity Ashvins)",
  Bharani: "bearing responsibility and transformation (Venus, Yama)",
  Krittika: "cutting clarity and purifying will (Sun, Agni)",
  Rohini: "growth, fertility and attraction (Moon, Brahma)",
  Mrigashira: "seeking and gentle restlessness (Mars, Soma)",
  Ardra: "storm-born clarity through effort (Rahu, Rudra)",
  Punarvasu: "renewal and safe return (Jupiter, Aditi)",
  Pushya: "nourishment and trustworthy support (Saturn, Brihaspati)",
  Ashlesha: "coiled insight and strategy (Mercury, Nagas)",
  Magha: "ancestral authority and throne (Ketu, Pitris)",
  "Purva Phalguni": "creative enjoyment and charm (Venus, Bhaga)",
  "Uttara Phalguni": "generous alliance and lasting contracts (Sun, Aryaman)",
  Hasta: "skilled hands and practical craft (Moon, Savitar)",
  Chitra: "brilliant design and visible artistry (Mars, Vishvakarma)",
  Swati: "independent movement like the wind (Rahu, Vayu)",
  Vishakha: "focused triumph after patient climbing (Jupiter, Indra-Agni)",
  Anuradha: "loyal devotion and organised success (Saturn, Mitra)",
  Jyeshtha: "seniority, protection and responsibility (Mercury, Indra)",
  Mula: "root-investigation and radical beginnings (Ketu, Nirriti)",
  "Purva Ashadha": "invincible declaration and purification (Venus, Apas)",
  "Uttara Ashadha": "unshakeable and lasting victory (Sun, Vishvedevas)",
  Shravana: "listening, learning and transmitting (Moon, Vishnu)",
  Dhanishta: "wealth-rhythm and collective music (Mars, Vasus)",
  Shatabhisha: "healing mysteries and boundary-crossing (Rahu, Varuna)",
  "Purva Bhadrapada": "intense idealism and penance (Jupiter, Ajaikapada)",
  "Uttara Bhadrapada": "deep stability and wisdom (Saturn, Ahirbudhnya)",
  Revati: "safe passage and compassionate completion (Mercury, Pushan)",
};

export function interpretNakshatra(name: string, lord: string, pada: number): Interpretation {
  return {
    verdict: `${name}, pada ${pada}`,
    meaning: `Birth falls in ${name} — ${NAKSHATRA_MEANINGS[name] ?? "a classical lunar mansion"}. Its lord ${lord} shapes the Vimshottari dasha sequence from birth.`,
    guidance: [],
    basis: "BPHS nakshatra attributions; research §2.2",
  };
}

const LAGNA_MEANINGS: Record<string, string> = {
  Aries: "first impressions are direct and energetic; life approach = pioneer",
  Taurus: "first impressions are calm and solid; life approach = builder",
  Gemini: "first impressions are quick and verbal; life approach = communicator",
  Cancer: "first impressions are caring and protective; life approach = nurturer",
  Leo: "first impressions are warm and commanding; life approach = leader",
  Virgo: "first impressions are precise and helpful; life approach = analyst",
  Libra: "first impressions are gracious and balanced; life approach = mediator",
  Scorpio: "first impressions are intense and private; life approach = transformer",
  Sagittarius: "first impressions are open and principled; life approach = explorer",
  Capricorn: "first impressions are composed and serious; life approach = organiser",
  Aquarius: "first impressions are original and detached; life approach = reformer",
  Pisces: "first impressions are gentle and imaginative; life approach = empath",
};

export function interpretLagna(sign: string, lord: string): Interpretation {
  return {
    verdict: `${sign} rising (Lagna)`,
    meaning: `The ascendant was rising in ${sign} at birth — it shapes appearance, first impressions and the lens the whole chart is read through; its lord ${lord} becomes the chart's primary ruler.`,
    guidance: [],
    basis: "BPHS Lagna Adhyaya; research §2.3",
  };
}

const SADE_SATI_PHASE_MEANINGS: Record<number, string> = {
  1: "Phase 1 (Saturn in the 12th from Moon): groundwork under pressure — expenses, sleep and detachment issues rise; the discipline learned here decides how the rest of the cycle lands.",
  2: "Phase 2 (Saturn over the natal Moon): the peak — health, mind and close relationships are tested directly; steady routine, humility and honesty are the classical protections.",
  3: "Phase 3 (Saturn in the 2nd from Moon): consolidation — finances, family and speech come under review; what was built in phases 1–2 starts to pay or teach.",
};

export function interpretSadeSati(
  inWindow: boolean,
  phase: number | null,
  dhaiyaHouse: number | null,
): Interpretation {
  const parts: string[] = [];
  if (inWindow && phase) parts.push(SADE_SATI_PHASE_MEANINGS[phase] ?? "");
  if (dhaiyaHouse === 4)
    parts.push(
      "Dhaiya (4th from Moon): domestic, property and inner-peace pressure — Saturn's 'small panoti' running alongside or independent of Sade Sati.",
    );
  if (dhaiyaHouse === 8)
    parts.push(
      "Dhaiya (8th from Moon, Ashtama Shani): sudden obstacles and health attention — a testing but transformative Saturn transit.",
    );
  return {
    verdict: inWindow
      ? `In Sade Sati${phase ? ` — phase ${phase}` : ""}`
      : dhaiyaHouse
        ? `Dhaiya active — Saturn ${dhaiyaHouse}th from Moon`
        : "No Sade Sati window now",
    meaning:
      parts.join(" ") ||
      "Saturn is outside the 12th/1st/2nd houses from the natal Moon and no dhaiya applies.",
    guidance:
      inWindow || dhaiyaHouse
        ? [
            "Classical presentation favours steady routine, service and patience during Saturn periods; remedial choices are a personal/Jyotishi matter.",
          ]
        : [],
    basis: "Classical Gochara; research §4.1; timing pending Jyotishi review (P11)",
  };
}

export function interpretManglik(
  isManglik: boolean,
  cancelled: boolean,
  cancelledReason: string | null,
): Interpretation {
  if (cancelled) {
    return {
      verdict: "Manglik placement present but cancelled",
      meaning: `Mars sits in a dosha position, yet ${cancelledReason ?? "classical cancellation applies"} — the dosha is treated as nullified in matching.`,
      guidance: [
        "Show the raw placement + cancellation together when matching; both charts' full context matters.",
      ],
      basis: "Classical cancellation rules; research §4.3",
    };
  }
  return {
    verdict: isManglik ? "Manglik (Mars in a dosha house)" : "Not Manglik",
    meaning: isManglik
      ? "Mars occupies the 1st/2nd/4th/7th/8th/12th from Lagna, Moon or Venus — the classical Mangal Dosha positions, tempering marriage matching with heat that a like-charted partner balances."
      : "Mars occupies none of the dosha houses from Lagna, Moon or Venus.",
    guidance: isManglik
      ? [
          "Traditional practice matches a Manglik chart with another Manglik chart; the placement's strength varies by house and aspects.",
        ]
      : [],
    basis: "Classical Mangal Dosha rules; research §4.3",
  };
}

const KAAL_SARP_TYPE_NOTES: Record<string, string> = {
  Anant: "Rahu in the 1st — identity and direction themes",
  Kulit: "Rahu in the 2nd — family, wealth and speech themes",
  Vasuki: "Rahu in the 3rd — courage, siblings and effort themes",
  Shankhpal: "Rahu in the 4th — home, mother and stability themes",
  Padma: "Rahu in the 5th — children, creativity and fortune themes",
  Mahapadma: "Rahu in the 6th — obstacles, health and service themes",
  Takshak: "Rahu in the 7th — partnership and marriage themes",
  Karkotak: "Rahu in the 8th — longevity, research and sudden events themes",
  Shankhchud: "Rahu in the 9th — dharma, father and fortune themes",
  Ghaatak: "Rahu in the 10th — career, action and authority themes",
  Vishdhar: "Rahu in the 11th — gains, networks and ambitions themes",
  Sheshnag: "Rahu in the 12th — expenses, moksha and isolation themes",
};

export function interpretKaalSarp(
  present: boolean,
  type: string | null,
  rahuHouse: number,
): Interpretation {
  if (!present) {
    return {
      verdict: "No Kaal Sarp Yoga",
      meaning: `At least one graha sits outside the Rahu–Ketu axis (Rahu in house ${rahuHouse}) — the full hemming the classical yoga requires is absent, so the yoga is not asserted.`,
      guidance: [],
      basis: "Classical definition (all seven grahas hemmed); research §4.2",
    };
  }
  return {
    verdict: `Kaal Sarp Yoga — ${type ?? "type by Rahu's house"} (Rahu in house ${rahuHouse})`,
    meaning: `All seven grahas are hemmed within the Rahu–Ketu axis. ${type ? (KAAL_SARP_TYPE_NOTES[type] ?? "") : ""} Classical texts describe life themes that oscillate between rapid rise and testing falls.`,
    guidance: [
      "Partial patterns are deliberately not asserted — see the planet table for each graha's side of the axis.",
    ],
    basis: "Classical yoga; research §4.2",
  };
}

const KARAKA_MEANINGS: Record<string, string> = {
  Sun: "soul purpose through authority, visibility and father-figures",
  Moon: "soul purpose through care, the public and the emotional life",
  Mars: "soul purpose through courage, competition and decisive action",
  Mercury: "soul purpose through learning, trade and communication",
  Jupiter: "soul purpose through teaching, children and dharma",
  Venus: "soul purpose through love, beauty and relationship",
  Saturn: "soul purpose through endurance, humility and service",
  Rahu: "soul purpose through the unconventional and worldly desire (8-karaka scheme)",
};

export function interpretAtmakaraka(planet: string): Interpretation {
  return {
    verdict: `Atmakaraka: ${planet}`,
    meaning: `The planet with the highest degree in its sign is the soul significator (Atmakaraka) — ${KARAKA_MEANINGS[planet] ?? "the core life theme"}. Its navamsha sign (Karakamsha) anchors Jaimini readings.`,
    guidance: [],
    basis: "Jaimini Sutras / BPHS Karakamsa; research §4.4",
  };
}

export function interpretIshtaDevata(deity: string, source: string): Interpretation {
  return {
    verdict: `Ishta Devata: ${deity}`,
    meaning: `Derived by the classical 12th-from-Karakamsha method — ${source}. Deity attribution varies between schools; where disputed, alternates are listed alongside.`,
    guidance: [],
    basis: "BPHS Karakamsa Phala, Jaimini Upadesa Sutras 1.2.72–79; research §4.5",
  };
}

export function interpretCurrentDasha(lord: string, subLord: string): Interpretation {
  return {
    verdict: `${lord} Mahadasha — ${subLord} Antardasha`,
    meaning: `Vimshottari periods layer a planet's theme inside the mahadasha lord's larger theme: ${KARAKA_MEANINGS[lord] ?? lord}'s period is currently coloured by ${subLord}'s sub-period.`,
    guidance: [],
    basis: "Vimshottari Pravesha; research §4.6",
  };
}

export function interpretLoShu(missing: number[], repeated: number[]): Interpretation {
  const missText = missing.length
    ? `Missing ${missing
        .map((n) => {
          const m = NUMEROLOGY_ROOTS[n];
          return `${n} (${m?.lord ?? "?"} — ${m?.keywords.split(", ")[0] ?? ""})`;
        })
        .join(", ")} — areas developed consciously rather than by default.`
    : "No missing numbers — every plane has support.";
  const repText = repeated.length
    ? ` Repeated ${repeated.join(", ")} — those qualities are amplified.`
    : "";
  return {
    verdict: missing.length
      ? `Lo Shu grid with ${missing.length} missing number${missing.length > 1 ? "s" : ""}`
      : "Complete Lo Shu grid",
    meaning: `${missText}${repText}`,
    guidance: [],
    basis: "Lo Shu / Chinese numerology research §3.6",
  };
}

export function interpretVehicle(verdict: string): Interpretation {
  return {
    verdict,
    meaning:
      "The plate is read by two schools — pure digit sum (School A) and Chaldean letter+digit sum (School B) — against your mulank/bhagyank. Where the schools disagree, both readings are shown rather than averaged.",
    guidance: ["Verdicts are advisory; registration constraints and personal preference apply."],
    basis: "Vehicle numerology research §3.5",
  };
}
