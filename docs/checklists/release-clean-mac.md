# Checklist manual de release en un Mac limpio (tarea 4.4)

Quien la ejecuta: el usuario, con el DMG **publicado** por `release.yml` (no una compilacion
local) en un Mac donde la app nunca se haya instalado, o tras borrar:
`/Applications/Time Track Copilot.app`, `~/Library/Application Support/com.carlosleon.timetrack/`
y la entrada de la app en Ajustes del Sistema > Privacidad y seguridad > Accesibilidad.

Marcar cada punto con `[x]` y anotar fecha, version de macOS y observaciones. Requisitos que
cubre: R11.1 (firma y notarizacion), R11.4 (actualizaciones) y R10.1 (sin red salvo el
actualizador).

- Version N: ____ / Version N+1: ____ / macOS: ____ / Equipo: ____ / Fecha: ____

## 1. Gatekeeper sin avisos (R11.1)

- [ ] Descargar el DMG desde la pagina de la release con el navegador (para que lleve la
      cuarentena) y abrirlo.
- [ ] Arrastrar la app a Aplicaciones y abrirla con doble clic: **no** aparece "no se puede
      abrir porque el desarrollador no puede ser verificado" ni "esta danada".
- [ ] A lo sumo aparece el aviso estandar "descargada de Internet, ¿seguro que quieres
      abrirla?" una sola vez.
- [ ] `spctl --assess --type execute --verbose=4 "/Applications/Time Track Copilot.app"` responde
      `accepted` con `source=Notarized Developer ID`.
- [ ] `codesign --verify --deep --strict --verbose=2 "/Applications/Time Track Copilot.app"` no
      muestra errores y `codesign -dv --verbose=4 ...` indica los flags `runtime`.
- [ ] `xcrun stapler validate "/Applications/Time Track Copilot.app"` responde
      `The validate action worked!`.
- [ ] Se abre sin conexion a Internet (el ticket de notarizacion esta grapado).

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
- [ ] `codesign -dv --verbose=4` de N y de N+1 muestra el mismo `Authority=Developer ID
      Application: ...` y el mismo `TeamIdentifier` (si cambia, macOS pedira el permiso otra
      vez).

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
