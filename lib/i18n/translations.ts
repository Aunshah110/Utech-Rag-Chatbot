// lib/i18n/translations.ts
// UI string translations for the language selector feature.

export type LanguageCode = 'en' | 'ur' | 'sd';

export interface Language {
  code: LanguageCode;
  /** Name in English */
  name: string;
  /** Name in the language's own script */
  nativeName: string;
  /** Text direction */
  direction: 'ltr' | 'rtl';
  /** BCP-47 for HTML lang attribute */
  htmlLang: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr', htmlLang: 'en' },
  { code: 'ur', name: 'Urdu',    nativeName: 'اردو',    direction: 'rtl', htmlLang: 'ur' },
  { code: 'sd', name: 'Sindhi',  nativeName: 'سنڌي',   direction: 'rtl', htmlLang: 'sd' },
];

export interface Translations {
  // Header
  appTitle: string;
  appSubtitle: string;
  newChat: string;
  language: string;

  // Empty state
  tryAsking: string;
  suggestion1: string;
  suggestion2: string;
  suggestion3: string;
  suggestion4: string;

  // Input
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  footerNote: string;

  // Messages
  thinking: string;
  sourcesLabel: string;
  notEnoughInfo: string;
  errorMessage: string;
  cancelled: string;
}

export const TRANSLATIONS: Record<LanguageCode, Translations> = {
  en: {
    appTitle: 'BBS-UTECH Assistant',
    appSubtitle: "Grounded answers from the university's published info",
    newChat: 'New chat',
    language: 'Language',

    tryAsking: 'Try asking about...',
    suggestion1: 'What are the admission requirements for MS Civil Engineering?',
    suggestion2: 'Who teaches in the Computer Science department?',
    suggestion3: 'What programs does the university offer?',
    suggestion4: 'What is the fee structure for BS programs?',

    placeholder: 'Ask about admissions, programs, faculty...',
    sendLabel: 'Send message',
    stopLabel: 'Stop generating',
    footerNote: "Answers are based only on BBS-UTECH's published information.",

    thinking: 'Thinking',
    sourcesLabel: 'Sources',
    notEnoughInfo: 'Not enough information',
    errorMessage: "I'm having trouble reaching the assistant right now. Please try again in a moment.",
    cancelled: '(cancelled)',
  },

  ur: {
    appTitle: 'بی بی ایس یو ٹیک اسسٹنٹ',
    appSubtitle: 'یونیورسٹی کی شائع کردہ معلومات سے مستند جوابات',
    newChat: 'نئی بات چیت',
    language: 'زبان',

    tryAsking: 'کے بارے میں پوچھیں...',
    suggestion1: 'ایم ایس سول انجینئرنگ کے داخلے کی شرائط کیا ہیں؟',
    suggestion2: 'کمپیوٹر سائنس کے شعبے میں کون پڑھاتا ہے؟',
    suggestion3: 'یونیورسٹی کون سے پروگرام پیش کرتی ہے؟',
    suggestion4: 'بی ایس پروگراموں کی فیس کا ڈھانچہ کیا ہے؟',

    placeholder: 'داخلے، پروگرام، فیکلٹی کے بارے میں پوچھیں...',
    sendLabel: 'پیغام بھیجیں',
    stopLabel: 'تولید روکیں',
    footerNote: 'جوابات صرف بی بی ایس یو ٹیک کی شائع کردہ معلومات پر مبنی ہیں۔',

    thinking: 'سوچ رہا ہوں',
    sourcesLabel: 'ذرائع',
    notEnoughInfo: 'کافی معلومات نہیں',
    errorMessage: 'مجھے اس وقت اسسٹنٹ تک رسائی میں دشواری ہو رہی ہے۔ براہ کرم ایک لمحے میں دوبارہ کوشش کریں۔',
    cancelled: '(منسوخ)',
  },

  sd: {
    appTitle: 'بي بي ايس يو ٽيڪ اسسٽنٽ',
    appSubtitle: 'يونيورسٽي جي شايع ٿيل معلومات مان مستند جواب',
    newChat: 'نئين چيٽ',
    language: 'ٻولي',

    tryAsking: 'باري ۾ پڇو...',
    suggestion1: 'ايم ايس سول انجنيئرنگ لاءِ داخلا جون شرطون ڇا آهن؟',
    suggestion2: 'ڪمپيوٽر سائنس شعبي ۾ ڪير سيکاريندو آهي؟',
    suggestion3: 'يونيورسٽي ڪهڙا پروگرام پيش ڪري ٿي؟',
    suggestion4: 'بي ايس پروگرامن جي فيس جي جوڙجڪ ڇا آهي؟',

    placeholder: 'داخلا، پروگرام، فيڪلٽي باري ۾ پڇو...',
    sendLabel: 'پيغام موڪليو',
    stopLabel: 'بند ڪريو',
    footerNote: 'جواب صرف بي بي ايس يو ٽيڪ جي شايع ٿيل معلومات تي ٻڌل آهن.',

    thinking: 'سوچي رهيو آهيان',
    sourcesLabel: 'ذريعا',
    notEnoughInfo: 'ڪافي معلومات ناهي',
    errorMessage: 'مون کي هن وقت اسسٽنٽ تائين پهچ ۾ ڏکيائي ٿي رهي آهي. مهرباني ڪري هڪ لمحي ۾ ٻيهر ڪوشش ڪريو.',
    cancelled: '(منسوخ)',
  },
};

export function getTranslations(code: LanguageCode): Translations {
  return TRANSLATIONS[code] ?? TRANSLATIONS.en;
}