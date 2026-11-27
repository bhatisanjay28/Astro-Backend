/**
 * S24 — Hindi mirror of interpretations.ts. Same function signatures and
 * Interpretation shape, authored Hindi text (not literal translation),
 * Jyotish terminology consistent with the /hi pages' style guide.
 * Sign/graha/nakshatra names are converted here from the EN inputs the
 * engines pass, using the central tables in names.ts. All readings remain
 * `pending Jyotishi review (P11)` like their EN counterparts.
 */

import type { Interpretation } from "./interpretations";
import { NAKSHATRAS, NAKSHATRAS_HI, PLANETS_HI, SIGNS, SIGNS_HI } from "./names";

const P11_NOTE = "व्याख्याएँ P11 तक ज्योतिषी-समीक्षित नहीं हैं (अनुसंधान अध्याय-संदर्भ देखें)";

const signHi = (sign: string): string => {
  const i = SIGNS.indexOf(sign as (typeof SIGNS)[number]);
  return i >= 0 ? (SIGNS_HI[i] ?? sign) : sign;
};
const planetHi = (planet: string): string => PLANETS_HI[planet] ?? planet;
const nakshatraHi = (name: string): string => {
  const i = NAKSHATRAS.indexOf(name);
  return i >= 0 ? (NAKSHATRAS_HI[i] ?? name) : name;
};

/* ---------------------------------------------------------------- numerology */

const NUMEROLOGY_ROOTS_HI: Record<number, { lord: string; keywords: string; meaning: string }> = {
  1: {
    lord: "सूर्य",
    keywords: "नेतृत्व, इच्छाशक्ति, मौलिकता",
    meaning:
      "मूलांक 1 के स्वामी सूर्य हैं — एक अग्रणी अंक, जिनके लोग अनुसरण करने की बजाय नेतृत्व करने के लिए बने होते हैं; स्वतंत्रता और स्वयं-निर्मित सत्ता इसकी पहचान है।",
  },
  2: {
    lord: "चंद्र",
    keywords: "संवेदनशीलता, सहयोग, कूटनीति",
    meaning:
      "मूलांक 2 के स्वामी चंद्र हैं — कोमल, सहज-ज्ञान और सहयोगी; सफलता बल से नहीं, साझेदारी और भावुक-बुद्धि से आती है।",
  },
  3: {
    lord: "गुरु",
    keywords: "ज्ञान, शिक्षण, विस्तार",
    meaning:
      "मूलांक 3 के स्वामी गुरु हैं — शिक्षक का अंक; आशावादी, अभिव्यक्त और विद्वान, यह ज्ञान बाँटने और दूसरों को मार्ग दिखाने में फलता-फूलता है।",
  },
  4: {
    lord: "राहु",
    keywords: "पारंपरिकता से हटकर, अनुशासित, व्यावहारिक",
    meaning:
      "मूलांक 4 के स्वामी राहु हैं (छलदेव प्रथा में अरुण भी पढ़ा जाता है) — अपरंपरागत और परिश्रमी; प्रतिफल देर से मिलते हैं पर टिकते हैं, पद्धति और दृढ़ता से।",
  },
  5: {
    lord: "बुध",
    keywords: "संवाद, बहुमुखी प्रतिभा, वाणिज्य",
    meaning:
      "मूलांक 5 के स्वामी बुध हैं — सबसे अनुकूलनशील अंक; तेज़ दिमाग़, यात्रा, व्यापार और संवाद इसके सहज क्षेत्र हैं।",
  },
  6: {
    lord: "शुक्र",
    keywords: "सामंजस्य, सौंदर्य, जिम्मेदारी",
    meaning:
      "मूलांक 6 के स्वामी शुक्र हैं — प्रेम, सौंदर्य और सेवा का अंक; कला, घरेलू सामंजस्य और देखभाल की जिम्मेदारियों में यह फलता है।",
  },
  7: {
    lord: "केतु",
    keywords: "अध्यात्म, अनुसंधान, अंतर्मुखता",
    meaning:
      "मूलांक 7 के स्वामी केतु हैं — साधक का अंक; अंतर्मुखी, दार्शनिक और विश्लेषणात्मक, यह चौड़ाई से अधिक गहराई से सफल होता है।",
  },
  8: {
    lord: "शनि",
    keywords: "धैर्य, कर्म, देर से विजय",
    meaning:
      "मूलांक 8 के स्वामी शनि हैं — कर्म का अंक; शुरुआत में देरी परीक्षा लेती है, पर स्थिर प्रयास स्थायी, अक्सर देर से खिलने वाली सफलता बनाता है।",
  },
  9: {
    lord: "मंगल",
    keywords: "साहस, ऊर्जा, सेवा",
    meaning:
      "मूलांक 9 के स्वामी मंगल हैं — योद्धा अंक; ऊर्जावान, साहसी और परोपकारी, यह 1–9 चक्र को पूरा करता है।",
  },
};

export function interpretRoot(root: number, label = "मूल अंक"): Interpretation {
  const m = NUMEROLOGY_ROOTS_HI[root];
  if (!m) {
    return {
      verdict: "मास्टर नंबर से प्राप्त एकल अंक",
      meaning: "योग 9 से आगे बढ़कर एक अंक में लौटता है, इसलिए शास्त्रीय मूल-अंक के अर्थ लागू होते हैं।",
      guidance: [],
      basis: `छलदेव अंकशास्त्र (अनुसंधान §3.1–3.3); ${P11_NOTE}`,
    };
  }
  return {
    verdict: `${label} ${root} — स्वामी ${m.lord}`,
    meaning: m.meaning,
    guidance: [`मुख्य विषय: ${m.keywords}।`],
    basis: `छलदेव अंकशास्त्र, अनुसंधान §3; ${P11_NOTE}`,
  };
}

/* --------------------------------------------------------------- moon phase */

const MOON_PHASE_HI: Record<string, string> = {
  "New Moon": "अमावस्या",
  "Waxing Crescent": "बढ़ता चंद्र (शुक्ल पक्ष आरंभ)",
  "First Quarter": "अर्ध-बढ़ता चंद्र",
  "Waxing Gibbous": "लगभग पूर्ण बढ़ता चंद्र",
  "Full Moon": "पूर्णिमा",
  "Waning Gibbous": "लगभग पूर्ण घटता चंद्र",
  "Last Quarter": "अर्ध-घटता चंद्र",
  "Waning Crescent": "घटता क्षीण चंद्र",
};

export { MOON_PHASE_HI };

const MOON_PHASE_MEANINGS_HI: Record<string, string> = {
  "New Moon":
    "चंद्र सूर्य के साथ बैठता है — बीज-क्षण। शास्त्रीय मुहूर्त में यह दृश्य कार्यवाही से अधिक शुभारंभ और योजना के लिए उपयुक्त है।",
  "Waxing Crescent": "प्रकाश बढ़ रहा है — ऐसे प्रयास आरंभ करने के लिए अनुकूल जो शुक्ल पक्ष के साथ बढ़ने चाहें।",
  "First Quarter":
    "आधा उजाला, चढ़ता हुआ — निर्णय-बिंदु; अब आने वाली बाधाएँ पार करने के लिए हैं, छोड़ने के लिए नहीं।",
  "Waxing Gibbous": "लगभग पूर्ण — संवारें और तैयारी करें; अब किए कार्यों के परिणाम शीघ्र पकते हैं।",
  "Full Moon":
    "सूर्य-चंद्र पूर्ण विपरीत में — परिणति, उच्च भावना और स्पष्टता। शास्त्रीय प्रथा नए कार्य आरंभ करने से बचाती है; समापन के लिए अनुकूल।",
  "Waning Gibbous": "प्रकाश घटने लगा — आभार, परिणाम साझा करना और सिखाना इस क्षण के लिए उपयुक्त है।",
  "Last Quarter":
    "आधा उजाला, घटता हुआ — जो अब उपयोगी नहीं, छोड़ दें; शास्त्रीय प्रथा सफ़ाई और सरलीकरण को वरीयता देती है।",
  "Waning Crescent": "कृष्ण पक्ष का अंत — अगली अमावस्या से पहले विश्राम, चिंतन और समापन का समय।",
};

export function interpretMoonPhase(phase: string): Interpretation {
  return {
    verdict: MOON_PHASE_HI[phase] ?? phase,
    meaning: MOON_PHASE_MEANINGS_HI[phase] ?? "मानक चंद्र-कला।",
    guidance: [],
    basis: "पंचांग प्रथा; अनुसंधान §1.6",
  };
}

/* ---------------------------------------------------------------- sun sign */

const ELEMENT_HI: Record<string, string> = {
  Fire: "अग्नि",
  Earth: "पृथ्वी",
  Air: "वायु",
  Water: "जल",
};

const ELEMENT_MEANINGS_HI: Record<string, string> = {
  Fire: "अग्नि तत्व की राशियाँ प्रेरणा से चलती हैं — पहचान, ऊर्जा और दृश्यता उनका क्षेत्र है।",
  Earth: "पृथ्वी तत्व की राशियाँ बनाती हैं — सार, धैर्य और ठोस परिणाम उनकी पहचान है।",
  Air: "वायु तत्व की राशियाँ जोड़ती हैं — विचार, भाषा और संबंध उनका क्षेत्र है।",
  Water: "जल तत्व की राशियाँ महसूस करती हैं — स्मृति, सहज-ज्ञान और गहराई उनकी पहचान है।",
};

const SUN_SIGN_MEANINGS_HI: Record<string, string> = {
  Aries: "मेष: पहल करने वाली, सीधी और प्रतिस्पर्धी — आत्मा कर्म से सीखती है।",
  Taurus: "वृषभ: स्थिर, सुखवादी और संसाधन-जोड़ने वाली — निरंतरता से सुरक्षा।",
  Gemini: "मिथुन: जिज्ञासु, वाक्-प्रिय और अनुकूलनशील — मन विविधता से सीखता है।",
  Cancer: "कर्क: रक्षात्मक, भावुक और गृह-केंद्रित — अपनेपन से सुरक्षा।",
  Leo: "सिंह: अभिव्यक्त, उदार और आदेशक — सृजनात्मक सत्ता से पहचान।",
  Virgo: "कन्या: विश्लेषणशील, उपयोगी और सूक्ष्म — परिष्कार से सेवा।",
  Libra: "तुला: संतुलित, न्यायप्रिय और संबंध-केंद्रित — दूसरों के दर्पण से सत्य।",
  Scorpio: "वृश्चिक: गहन, गूप्य और रूपांतरणकारी — नियंत्रण का त्याग से गहराई।",
  Sagittarius: "धनु: विस्तारशील, सिद्धांतवादी और दूर-देखने वाली — विशाल दृष्टि से अर्थ।",
  Capricorn: "मकर: अनुशासित, महत्वाकांक्षी और संरचनावादी — समय से परिपक्वता।",
  Aquarius: "कुम्भ: आविष्कारशील, कारण-संचालित और सामूहिक — समूह से व्यक्तित्व।",
  Pisces: "मीन: करुणामयी, कल्पनाशील और विलीन — छोड़ने से अर्थ।",
};

export function interpretSunSign(sign: string, element: string): Interpretation {
  return {
    verdict: `${signHi(sign)} सूर्य राशि — ${ELEMENT_HI[element] ?? element} तत्व`,
    meaning:
      `${SUN_SIGN_MEANINGS_HI[sign] ?? signHi(sign)} ${ELEMENT_MEANINGS_HI[element] ?? ""}`.trim(),
    guidance: [],
    basis: "पाश्चात्य उष्णकटिबंधीय ज्योतिष; अनुसंधान §2.1",
  };
}

/* ---------------------------------------------------------------- nakshatra */

const NAKSHATRA_MEANINGS_HI: Record<string, string> = {
  Ashwini: "शीघ्र उपचार और पहल (स्वामी केतु, देवता अश्विनीकुमार)",
  Bharani: "जिम्मेदारी और रूपांतरण वहन करना (शुक्र, यम)",
  Krittika: "निर्णायक स्पष्टता और शुद्ध करने वाली इच्छा (सूर्य, अग्नि)",
  Rohini: "वृद्धि, उर्वरता और आकर्षण (चंद्र, ब्रह्मा)",
  Mrigashira: "खोज और सौम्य चंचलता (मंगल, सोम)",
  Ardra: "प्रयास से जन्मी तूफ़ानी स्पष्टता (राहु, रुद्र)",
  Punarvasu: "पुनर्जन्म/नवीनीकरण और सुरक्षित लौटना (गुरु, अदिति)",
  Pushya: "पोषण और भरोसेमंद सहारा (शनि, बृहस्पति)",
  Ashlesha: "कुंडलित अंतर्दृष्टि और रणनीति (बुध, नाग)",
  Magha: "पैतृक सत्ता और सिंहासन (केतु, पितर)",
  "Purva Phalguni": "सृजनात्मक आनंद और आकर्षण (शुक्र, भग)",
  "Uttara Phalguni": "उदार गठजोड़ और स्थायी अनुबंध (सूर्य, अर्यमा)",
  Hasta: "कुशल हाथ और व्यावहारिक शिल्प (चंद्र, सविता)",
  Chitra: "तेजस्वी रचना और दृश्य कौशल (मंगल, विश्वकर्मा)",
  Swati: "वायु की तरह स्वतंत्र गति (राहु, वायु)",
  Vishakha: "धैर्यपूर्ण आरोहण के बाद केंद्रित विजय (गुरु, इंद्र-अग्नि)",
  Anuradha: "निष्ठावान भक्ति और संगठित सफलता (शनि, मित्र)",
  Jyeshtha: "वरिष्ठता, संरक्षण और जिम्मेदारी (बुध, इंद्र)",
  Mula: "मूल-अन्वेषण और मौलिक आरंभ (केतु, निरृति)",
  "Purva Ashadha": "अजेय घोषणा और शुद्धि (शुक्र, अपः)",
  "Uttara Ashadha": "अटल और स्थायी विजय (सूर्य, विश्वेदेव)",
  Shravana: "सुनना, सीखना और आगे बढ़ाना (चंद्र, विष्णु)",
  Dhanishta: "धन-लय और सामूहिक संगीत (मंगल, वसु)",
  Shatabhisha: "उपचार के रहस्य और सीमा-लंघन (राहु, वरुण)",
  "Purva Bhadrapada": "तीव्र आदर्शवाद और तप (गुरु, अजैकपाद)",
  "Uttara Bhadrapada": "गहरी स्थिरता और ज्ञान (शनि, अहिर्बुध्न्य)",
  Revati: "सुरक्षित यात्रा और करुणामयी समापन (बुध, पूषा)",
};

export function interpretNakshatra(name: string, lord: string, pada: number): Interpretation {
  const hi = nakshatraHi(name);
  return {
    verdict: `${hi}, पद ${pada}`,
    meaning: `जन्म ${hi} नक्षत्र में हुआ है — ${NAKSHATRA_MEANINGS_HI[name] ?? "एक शास्त्रीय चंद्र-मंडल"}। इसके स्वामी ${planetHi(lord)} जन्म से विंशोत्तरी दशा-क्रम को आकार देते हैं।`,
    guidance: [],
    basis: `BPHS नक्षत्र-वर्णन; अनुसंधान §2.2; ${P11_NOTE}`,
  };
}

/* ------------------------------------------------------------------- lagna */

export function interpretLagna(sign: string, lord: string): Interpretation {
  const hi = signHi(sign);
  return {
    verdict: `${hi} लग्न (आरोही)`,
    meaning: `जन्म के समय ${hi} आरोही था — यह उपस्थिति, पहली छाप और पूरी कुंडली पढ़ने का दृष्टिकोण तय करता है; इसके स्वामी ${planetHi(lord)} कुंडली के प्रमुख स्वामी बनते हैं।`,
    guidance: [],
    basis: `BPHS लग्न-अध्याय; अनुसंधान §2.3; ${P11_NOTE}`,
  };
}

/* --------------------------------------------------------------- sade sati */

const SADE_SATI_PHASE_MEANINGS_HI: Record<number, string> = {
  1: "चरण 1 (चंद्रमा से 12वें भाव में शनि): दबाव में बुनियाद — खर्च, नींद और वैराग्य के विषय बढ़ते हैं; यहीं सीखी अनुशासन तय करता है कि चक्र का बाकी हिस्सा कैसा रहेगा।",
  2: "चरण 2 (शनि जन्म-चंद्रमा के ऊपर): चरम — स्वास्थ्य, मन और घनिष्ठ संबंध सीधे परखे जाते हैं; नियमित दिनचर्या, नम्रता और ईमानदारी ही शास्त्रीय संरक्षण हैं।",
  3: "चरण 3 (चंद्रमा से दूसरे भाव में शनि): संगठन — धन, परिवार और वाणी की समीक्षा होती है; चरण 1–2 में बना सारा काम अब फल देने या सिखाने लगता है।",
};

const ordinalHi = (n: number): string => (n === 4 ? "चौथे" : n === 8 ? "आठवें" : `${n}वें`);

export function interpretSadeSati(
  inWindow: boolean,
  phase: number | null,
  dhaiyaHouse: number | null,
): Interpretation {
  const parts: string[] = [];
  if (inWindow && phase) parts.push(SADE_SATI_PHASE_MEANINGS_HI[phase] ?? "");
  if (dhaiyaHouse === 4)
    parts.push(
      "ढैया (चंद्रमा से चौथा भाव): गृह, संपत्ति और मानसिक शांति पर दबाव — शनि की 'छोटी ढैया', साढ़े साती के साथ या स्वतंत्र रूप से चलती है।",
    );
  if (dhaiyaHouse === 8)
    parts.push(
      "ढैया (चंद्रमा से आठवाँ भाव, अष्टम शनि): अचानक बाधाएँ और स्वास्थ्य-ध्यान — परीक्षामूलक पर रूपांतरणकारी शनि-गोचर।",
    );
  return {
    verdict: inWindow
      ? `साढ़े साती चल रही है${phase ? ` — चरण ${phase}` : ""}`
      : dhaiyaHouse
        ? `ढैया सक्रिय — चंद्रमा से ${ordinalHi(dhaiyaHouse)} भाव में शनि`
        : "अभी साढ़े साती की विंडो नहीं है",
    meaning: parts.join(" ") || "शनि जन्म-चंद्रमा से 12वें, पहले या दूसरे भाव में नहीं है और कोई ढैया लागू नहीं है।",
    guidance:
      inWindow || dhaiyaHouse
        ? [
            "शनि-काल में शास्त्रीय मार्गदर्शन नियमित दिनचर्या, सेवा और धैर्य को महत्व देता है; उपाय व्यक्तिगत/ज्योतिषी विषय हैं।",
          ]
        : [],
    basis: `शास्त्रीय गोचर; अनुसंधान §4.1; समय-गणना P11 तक ज्योतिषी-समीक्षित नहीं`,
  };
}

/* ----------------------------------------------------------------- manglik */

export function interpretManglik(
  isManglik: boolean,
  cancelled: boolean,
  _cancelledReason: string | null,
): Interpretation {
  if (cancelled) {
    return {
      verdict: "मांगलिक स्थिति मौजूद, पर निवारित",
      meaning:
        "मंगल दोष-भाव में है, परंतु स्वगृही (मेष/वृश्चिक) या उच्च (मकर) राशि के कारण शास्त्रीय निवारण लागू होता है — मिलान में यह दोष निष्प्रभावी माना जाता है।",
      guidance: [
        "मिलान के समय कच्ची स्थिति और निवारण दोनों दिखाए जाएँ — दोनों कुंडलियों का पूरा संदर्भ मायने रखता है।",
      ],
      basis: "शास्त्रीय निवारण नियम; अनुसंधान §4.3",
    };
  }
  return {
    verdict: isManglik ? "मांगलिक (दोष-भाव में मंगल)" : "मांगलिक नहीं",
    meaning: isManglik
      ? "मंगल लग्न, चंद्र या शुक्र से पहले/दूसरे/चौथे/सातवें/आठवें/बारहवें भाव में है — ये शास्त्रीय मंगल दोष की स्थितियाँ हैं, जो विवाह-मिलान को संतुलित करती हैं; समान कुंडली वाले साथी से यह ऊर्जा संतुलित होती है।"
      : "मंगल लग्न, चंद्र या शुक्र से किसी भी दोष-भाव में नहीं है।",
    guidance: isManglik
      ? [
          "परंपरा मांगलिक कुंडली का मिलान दूसरी मांगलिक कुंडली से करती है; भाव और दृष्टियों के अनुसार स्थिति की तीव्रता भिन्न होती है।",
        ]
      : [],
    basis: "शास्त्रीय मंगल दोष नियम; अनुसंधान §4.3",
  };
}

/* -------------------------------------------------------------- kaal sarp */

const KAAL_SARP_TYPE_HI: Record<string, string> = {
  Anant: "अनंत",
  Kulit: "कुलीक",
  Vasuki: "वासुकी",
  Shankhpal: "शंखपाल",
  Padma: "पद्म",
  Mahapadma: "महापद्म",
  Takshak: "तक्षक",
  Karkotak: "कार्कोटक",
  Shankhchud: "शंखचूड़",
  Ghaatak: "घातक",
  Vishdhar: "विषधर",
  Sheshnag: "शेषनाग",
};

export { KAAL_SARP_TYPE_HI };

const KAAL_SARP_TYPE_NOTES_HI: Record<string, string> = {
  Anant: "राहु पहले भाव में — पहचान और दिशा के विषय",
  Kulit: "राहु दूसरे भाव में — परिवार, धन और वाणी के विषय",
  Vasuki: "राहु तीसरे भाव में — साहस, भाई-बहन और प्रयास के विषय",
  Shankhpal: "राहु चौथे भाव में — घर, माता और स्थिरता के विषय",
  Padma: "राहु पाँचवें भाव में — संतान, सृजन और भाग्य के विषय",
  Mahapadma: "राहु छठे भाव में — बाधाएँ, स्वास्थ्य और सेवा के विषय",
  Takshak: "राहु सातवें भाव में — साझेदारी और विवाह के विषय",
  Karkotak: "राहु आठवें भाव में — आयु, अनुसंधान और अचानक घटनाओं के विषय",
  Shankhchud: "राहु नौवें भाव में — धर्म, पिता और भाग्य के विषय",
  Ghaatak: "राहु दसवें भाव में — करियर, कर्म और सत्ता के विषय",
  Vishdhar: "राहु ग्यारहवें भाव में — लाभ, संपर्क और महत्वाकांक्षाओं के विषय",
  Sheshnag: "राहु बारहवें भाव में — व्यय, मोक्ष और एकांत के विषय",
};

export function interpretKaalSarp(
  present: boolean,
  type: string | null,
  rahuHouse: number,
): Interpretation {
  if (!present) {
    return {
      verdict: "काल सर्प योग नहीं",
      meaning: `कम से कम एक ग्रह राहु–केतु अक्ष से बाहर बैठा है (राहु भाव ${rahuHouse} में) — शास्त्रीय योग के लिए आवश्यक पूर्ण घेराव अनुपस्थित है, इसलिए योग नहीं माना जाता।`,
      guidance: [],
      basis: "शास्त्रीय परिभाषा (सातों ग्रह घेरे में); अनुसंधान §4.2",
    };
  }
  return {
    verdict: `काल सर्प योग — ${type ? (KAAL_SARP_TYPE_HI[type] ?? type) : "राहु-भाव अनुसार"} (राहु भाव ${rahuHouse} में)`,
    meaning: `सातों ग्रह राहु–केतु अक्ष के भीतर घिरे हैं। ${type ? (KAAL_SARP_TYPE_NOTES_HI[type] ?? "") : ""} शास्त्र जीवन के ऐसे विषय बताते हैं जो तीव्र उन्नति और परीक्षामूलक गिरावट के बीच दोलन करते हैं।`,
    guidance: ["आंशिक स्थितियाँ जानबूझकर योग नहीं मानी जातीं — हर ग्रह का अक्ष-पक्ष ग्रह-तालिका में देखें।"],
    basis: "शास्त्रीय योग; अनुसंधान §4.2",
  };
}

/* ----------------------------------------------------------------- karakas */

const KARAKA_MEANINGS_HI: Record<string, string> = {
  Sun: "आत्म-उद्देश्य सत्ता, दृश्यता और पिता-स्वरूप के माध्यम से",
  Moon: "आत्म-उद्देश्य देखभाल, जन-समूह और भावुक जीवन के माध्यम से",
  Mars: "आत्म-उद्देश्य साहस, प्रतिस्पर्धा और निर्णायक कर्म के माध्यम से",
  Mercury: "आत्म-उद्देश्य अध्ययन, व्यापार और संवाद के माध्यम से",
  Jupiter: "आत्म-उद्देश्य शिक्षण, संतान और धर्म के माध्यम से",
  Venus: "आत्म-उद्देश्य प्रेम, सौंदर्य और संबंध के माध्यम से",
  Saturn: "आत्म-उद्देश्य धैर्य, नम्रता और सेवा के माध्यम से",
  Rahu: "आत्म-उद्देश्य अपरंपरागत मार्ग और सांसारिक इच्छा के माध्यम से (आठ-कारक पद्धति)",
};

export function interpretAtmakaraka(planet: string): Interpretation {
  return {
    verdict: `आत्मकारक: ${planetHi(planet)}`,
    meaning: `अपनी राशि में सर्वाधिक अंश वाला ग्रह आत्मकारक (आत्म का सूचक) होता है — ${KARAKA_MEANINGS_HI[planet] ?? "मूल जीवन-विषय"}। इसकी नवांश राशि (कारकांश) जैमिनी पठन का आधार है।`,
    guidance: [],
    basis: `जैमिनि सूत्र / BPHS कारकांश; अनुसंधान §4.4; ${P11_NOTE}`,
  };
}

export function interpretIshtaDevata(deity: string, _source: string): Interpretation {
  return {
    verdict: `इष्ट देवता: ${DEITY_HI[deity] ?? deity}`,
    meaning:
      "शास्त्रीय 'कारकांश से बारहवें भाव' विधि से व्युत्पन्न। देवता-निर्धारण परंपराओं में भिन्नता होती है; विवादित स्थितियों में वैकल्पिक देवता भी सूचीबद्ध हैं।",
    guidance: [],
    basis: "BPHS कारकांश फल, जैमिनि उपदेश सूत्र 1.2.72–79; अनुसंधान §4.5",
  };
}

/* ------------------------------------------------------------------ dasha */

export function interpretCurrentDasha(lord: string, subLord: string): Interpretation {
  return {
    verdict: `${planetHi(lord)} महादशा — ${planetHi(subLord)} अंतर्दशा`,
    meaning: `विंशोत्तरी काल एक ग्रह की थीम को महादशा-स्वामी की बड़ी थीम के भीतर परत करते हैं: ${KARAKA_MEANINGS_HI[lord] ?? planetHi(lord)} का काल अभी ${planetHi(subLord)} के अंतर्काल से रंगा है।`,
    guidance: [],
    basis: "विंशोत्तरी प्रवेश; अनुसंधान §4.6",
  };
}

/* ----------------------------------------------------------------- lo shu */

export function interpretLoShu(missing: number[], repeated: number[]): Interpretation {
  const missText = missing.length
    ? `अनुपस्थित ${missing
        .map((n) => {
          const m = NUMEROLOGY_ROOTS_HI[n];
          return `${n} (${m?.lord ?? "?"} — ${m?.keywords.split(", ")[0] ?? ""})`;
        })
        .join(", ")} — ये क्षेत्र सहज नहीं, जानबूझकर विकसित करने पड़ते हैं।`
    : "कोई संख्या अनुपस्थित नहीं — हर दिशा में समर्थन है।";
  const repText = repeated.length ? ` दोहराई गई ${repeated.join(", ")} — वे गुण प्रबल होते हैं।` : "";
  return {
    verdict: missing.length ? `लो शू ग्रिड में ${missing.length} संख्या अनुपस्थित` : "पूर्ण लो शू ग्रिड",
    meaning: `${missText}${repText}`,
    guidance: [],
    basis: "लो शू / चीनी अंकशास्त्र, अनुसंधान §3.6",
  };
}

/* ---------------------------------------------------------------- vehicle */

export function interpretVehicle(verdict: string): Interpretation {
  return {
    verdict: VEHICLE_VERDICT_HI[verdict] ?? verdict,
    meaning:
      "प्लेट दो पद्धतियों से पढ़ी जाती है — शुद्ध अंक-योग (पद्धति A) और छलदेव अक्षर+अंक योग (पद्धति B) — और आपके मूलांक/भाग्यांक से तुलना होती है। जहाँ दोनों पद्धतियाँ भिन्न हों, औसत निकालने के बजाय दोनों पठन दिखाए जाते हैं।",
    guidance: ["निर्णय सुझावात्मक हैं; पंजीकरण-बाध्यताएँ और व्यक्तिगत पसंद भी लागू होती हैं।"],
    basis: "वाहन अंकशास्त्र, अनुसंधान §3.5",
  };
}

/* -------------------------------------------------- shared value maps (S24) */

/** Devata names emitted by the ishta-devata table — hi for values + alternates. */
export const DEITY_HI: Record<string, string> = {
  Shiva: "शिव",
  "Devi (Gauri)": "देवी (गौरी)",
  Hanuman: "हनुमान",
  Vishnu: "विष्णु",
  Lakshmi: "लक्ष्मी",
  Durga: "दुर्गा",
  Ganesha: "गणेश",
  "Sri Rama": "श्री राम",
  Lalita: "ललिता",
  Saraswati: "सरस्वती",
  "Sri Krishna": "श्री कृष्ण",
  Narayana: "नारायण",
  Hayagriva: "हयग्रीव",
  Dattatreya: "दत्तात्रेय",
  Parvati: "पार्वती",
  Brahma: "ब्रह्मा",
  "Mahakala/Bhairava": "महाकाल/भैरव",
  Narasimha: "नरसिंह",
  Kali: "काली",
  Kartikeya: "कार्तिकेय",
  Rudra: "रुद्र",
};

/** Plate/name-compat verdict words — exact-match values. */
export const VEHICLE_VERDICT_HI: Record<string, string> = {
  Lucky: "शुभ",
  Mixed: "मिश्रित",
  Neutral: "सामान्य",
  "Not suggested": "अनुशंसित नहीं",
  Unparseable: "प्लेट अपाठ्य",
  Supportive: "सहायक",
  Challenging: "चुनौतीपूर्ण",
  "Lucky vehicle numbers": "शुभ वाहन अंक",
};
