import { CircleAlert, ShieldAlert } from "lucide-react";
import { useState } from "react";

import type { AiProviderDto, AiProviderInfoDto, AiSettingsDto } from "@/shared/ipc";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Panel, Row } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";

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
  const [keyDraft, setKeyDraft] = useState("");
  const [model, setModel] = useState(info.model);
  const [address, setAddress] = useState(info.base_url ?? "");
  const store = settings.secret_store;
  const keyBlocked = info.needs_key && !store.available;
  const listId = `ai-models-${info.provider}`;

  return (
    <>
      <Row
        label={`Use ${info.label}`}
        controlId="ai-enabled"
        description={
          info.local
            ? "Runs on this computer. Your data never leaves it."
            : `Off by default. When on, you can send your weekly totals to ${info.label} from the Review section, after seeing exactly what is sent. Their privacy terms apply to what you send.`
        }
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
              There is no secure place to keep API keys on this computer ({store.reason ?? "no key store"}). Keys are
              never stored in plain text, so {info.label} cannot be used here. A model on this computer (Ollama) still
              can.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {info.needs_key && !keyBlocked && (
        <Row
          label="API key"
          controlId="ai-key"
          description={
            info.has_key
              ? "Saved in your system keychain. It is never shown again and never leaves this computer except to reach the provider."
              : "Paste your key. It goes straight to your system keychain: it is not saved in the app, in backups or in exports."
          }
        >
          {info.has_key ? (
            <Button size="sm" disabled={props.busy} onClick={() => props.onDeleteKey(info.provider)}>
              Remove key
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
                placeholder="Paste API key"
                onChange={(event) => setKeyDraft(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={props.busy || keyDraft.trim() === ""}>
                Save key
              </Button>
            </form>
          )}
        </Row>
      )}

      <Row
        label="Model"
        controlId="ai-model"
        description={
          info.local
            ? "Pick one of the models installed in Ollama (use Refresh list)."
            : `The cheapest current model is the default (${info.default_model}). You can type another one.`
        }
      >
        <div className="flex items-center gap-2">
          <Input
            id="ai-model"
            className="w-48"
            list={listId}
            value={model}
            placeholder={info.default_model || "Model name"}
            onChange={(event) => setModel(event.target.value)}
            onBlur={() => model !== info.model && props.onModelChange(info.provider, model)}
          />
          <datalist id={listId}>
            {props.models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          <Button size="sm" disabled={props.busy || !info.enabled} onClick={() => props.onRefreshModels(info.provider)}>
            Refresh list
          </Button>
        </div>
      </Row>

      {info.local && (
        <Row
          label="Ollama address"
          controlId="ai-address"
          description="Only this computer is allowed (localhost or 127.0.0.1), whatever the scheme."
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
        label="Test connection"
        controlId="ai-test"
        description="Checks the key and the connection by listing the available models. Nothing about your time is sent."
      >
        <Button id="ai-test" size="sm" disabled={props.busy || !info.enabled} onClick={() => props.onTest(info.provider)}>
          Test
        </Button>
      </Row>
    </>
  );
}

/** Settings > AI (presentational): opt-in per provider, the key, the model and the defaults. */
export function AiSettingsPanel(props: Props) {
  const { settings } = props;
  const selected = settings?.providers.find((p) => p.provider === settings.selected);
  return (
    <Panel
      title="AI analysis"
      description="Optional. Everything works without it. Nothing is sent to any AI provider unless you switch one on here and press Send in Review."
    >
      {!settings || !selected ? (
        <div className="p-3" aria-label="Loading AI settings">
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
          <Row label="Provider" controlId="ai-provider">
            <Select
              id="ai-provider"
              value={settings.selected}
              onChange={(event) => props.onSelect(event.target.value as AiProviderDto)}
            >
              {settings.providers.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Row>

          <ProviderFields key={selected.provider} info={selected} settings={settings} props={props} />

          <Row
            label="Include window titles by default"
            controlId="ai-titles"
            description="Window titles can contain private details. When on, the 20 busiest titles (shortened) are added to what you can send. You still review everything first."
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
            label="Monday review"
            controlId="ai-monday"
            description="On its own, the app analyzes last week once a new week starts, using the provider above (it must be switched on). Nothing is sent otherwise. If you are offline it tries again the next time the app starts."
            error={settings.last_auto_error ? `The last automatic review failed: ${settings.last_auto_error}` : null}
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
