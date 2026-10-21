# Checklist manual de release en un Mac limpio (tarea 4.4)

Quien la ejecuta: el usuario, con el DMG **publicado** por `release.yml` (no una compilacion
local) en un Mac donde la app nunca se haya instalado, o tras borrar:
`/Applications/Time Track Copilot.app`, `~/Library/Application Support/com.carlosleon.timetrack/`
y la entrada de la app en Ajustes del Sistema > Privacidad y seguridad > Accesibilidad.

Marcar cada punto con `[x]` y anotar fecha, version de macOS y observaciones. Requisitos que
cubre: R11.1 (instalacion y primera apertura), R11.4 (actualizaciones) y R10.1 (sin red salvo
el actualizador). Las releases son gratuitas y **no estan notarizadas** salvo que existan los
secretos de Apple (ver `docs/release.md`); anotar el modo de firma que muestra el resumen del
job (ad-hoc, autofirmado o notarizado).

- Version N: ____ / Version N+1: ____ / Modo de firma: ____ / macOS: ____ / Equipo: ____ / Fecha: ____

## 1. Primera apertura (R11.1)

- [ ] Descargar el DMG desde la pagina de la release con el navegador (para que lleve la
      cuarentena) y abrirlo.
- [ ] Arrastrar la app a Aplicaciones y abrirla con doble clic.
- [ ] Sin notarizar: macOS avisa de que no puede verificar al desarrollador. Seguir los pasos de
      las notas de la release y comprobar que funcionan tal cual:
  - [ ] macOS 15 o posterior: Ajustes del Sistema > Privacidad y seguridad > "Abrir
        igualmente".
  - [ ] macOS 13 o 14: clic derecho > Abrir > Abrir.
- [ ] Notarizada (solo modo notarizado): no aparece el aviso del desarrollador y
      `spctl --assess --type execute --verbose=4 "/Applications/Time Track Copilot.app"`
      responde `accepted` con `source=Notarized Developer ID`.
- [ ] `codesign --verify --deep --strict --verbose=2 "/Applications/Time Track Copilot.app"` no
      muestra errores.
- [ ] Las notas de la release describen bien el modo de firma (aviso de Accesibilidad en
      ad-hoc) y si hay actualizaciones automaticas.

## 2. Permiso conservado de N a N+1 (R11.4, R5.2)

- [ ] Instalar la version N, completar la bienvenida y conceder Accesibilidad. Comprobar que
      se registra el titulo de las ventanas.
- [ ] Publicar la version N+1 (o usar una release de prueba posterior).
- [ ] En Ajustes > Updates pulsar "Check now": aparece "Version N+1 is available" (y el aviso
      en el popover).
- [ ] Pulsar "Install and restart": la app se reinicia sola y el seguimiento se reanuda.
- [ ] Tras la actualizacion, Ajustes del Sistema > Accesibilidad sigue mostrando la app
      **activada**; no vuelve a pedirse el permiso ni aparece el banner de modo degradado.
- [ ] Los datos de N siguen ahi (Hoy e Historial) y la version mostrada es N+1.
- [ ] `codesign -d -r-` de N y de N+1 muestra el mismo requisito designado (si cambia,
      macOS pedira el permiso otra vez). En modo ad-hoc es esperable que cambie: comprobar que
      las notas lo advierten.
- [ ] Esta seccion solo aplica si el actualizador esta configurado; si no, instalar N+1 a mano
      desde el DMG y comprobar el permiso igualmente.

## 3. Red solo del actualizador (R10.1)

Usar un monitor de red por proceso (Little Snitch, LuLu o `nettop -p <pid>`) mientras se usa
la app unos minutos: abrir popover y ventana principal, cambiar de app, exportar un JSON.

- [ ] Sin pulsar "Check now" y durante los primeros 30 s no hay ninguna conexion saliente.
- [ ] La unica conexion saliente es a `github.com` (`releases/latest/download/latest.json` y,
      al instalar, el archivo `.app.tar.gz` de la release) y a los servidores de descarga de
      GitHub a los que redirige.
- [ ] No hay trafico a ningun otro dominio (analitica, telemetria, fuentes, CDN).
- [ ] Con el Mac sin conexion, "Check now" muestra un error entendible y la app sigue
      funcionando con normalidad.
- [ ] Una actualizacion con firma invalida o `latest.json` manipulado se rechaza y la version
      instalada no cambia (prueba opcional con una release de prueba firmada con otra clave).

## Resultado

- [ ] Todos los puntos obligatorios marcados: la release puede anunciarse.
- Observaciones: ______________________________________________
