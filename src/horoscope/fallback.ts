/**
 * Fallback phrase templates (Horoscope Upgrade Step 4).
 *
 * When a library cell has no rows, the generator still composes an honest,
 * style-guide-compliant line from these templates — keyed by slot family and
 * rating band, 3 variants per cell so the §10.5 no-repeat rule survives.
 * Fallback rows are marked in the payload (`source: "fallback"`) so the
 * content team can see exactly which cells still need Paige's batches.
 *
 * Tone: no fear, no absolutes, no medical/legal/financial directives —
 * style-guide §3/§8. HI mirrors EN structure.
 */
import type { Rating } from "./rules";

type BandTexts = Record<Rating, string[]>;

const AREA_FALLBACK: Record<string, BandTexts> = {
  health: {
    excellent: [
      "Vitality flows easily today — a good window to keep your routine going and enjoy steady energy.",
      "Energy feels well-supported; light exercise and regular meals will make the most of it.",
      "A strong day for wellbeing — keep up whatever routine has been working for you.",
    ],
    good: [
      "Wellbeing holds steady; your usual routine is enough to stay balanced.",
      "Energy is quietly supportive — keep meals regular and pace yourself well.",
      "A settled day for health; small consistent habits carry you.",
    ],
    moderate: [
      "Energy is even; nothing pushes either way — keep a simple rhythm through the day.",
      "A neutral day physically; routine care and hydration do their quiet work.",
      "Wellbeing is workable; keep the pace moderate and rest when you can.",
    ],
    challenging: [
      "The day asks for gentler pacing — regular meals and an early night serve you best.",
      "Keep today's demands light; warmth, rest and routine are your allies.",
      "Go easy on intensity today; steady habits matter more than pushes.",
    ],
  },
  career: {
    excellent: [
      "Work flows in your favour — a good day to advance a key task or put your name forward.",
      "Professional energy is strong; decisive moves land well today.",
      "A productive window at work — finish something visible.",
    ],
    good: [
      "Steady progress at work; steady blocks of effort pay off.",
      "A quietly productive day — finishing beats starting.",
      "Work supports you; keep commitments realistic and deliver.",
    ],
    moderate: [
      "Work life is even — handle the routine well and save big pushes for a clearer day.",
      "A workmanlike day; tidy tasks and note ideas for later.",
      "Nothing blocks you, nothing rushes you — keep it steady.",
    ],
    challenging: [
      "Favour finishing over starting today; tie up loose ends and note ideas for tomorrow.",
      "Keep professional moves modest; steady completion outperforms new launches.",
      "A patience day at work — small, careful steps keep things smooth.",
    ],
  },
  wealth: {
    excellent: [
      "Money matters move smoothly — a fine day to review plans or follow up on offers.",
      "Financial energy is supportive; tidy paperwork or act on a pending idea.",
      "Gains feel within reach; sensible decisions land well.",
    ],
    good: [
      "Finances stay steady; a good day for routine money tasks.",
      "Money energy is quietly helpful — budget reviews go well.",
      "A stable day for finances; small sensible steps compound.",
    ],
    moderate: [
      "Money matters stay calm; postpone big spends for a clearer day.",
      "An even financial day — routine is enough.",
      "Finances hold level; nothing needs urgent attention.",
    ],
    challenging: [
      "Keep spending light today and skip lending — calm is the win.",
      "A careful day for money: review rather than commit.",
      "Hold large purchases; let today pass before big financial moves.",
    ],
  },
  love: {
    excellent: [
      "Warmth comes easily today — honest, open conversation lands beautifully.",
      "Romantic energy is strong; small gestures carry far.",
      "A lovely day for connection — plan something together.",
    ],
    good: [
      "Relationships feel settled; unhurried time together works best.",
      "A gently warm day — listen fully, speak kindly.",
      "Steady affection today; simple company is enough.",
    ],
    moderate: [
      "Emotions are level; keep exchanges simple and kind.",
      "A quiet day for the heart — small kindnesses suffice.",
      "Nothing dramatic in love; steady care does the work.",
    ],
    challenging: [
      "A short, unhurried conversation lands better than a long discussion today.",
      "Keep expectations light; say less, listen more.",
      "Give loved ones room today — gentleness is the strategy.",
    ],
  },
  education: {
    excellent: [
      "A strong study day — concepts click and deep work goes well.",
      "Learning energy peaks; tackle the hardest topic first.",
      "An excellent window for study, revision and practice.",
    ],
    good: [
      "Study goes smoothly; keep sessions focused and short.",
      "A supportive learning day — group study pays off.",
      "Concepts settle nicely; keep the momentum.",
    ],
    moderate: [
      "An ordinary study day — rhythm matters more than intensity.",
      "Learning is workable; revisit notes once and let understanding settle.",
      "Keep study sessions light today.",
    ],
    challenging: [
      "A revision day, not a test-yourself day — revisit rather than race ahead.",
      "Keep learning goals small; understanding arrives on its own schedule.",
      "Gentle review beats new material today.",
    ],
  },
  family: {
    excellent: [
      "Home feels warm and cooperative — a good day for family time.",
      "Family matters flow; shared plans go smoothly.",
      "A harmonious day at home; enjoy it.",
    ],
    good: [
      "Home life stays steady; small shared tasks help.",
      "A calm family day — keep plans breathable.",
      "Domestic matters cooperate; light plans work best.",
    ],
    moderate: [
      "Home matters are even; keep talk light and practical.",
      "A neutral day at home; routine is enough.",
      "Family life hums along; nothing needs pushing.",
    ],
    challenging: [
      "Keep home talk light; let small disagreements rest until the mood clears.",
      "A patience day at home — calm ears help most.",
      "Keep family plans flexible; quiet company works better than big gatherings.",
    ],
  },
  business: {
    excellent: [
      "Trade decisions land well today — a fine window for negotiations.",
      "Business energy is supportive; push the priority deal.",
      "A strong day for commerce; momentum is with you.",
    ],
    good: [
      "Business runs steadily; useful day for follow-ups.",
      "A quietly productive day for trade matters.",
      "Steady commerce; keep the pipeline moving.",
    ],
    moderate: [
      "Business matters stay even; routine is enough today.",
      "A workmanlike day — tidy records, review plans.",
      "Nothing pressing in trade; keep it simple.",
    ],
    challenging: [
      "Hold big business moves today; review rather than commit.",
      "Keep trade decisions modest; patience protects the margin.",
      "A caution day for business — steady operations only.",
    ],
  },
  marriage: {
    excellent: [
      "Partnership warmth is high — a lovely day for shared plans.",
      "Togetherness flows easily; plan something as a pair.",
      "A harmonious day for the relationship.",
    ],
    good: [
      "The partnership feels settled; unhurried time together works best.",
      "A steady day for the two of you — small gestures carry.",
      "Quiet mutual support today.",
    ],
    moderate: [
      "Partnership matters are even; keep plans simple.",
      "A neutral day together — routine affection suffices.",
      "Nothing pressing between you; keep it easy.",
    ],
    challenging: [
      "Keep expectations light today; partnership talk goes better short and kind.",
      "Give each other room; patience is the day's work.",
      "Defer big relationship decisions to a clearer day.",
    ],
  },
  children: {
    excellent: [
      "Children's plans and studies go beautifully — join in their world today.",
      "A joyful day with the young ones; their energy lifts the home.",
      "Children's matters bloom; support their interests.",
    ],
    good: [
      "The young ones settle well today; gentle plans work.",
      "Children's routines cooperate; enjoy the ease.",
      "A pleasant day for family's youngest members.",
    ],
    moderate: [
      "Children's matters are even; keep plans simple.",
      "A normal day with the kids; routine suffices.",
      "Nothing pressing; keep their schedule light.",
    ],
    challenging: [
      "Keep children's plans light today; extra patience helps.",
      "A gentle day for the young ones — avoid crowded schedules.",
      "Support quietly; their day needs calm more than activity.",
    ],
  },
};

const OVERVIEW_FALLBACK: Record<Rating, string[]> = {
  excellent: [
    "Today's sky supports you broadly — momentum, warmth and clarity arrive together; make the most of the window.",
    "A strongly favourable day; the leading planets line up behind your sign's priorities.",
    "The day opens well and stays that way — move the important things forward.",
  ],
  good: [
    "A quietly supportive day — steady effort lands well and the mood stays workable.",
    "The sky leans your way without drama; keep plans moving at an even pace.",
    "Today favours follow-through: small, steady steps add up.",
  ],
  moderate: [
    "An even-keeled day — nothing blocks you, nothing rushes you; routine is your friend.",
    "The day holds level; keep expectations simple and rhythm steady.",
    "A neutral sky; ordinary tasks do well, big pushes can wait.",
  ],
  challenging: [
    "The day asks for a slower rhythm — care with words, wallets and plans goes a long way.",
    "Today rewards patience over pace; keep moves modest and finish what is open.",
    "A gentle-caution day: steady routines carry you while the sky rebalances.",
  ],
};

const THOUGHT_FALLBACK: string[] = [
  "A calm mind and a steady pace are both quiet strengths.",
  "Small daily order builds large silent reserves.",
  "What you water today grows tomorrow.",
  "Patience is also a form of progress.",
];

const DO_FALLBACK: string[] = [
  "Lean into the day's open door — one small, concrete step beats three plans.",
  "Begin the thing you keep postponing; today's sky gives it a gentle push.",
  "Keep one promise to yourself today — it compounds.",
];

const DONT_FALLBACK: string[] = [
  "Sidestep avoidable friction today; not every raised topic needs raising.",
  "Hold off on big commitments while the day's mood settles.",
  "Let small irritations pass unanswered — tomorrow they look smaller.",
];

const YEARLY_AREA_FALLBACK: Record<Rating, string[]> = {
  excellent: [
    "This area is among the year's bright spots — invest in it deliberately.",
    "The sky supports this area strongly through the year; momentum builds.",
    "A rewarding year here — steady attention brings visible results.",
  ],
  good: [
    "This area holds a supportive tone through the year; steady effort is repaid.",
    "Quiet progress defines this area — keep the rhythm.",
    "A workable, often warm year here; small consistent steps win.",
  ],
  moderate: [
    "This area moves at an even pace; patience and routine are the strategy.",
    "A level year here — neither rushed nor stuck.",
    "Steady as she goes; the area responds to consistency.",
  ],
  challenging: [
    "This area asks for patience this year — steady habits and modest plans serve best.",
    "Progress here comes slowly; respect rest and keep commitments realistic.",
    "A building year for this area — slow construction, not sudden change.",
  ],
};

const YEARLY_OVERVIEW_FALLBACK: Record<Rating, string[]> = {
  excellent: [
    "The year opens doors — plan deliberately and use the strong windows well.",
    "A rewarding year overall; the slow planets mostly line up behind your effort.",
    "Momentum defines the year; move priorities while the sky supports them.",
  ],
  good: [
    "A steadily supportive year — consistent effort finds its rewards.",
    "The year favours patient building; the good windows are frequent.",
    "Quiet progress across the year; keep going.",
  ],
  moderate: [
    "An even year — mixed skies reward routine, patience and realistic plans.",
    "The year keeps a level tone; save ambition for the bright weeks.",
    "A steady year: neither a sprint nor a stall.",
  ],
  challenging: [
    "A building year — the sky rewards steady effort, simple routines and patience over speed.",
    "The year asks for a longer breath: slow construction beats sudden moves.",
    "Progress comes through persistence this year; rest counts as work.",
  ],
};

const CLAUSE_FALLBACK: Record<"pos" | "neg" | "closing", string[]> = {
  pos: [
    "{planet} in your {house} supports this month's plans",
    "{planet} moves through your {house}, quietly helping",
    "{planet} lends your {house} a steady hand",
  ],
  neg: [
    "{planet} in your {house} asks for patience",
    "{planet} through your {house} slows the pace",
    "{planet} in your {house} counsels steady routines",
  ],
  closing: ["keep plans realistic", "steady routines win", "pace yourself and continue"],
};

export function fallbackForSlot(slot: string, rating: Rating): string[] {
  const family = slot.split(".")[0] ?? slot;
  if (family === "thought") return THOUGHT_FALLBACK;
  if (family === "dos") return DO_FALLBACK;
  if (family === "donts") return DONT_FALLBACK;
  if (family === "clause") {
    if (slot === "clause.pos") return CLAUSE_FALLBACK.pos;
    if (slot === "clause.neg") return CLAUSE_FALLBACK.neg;
    return CLAUSE_FALLBACK.closing;
  }
  if (family === "yearly") {
    if (slot === "yearly.overview") return YEARLY_OVERVIEW_FALLBACK[rating];
    return YEARLY_AREA_FALLBACK[rating];
  }
  if (slot.endsWith(".overview")) return OVERVIEW_FALLBACK[rating];
  const area = slot.split(".")[1] ?? "health";
  return AREA_FALLBACK[area]?.[rating] ?? AREA_FALLBACK.health![rating];
}
