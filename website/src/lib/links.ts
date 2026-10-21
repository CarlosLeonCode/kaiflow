const REPO = "https://github.com/CarlosLeonCode/kaiflow";

/**
 * Shows the "Sponsor" button in the Support section. Set to `false` to hide it.
 * The sponsor link only works once GitHub Sponsors is enabled for the account.
 */
export const SHOW_SPONSOR = true;

/** External links used across the site. */
export const LINKS = {
  repo: REPO,
  download: `${REPO}/releases/latest`,
  releases: `${REPO}/releases`,
  issues: `${REPO}/issues`,
  /** Placeholder until a dedicated "Windows and Linux builds" issue exists. */
  platformVote: `${REPO}/issues`,
  license: `${REPO}/blob/main/LICENSE`,
  buildFromSource: `${REPO}#build-from-source`,
  platformDocs: `${REPO}/blob/main/docs/platform-support.md`,
  agents: `${REPO}/blob/main/AGENTS.md`,
  forking: `${REPO}/blob/main/docs/forking.md`,
  fork: `${REPO}/fork`,
  sponsor: "https://github.com/sponsors/CarlosLeonCode",
} as const;
