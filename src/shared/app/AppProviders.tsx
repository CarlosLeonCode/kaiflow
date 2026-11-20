import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { I18nProvider, type Language } from "@/shared/i18n";
import { useBackendEventSync, useSettingsQuery } from "@/shared/ipc";
import { parseTheme, useTheme } from "@/shared/lib/theme";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // The backend is local and fast: one retry hides a transient engine hiccup.
      queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true },
    },
  });
}

/** Follows the backend: theme setting and event-driven cache invalidation. */
function BackendSync() {
  useBackendEventSync();
  const settings = useSettingsQuery();
  useTheme(parseTheme(settings.data?.theme));
  return null;
}

interface Props {
  children: ReactNode;
  client?: QueryClient;
  /** Pins the OS language (tests); the real windows read `navigator.language`. */
  systemLanguage?: Language;
}

/** Providers every window shares (query cache, event sync, theme, language). */
export function AppProviders({ children, client, systemLanguage }: Props) {
  const [fallback] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client ?? fallback}>
      <BackendSync />
      <I18nProvider system={systemLanguage}>{children}</I18nProvider>
    </QueryClientProvider>
  );
}
