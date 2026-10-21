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
  nav: { features: string; privacy: string; platforms: string; faq: string; download: string };
  language: { label: string; en: string; es: string };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    primary: string;
    secondaryLabel: string;
    secondary: { label: string; href: string }[];
    note: string;
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
  faq: { title: string; items: { q: string; a: string }[] };
  cta: { title: string; lead: string; primary: string; secondary: string };
  footer: { tagline: string; license: string; source: string; releases: string; issues: string };
}
