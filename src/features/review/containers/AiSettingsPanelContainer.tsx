import { useState } from "react";

import {
  errorMessage,
  useAiModelsMutation,
  useAiSettingsQuery,
  useDeleteAiKeyMutation,
  useSetAiKeyMutation,
  useTestAiMutation,
  useUpdateAiSettingsMutation,
  type AiProviderDto,
  type AiSettingsPatchDto,
} from "@/shared/ipc";

import { AiSettingsPanel } from "../components/AiSettingsPanel";

function patch(changes: Partial<AiSettingsPatchDto>): AiSettingsPatchDto {
  return { selected: null, include_titles: null, monday_review: null, provider: null, ...changes };
}

/**
 * Wires Settings > AI. Opening it reads settings only: no provider is contacted and the
 * keychain is not opened. Listing models and testing the connection are buttons.
 */
export function AiSettingsPanelContainer() {
  const settings = useAiSettingsQuery();
  const update = useUpdateAiSettingsMutation();
  const setKey = useSetAiKeyMutation();
  const deleteKey = useDeleteAiKeyMutation();
  const listModels = useAiModelsMutation();
  const test = useTestAiMutation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [models, setModels] = useState<readonly string[]>([]);

  const busy =
    update.isPending || setKey.isPending || deleteKey.isPending || listModels.isPending || test.isPending;
  const fail = (e: unknown) => setError(errorMessage(e));
  const reset = () => {
    setError(null);
    setNotice(null);
  };
  const providerPatch = (provider: AiProviderDto, changes: { enabled?: boolean; model?: string; base_url?: string }) =>
    update.mutate(
      patch({
        provider: { provider, enabled: changes.enabled ?? null, model: changes.model ?? null, base_url: changes.base_url ?? null },
      }),
      { onError: fail },
    );

  return (
    <AiSettingsPanel
      settings={settings.data}
      busy={busy}
      error={error ?? (settings.isError ? `Could not load AI settings: ${errorMessage(settings.error)}` : null)}
      notice={notice}
      models={models}
      onSelect={(provider) => {
        reset();
        setModels([]);
        update.mutate(patch({ selected: provider }), { onError: fail });
      }}
      onToggle={(provider, enabled) => {
        reset();
        providerPatch(provider, { enabled });
      }}
      onSaveKey={(provider, key) => {
        reset();
        setKey.mutate({ provider, key }, { onError: fail });
      }}
      onDeleteKey={(provider) => {
        reset();
        deleteKey.mutate(provider, { onError: fail });
      }}
      onModelChange={(provider, model) => {
        reset();
        providerPatch(provider, { model });
      }}
      onBaseUrlChange={(provider, base_url) => {
        reset();
        setModels([]);
        providerPatch(provider, { base_url });
      }}
      onRefreshModels={(provider) => {
        reset();
        listModels.mutate(provider, {
          onSuccess: (ids) => {
            setModels(ids);
            setNotice(ids.length === 0 ? "The provider lists no models." : `${ids.length} models available.`);
            // Ollama has no default: choose the first installed one so a run can start.
            const current = settings.data?.providers.find((p) => p.provider === provider);
            const first = ids[0];
            if (current?.local && current.model === "" && first) providerPatch(provider, { model: first });
          },
          onError: fail,
        });
      }}
      onTest={(provider) => {
        reset();
        test.mutate(provider, {
          onSuccess: (count) => setNotice(`Connected. The provider lists ${count} models.`),
          onError: fail,
        });
      }}
      onIncludeTitles={(value) => {
        reset();
        update.mutate(patch({ include_titles: value }), { onError: fail });
      }}
      onMondayReview={(value) => {
        reset();
        update.mutate(patch({ monday_review: value }), { onError: fail });
      }}
    />
  );
}
