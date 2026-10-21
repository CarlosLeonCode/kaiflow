import type { ReactNode } from "react";

import { Panel } from "@/shared/ui/field";

interface Props {
  version: string;
  license: string;
  repositoryUrl: string;
}

/** Settings panel: version, license and where the source code lives (presentational). */
export function AboutPanel({ version, license, repositoryUrl }: Props) {
  const releasesUrl = `${repositoryUrl}/releases`;
  return (
    <Panel title="About" description="Free and open source. New versions are published on GitHub Releases.">
      <dl className="divide-y divide-border">
        <AboutRow term="Version">{version}</AboutRow>
        <AboutRow term="License">{license}</AboutRow>
        <AboutRow term="Source code">
          <span data-selectable className="break-all">
            {repositoryUrl}
          </span>
        </AboutRow>
        <AboutRow term="Releases">
          <span data-selectable className="break-all">
            {releasesUrl}
          </span>
        </AboutRow>
      </dl>
    </Panel>
  );
}

function AboutRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5">
      <dt className="font-medium">{term}</dt>
      <dd className="min-w-0 text-right text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}
