# Spike de la Fase 2: APIs nativas de macOS (tarea 2.1)

Fecha: 2026-10-19/20. Equipo: macOS 26.6.2 (Darwin 25.6), Apple Silicon, Rust 1.90.
Alcance: verificar cada suposicion del diseno (secciones 6, 11 y 12) antes de escribir el
codigo de produccion de `adapters-macos`. Las sondas fueron programas desechables fuera del
repositorio; el codigo de produccion resultante esta en `crates/adapters-macos`.

Leyenda: **Verificado** = ejecutado en esta maquina. **Documentado** = confirmado en
documentacion o codigo fuente de terceros, no ejecutado aqui. **Pendiente** = requiere la
checklist manual de la tarea 2.9.

## Resumen

| Tema | Resultado | Estado |
|---|---|---|
| Deep link de Accesibilidad | Funciona; abre Ajustes del Sistema | Verificado |
| Notificaciones de bloqueo `com.apple.screenIsLocked` / `screenIsUnlocked` | Nombres vigentes (los usa Hammerspoon en `master`) | Documentado; disparo real pendiente (2.9) |
| `CGEventSource::seconds_since_last_event_type` | Funciona sin permisos; el comportamiento tras despertar no se pudo forzar | Verificado (llamada) / Pendiente (tras wake) |
| `NSRunningApplication` fuera del hilo principal | Funciona (lectura de bundle id, nombre y pid) | Verificado |
| Observers de `NSWorkspace` (`didActivate`, `didTerminate`) | Entregados en el hilo principal con bloques; mapa pid -> identidad correcto | Verificado |
| `willSleep` / `didWake` / `willPowerOff` | Mismo mecanismo que `didActivate`; no se durmio el equipo | Pendiente (2.9) |
| Entitlements con hardened runtime | No hacen falta para las APIs usadas; `Entitlements.plist` vacio y sin Sandbox | Verificado (arranque con `--options runtime`) |
| Versiones `objc2*` | Ver tabla de versiones | Verificado (compila) |
| `tauri-plugin-positioner` | Estable 2.4.0; no se adopta | Documentado |

## 1. Deep link de Accesibilidad

`open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`
devuelve codigo 0 y lanza "Ajustes del Sistema" (proceso creado; no estaba abierto antes). La
URL se abre con `/usr/bin/open` desde `MacPermissionProvider::open_settings`, con una
constante, sin entrada del usuario (matriz de amenazas N/A).

Nota de la sonda: pedir la ventana a Ajustes con `osascript` dispara un aviso de
Automatizacion; no se usa en produccion (solo `open`). No se verifica la ventana por
Automatizacion por la misma razon.

## 2. Bloqueo y desbloqueo de pantalla

Nombres: `com.apple.screenIsLocked` y `com.apple.screenIsUnlocked`, publicados en el
`NSDistributedNotificationCenter`. Evidencia: `libcaffeinate_watcher.m` de Hammerspoon (rama
`master`) los registra junto con `com.apple.screensaver.didstart/willstop/didstop`. No existe
constante publica; no estan en los binarios del sistema como cadenas (viven en la cache
compartida de dyld), por lo que `strings` no sirve como verificacion.

La sonda registro ambos observers con `addObserverForName:object:queue:usingBlock:` sin error
(el registro no valida el nombre). Bloquear la pantalla del usuario durante la sonda se
descarto por intrusivo: **queda en la checklist 2.9** (bloquear con Ctrl+Cmd+Q y comprobar que
llegan ambos eventos). Mitigaciones ya en el diseno: la fila de respaldo de la maquina
(`ActivityResumed` con `locked` implica desbloqueo) y el salto de heartbeat > 60 s.

Decision: los observers de bloqueo se implementan en `lock.rs` (tarea 2.5), no en
`workspace_observer.rs`. Si en 2.9 no llegaran, se anade `com.apple.screensaver.didstart` /
`didstop` como senal secundaria.

## 3. Inactividad: `CGEventSource::seconds_since_last_event_type`

API: `objc2_core_graphics::CGEventSource::seconds_since_last_event_type(
CGEventSourceStateID::CombinedSessionState, CGEventType(u32::MAX))` (`kCGAnyInputEventType` es
`~0`; el crate no lo expone como constante). Devuelve `f64` segundos. Verificado: 15,9 s y
183,1 s en dos ejecuciones, sin permiso de Accesibilidad ni de Monitorizacion de entrada
(la lectura del contador combinado no los requiere).

Tras despertar: no se pudo forzar un sleep real del equipo del usuario. El contador cuenta
desde el ultimo evento HID de la sesion; si se despierta con una tecla o el raton, vale ~0 s
y el diseno ya acota `since` a la hora de despertar (seccion 4: "el `since` de inactividad se
acota a >= hora de despertar"). Si se despierta sin evento HID (reloj/red) el valor puede ser
grande: el acotado lo neutraliza. **Pendiente en 2.9** (dormir, despertar con el raton, leer).

## 4. `NSRunningApplication` fuera del hilo principal

Una hebra `std::thread` leyo `NSWorkspace::sharedWorkspace().frontmostApplication()` y luego
`bundleIdentifier`, `localizedName` y `processIdentifier` sin problemas (bundle id
`com.anthropic.claudefordesktop`, nombre `Claude`, pid 3669). Esto coincide con la
documentacion: `NSRunningApplication` es de solo lectura y seguro entre hilos, a diferencia
de otros objetos de AppKit.

Consecuencia para el diseno: el mapa `pid -> (bundle, nombre)` sigue siendo la fuente
primaria (evita llamadas repetidas y sobrevive a terminaciones), pero el fallo de cache puede
resolverse directamente desde el hilo sampler con
`NSRunningApplication::runningApplicationWithProcessIdentifier`; **no hace falta
`run_on_main_thread`**. Se simplifica el diseno de la seccion 6.

## 5. Observers de `NSWorkspace`

Sonda: `WorkspaceObserver::install` en el hilo principal, bucle `NSRunLoop` manual 12 s y
activaciones provocadas con `osascript`/`open`:

- `didActivateApplication`: Finder, Calculator y de nuevo Finder llegaron en orden con
  bundle id, nombre y pid correctos; el mapa los resolvio inmediatamente.
- `didTerminateApplication` (anadido ademas de los cuatro pedidos): al salir Calculator su
  entrada se elimino (tamano final 2: la app activa inicial y Finder). Evita crecimiento del
  mapa y la reutilizacion de pid.
- Un proceso CLI (la sonda) recibe estas notificaciones con solo un run loop; no hace falta
  `NSApplication`. En la app Tauri el run loop es el de `tao`.
- Los bloques se instalan con `queue: None`: se ejecutan en el hilo que publica (el
  principal para `NSWorkspace`). Solo extraen valores y envian por canal.
- Aplicaciones sin bundle id (demonios, ejecutables sueltos) se omiten: el dominio exige
  `app_id` en segmentos `Tracked`.

`willSleep` / `didWake` / `willPowerOff` usan exactamente el mismo `observe(...)`; solo
cambia la senal enviada (`power_signal`, probada como funcion pura). Disparo real: 2.9.

Limitacion de las pruebas: `cargo test` ejecuta las pruebas fuera del hilo principal, por lo
que el observer real no se puede ejercitar ahi; se cubre con la sonda y con la checklist.
La logica pura (mapa, mapeo de senales, identidad) tiene pruebas normales.

## 6. Entitlements y hardened runtime

`AXIsProcessTrusted*`, `NSWorkspace` y `CGEventSource` no requieren entitlements. Sin
App Sandbox (obligatorio: Accesibilidad no esta disponible en el sandbox). Verificado:

- Binario de la sonda firmado con `codesign --options runtime` (flags `adhoc,runtime`) sin
  entitlements: arranca y ejecuta las tres APIs (observer, idle, lectura de confianza AX).
- El `.app` generado por `tauri build --debug --bundles app` con `Entitlements.plist` vacio,
  re-firmado con `--options runtime --entitlements src-tauri/Entitlements.plist` (flags
  `adhoc,runtime`), pasa `codesign --verify --deep --strict`. Identifier
  `com.carlosleon.timetrack`, `LSUIElement=true`.
- WKWebView ejecuta JIT en procesos propios del sistema (WebContent), no en el de la app: no
  hace falta `com.apple.security.cs.allow-jit`.

El permiso de Accesibilidad no se pudo probar con identidad estable: no existe aun la
identidad "TimeTrack Dev" (la crea el usuario, ver `scripts/create-dev-identity.md`). La
concesion y la persistencia entre builds firmados quedan en 2.9.

Firma en `tauri.conf.json`: Tauri lee la identidad de la variable de entorno
`APPLE_SIGNING_IDENTITY`, por lo que `signingIdentity` no se escribe en el archivo.
`scripts/dev-sign.sh` la exporta; `hardenedRuntime` (true) y `entitlements` si van en la
configuracion. Sin identidad, `tauri build` deja el binario sin firmar de forma estable
(`linker-signed`), por eso el script exige la identidad.

## 7. Versiones y APIs

| Crate | Version | Uso |
|---|---|---|
| `objc2` | 0.6.5 | `MainThreadMarker`, `Retained`, `downcast` |
| `block2` | 0.6.2 | `RcBlock` para observers |
| `objc2-foundation` | 0.3.2 | `NSNotification*`, `NSDictionary`; features `block2`, `NSOperation` obligatorias para `addObserverForName...` |
| `objc2-app-kit` | 0.3.2 | `NSWorkspace`, `NSRunningApplication` (feature `libc` para `processIdentifier`) |
| `objc2-application-services` | 0.3.2 | `AXIsProcessTrustedWithOptions`, `kAXTrustedCheckOptionPrompt`, `AXUIElement` (features `HIServices` y `AXUIElement`) |
| `objc2-core-foundation` | 0.3.2 | `CFDictionary::from_slices`, `CFBoolean` |
| `objc2-core-graphics` | 0.3.2 | `CGEventSource` (features `CGEventSource`, `CGEventTypes`) para 2.5 |

Notas para la tarea 2.4 (AX): `AXUIElement::new_application(pid)`, `copy_attribute_value` y
`set_messaging_timeout` existen; las constantes de atributo (`kAXFocusedWindowAttribute`,
`kAXTitleAttribute`) son macros de C y **no** estan enlazadas: usar
`CFString::from_static_str("AXFocusedWindow")` y `"AXTitle"`.

Comprobacion de permiso: `AXIsProcessTrustedWithOptions(NULL)` no muestra interfaz; con
`{kAXTrustedCheckOptionPrompt: true}` muestra el aviso del sistema de forma asincrona sin
cambiar el valor devuelto. Verificado el modo sin interfaz (`Denied` para la sonda, esperado
al no estar concedida).

Reinicio tras conceder (`app_restart`): `tauri::AppHandle::restart` hace `exec` y conserva el
pid; la cache de confianza de AX del proceso puede persistir. Se anade
`permission::spawn_relaunch`, que usa `open -n <bundle>` (nueva instancia con pid nuevo) y
exige que el proceso salga despues. Fuera de un `.app` (`cargo run`) cae a `restart` de Tauri.
La integracion en `app_restart` se hace al cablear los adaptadores en `src-tauri`.

## 8. `tauri-plugin-positioner`

Estable `2.4.0` (existen `3.0.0-alpha.*`, descartadas como el resto de Tauri 3). La Fase 1
ya posiciona el popover con calculo propio a partir del rectangulo del tray. **Decision:** no
anadir el plugin; menos dependencia y menos superficie de permisos (R6.5). Reabrir solo si
el calculo propio falla en monitores multiples (comprobar en 2.9).

## Ajustes al diseno

1. Seccion 6: el sampler resuelve fallos de cache de `NSRunningApplication` por si mismo; se
   elimina `run_on_main_thread` de la ruta.
2. Seccion 6: el observer tambien escucha `didTerminateApplication` para podar el mapa.
3. Las activaciones no van al motor: `WorkspaceObserver::activations()` las entrega al sampler
   (2.4), que emite `Focus` con titulo AX; las senales de energia si van al canal del motor.
4. Seccion 10: positioner no se adopta (calculo propio).
5. Seccion 12: la identidad de firma llega por `APPLE_SIGNING_IDENTITY`, no por
   `tauri.conf.json`.

## Pendiente para la checklist 2.9

- Bloquear/desbloquear la pantalla y comprobar `screenIsLocked/Unlocked`.
- Dormir/despertar: `willSleep`, `didWake` y valor de `seconds_since_last_event_type` tras
  despertar con raton y sin evento HID.
- Concesion de Accesibilidad con la app firmada "TimeTrack Dev" y persistencia tras un
  rebuild (mismo requisito designado, ver salida de `scripts/dev-sign.sh`).
- Revocacion con la app en marcha y `app_restart` con `spawn_relaunch`.
