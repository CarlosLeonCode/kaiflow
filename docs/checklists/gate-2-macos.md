# Checklist manual del Gate 2: Accesibilidad (AX) y TCC en macOS (tarea 2.9)

Quien la ejecuta: el usuario, sobre una compilacion **firmada** con la identidad estable
"Kaiflow Dev" (ver `scripts/create-dev-identity.md` y `scripts/dev-sign.sh`). Con
`tauri dev` el permiso de Accesibilidad se concede al terminal, no a la app, por lo que esas
ejecuciones no sirven para este gate.

Marcar cada punto con `[x]` y anotar fecha, version de macOS y observaciones. El Gate 2 se
supera cuando todos los puntos obligatorios estan marcados. El prototipo Electron ya fue
retirado; si este gate falla, puede recuperarse desde el tag `electron-final`.

- Fecha: ____ / macOS: ____ / Equipo: ____ / Commit: ____

## 0. Preparacion

- [ ] La identidad "Kaiflow Dev" existe en el llavero (`security find-identity -v -p codesigning`).
- [ ] `scripts/dev-sign.sh` termina sin errores y deja la app en `~/Applications`.
- [ ] `codesign -dv --verbose=4 ~/Applications/<app>.app` muestra el identificador
      `com.carlosleon.kaiflow` y los flags `runtime` (hardened runtime).
- [ ] Se parte de un estado limpio: en Ajustes del Sistema > Privacidad y seguridad >
      Accesibilidad la app NO aparece (o esta desactivada) y se ha borrado la base de datos de
      prueba (`~/Library/Application Support/com.carlosleon.kaiflow/`).
- [ ] No se solicita en ningun momento Grabacion de Pantalla (R2.3, R5.5). Revisar tambien
      Privacidad y seguridad > Grabacion de pantalla: la app no debe figurar.

## 1. Primer arranque y concesion (R5.1, R5.2, R5.4)

- [ ] Al abrir la app aparece la ventana de bienvenida (no hay icono en el Dock; si en la
      barra de menus).
- [ ] La bienvenida explica que se registra y que todo es local, y muestra el interruptor de
      titulos de ventana.
- [ ] El estado de Accesibilidad aparece como "sin permiso" (rojo).
- [ ] El boton de abrir Ajustes abre Ajustes del Sistema directamente en Accesibilidad.
- [ ] Tras activar la app en esa lista, el estado pasa a verde **sin reabrir la ventana** en
      menos de unos 5 s. (Si no pasa a verde: anotar si se ofrece "Reiniciar" y que, tras
      pulsarlo, queda en verde; en ese caso la app nueva debe tener un pid distinto.)
- [ ] Al completar el onboarding el registro arranca solo (icono "registrando").

## 2. Deteccion de app y titulo (R2.1, R2.4, R2.5)

- [ ] Cambiar entre Safari, Finder y un editor: cada cambio aparece en el popover en menos de
      ~2 s con el nombre correcto de la app.
- [ ] El titulo de la ventana se muestra y se actualiza al cambiar de pestana o documento en
      la misma app (en un maximo de ~2 s, R2.5).
- [ ] Una app sin ventanas (por ejemplo Finder sin ventanas abiertas) se registra solo con el
      nombre, sin errores ni cierres.
- [ ] Una app que no responde a AX (probar con una app Electron o una app congelada con
      `kill -STOP <pid>`) no bloquea la app: el siguiente cambio de foco se detecta en el
      plazo normal. Reanudar con `kill -CONT <pid>`.
- [ ] Una app excluida (Ajustes > Privacidad) no crea segmento ni titulo (R10.2).

## 3. Revocacion en marcha (R5.2, R5.3)

- [ ] Con el registro activo, desactivar la app en Accesibilidad. En un maximo de ~2 s el
      popover muestra el banner de modo degradado y llega una notificacion (si estan
      autorizadas; si no, solo el banner).
- [ ] Los segmentos siguientes se guardan con `window_title` vacio (comprobar en Hoy/Historial).
- [ ] Volver a activar el permiso: el modo degradado desaparece (o se ofrece reinicio) y los
      titulos vuelven.
- [ ] Probar tambien **quitar** la entrada con "-" y volver a anadirla tras ejecutar de nuevo
      `scripts/dev-sign.sh`: el permiso debe conservarse entre builds con la misma identidad
      (R11.2). Anotar si macOS pide concederlo de nuevo.

## 4. Inactividad (R3.1, R3.2, R3.4, S1)

- [ ] Con umbral de 1-2 min (Ajustes), no tocar el equipo. Al volver, el segmento anterior
      termino en el **ultimo input**, no en el momento de la deteccion (R3.2).
- [ ] Al volver se abre el popover con la tarjeta (Descartar / App anterior / Categoria).
- [ ] Con las notificaciones de macOS autorizadas llega ademas una notificacion; la primera
      vez macOS pregunta por la autorizacion. Sin autorizar, solo se abre el popover y no hay
      errores (R5.5 enmendado).
- [ ] "App anterior" crea un segmento con esa app; "Categoria" crea uno con `app_id` vacio y
      la categoria elegida; "Descartar" no crea nada.
- [ ] Sin responder durante 10 min el intervalo se descarta.
- [ ] Cambiar el umbral a 10 min y esperar 7 min sin input: el segmento sigue abierto.

## 5. Suspension y despertar (R3.3)

- [ ] Con un segmento abierto, dormir el equipo (menu Apple > Reposo). Al despertar, el
      segmento anterior termino con `end_reason=sleep` y se abre uno nuevo con la app activa.
- [ ] Despertar con el raton y despertar sin input (por ejemplo, por red o reloj): el tiempo
      dormido nunca se cuenta como actividad y no aparece una inactividad enorme falsa.
- [ ] Estando en pausa, dormir y despertar mantiene la pausa (no se reanuda sola).
- [ ] Con el equipo en inactividad, dormir y despertar: el prompt de regreso aparece al volver.

## 6. Bloqueo de pantalla (R3.3)

- [ ] Bloquear con Ctrl+Cmd+Q: el segmento se cierra con `end_reason=lock`. (El diseno asume
      las notificaciones `com.apple.screenIsLocked/Unlocked`; si no llegan, anotarlo: se
      anadiran `com.apple.screensaver.didstart/didstop` como senal secundaria.)
- [ ] Al desbloquear se abre un segmento nuevo con la app activa.
- [ ] Salvapantallas con contrasena y bloqueo por esquina activa: mismo resultado.

## 7. Atajo, menu y ventana unica (R6.3, R6.4)

- [ ] El atajo global (por defecto Ctrl+Opt+Cmd+T) pausa y reanuda; el icono y la entrada del
      menu del tray cambian de estado.
- [ ] Con el atajo ocupado por otra app (registrar antes el mismo atajo en otra app): la app
      arranca, el popover y Ajustes muestran "atajo no disponible" con el motivo y Pausar/
      Reanudar sigue funcionando desde el popover y el menu del tray.
- [ ] Cambiar el atajo en Ajustes a uno libre lo activa sin reiniciar; elegir uno ocupado
      muestra el error en el campo y conserva el resto de ajustes.
- [ ] Lanzar la app una segunda vez no abre otra instancia y muestra la ventana principal.
- [ ] Autostart: activarlo, cerrar sesion y volver a entrar: la app arranca y registra.
      Desactivarlo elimina el LaunchAgent en `~/Library/LaunchAgents`.

## 8. Precision (R1.2)

- [ ] Sesion de 1 h con cronometro externo: la suma de segmentos difiere del reloj de pared
      en menos del 1 % (anotar: reloj ____ / app ____ / diferencia ____ %).
- [ ] Forzar el cierre (`kill -9`) con un segmento abierto y reabrir: el segmento queda
      cerrado con el ultimo latido y `end_reason=recovered`; los datos previos siguen.

## 9. Reinicio tras conceder (R5.4)

- [ ] `app_restart` (boton "Reiniciar" del onboarding) lanza una instancia nueva de la app
      (pid distinto), cierra la anterior y no queda ninguna segunda instancia en la barra.

## Resultado

- [ ] Gate 2 superado (todos los puntos anteriores marcados).
- Observaciones / incidencias: ____
- Firma de quien ejecuta la checklist: ____
