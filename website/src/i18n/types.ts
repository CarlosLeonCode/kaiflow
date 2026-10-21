export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export interface Item {
  title: string;
  body: string;
}

export interface Persona {
  role: string;
  summary: string;
  examples: string[];
}

export type Support = "yes" | "partial" | "no";

export interface PlatformRow {
  label: string;
  cells: [Support, string][];
}

export interface Content {
  meta: { title: string; description: string; ogAlt: string };
  a11y: {
    skip: string;
    primaryNav: string;
    languageNav: string;
    home: string;
    opensNewTab: string;
    yes: string;
    partial: string;
    no: string;
  };
  nav: { features: string; privacy: string; platforms: string; install: string; faq: string; download: string };
  language: { label: string; en: string; es: string };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    primary: string;
    /** Text before the Windows and Linux beta links, e.g. "Also for". */
    secondaryLabel: string;
    secondary: { label: string; href: string }[];
    /** Small badge after the Windows and Linux links. */
    betaBadge: string;
    note: string;
    /** "Free. Not notarized by Apple..." line, followed by a link to the Install section. */
    notice: string;
    noticeLink: string;
    shotAlt: string;
    popoverAlt: string;
  };
  how: { title: string; lead: string; steps: Item[] };
  features: { title: string; lead: string; items: Item[] };
  showcase: {
    title: string;
    lead: string;
    shots: { key: "overview" | "goals" | "focus"; title: string; body: string; alt: string }[];
  };
  personas: { title: string; lead: string; items: Persona[] };
  privacy: {
    title: string;
    lead: string;
    readTitle: string;
    read: string[];
    neverTitle: string;
    never: string[];
    storageTitle: string;
    storage: string[];
  };
  ai: {
    eyebrow: string;
    title: string;
    lead: string;
    points: Item[];
    providersTitle: string;
    providers: string[];
  };
  platforms: {
    title: string;
    lead: string;
    feature: string;
    columns: string[];
    rows: PlatformRow[];
    note: string;
    sourceLink: string;
  };
  install: {
    title: string;
    lead: string;
    steps: { title: string; body: string }[];
    firstOpenTitle: string;
    firstOpenLead: string;
    variants: { title: string; steps: string[] }[];
    advancedTitle: string;
    advancedBody: string;
    permissionTitle: string;
    permissionBody: string;
    beta: {
      title: string;
      lead: string;
      badge: string;
      windowsTitle: string;
      windowsSteps: string[];
      linuxTitle: string;
      linuxLead: string;
      appImageLabel: string;
      debLabel: string;
      linuxNote: string;
      report: string;
      download: string;
    };
  };
  availability: {
    title: string;
    available: string;
    beta: string;
    soon: string;
    items: { name: string; status: "available" | "beta" | "soon"; detail: string }[];
    watch: string;
    vote: string;
  };
  fork: {
    eyebrow: string;
    title: string;
    lead: string;
    points: Item[];
    agentsTitle: string;
    agents: string[];
    promptTitle: string;
    prompt: string;
    agentsLink: string;
    forkingLink: string;
    forkLink: string;
  };
  support: { title: string; lead: string; star: string; sponsor: string };
  faq: { title: string; items: { q: string; a: string }[] };
  cta: { title: string; lead: string; primary: string; secondary: string };
  footer: { tagline: string; nameNote: string; license: string; source: string; releases: string; issues: string };
}
