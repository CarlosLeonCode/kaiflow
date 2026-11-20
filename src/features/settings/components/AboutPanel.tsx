import type { ReactNode } from "react";

import { useT } from "@/shared/i18n";
import { Panel } from "@/shared/ui/field";
import { KaiflowMark } from "@/shared/ui/kaiflow-mark";

interface Props {
  version: string;
  license: string;
  repositoryUrl: string;
}

/** Settings panel: version, license and where the source code lives (presentational). */
export function AboutPanel({ version, license, repositoryUrl }: Props) {
  const words = useT().settings.about;
  const releasesUrl = `${repositoryUrl}/releases`;
  return (
    <Panel title={words.title} description={words.description}>
      <div className="flex items-center gap-3 border-b border-border px-3 py-3">
        <KaiflowMark decorative className="size-9" />
        <p className="text-base font-medium tracking-tight">Kaiflow</p>
      </div>
      <dl className="divide-y divide-border">
        <AboutRow term={words.version}>{version}</AboutRow>
        <AboutRow term={words.license}>{license}</AboutRow>
        <AboutRow term={words.source}>
          <span data-selectable className="break-all">
            {repositoryUrl}
          </span>
        </AboutRow>
        <AboutRow term={words.releases}>
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
