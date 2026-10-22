# Checklist manual de la beta de Windows

Quién la ejecuta: el responsable de la release, con el instalador **publicado** por
`release.yml` (no una compilación local) en una máquina virtual con Windows 10 u 11 de 64 bits
(UTM o Parallels en un Mac, o un equipo real) donde Kaiflow nunca se haya instalado, o tras
desinstalarlo y borrar `%APPDATA%\com.carlosleon.kaiflow\`.

Marca cada punto con `[x]` cuando el resultado coincida con lo esperado. Si no coincide, déjalo
sin marcar, anota lo que viste y abre un issue (ver el final).

- Versión: ____ / Windows (edición y compilación, `winver`): ____ / Instalador (`-setup.exe` o `.msi`): ____ / Máquina: ____ / Fecha: ____

> **Privacidad:** los títulos de ventana pueden ser privados. Para las pruebas abre documentos y
> páginas de prueba (por ejemplo, un archivo `prueba-kaiflow.txt` en el Bloc de notas), y nunca
> copies títulos reales en notas, capturas ni issues.

## 1. Instalación

- [ ] Descargar `Kaiflow_<versión>_x64-setup.exe` desde la página de la release con el
      navegador. **Esperado:** se descarga sin errores (Edge puede pedir confirmar la descarga).
- [ ] Ejecutar el instalador. **Esperado:** SmartScreen muestra "Windows protegió su PC". Pulsar
      **Más información → Ejecutar de todas formas** permite continuar (exactamente como dicen
      las notas de la release).
- [ ] Completar el asistente. **Esperado:** no pide permisos de administrador (instalación por
      usuario) y crea el acceso directo en el menú Inicio.
- [ ] (Opcional, en otra VM o tras desinstalar) Repetir con el `.msi`. **Esperado:** instala sin
      errores; puede pedir permisos de administrador.
- [ ] Si WebView2 no estaba instalado (Windows 10 antiguo), el instalador lo descarga.
      **Esperado:** la app abre sin pantalla en blanco.

## 2. Primera apertura y bienvenida

- [ ] Abrir Kaiflow desde el menú Inicio. **Esperado:** aparece la ventana de bienvenida
      (pasos "Welcome", "Recording", "Ready") y el icono de Kaiflow en la bandeja del sistema
      (puede quedar oculto bajo la flecha **^**). La bienvenida dice "lives in your system tray"
      y "Everything stays on this computer".
- [ ] Recorrer los pasos con **Continue** y terminar con **Start tracking**. **Esperado:** el
      segundo paso muestra el interruptor "Record window titles" y el bloque "No permission
      needed"; no hay paso de Accesibilidad, ni botón "Open System Settings", ni oferta de
      reinicio. El último paso indica "Permission: None needed" y recuerda que **Open at login**
      se activa en Settings.
- [ ] **Esperado:** se crea `%APPDATA%\com.carlosleon.kaiflow\kaiflow.db`.

## 3. App y título de la ventana activa

- [ ] Alternar durante 1 minuto entre el Bloc de notas (con `prueba-kaiflow.txt`), el
      Explorador de archivos y Edge (con una página de prueba). **Esperado:** el popover y la
      vista Today muestran cada app con su nombre visible (por ejemplo "Notepad", "Microsoft
      Edge") y el tiempo crece en la app que está al frente.
- [ ] Cambiar de pestaña o de documento. **Esperado:** el título nuevo aparece en Today en
      menos de unos segundos.
- [ ] Abrir la Calculadora o Configuración. **Esperado (limitación conocida):** aparecen como
      `applicationframehost.exe` o similar; no es un fallo nuevo.
- [ ] Excluir una app u ocultar títulos en Privacy. **Esperado:** se respeta desde ese momento.

## 4. Bandeja del sistema y cuenta atrás

- [ ] Clic izquierdo en el icono. **Esperado:** se abre y se cierra el popover junto a la
      bandeja.
- [ ] Clic derecho en el icono. **Esperado:** menú con "Pause tracking", "Open Kaiflow" y
      "Quit". "Open Kaiflow" abre la ventana principal.
- [ ] Pasar el ratón sobre el icono. **Esperado:** el tooltip muestra "Kaiflow — " seguido del
      total del día o de la app actual (Windows no muestra texto junto al icono).
- [ ] Con un temporizador de enfoque en marcha, pasar el ratón sobre el icono. **Esperado:** el
      tooltip muestra la cuenta atrás y se actualiza.

## 5. Fin del temporizador de enfoque

- [ ] En Settings activar **Sound**. Iniciar un bloque de enfoque corto (el mínimo posible) y
      cerrar el popover.
- [ ] **Esperado:** un minuto antes llega el aviso "One minute left".
- [ ] **Esperado:** al terminar llega la notificación de Windows ("Focus block done" o "Time is
      up") **con sonido**, aunque el popover esté cerrado.
- [ ] Abrir el popover. **Esperado:** aparece la tarjeta de fin ("Focus done" o "Time is up")
      con "Start break" o "Start focus", "Skip" o "Done" y "+5 min", y cada botón funciona.
- [ ] Con el Asistente de concentración (No molestar) activado. **Esperado:** anotar si la
      notificación se muestra o queda en el centro de notificaciones.

## 6. Inactividad y vuelta

- [ ] En Settings > Idle bajar "Idle after" al mínimo. No tocar teclado ni ratón durante más de
      ese tiempo y del tiempo de "Skip the prompt for short breaks".
- [ ] Volver a mover el ratón. **Esperado:** notificación "Welcome back" y, en el popover, la
      tarjeta "You were away for …" con "Discard", "Assign to previous app" y "Assign to
      activity…".
- [ ] Elegir cada opción en intentos distintos. **Esperado:** Today refleja la decisión (hueco,
      tiempo en la app anterior o en la actividad).

## 7. Bloqueo y suspensión

- [ ] Bloquear con **Win + L** durante 1 minuto y desbloquear. **Esperado:** ese tiempo no se
      cuenta como uso de ninguna app.
- [ ] Suspender la VM o el equipo (Inicio > Apagado > Suspender) y reanudar. **Esperado:** el
      tiempo suspendido no se cuenta y el registro continúa solo al volver.
- [ ] Cerrar sesión o apagar con Kaiflow abierto. **Esperado:** al volver a abrirla, el último
      tramo se guardó bien (sin un tramo enorme hasta el arranque siguiente).

## 8. Inicio automático

- [ ] Activar Settings > Tracking > **Open at login** y reiniciar Windows. **Esperado:** Kaiflow
      arranca sola y aparece en la bandeja (también en Administrador de tareas > Aplicaciones
      de arranque).
- [ ] Desactivarlo y reiniciar. **Esperado:** ya no arranca sola.

## 9. Una sola instancia

- [ ] Con Kaiflow abierta, abrirla otra vez desde el menú Inicio. **Esperado:** no se crea un
      segundo icono en la bandeja ni un segundo proceso; se muestra y enfoca la ventana
      principal existente.

## 10. Atajo global

- [ ] Probar el atajo de pausar y reanudar (por defecto `Ctrl+Alt+Shift+K` en una instalación
      nueva). **Esperado:** pausa y reanuda el registro; el popover, Settings y el menú de la
      bandeja lo muestran como `Ctrl+Alt+Shift+K`. Anotar si choca con algún atajo de Windows o
      de una app instalada.
- [ ] Settings > Tracking: grabar otro atajo y pulsar **Reset shortcut to default**.
      **Esperado:** vuelve a `Ctrl+Alt+Shift+K`.

## 11. Copias de seguridad y exportación

- [ ] Settings > Data > **Back up now**. **Esperado:** aparece un archivo
      `kaiflow-backup-*.json.gz` en la carpeta de copias y se actualiza "Last backup".
- [ ] Exportar desde Overview. **Esperado:** se guarda un JSON que se abre sin errores.
- [ ] **Restore from file…** con la copia anterior y confirmar con "Restore and replace".
      **Esperado:** los datos vuelven al estado de la copia.

## 12. Desinstalación

- [ ] Configuración > Aplicaciones > Kaiflow > Desinstalar. **Esperado:** se desinstala sin
      errores, desaparece del menú Inicio y de la bandeja, y no queda en las aplicaciones de
      arranque.
- [ ] **Esperado:** `%APPDATA%\com.carlosleon.kaiflow\` se conserva (los datos no se borran
      sin pedirlo); borrarla a mano si se quiere empezar de cero.

## Cómo informar de un fallo

Abre un issue en https://github.com/CarlosLeonCode/kaiflow/issues con:

- Versión de Kaiflow (Settings > About) y paquete usado (`-setup.exe` o `.msi`).
- Edición y compilación de Windows (`winver`) y si es una VM (UTM, Parallels...) o un equipo
  real.
- El punto de esta lista que falla, lo esperado y lo que pasó, y los pasos para reproducirlo.
- Capturas solo si no muestran datos privados.

**Nunca pegues títulos de ventana reales** (ni en el texto ni en capturas): pueden contener
nombres de documentos, clientes o mensajes. Usa los archivos de prueba o reemplázalos por
`<título>`.
