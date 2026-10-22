export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export interface Item {
  title: string;
  body: string;
}

export type PlatformStatus = "available" | "beta";

export interface Content {
  meta: { title: string; description: string; ogAlt: string };
  a11y: {
    skip: string;
    primaryNav: string;
    languageNav: string;
    home: string;
  };
  /** Header links: `features` → #features, `privacy` → #privacy, `install` → #download, `faq` → #faq. */
  nav: { features: string; privacy: string; install: string; faq: string; download: string };
  language: { en: string; es: string };
  hero: {
    eyebrow: string;
    title: string;
    /** One sentence. */
    lead: string;
    primary: string;
    /** Text before the Windows and Linux beta links, e.g. "Also for". */
    secondaryLabel: string;
    secondary: { label: string; href: string }[];
    /** Small badge after the Windows and Linux links. */
    betaBadge: string;
    note: string;
    /** "Free. Not notarized by Apple..." line, followed by a link to the first-open steps. */
    notice: string;
    noticeLink: string;
    /** Accessible description of the hero explainer video. */
    videoLabel: string;
    pauseVideo: string;
    playVideo: string;
  };
  /** "What you get": four items, in the order of the icons in Features.astro. */
  features: {
    title: string;
    items: Item[];
    shots: { key: "overview" | "focus"; alt: string }[];
  };
  privacy: {
    title: string;
    /** Three items, in the order of the icons in Privacy.astro. */
    items: Item[];
    /** One line about forking with AI agents, followed by a link to AGENTS.md. */
    fork: string;
    forkLink: string;
  };
  download: {
    title: string;
    lead: string;
    available: string;
    beta: string;
    platforms: { name: string; status: PlatformStatus; detail: string; cta: string }[];
    firstOpen: {
      title: string;
      items: { title: string; steps: string[]; code?: string }[];
    };
  };
  faq: { title: string; items: { q: string; a: string }[] };
  footer: {
    tagline: string;
    nameNote: string;
    license: string;
    source: string;
    releases: string;
    issues: string;
    star: string;
    sponsor: string;
  };
}
