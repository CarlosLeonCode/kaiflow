const REPO = "https://github.com/CarlosLeonCode/kaiflow";

/**
 * Shows the "Sponsor" link in the footer. Set to `false` to hide it.
 * The sponsor link only works once GitHub Sponsors is enabled for the account.
 */
export const SHOW_SPONSOR = true;

/** External links used across the site. */
export const LINKS = {
  repo: REPO,
  download: `${REPO}/releases/latest`,
  issues: `${REPO}/issues`,
  license: `${REPO}/blob/main/LICENSE`,
  agents: `${REPO}/blob/main/AGENTS.md`,
  sponsor: "https://github.com/sponsors/CarlosLeonCode",
} as const;
