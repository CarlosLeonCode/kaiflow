# Publicar una versión (gratis, sin cuenta de Apple de pago)

Este documento describe cómo se publica Kaiflow y qué hay que configurar una sola
vez. El flujo está en `.github/workflows/release.yml`; la lógica de actualización de la app
está en `src-tauri/src/updater.rs`.

Decisión del proyecto: **no se usa una cuenta de Apple Developer de pago**. La app de macOS se
distribuye gratis desde GitHub Releases **sin notarizar**. Todo lo demás (firma estable,
actualizaciones automáticas) también es gratuito y opcional. Windows y Linux están
implementados, pero todavía no se publican (próximamente).

## Cómo funciona

1. Se sube una etiqueta `vX.Y.Z` (debe coincidir con `version` de `src-tauri/tauri.conf.json`).
2. El flujo elige el **modo de firma** según los secretos disponibles (tabla abajo) y decide
   si se activa el **actualizador**.
3. GitHub Actions compila la app universal (`aarch64` + `x86_64`) con `tauri-action`, la firma
   y sube el DMG a una release en **borrador**, con notas que explican cómo abrirla la primera
   vez.
4. Se verifica la firma (`codesign`). El requisito designado (*designated requirement*) queda en
   el resumen del job: si no cambia entre versiones, macOS conserva el permiso de Accesibilidad.
5. La release se **publica** (deja de ser borrador). Así `releases/latest` nunca apunta a una
   compilación sin verificar.

Sin ningún secreto configurado, el flujo funciona igual: firma ad-hoc, sin actualizador y release
publicada.

## Modos de firma

| Modo | Secretos necesarios | Gatekeeper la primera vez | Permiso de Accesibilidad al actualizar |
|---|---|---|---|
| **Ad-hoc** (por defecto) | Ninguno | Aviso: hay que abrirla desde Ajustes del Sistema | **Se pierde**: hay que concederlo de nuevo. Las notas de la release lo indican. |
| **Autofirmado estable** (recomendado) | `MACOS_SELF_SIGNED_CERT_P12`, `MACOS_SELF_SIGNED_CERT_PASSWORD` | Aviso: hay que abrirla desde Ajustes del Sistema | **Se conserva**, siempre que el certificado no cambie |
| **Developer ID + notarización** (opcional, de pago) | Los seis `APPLE_*` | Sin aviso | Se conserva |

Por qué importa: macOS guarda el permiso de Accesibilidad (TCC) asociado al requisito designado
de la firma. Con firma ad-hoc ese requisito cambia en cada compilación; con un certificado
autofirmado que no cambia, el requisito es el mismo (`certificate leaf = H"..."`) en todas las
versiones.

## Certificado autofirmado de release (una sola vez, gratis)

Se crea un certificado de firma de código llamado **Kaiflow Release** y se guarda como
secreto del repositorio. Es distinto de la identidad de desarrollo "Kaiflow Dev"
(`scripts/create-dev-identity.md`), que solo se usa en tu Mac.

> **Nunca subas el `.p12` ni la clave privada al repositorio.** Guarda una copia cifrada fuera
> de línea (gestor de contraseñas). Si pierdes el certificado y creas otro, todos los usuarios
> tendrán que conceder Accesibilidad otra vez.

### Opción A: Acceso a Llaveros

1. Abre **Acceso a Llaveros** > menú **Acceso a Llaveros > Asistente de certificados > Crear un
   certificado...**
2. **Nombre**: `Kaiflow Release` (si usas otro, crea la variable del repositorio
   `MACOS_SELF_SIGNED_IDENTITY` con ese nombre). **Tipo de identidad**: Raíz autofirmada.
   **Tipo de certificado**: Firma de código. Marca **Permitirme anular los valores por
   omisión** y pon una validez larga (por ejemplo, 3650 días).
3. En **Mis certificados**, haz clic derecho en `Kaiflow Release` > **Exportar...**, formato
   **Intercambio de información personal (.p12)**, y elige una contraseña.

### Opción B: OpenSSL

```sh
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout release.key -out release.crt \
  -subj "/CN=Kaiflow Release" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

openssl pkcs12 -export -inkey release.key -in release.crt \
  -name "Kaiflow Release" -out release.p12
```

Con OpenSSL 3 (por ejemplo, el de Homebrew) añade `-legacy` al segundo comando: el
`security import` de macOS no lee el cifrado por defecto de OpenSSL 3. El `openssl` incluido en
macOS (LibreSSL) no lo necesita. Borra `release.key` cuando tengas el `.p12` guardado.

### Guardar los secretos

```sh
base64 -i release.p12 | pbcopy
```

En GitHub: **Settings > Secrets and variables > Actions > New repository secret**:

| Secreto | Valor |
|---|---|
| `MACOS_SELF_SIGNED_CERT_P12` | El `.p12` en base64 (lo que copió el comando anterior). |
| `MACOS_SELF_SIGNED_CERT_PASSWORD` | La contraseña del `.p12`. |

El flujo importa el certificado en un llavero temporal, firma con él (lo referencia por su huella
SHA-1, así que no hace falta que macOS confíe en él) y borra el llavero al terminar.

Al pasar de ad-hoc a autofirmado, los usuarios conceden Accesibilidad **una última vez**; a
partir de ahí se conserva.

## Actualizaciones automáticas (opcional, gratis)

El actualizador de Tauri verifica cada actualización con una firma propia (no tiene que ver con
Apple). Si no se configura, la app se publica **sin actualizador**: el flujo compila con
`createUpdaterArtifacts: false`, no sube `latest.json` y la app no hace ninguna petición de
actualización. Los usuarios descargan las nuevas versiones desde Releases.

Para activarlo:

```sh
npx tauri signer generate -w ~/.tauri/kaiflow.key
```

1. Elige una contraseña cuando la pida (o déjala vacía).
2. Copia la **clave pública** que imprime el comando (también queda en
   `~/.tauri/kaiflow.key.pub`) en `src-tauri/tauri.conf.json`, en lugar del marcador
   `REPLACE_WITH_UPDATER_PUBLIC_KEY`:

   ```json
   "plugins": { "updater": { "pubkey": "<clave pública>", "endpoints": [ ... ] } }
   ```

   El test `the_committed_config_ships_the_placeholder_and_the_release_endpoint` de
   `src-tauri/src/updater.rs` comprueba el marcador: actualízalo en el mismo cambio.
3. Guarda el contenido de `~/.tauri/kaiflow.key` en el secreto
   `TAURI_SIGNING_PRIVATE_KEY` y la contraseña en `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Guarda una copia de la clave privada fuera de línea.

El actualizador solo se activa con **las dos cosas**: clave pública real en la configuración y
clave privada en los secretos. Si falta una, el flujo compila sin actualizador (y fuerza el
marcador en esa compilación para que la app no consulte un `latest.json` inexistente).

> **Perder la clave privada** impide publicar actualizaciones que las versiones instaladas
> acepten: habría que distribuir una nueva versión a mano. Cambiar la clave pública tiene el
> mismo efecto. No la cambies sin necesidad.

La app comprueba actualizaciones al iniciar (tras 30 s) y cada 24 horas, y desde
Ajustes > Updates con "Check now". Esa petición y la descarga del archivo firmado son el único
tráfico de red de la app, aparte de la revisión semanal con IA si el usuario la activa.

## Notarización con Apple (opcional, de pago)

Si en algún momento hay cuenta de Apple Developer, basta con añadir estos secretos; el flujo
pasa solo al modo notarizado y además comprueba Gatekeeper (`spctl`) y el ticket grapado
(`stapler`):

| Secreto | Cómo obtenerlo |
|---|---|
| `APPLE_CERTIFICATE` | Certificado "Developer ID Application" exportado como `.p12`, en base64 (`base64 -i certificado.p12 \| pbcopy`). |
| `APPLE_CERTIFICATE_PASSWORD` | Contraseña del `.p12`. |
| `APPLE_SIGNING_IDENTITY` | `security find-identity -v -p codesigning`, por ejemplo `Developer ID Application: Nombre Apellido (ABCDE12345)`. |
| `APPLE_ID` | Correo de la cuenta de desarrollador. |
| `APPLE_PASSWORD` | Contraseña específica de app (appleid.apple.com > Inicio de sesión y seguridad). |
| `APPLE_TEAM_ID` | Identificador del equipo (10 caracteres). |

Cambiar de autofirmado a Developer ID cambia el requisito designado: los usuarios conceden
Accesibilidad una vez más.

## Primera apertura en macOS (lo que ven los usuarios)

Las notas de cada release y la web incluyen estos pasos:

1. Abrir el DMG y arrastrar **Kaiflow** a **Aplicaciones**.
2. Abrir la app una vez. macOS avisa de que no puede verificar al desarrollador. Pulsar
   **Listo** (o **Cancelar**) y luego:
   - **macOS 15 (Sequoia) o posterior**: **Ajustes del Sistema > Privacidad y seguridad**,
     bajar hasta **Seguridad**, pulsar **Abrir igualmente** junto al mensaje sobre Kaiflow
     Copilot y confirmar con **Abrir igualmente** y la contraseña.
   - **macOS 13 y 14**: en Finder, **Aplicaciones**, clic derecho (o Control + clic) en
     **Kaiflow** > **Abrir**, y de nuevo **Abrir** en el diálogo.
3. Conceder **Accesibilidad** cuando la app lo pida.

Alternativa **avanzada**, solo si se confía en la descarga (omite la comprobación de
Gatekeeper para esta app):

```sh
xattr -dr com.apple.quarantine "/Applications/Kaiflow.app"
```

## Publicar una versión

1. Subir la versión en `src-tauri/tauri.conf.json`, `Cargo.toml` (`[workspace.package]`) y
   `package.json` (la pantalla Ajustes > About muestra la de `package.json`).
2. Confirmar que `main` está en verde (CI) y crear la etiqueta:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Seguir la ejecución en la pestaña Actions. El resumen del job muestra el modo de firma, si el
   actualizador está activo y el requisito designado.
4. Antes de anunciarla, repasar `docs/checklists/release-clean-mac.md` en un Mac limpio.

## Windows y Linux (próximamente)

La app compila y registra en Windows y Linux (ver `docs/platform-support.md`) y CI la prueba en
los tres sistemas, pero `release.yml` todavía publica solo macOS. `bundle.targets` en
`src-tauri/tauri.conf.json` ya incluye todos los formatos; cada sistema genera solo los suyos:

| Sistema | Paquetes | Actualización automática |
|---|---|---|
| macOS | `.app` y DMG | Sí, si el actualizador está configurado (`.app.tar.gz` + `.sig`) |
| Windows | MSI (WiX) e instalador NSIS (`.exe`, por usuario, sin permisos de administrador) | Sí (el instalador + `.sig`) |
| Linux | AppImage y `.deb` | Solo AppImage (+ `.sig`); el `.deb` se actualiza reinstalando |

Para publicarlos, agregar a `release.yml` un segundo job con una matriz y mover el paso
"Publish the release" a un job propio con `needs: [macos, windows-linux]`, de modo que la
release siga en borrador hasta que terminen todos:

```yaml
  windows-linux:
    name: ${{ matrix.os }} (${{ github.ref_name }})
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-22.04]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
            librsvg2-dev libxdo-dev libssl-dev build-essential pkg-config
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: "1.93"
      - uses: Swatinem/rust-cache@v2
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: Kaiflow ${{ github.ref_name }}
          releaseDraft: true
          includeUpdaterJson: true
```

- Reutilizar el mismo archivo de configuración adicional (`--config`) que el job de macOS
  cuando el actualizador está desactivado.
- `tauri-action` agrega cada plataforma al mismo `latest.json`, así que el actualizador de cada
  sistema encuentra su entrada.
- **Windows sin firma de código**: SmartScreen avisará al instalar ("editor desconocido"). Para
  evitarlo hace falta un certificado de firma de código (o Azure Trusted Signing) configurado en
  `bundle.windows`.
- **Linux**: el AppImage y el `.deb` no llevan firma del sistema. El `.deb` declara
  `libayatana-appindicator3-1` como dependencia para el icono de la bandeja.

## Endurecimiento pendiente

El plugin ofrece `requireSignedVersion` (en `plugins.updater`): exige que la firma lleve la
versión para la que se firmó y evita que un `latest.json` manipulado fuerce una versión antigua
pero legítima. Activarlo tras la primera release con actualizador y comprobar que la
actualización de N a N+1 sigue funcionando.

## Cambio de nombre a Kaiflow (identificador `com.carlosleon.kaiflow`)

La app se llamaba Time Track Copilot, con el identificador `com.carlosleon.timetrack`. Al
cambiar el identificador:

- **Accesibilidad se pierde una vez en macOS.** macOS asocia el permiso al identificador, así
  que la primera versión de Kaiflow lo vuelve a pedir. Conviene quitar la entrada antigua de
  Ajustes del Sistema > Privacidad y seguridad > Accesibilidad.
- **Los datos se copian solos.** Al arrancar, antes de abrir SQLite, si la carpeta nueva
  (`~/Library/Application Support/com.carlosleon.kaiflow/` en macOS, `%APPDATA%` en Windows,
  `$XDG_DATA_HOME` en Linux) no tiene base de datos y existe la antigua
  (`com.carlosleon.timetrack/`), se copia su contenido (base de datos, WAL/SHM, copias
  `.bak-v*`, copias previas a restaurar y `backups/`), renombrando `timetrack.db*` a
  `kaiflow.db*`. La carpeta antigua no se toca y queda como respaldo (ver
  `src-tauri/src/data_migration.rs`).
- **Las claves de IA se mueven al leerlas.** Si no hay clave en el servicio del llavero
  `com.carlosleon.kaiflow` pero sí en el antiguo (`com.timetrack.copilot.ai`), se copia y la
  antigua se borra solo después de escribir la nueva. macOS puede pedir una vez permiso para
  leer la entrada antigua.
- **Las copias y exportaciones antiguas se siguen restaurando**: se acepta el `format`
  `timetrack` además de `kaiflow`, y las copias diarias `timetrack-backup-*.json.gz` cuentan
  para la retención igual que las nuevas `kaiflow-backup-*`.
- El elemento de inicio de sesión antiguo (si estaba activado) puede quedar en Ajustes del
  Sistema > General > Ítems de inicio; se puede quitar a mano.

## Notas

- Los permisos del actualizador no se conceden a ninguna ventana: la interfaz solo usa los
  comandos `update_check` y `update_install`.
- `tauri build` puede reescribir las `features` de `tauri-build` en `src-tauri/Cargo.toml`.
  Revertir ese cambio antes de hacer commit.
- La salida de compilación está en `target/` en la raíz (espacio de trabajo de Cargo), no en
  `src-tauri/target/`.
- Endpoint del actualizador:
  `https://github.com/CarlosLeonCode/kaiflow/releases/latest/download/latest.json`.
  En un fork, cámbialo en `src-tauri/tauri.conf.json` (ver `docs/forking.md`).
