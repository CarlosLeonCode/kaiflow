import { CircleAlert, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { useT } from "@/shared/i18n";
import type { AiProviderDto, AiProviderInfoDto, AiSettingsDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Panel, Row } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

import { providerLabel } from "../lib/review";

interface Props {
  /** `undefined` while loading. */
  settings: AiSettingsDto | undefined;
  busy: boolean;
  error: string | null;
  /** Result of the last "Test connection" or "Refresh models" (a short sentence). */
  notice: string | null;
  /** Model ids from the last refresh, for the suggestions list. */
  models: readonly string[];
  onSelect: (provider: AiProviderDto) => void;
  onToggle: (provider: AiProviderDto, enabled: boolean) => void;
  onSaveKey: (provider: AiProviderDto, key: string) => void;
  onDeleteKey: (provider: AiProviderDto) => void;
  onModelChange: (provider: AiProviderDto, model: string) => void;
  onBaseUrlChange: (provider: AiProviderDto, url: string) => void;
  onRefreshModels: (provider: AiProviderDto) => void;
  onTest: (provider: AiProviderDto) => void;
  onIncludeTitles: (value: boolean) => void;
  onMondayReview: (value: boolean) => void;
}

/** Fields that belong to one provider. Remounted per provider (`key`) so drafts never leak across. */
function ProviderFields({
  info,
  settings,
  props,
}: {
  info: AiProviderInfoDto;
  settings: AiSettingsDto;
  props: Props;
}) {
  const t = useT();
  const words = t.review.settings;
  const label = providerLabel(info, t);
  const [keyDraft, setKeyDraft] = useState("");
  const [model, setModel] = useState(info.model);
  const [address, setAddress] = useState(info.base_url ?? "");
  const store = settings.secret_store;
  const keyBlocked = info.needs_key && !store.available;
  const listId = `ai-models-${info.provider}`;

  return (
    <>
      <Row
        label={words.use(label)}
        controlId="ai-enabled"
        description={info.local ? words.localHint : words.remoteHint(label)}
      >
        <Switch
          id="ai-enabled"
          aria-describedby="ai-enabled-hint"
          checked={info.enabled}
          disabled={props.busy || (keyBlocked && !info.enabled)}
          onCheckedChange={(enabled) => props.onToggle(info.provider, enabled)}
        />
      </Row>

      {keyBlocked && (
        <div className="px-3 py-2.5">
          <Alert variant="warning" role="alert">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription data-testid="ai-keychain-unavailable">
              {words.keychainUnavailable(store.reason ?? words.noKeyStore, label)}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {info.needs_key && !keyBlocked && (
        <Row
          label={words.apiKey}
          controlId="ai-key"
          description={info.has_key ? words.keySaved : words.keyPaste}
        >
          {info.has_key ? (
            <Button size="sm" disabled={props.busy} onClick={() => props.onDeleteKey(info.provider)}>
              {words.removeKey}
            </Button>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (keyDraft.trim() === "") return;
                props.onSaveKey(info.provider, keyDraft);
                setKeyDraft("");
              }}
            >
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="w-48"
                value={keyDraft}
                placeholder={words.keyPlaceholder}
                onChange={(event) => setKeyDraft(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={props.busy || keyDraft.trim() === ""}>
                {words.saveKey}
              </Button>
            </form>
          )}
        </Row>
      )}

      <Row
        label={words.model}
        controlId="ai-model"
        description={info.local ? words.modelLocal : words.modelRemote(info.default_model)}
      >
        <div className="flex items-center gap-2">
          <Input
            id="ai-model"
            className="w-48"
            list={listId}
            value={model}
            placeholder={info.default_model || words.modelPlaceholder}
            onChange={(event) => setModel(event.target.value)}
            onBlur={() => model !== info.model && props.onModelChange(info.provider, model)}
          />
          <datalist id={listId}>
            {props.models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <Button size="sm" disabled={props.busy || !info.enabled} onClick={() => props.onRefreshModels(info.provider)}>
            {words.refresh}
          </Button>
        </div>
      </Row>

      {info.local && (
        <Row
          label={words.address}
          controlId="ai-address"
          description={words.addressHint}
        >
          <Input
            id="ai-address"
            className="w-56"
            value={address}
            placeholder="http://localhost:11434"
            onChange={(event) => setAddress(event.target.value)}
            onBlur={() => address !== (info.base_url ?? "") && props.onBaseUrlChange(info.provider, address)}
          />
        </Row>
      )}

      <Row
        label={words.testConnection}
        controlId="ai-test"
        description={words.testHint}
      >
        <Button id="ai-test" size="sm" disabled={props.busy || !info.enabled} onClick={() => props.onTest(info.provider)}>
          {words.test}
        </Button>
      </Row>
    </>
  );
}

/** Settings > AI (presentational): opt-in per provider, the key, the model and the defaults. */
export function AiSettingsPanel(props: Props) {
  const t = useT();
  const words = t.review.settings;
  const { settings } = props;
  const selected = settings?.providers.find((p) => p.provider === settings.selected);
  return (
    <Panel
      title={words.title}
      description={words.description}
    >
      {!settings || !selected ? (
        <div className="p-3" aria-label={words.loading}>
          <Skeleton className="h-16" />
        </div>
      ) : (
        <>
          {props.error && (
            <div className="px-3 py-2.5">
              <Alert variant="warning" role="alert">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <AlertDescription data-testid="ai-settings-error">{props.error}</AlertDescription>
              </Alert>
            </div>
          )}
          {props.notice && (
            <div className="px-3 py-2.5">
              <Alert variant="neutral">
                <AlertDescription data-testid="ai-notice">{props.notice}</AlertDescription>
              </Alert>
            </div>
          )}
          <Row label={words.provider} controlId="ai-provider">
            <Select
              id="ai-provider"
              value={settings.selected}
              onChange={(event) => props.onSelect(event.target.value as AiProviderDto)}
            >
              {settings.providers.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {providerLabel(p, t)}
                </option>
              ))}
            </Select>
          </Row>

          <ProviderFields key={selected.provider} info={selected} settings={settings} props={props} />

          <Row
            label={words.includeTitles}
            controlId="ai-titles"
            description={words.includeTitlesHint}
          >
            <Switch
              id="ai-titles"
              aria-describedby="ai-titles-hint"
              checked={settings.include_titles}
              disabled={props.busy}
              onCheckedChange={props.onIncludeTitles}
            />
          </Row>

          <Row
            label={words.monday}
            controlId="ai-monday"
            description={words.mondayHint}
            error={settings.last_auto_error ? words.mondayFailed(settings.last_auto_error) : null}
          >
            <Switch
              id="ai-monday"
              aria-describedby="ai-monday-hint"
              checked={settings.monday_review}
              disabled={props.busy}
              onCheckedChange={props.onMondayReview}
            />
          </Row>
        </>
      )}
    </Panel>
  );
}
