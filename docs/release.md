# Publicar una version (firma, notarizacion y actualizaciones)

Este documento describe como se publica Time Track Copilot y que hay que configurar una sola
vez. El flujo esta en `.github/workflows/release.yml`; la logica de actualizacion de la app
esta en `src-tauri/src/updater.rs`.

## Como funciona

1. Se sube una etiqueta `vX.Y.Z` (debe coincidir con `version` de `src-tauri/tauri.conf.json`).
2. GitHub Actions compila la app universal (`aarch64` + `x86_64`) con `tauri-action`.
3. Con los secretos de Apple presentes, la app se firma con Developer ID, con hardened runtime
   y se notariza. Despues se verifican `codesign`, Gatekeeper (`spctl`) y el ticket grapado
   (`stapler`).
4. Se generan el DMG, el archivo de actualizacion (`.app.tar.gz` + `.sig`, firmado con la clave
   del actualizador) y `latest.json`.
5. La release se crea como **borrador** y solo se publica cuando las verificaciones pasan. Asi
   `releases/latest/download/latest.json` (el endpoint del actualizador) nunca apunta a una
   compilacion sin verificar.

La app comprueba actualizaciones al iniciar (tras 30 s) y cada 24 horas, y desde
Ajustes > Updates con "Check now". Esa peticion a `latest.json` y la descarga del archivo
firmado son el unico trafico de red de la app. Instalar reinicia la app; el seguimiento se
reanuda solo.

## Secretos del repositorio

Se configuran en GitHub: Settings > Secrets and variables > Actions > New repository secret.
Ningun secreto se guarda en el repositorio.

| Secreto | Para que sirve | Como obtenerlo |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Firma los archivos de actualizacion. **Obligatorio**: sin el, la compilacion falla. | Contenido del archivo generado en "Clave del actualizador" (abajo). |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Contrasena de esa clave (vacio si no se puso). | La que se eligio al generarla. |
| `APPLE_CERTIFICATE` | Certificado "Developer ID Application" en base64. | Exportar el certificado con su clave privada desde Acceso a Llaveros como `.p12` y ejecutar `base64 -i certificado.p12 \| pbcopy`. |
| `APPLE_CERTIFICATE_PASSWORD` | Contrasena del `.p12`. | La elegida al exportarlo. |
| `APPLE_SIGNING_IDENTITY` | Nombre de la identidad de firma. | `security find-identity -v -p codesigning`, por ejemplo `Developer ID Application: Nombre Apellido (ABCDE12345)`. |
| `APPLE_ID` | Apple ID de la cuenta de desarrollador. | El correo de la cuenta. |
| `APPLE_PASSWORD` | Contrasena **especifica de aplicacion** para notarizar. | appleid.apple.com > Inicio de sesion y seguridad > Contrasenas especificas de apps. |
| `APPLE_TEAM_ID` | Identificador del equipo (10 caracteres). | developer.apple.com > Cuenta > Membresia. |

Si falta alguno de los seis secretos de Apple, el flujo **no falla**: genera una app con firma
ad-hoc, sin notarizar, deja la release como borrador y muestra un aviso visible (anotacion de
la ejecucion y resumen del job). Esa compilacion sirve para probar, no para distribuir: macOS
mostrara avisos de Gatekeeper y el permiso de Accesibilidad no se conservara entre versiones
porque la identidad de firma cambia.

## Clave del actualizador (una sola vez)

La clave publica va en la configuracion; la privada nunca sale de los secretos y de una copia
fuera de linea.

```sh
npx tauri signer generate -w ~/.tauri/time-track-copilot.key
```

1. Elegir una contrasena cuando la pida (o dejarla vacia).
2. Copiar la **clave publica** que imprime el comando (tambien queda en `~/.tauri/time-track-copilot.key.pub`)
   en `src-tauri/tauri.conf.json`, sustituyendo el marcador:

   ```json
   "plugins": { "updater": { "pubkey": "<clave publica>", "endpoints": [ ... ] } }
   ```

3. Guardar el contenido de `~/.tauri/time-track-copilot.key` en el secreto
   `TAURI_SIGNING_PRIVATE_KEY` y la contrasena en `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Guardar una copia de la clave privada fuera de linea (gestor de contrasenas o disco
   cifrado).

Mientras `pubkey` sea el marcador `REPLACE_WITH_UPDATER_PUBLIC_KEY`, la app **no hace ninguna
peticion de actualizacion** y el flujo de release se detiene con un error explicito.

> **Perder la clave privada** impide publicar actualizaciones que las versiones ya instaladas
> acepten: habria que distribuir una nueva version a mano. Cambiar la clave publica tiene el
> mismo efecto sobre las instalaciones existentes. No la cambies sin necesidad.

## Publicar una version

1. Subir la version en `src-tauri/tauri.conf.json`, `Cargo.toml` (`[workspace.package]`) y
   `package.json`.
2. Confirmar que `main` esta verde (CI) y crear la etiqueta:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Seguir la ejecucion en la pestana Actions. Al terminar, la release pasa de borrador a
   publicada y las instalaciones existentes la detectan en su siguiente comprobacion.
4. Antes de anunciarla, repasar `docs/checklists/release-clean-mac.md` en un Mac limpio.

## Windows y Linux

La app compila y rastrea en Windows y Linux (ver `docs/platform-support.md`) y CI la prueba en
los tres sistemas, pero `release.yml` todavia publica solo macOS. `bundle.targets` en
`src-tauri/tauri.conf.json` ya incluye todos los formatos; cada sistema genera solo los suyos:

| Sistema | Paquetes | Actualizacion automatica |
|---|---|---|
| macOS | `.app` y DMG (sin cambios: firma Developer ID y notarizacion como arriba) | Si (`.app.tar.gz` + `.sig`) |
| Windows | MSI (WiX) e instalador NSIS (`.exe`, por usuario, sin permisos de administrador) | Si (el instalador + `.sig`) |
| Linux | AppImage y `.deb` | Solo AppImage (+ `.sig`); el `.deb` se actualiza reinstalando |

Para publicarlos, agregar a `release.yml` un segundo job con una matriz y hacer que el paso
que publica la release espere a todos los jobs:

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
          releaseName: Time Track Copilot ${{ github.ref_name }}
          releaseDraft: true
          includeUpdaterJson: true
```

- `tauri-action` agrega cada plataforma al mismo `latest.json` de la release, asi que el
  actualizador de cada sistema encuentra su entrada. Por eso la release debe seguir siendo un
  borrador hasta que terminen todos los jobs: el paso "Publish the release" del job de macOS
  pasa a un job propio con `needs: [macos, windows-linux]`.
- Se usa la misma clave del actualizador (`TAURI_SIGNING_PRIVATE_KEY`) en los tres sistemas.
- **Windows sin firma de codigo**: SmartScreen avisara al instalar ("editor desconocido")
  hasta que el instalador se firme. Para firmarlo hace falta un certificado de firma de codigo
  (o Azure Trusted Signing) configurado en `bundle.windows` (`certificateThumbprint` o
  `signCommand`). La firma de macOS no cambia.
- **Linux**: el AppImage y el `.deb` no llevan firma del sistema. El `.deb` declara
  `libayatana-appindicator3-1` como dependencia para el icono de la bandeja.
- El job de macOS no cambia: sigue compilando la app universal, firmando y notarizando con los
  mismos secretos.

## Endurecimiento pendiente

El plugin ofrece `requireSignedVersion` (en `plugins.updater`): exige que la firma lleve la
version para la que se firmo y evita que un `latest.json` manipulado fuerce una version
antigua pero legitima. No esta activado porque exige que la CLI de Tauri registre la version en
el comentario firmado y eso no se ha podido comprobar sin generar claves. Tras publicar la
primera release de prueba, activarlo y comprobar que la actualizacion N a N+1 sigue
funcionando.

## Notas

- Los permisos del actualizador no se conceden a ninguna ventana: la interfaz solo usa los
  comandos `update_check` y `update_install` (R6.5).
- `tauri build` puede reescribir las `features` de `tauri-build` en `src-tauri/Cargo.toml`.
  Revertir ese cambio antes de hacer commit.
- Endpoint: `https://github.com/CarlosLeonCode/time-track-copilot/releases/latest/download/latest.json`.
  Si el repositorio cambia de dueno o nombre, actualizarlo en `src-tauri/tauri.conf.json`.
