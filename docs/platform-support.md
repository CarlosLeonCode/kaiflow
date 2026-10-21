# Soporte por sistema operativo

Kaiflow rastrea la aplicacion y la ventana en primer plano en macOS, Windows y Linux.
La logica de decision (cuando cambia el foco, cuando empieza y termina la inactividad, el pulso
de 2 s) es la misma en los tres sistemas y vive en `crates/adapters-common`; cada sistema solo
aporta como leer la ventana activa, su titulo, el contador de inactividad y los avisos de
suspension y bloqueo.

## Descargas

| Sistema | Estado | Paquetes en GitHub Releases |
|---|---|---|
| macOS 13+ | Publicado | DMG universal |
| Windows 10/11 (x64) | **Beta** | Instalador NSIS (`*_x64-setup.exe`, por usuario) y MSI, sin firma de codigo |
| Linux x86_64 | **Beta** | AppImage y `.deb` (compilados en Ubuntu 22.04), sin firma |

"Beta" significa que se compilan y prueban en CI igual que macOS, pero se han probado menos en
equipos reales. Las listas de prueba manual estan en `docs/checklists/beta-windows.md` y
`docs/checklists/beta-linux.md`.

| Crate | Sistema |
|---|---|
| `crates/adapters-macos` | macOS: NSWorkspace, Accesibilidad (AX), CGEventSource |
| `crates/adapters-windows` | Windows: Win32 (`GetForegroundWindow`, WinEvents, sesion y energia) |
| `crates/adapters-linux` | Linux: X11 con `x11rb`, logind y GNOME Mutter por D-Bus con `zbus` |

## Resumen

| Funcion | macOS | Windows | Linux X11 | Linux Wayland |
|---|---|---|---|---|
| App en primer plano | Si | Si | Si | No |
| Titulo de la ventana | Si, con permiso de Accesibilidad | Si, sin permiso | Si, sin permiso | No |
| Inactividad | Si | Si | Si | Si (GNOME o logind) |
| Bloqueo de pantalla | Si | Si | Si (logind) | Si (logind) |
| Suspension y reanudacion | Si | Si | Si (logind) | Si (logind) |
| Apagado o cierre de sesion | Si | Si | Si (logind) | Si (logind) |
| Texto junto al icono de la bandeja | Titulo del item de la barra de menus | No: solo tooltip | Etiqueta de AppIndicator | Etiqueta de AppIndicator |

## macOS

- La app se detecta con las notificaciones de `NSWorkspace` y el titulo con la API de
  Accesibilidad. Sin ese permiso solo se registran nombres de apps y la interfaz muestra el
  aviso "Window titles are off" con un boton a Ajustes del Sistema.
- La inactividad se lee de `CGEventSource` y no necesita permisos.
- La app vive en la barra de menus (sin icono en el Dock). El texto de la bandeja se muestra
  como titulo del item.

## Windows

- **Ventana activa**: `GetForegroundWindow` en cada ciclo de 2 s, mas un gancho
  `EVENT_SYSTEM_FOREGROUND` que avisa del cambio de app al instante. Si el gancho no llega, el
  sondeo lo corrige en el siguiente ciclo.
- **Aplicacion**: proceso dueno de la ventana (`GetWindowThreadProcessId` y
  `QueryFullProcessImageNameW`). El identificador es el nombre del ejecutable en minusculas
  (`code.exe`), no la ruta completa, para que una app que se instala en carpetas con version
  (`app-1.0.9\Discord.exe`) no se divida en varias tras cada actualizacion. El nombre visible es
  la descripcion del ejecutable ("Visual Studio Code") o, si no tiene, el nombre del archivo sin
  `.exe`.
- **Titulo**: `GetWindowTextW`. No necesita permisos y no se bloquea si la app no responde.
- **Inactividad**: `GetLastInputInfo` y `GetTickCount64`.
- **Bloqueo y energia**: una ventana oculta recibe `WM_WTSSESSION_CHANGE` (bloqueo y
  desbloqueo), `WM_POWERBROADCAST` (suspension y reanudacion) y `WM_ENDSESSION` (apagado o
  cierre de sesion). Es una ventana de nivel superior que nunca se muestra, no una ventana
  "solo mensajes", porque estas ultimas no reciben los mensajes de difusion de energia.
- **Permisos**: ninguno. El estado de permiso es siempre "concedido".
- **Bandeja**: Windows no admite texto junto al icono; el total del dia o la app actual se
  muestran en el tooltip.
- **Limitaciones conocidas**: las apps UWP (Calculadora, Configuracion...) aparecen como
  `applicationframehost.exe`; las ventanas de procesos con mas privilegios pueden no revelar
  su ejecutable y en ese caso no se registran.

## Linux

El modo se decide una vez al iniciar:

| Sesion | Modo | Que se registra |
|---|---|---|
| X11 (Xorg) con un gestor de ventanas EWMH | X11 | Todo |
| Wayland sin una ventana activa X11 utilizable | Degradado (Wayland) | Inactividad, bloqueo y suspension |
| Sin servidor grafico | Degradado (sin pantalla) | Bloqueo y suspension |

### Sesiones X11

- **Ventana activa**: `_NET_ACTIVE_WINDOW` en la ventana raiz, con eventos `PropertyNotify`
  para los cambios inmediatos y sondeo en cada ciclo como respaldo.
- **Titulo**: `_NET_WM_NAME` (UTF-8) y, si falta, `WM_NAME`.
- **Aplicacion**: `WM_CLASS` (la clase, en minusculas, es el identificador) y `_NET_WM_PID`
  para leer el nombre del proceso en `/proc/<pid>/exe` o `/proc/<pid>/comm` cuando la ventana no
  declara clase. El nombre visible se deriva de la clase (`google-chrome` pasa a
  "Google Chrome").
- **Inactividad**: extension MIT-SCREEN-SAVER (`ms_since_user_input`).
- Se usa `x11rb` en Rust puro: no se enlaza con `libX11`.

### Sesiones Wayland

Wayland no permite que una aplicacion vea que ventana de otra aplicacion esta en primer plano.
Cuando la sesion es Wayland (`WAYLAND_DISPLAY` o `XDG_SESSION_TYPE=wayland`) y X11 no ofrece una
ventana activa real, el rastreo queda **degradado**:

- No se registra tiempo por app ni titulos. La interfaz muestra el aviso "Window tracking is
  unavailable on Wayland" con la explicacion; no ofrece abrir ajustes porque no hay ningun
  permiso que conceder.
- La inactividad sigue funcionando con `org.gnome.Mutter.IdleMonitor` (GNOME) o, en otros
  escritorios, con `IdleHint` de logind (menos preciso: depende del retardo de inactividad del
  escritorio).
- Xwayland no cuenta como ventana activa utilizable: solo ve las apps X11 y atribuiria a la
  ultima de ellas el tiempo pasado en apps Wayland nativas. Con Xwayland 23.1 o posterior se
  detecta por su extension `XWAYLAND`.
- Para rastrear apps y titulos: iniciar sesion en "GNOME sobre Xorg" (u otra sesion X11). Una
  extension de GNOME Shell que publique la ventana enfocada por D-Bus permitiria rastrear en
  Wayland; no esta implementado.

### Suspension, bloqueo y apagado (logind)

- `PrepareForSleep` y `PrepareForShutdown` del gestor de logind, y `Lock`/`Unlock` y el
  cambio de `LockedHint` de la sesion propia (`XDG_SESSION_ID`, o la sesion `auto`).
- Se compila con la feature `logind` del crate `adapters-linux` (activada por defecto). `zbus`
  ya forma parte de las dependencias de Linux por el plugin de notificaciones, asi que el coste
  es bajo. Sin la feature solo quedan el foco y la inactividad de X11.
- Sin bus del sistema (contenedores) se registra un aviso y la app sigue sin esas senales.

### Bandeja

La bandeja usa AppIndicator (`libayatana-appindicator3`); el texto aparece como etiqueta junto
al icono en los escritorios que la muestran (por ejemplo Ubuntu con la extension de
AppIndicator). GNOME sin esa extension no muestra iconos de bandeja.

## Comprobaciones

- Las partes puras (lectura de `WM_CLASS` y titulos, nombres de ejecutables, calculo de
  inactividad, decision de Wayland, traduccion de eventos) tienen pruebas que corren en los
  tres sistemas con `cargo test --workspace`.
- Las pruebas que necesitan una sesion grafica real estan marcadas con `#[ignore]`. En CI,
  Linux ejecuta la prueba X11 bajo Xvfb:
  `xvfb-run --auto-servernum cargo test -p adapters-linux -- --ignored`.
- CI (`.github/workflows/ci.yml`) ejecuta clippy, pruebas y `cargo build -p kaiflow` en
  macOS, Ubuntu 22.04 y Windows.
