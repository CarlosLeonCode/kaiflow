# Create the "TimeTrack Dev" signing identity

`scripts/dev-sign.sh` signs the development build with a self-signed certificate named
**TimeTrack Dev**. You create it once, in Keychain Access. Nothing in this repository creates
certificates or changes your keychain.

## Why a stable identity

macOS stores the Accessibility grant (TCC) against the app's code requirement. With an
ad-hoc signature the requirement changes on every build, so the grant is lost each time. A
self-signed certificate that does not change keeps the same requirement across builds.

## Steps

1. Open **Keychain Access** (Spotlight: "Keychain Access").
2. Menu **Keychain Access > Certificate Assistant > Create a Certificate...**
3. Fill in:
   - **Name**: `TimeTrack Dev` (must match exactly)
   - **Identity Type**: Self Signed Root
   - **Certificate Type**: Code Signing
   - Leave "Let me override defaults" unchecked.
4. Click **Create**, then **Done**.
5. Select the **login** keychain, category **My Certificates**, and double-click
   `TimeTrack Dev`.
6. Expand **Trust**, set **Code Signing** to **Always Trust**, and close the window
   (authenticate when asked).

## Check

```sh
security find-identity -v -p codesigning | grep "TimeTrack Dev"
```

It must print one line with `"TimeTrack Dev"`. If it prints nothing, the trust setting in
step 6 is missing (without it the identity appears only under `-p codesigning` without `-v`).

## Use

```sh
scripts/dev-sign.sh
open ~/Applications/"Time Track Copilot.app"
```

Grant Accessibility to **Time Track Copilot** in System Settings > Privacy & Security >
Accessibility. The grant survives later rebuilds signed with the same identity.

To use another identity name, set `TIMETRACK_SIGNING_IDENTITY`.

## If the grant is ever lost

Remove the entry in System Settings (the `-` button), run the app again and grant it again.
If the entry looks enabled but tracking is degraded, quit and reopen the app (the app also
offers a restart after granting).

## Backup (optional)

To keep the same identity on another Mac, export it from Keychain Access as a `.p12`
(right-click the certificate > Export) and import it there. Store the file securely; never
commit it.
