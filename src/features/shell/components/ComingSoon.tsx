import { Page } from "@/shared/ui/page";

/** Placeholder for sections that land in the next batch (History, Categories, Privacy). */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <Page title={title}>
      <div className="mx-auto mt-16 max-w-sm text-center">
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
    </Page>
  );
}
