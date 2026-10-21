# Checklist manual de la beta de Linux

Quién la ejecuta: el responsable de la release, con el AppImage y el `.deb` **publicados** por
`release.yml` (no una compilación local) en una máquina virtual (UTM o Parallels en un Mac, o un
equipo real) con Ubuntu 22.04 o posterior (x86_64), donde Kaiflow nunca se haya instalado o tras
desinstalarlo y borrar `~/.local/share/com.carlosleon.kaiflow/`.

Lo ideal es probar dos sesiones: **GNOME sobre Xorg (X11)**, con seguimiento completo, y
**Ubuntu por defecto (Wayland)**, con seguimiento limitado.

Marca cada punto con `[x]` cuando el resultado coincida con lo esperado. Si no coincide, déjalo
sin marcar, anota lo que viste y abre un issue (ver el final).

- Versión: ____ / Distribución y versión (`cat /etc/os-release`): ____ / Escritorio: ____ / Sesión (`echo $XDG_SESSION_TYPE`): ____ / Paquete (AppImage o `.deb`): ____ / Máquina: ____ / Fecha: ____

> **Privacidad:** los títulos de ventana pueden ser privados. Para las pruebas abre documentos y
> páginas de prueba (por ejemplo, un archivo `prueba-kaiflow.txt` en el editor de texto), y
> nunca copies títulos reales en notas, capturas ni issues.

## 0. Tipo de sesión y bandeja

- [ ] En una terminal, `echo $XDG_SESSION_TYPE`. **Esperado:** `x11` en "GNOME sobre Xorg" (se
      elige con el engranaje de la pantalla de inicio de sesión) o `wayland` en la sesión por
      defecto. Anotarlo arriba.
- [ ] GNOME: comprobar que la extensión **AppIndicator** está activa (en Ubuntu viene
      preinstalada como "Ubuntu AppIndicators"; en otras distribuciones, instalar
      "AppIndicator and KStatusNotifierItem Support"). **Esperado:** sin ella no hay icono en la
      bandeja; con ella, sí.

## 1. Instalación

- [ ] AppImage: descargarlo y ejecutar `chmod +x Kaiflow_*.AppImage && ./Kaiflow_*.AppImage`.
      **Esperado:** la app abre. Si falla por FUSE, anotar el error (en Ubuntu 22.04 hace falta
      `libfuse2`; en 24.04, `libfuse2t64`).
- [ ] `.deb` (en otra VM o tras desinstalar el AppImage): `sudo apt install ./Kaiflow_*.deb`.
      **Esperado:** instala las dependencias (`libwebkit2gtk-4.1-0`, `libgtk-3-0`,
      `libayatana-appindicator3-1`) sin errores y Kaiflow aparece en el lanzador de
      aplicaciones con su icono.

## 2. Primera apertura y bienvenida

- [ ] Abrir Kaiflow. **Esperado:** aparece la ventana de bienvenida (pasos "Welcome",
      "Permissions", "Ready") y el icono en la bandeja.
- [ ] Recorrer los pasos con **Continue** y terminar con **Start tracking**. **Esperado:** en
      X11 el estado aparece como concedido ("Granted"); en Wayland no. Anotar si algún texto
      habla de "this Mac" o de Ajustes del Sistema (texto de macOS que conviene corregir).
- [ ] **Esperado:** se crea `~/.local/share/com.carlosleon.kaiflow/kaiflow.db`.

## 3. App y título de la ventana activa

Sesión **X11**:

- [ ] Alternar durante 1 minuto entre el editor de texto (con `prueba-kaiflow.txt`), Archivos
      y Firefox (con una página de prueba). **Esperado:** el popover y Today muestran cada app
      con un nombre legible y el tiempo crece en la app que está al frente.
- [ ] Cambiar de pestaña o de documento. **Esperado:** el título nuevo aparece en Today en
      pocos segundos.
- [ ] Excluir una app u ocultar títulos en Privacy. **Esperado:** se respeta desde ese momento.

Sesión **Wayland**:

- [ ] **Esperado:** aparece el aviso "Window tracking is unavailable on Wayland" y no se
      registra tiempo por app ni títulos, aunque se cambie de app. No es un fallo: es la
      limitación documentada.

## 4. Bandeja y cuenta atrás

- [ ] Clic en el icono. **Esperado:** se abre y se cierra el popover (en algunos escritorios el
      clic izquierdo abre el menú; anotar el comportamiento).
- [ ] Menú del icono. **Esperado:** "Pause tracking", "Open Kaiflow" y "Quit". "Open Kaiflow"
      abre la ventana principal.
- [ ] **Esperado:** junto al icono aparece como etiqueta el total del día o la app actual (si el
      escritorio muestra etiquetas de AppIndicator; GNOME con la extensión sí).
- [ ] Con un temporizador de enfoque en marcha. **Esperado:** la etiqueta muestra la cuenta atrás
      y se actualiza cada segundo sin que el icono parpadee.

## 5. Fin del temporizador de enfoque

- [ ] En Settings activar **Sound**. Iniciar un bloque de enfoque corto (el mínimo posible) y
      cerrar el popover.
- [ ] **Esperado:** un minuto antes llega el aviso "One minute left".
- [ ] **Esperado:** al terminar llega la notificación del escritorio ("Focus block done" o "Time
      is up") **con sonido**, aunque el popover esté cerrado. Anotar si el sonido no suena (puede
      depender del servidor de notificaciones).
- [ ] Abrir el popover. **Esperado:** aparece la tarjeta de fin ("Focus done" o "Time is up")
      con "Start break" o "Start focus", "Skip" o "Done" y "+5 min", y cada botón funciona.

## 6. Inactividad y vuelta

- [ ] En Settings > Idle bajar "Idle after" al mínimo. No tocar teclado ni ratón durante más de
      ese tiempo y del tiempo de "Skip the prompt for short breaks".
- [ ] Volver a mover el ratón. **Esperado:** notificación "Welcome back" y, en el popover, la
      tarjeta "You were away for …" con "Discard", "Assign to previous app" y "Assign to
      activity…".
- [ ] Repetir en Wayland. **Esperado:** también se detecta (GNOME vía Mutter; otros escritorios
      vía logind, con menos precisión).

## 7. Bloqueo y suspensión

- [ ] Bloquear con **Super + L** durante 1 minuto y desbloquear. **Esperado:** ese tiempo no se
      cuenta como uso de ninguna app (X11 y Wayland).
- [ ] Suspender (menú del sistema > Suspender, o `systemctl suspend`) y reanudar.
      **Esperado:** el tiempo suspendido no se cuenta y el registro continúa solo al volver.

## 8. Inicio automático

- [ ] Activar Settings > Tracking > **Open at login**, cerrar sesión y volver a entrar.
      **Esperado:** Kaiflow arranca sola y aparece en la bandeja (existe
      `~/.config/autostart/Kaiflow.desktop` o similar).
- [ ] Con el AppImage: comprobar que la entrada de inicio apunta a la ruta del AppImage y que
      funciona si no se mueve el archivo. Anotar qué pasa si se mueve.
- [ ] Desactivarlo y volver a entrar. **Esperado:** ya no arranca sola.

## 9. Una sola instancia

- [ ] Con Kaiflow abierta, abrirla otra vez (lanzador o AppImage). **Esperado:** no se crea un
      segundo icono ni un segundo proceso (`pgrep -a kaiflow`); se muestra y enfoca la ventana
      principal existente.

## 10. Atajo global

- [ ] Probar el atajo de pausar y reanudar (por defecto `Ctrl+Alt+Super+T`). **Esperado:** en X11
      pausa y reanuda el registro. En Wayland los atajos globales pueden no funcionar; anotarlo.

## 11. Copias de seguridad y exportación

- [ ] Settings > Data > **Back up now**. **Esperado:** aparece un archivo
      `kaiflow-backup-*.json.gz` en la carpeta de copias y se actualiza "Last backup".
- [ ] Exportar desde Overview. **Esperado:** se guarda un JSON que se abre sin errores (el
      diálogo de archivos funciona).
- [ ] **Restore from file…** con la copia anterior y confirmar con "Restore and replace".
      **Esperado:** los datos vuelven al estado de la copia.

## 12. Desinstalación

- [ ] `.deb`: `sudo apt remove kaiflow`. **Esperado:** se desinstala sin errores y desaparece del
      lanzador.
- [ ] AppImage: borrar el archivo y, si se activó, la entrada de `~/.config/autostart/`.
- [ ] **Esperado:** `~/.local/share/com.carlosleon.kaiflow/` se conserva (los datos no se borran
      sin pedirlo); borrarla a mano si se quiere empezar de cero.

## Cómo informar de un fallo

Abre un issue en https://github.com/CarlosLeonCode/kaiflow/issues con:

- Versión de Kaiflow (Settings > About) y paquete usado (AppImage o `.deb`).
- Distribución y versión (`cat /etc/os-release`), escritorio (GNOME, KDE...) y tipo de sesión
  (`echo $XDG_SESSION_TYPE`), y si es una VM (UTM, Parallels...) o un equipo real.
- El punto de esta lista que falla, lo esperado y lo que pasó, y los pasos para reproducirlo.
- Si la app lo muestra, la salida al lanzarla desde una terminal, revisada antes de pegarla.
- Capturas solo si no muestran datos privados.

**Nunca pegues títulos de ventana reales** (ni en el texto, ni en registros, ni en capturas):
pueden contener nombres de documentos, clientes o mensajes. Usa los archivos de prueba o
reemplázalos por `<título>`.
