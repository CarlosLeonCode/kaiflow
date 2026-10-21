import type { Content } from "./types";

export const es: Content = {
  meta: {
    title: "TimeTrack: descubre en qué se va tu día",
    description:
      "Un registro de tiempo privado y local que vive en la barra de menús de macOS, con Windows y Linux próximamente. Seguimiento automático por app y ventana, objetivos, sesiones de enfoque y revisión semanal. Gratis, de código abierto (MIT) y fácil de adaptar con agentes de programación con IA.",
    ogAlt: "TimeTrack: un registro de tiempo privado que vive en la barra de menús.",
  },
  a11y: {
    skip: "Saltar al contenido",
    primaryNav: "Principal",
    languageNav: "Idioma",
    home: "Inicio de TimeTrack",
    opensNewTab: "se abre en GitHub",
    yes: "Compatible",
    partial: "Compatible en parte",
    no: "No compatible",
  },
  nav: { features: "Funciones", privacy: "Privacidad", platforms: "Plataformas", install: "Instalar", faq: "Preguntas", download: "Descargar" },
  language: { label: "Idioma", en: "English", es: "Español" },
  hero: {
    eyebrow: "Gratis y de código abierto · Privado por diseño",
    title: "Descubre en qué se va tu día.",
    lead:
      "TimeTrack registra en segundo plano qué app y qué ventana estás usando y te muestra el día en una línea de tiempo clara. Sin cronómetros que iniciar, sin cuentas que crear y sin que nada salga de tu equipo.",
    primary: "Descargar para macOS",
    secondaryLabel: "Próximamente:",
    secondary: [
      { label: "Windows", href: "#platforms" },
      { label: "Linux", href: "#platforms" },
    ],
    note: "Requiere macOS 13 o posterior. Compilación universal para Apple silicon e Intel.",
    notice: "Gratis. Sin notarización de Apple: la primera vez, ábrela desde Ajustes del Sistema → Privacidad y seguridad.",
    noticeLink: "Ver los pasos de instalación",
    shotAlt:
      "La vista Hoy de TimeTrack: 4 horas y 25 minutos de tiempo enfocado, una línea de tiempo de colores de 9:00 a 14:00 y totales por app y por actividad.",
    popoverAlt:
      "El panel de la barra de menús de TimeTrack con el total de hoy, la app en uso y las apps más usadas del día.",
  },
  how: {
    title: "Configúralo una vez. Después, olvídate.",
    lead: "No hay cronómetro que recordar. TimeTrack trabaja en segundo plano desde la barra de menús.",
    steps: [
      {
        title: "Instala y permite los títulos de ventana",
        body: "Abre la app y concede el permiso de Accesibilidad una sola vez para que pueda leer el título de la ventana activa. Si no lo concedes, TimeTrack registra igualmente el nombre de las apps.",
      },
      {
        title: "Trabaja como siempre",
        body: "Cada app y ventana que usas se registra automáticamente. Si te ausentas, detecta la inactividad para que las pausas no inflen tus cifras.",
      },
      {
        title: "Revisa y ajusta",
        body: "Abre el panel para ver tu línea de tiempo, agrupar el tiempo en actividades y fijar objetivos. Un vistazo a la barra de menús te muestra el total del día.",
      },
    ],
  },
  features: {
    title: "Todo lo que necesitas para entender tu tiempo",
    lead: "Sencillo a primera vista, con la profundidad suficiente para responder preguntas reales sobre tu semana.",
    items: [
      {
        title: "Seguimiento automático",
        body: "Registra solo la app activa y el título de su ventana. Sin cronómetros manuales, sin capturas de pantalla y sin registrar teclas.",
      },
      {
        title: "Actividades y reglas",
        body: "Agrupa el tiempo en proyectos, clientes o tareas con reglas por app o por título de ventana. Marca cada una como productiva, neutra o de distracción.",
      },
      {
        title: "Panel de resumen",
        body: "Reparto por actividad, títulos más frecuentes, tendencias, un mapa de calor por hora y día de la semana y tu porcentaje de enfoque.",
      },
      {
        title: "Objetivos con rachas",
        body: "Metas diarias, semanales o mensuales, como mínimo a alcanzar o límite que no superar. Las rachas te ayudan a mantener el ritmo y los objetivos nunca bloquean nada.",
      },
      {
        title: "Sesiones de enfoque",
        body: "Define una intención y las apps que le corresponden. Verás una cuenta atrás en la barra de menús y un aviso discreto si te desvías.",
      },
      {
        title: "Revisión semanal",
        body: "Un resumen tranquilo de la semana: qué fue bien, dónde se escapó el tiempo y cómo fueron tus objetivos. Con análisis de IA opcional, solo si lo pides.",
      },
      {
        title: "Detección de inactividad",
        body: "Al volver, decide si descartas el tiempo ausente o lo asignas a una actividad, como una reunión o una llamada.",
      },
      {
        title: "Exportación y copias de seguridad",
        body: "Exporta tu historial en JSON cuando quieras. Se guarda una copia diaria en tu equipo que puedes restaurar en un solo paso.",
      },
    ],
  },
  showcase: {
    title: "Una imagen clara, en modo claro u oscuro",
    lead: "Ventanas con aspecto nativo que siguen la apariencia de tu sistema.",
    shots: [
      {
        key: "overview",
        title: "Resumen",
        body: "Tu semana día a día, tus horas de más actividad y cuánto de tu tiempo fue enfocado.",
        alt: "El panel de resumen de una semana: 15 horas y 57 minutos en total, el porcentaje de enfoque, barras apiladas por día y un mapa de calor de las horas con más actividad.",
      },
      {
        key: "goals",
        title: "Objetivos",
        body: "Metas que alcanzar y límites que respetar, con progreso y rachas.",
        alt: "La vista de objetivos con cuatro metas: trabajo profundo en curso, un límite de Slack superado por 5 minutos, una meta diaria cumplida con una racha de 46 días y una meta semanal.",
      },
      {
        key: "focus",
        title: "Enfoque",
        body: "Un bloque de tiempo para una sola intención, con las apps que le corresponden.",
        alt: "Una sesión de enfoque en curso llamada Write report con 40 minutos restantes, una barra de progreso y botones para añadir 10 minutos o terminar la sesión.",
      },
    ],
  },
  personas: {
    title: "Pensado para cualquier tipo de trabajo",
    lead: "Si tu trabajo pasa por un ordenador, TimeTrack te ayuda a verlo con claridad.",
    items: [
      {
        role: "Marketing",
        summary: "Equilibra el trabajo de campaña con la presión constante de los mensajes.",
        examples: [
          "Comprueba cuánto llevó de verdad la presentación del lanzamiento en Keynote o Figma",
          "Fija un límite de 45 minutos al día en herramientas de redes sociales",
          "Detecta las tardes que se van en llamadas seguidas",
        ],
      },
      {
        role: "Contabilidad y consultoría",
        summary: "Convierte un día ajetreado en horas precisas por cliente.",
        examples: [
          "Una regla asigna cada hoja de cálculo con el nombre de un cliente a ese cliente",
          "Totales semanales por cliente, listos para tu parte de horas",
          "Exporta a JSON cuando llegue el momento de facturar",
        ],
      },
      {
        role: "Diseño y creatividad",
        summary: "Protege los bloques largos en los que sucede el trabajo de verdad.",
        examples: [
          "Una sesión de enfoque con solo tus herramientas de diseño permitidas",
          "Una meta de tres horas de trabajo profundo cada día laborable",
          "Un mapa de calor que muestra cuándo rindes mejor",
        ],
      },
      {
        role: "Estudiantes e investigación",
        summary: "Sabe cuánto estudiaste realmente esta semana.",
        examples: [
          "Separa lectura, escritura y navegación por título de ventana",
          "Una racha de al menos dos horas de estudio al día",
          "Una revisión semanal antes de planificar la siguiente",
        ],
      },
    ],
  },
  privacy: {
    title: "Tu tiempo es tuyo. Tus datos, también.",
    lead: "TimeTrack está diseñado para que lo más seguro sea lo predeterminado. Sin cuentas, sin nube y sin rastrearte.",
    readTitle: "Qué lee",
    read: [
      "El nombre de la app activa",
      "El título de la ventana activa, con tu permiso",
      "Si estás inactivo, con la pantalla bloqueada o en reposo",
    ],
    neverTitle: "Qué no lee nunca",
    never: [
      "Tu pantalla: nunca pide permiso de grabación de pantalla",
      "Lo que escribes, el portapapeles o el contenido de tus archivos",
      "Páginas web, mensajes o cualquier cosa en segundo plano",
    ],
    storageTitle: "Dónde se guarda",
    storage: [
      "En una base de datos local en tu equipo, en ningún otro sitio",
      "Excluye apps, oculta títulos o borra cualquier periodo de tiempo",
      "Exporta o borra todo cuando quieras",
    ],
  },
  ai: {
    eyebrow: "Opcional",
    title: "Una revisión semanal con IA, solo si la quieres",
    lead:
      "La revisión semanal funciona por completo sin conexión. Si quieres una segunda opinión, puedes activar un análisis de tu semana con IA usando el proveedor que elijas.",
    points: [
      {
        title: "Desactivada hasta que la actives",
        body: "No se envía nada salvo que actives un proveedor y ejecutes tú el análisis.",
      },
      {
        title: "Datos agregados por defecto",
        body: "De forma predeterminada comparte resúmenes de tu semana, no tu historial completo.",
      },
      {
        title: "Vista previa antes de enviar",
        body: "Ve exactamente qué se va a compartir antes de que salga de tu equipo.",
      },
      {
        title: "Claves en tu llavero",
        body: "Las claves de API se guardan en el almacén seguro de tu sistema operativo, nunca en archivos de texto.",
      },
    ],
    providersTitle: "Compatible con",
    providers: ["Claude", "Gemini", "OpenAI", "Ollama (en local)"],
  },
  platforms: {
    title: "Compatibilidad por plataforma",
    lead: "Disponible para macOS. Windows y Linux ya están implementados y registran tu tiempo; las descargas listas para instalar llegarán pronto.",
    feature: "Función",
    columns: ["macOS", "Windows", "Linux (X11)", "Linux (Wayland)"],
    rows: [
      {
        label: "App activa",
        cells: [["yes", ""], ["yes", ""], ["yes", ""], ["no", ""]],
      },
      {
        label: "Títulos de ventana",
        cells: [["yes", "Con permiso de Accesibilidad"], ["yes", "Sin permisos"], ["yes", "Sin permisos"], ["no", ""]],
      },
      {
        label: "Detección de inactividad",
        cells: [["yes", ""], ["yes", ""], ["yes", ""], ["partial", "GNOME o logind"]],
      },
      {
        label: "Bloqueo y reposo",
        cells: [["yes", ""], ["yes", ""], ["yes", ""], ["yes", ""]],
      },
      {
        label: "Texto en la barra de menús o bandeja",
        cells: [["yes", "Barra de menús"], ["partial", "Solo información emergente"], ["partial", "Etiqueta de AppIndicator"], ["partial", "Etiqueta de AppIndicator"]],
      },
      {
        label: "Descarga lista para instalar",
        cells: [["yes", "DMG en GitHub Releases"], ["partial", "Próximamente. Por ahora, compilar desde el código"], ["partial", "Próximamente. Por ahora, compilar desde el código"], ["partial", "Próximamente. Por ahora, compilar desde el código"]],
      },
    ],
    note: "Wayland no permite que las apps vean qué ventana está activa, así que allí solo se registran la inactividad, el bloqueo y el reposo. Inicia una sesión X11 (por ejemplo, GNOME sobre Xorg) para un seguimiento completo.",
    sourceLink: "Compilar para Windows o Linux",
  },
  faq: {
    title: "Preguntas frecuentes",
    items: [
      {
        q: "¿Por qué TimeTrack pide el permiso de Accesibilidad?",
        a: "En macOS, Accesibilidad es la forma en que una app lee el título de la ventana activa, lo que permite a TimeTrack distinguir un documento o una web de otra. Solo se usa para eso. Sin él, TimeTrack sigue registrando el nombre de las apps. Nunca pide permiso de grabación de pantalla.",
      },
      {
        q: "¿Funciona en Linux con Wayland?",
        a: "En parte. Wayland no permite que una app vea qué ventana tiene activa otra app, así que en Wayland TimeTrack registra la inactividad, el bloqueo y el reposo, pero no apps ni títulos. Elige una sesión X11 al iniciar sesión para un seguimiento completo.",
      },
      {
        q: "¿Dónde se guardan mis datos?",
        a: "En una base de datos local en tu equipo. En macOS está en ~/Library/Application Support/com.carlosleon.timetrack/. Puedes exportarla en JSON, restaurar una copia diaria o borrar cualquier periodo en cualquier momento.",
      },
      {
        q: "¿Sale algo de mi equipo?",
        a: "Solo dos cosas, y ambas bajo tu control: la comprobación de actualizaciones de la app y la revisión semanal con IA, si la activas y la ejecutas. Todo lo demás se queda en tu equipo.",
      },
      {
        q: "¿Por qué macOS muestra un aviso al abrirla?",
        a: "TimeTrack es gratuita y no está notarizada por Apple, algo que requiere una cuenta de desarrollador de pago. macOS muestra ese aviso con cualquier app que no ha revisado. El código es público y, la primera vez que la abres desde Ajustes del Sistema → Privacidad y seguridad (o con clic derecho → Abrir en macOS 14 y anteriores), macOS recuerda tu decisión.",
      },
      {
        q: "¿Es gratis?",
        a: "Sí. TimeTrack es gratuita y de código abierto con licencia MIT. Sin cuentas, sin suscripciones y sin versiones de pago.",
      },
      {
        q: "¿Puedo usarla para trabajo comercial?",
        a: "Sí. La licencia MIT permite usarla, modificarla y redistribuirla, también con fines comerciales y dentro de tus propios productos, siempre que conserves el aviso de copyright y de licencia.",
      },
      {
        q: "¿Ralentiza mi equipo?",
        a: "No. Comprueba la ventana activa cada par de segundos y reacciona a los cambios de app al momento, lo que consume muy poca energía.",
      },
    ],
  },
  install: {
    title: "Instalar en macOS",
    lead: "Lleva un minuto. La primera apertura necesita un paso más porque la app es gratuita y no está notarizada por Apple.",
    steps: [
      {
        title: "Descarga",
        body: "Obtén el último .dmg desde GitHub Releases. Es una compilación universal para Apple silicon e Intel.",
      },
      {
        title: "Muévela a Aplicaciones",
        body: "Abre el .dmg y arrastra TimeTrack a la carpeta Aplicaciones.",
      },
      {
        title: "Ábrela por primera vez",
        body: "macOS indica que no puede verificar al desarrollador. Pulsa Listo y sigue los pasos de tu versión de macOS.",
      },
    ],
    firstOpenTitle: "Primera apertura",
    firstOpenLead: "Solo hay que hacerlo una vez. Después, TimeTrack se abre como cualquier otra app.",
    variants: [
      {
        title: "macOS 15 Sequoia o posterior",
        steps: [
          "Intenta abrir TimeTrack desde Aplicaciones y pulsa Listo en el aviso.",
          "Abre Ajustes del Sistema → Privacidad y seguridad.",
          "Baja hasta Seguridad y pulsa Abrir igualmente junto al mensaje sobre TimeTrack.",
          "Pulsa de nuevo Abrir igualmente e introduce tu contraseña.",
        ],
      },
      {
        title: "macOS 13 Ventura y 14 Sonoma",
        steps: [
          "En Finder, abre la carpeta Aplicaciones.",
          "Haz clic derecho (o Control + clic) en TimeTrack y elige Abrir.",
          "Pulsa Abrir en el diálogo.",
        ],
      },
    ],
    advancedTitle: "Avanzado: usar Terminal",
    advancedBody: "Solo si confías en la descarga. Este comando quita la marca de cuarentena, lo que omite la comprobación de Gatekeeper para esta app:",
    permissionTitle: "Después, permite los títulos de ventana",
    permissionBody: "Cuando TimeTrack lo pida, actívala en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad. Sin ese permiso, TimeTrack registra igualmente el nombre de las apps.",
  },
  availability: {
    title: "Disponibilidad",
    available: "Disponible",
    soon: "Próximamente",
    items: [
      { name: "macOS", status: "available", detail: "DMG universal para macOS 13 o posterior" },
      { name: "Windows", status: "soon", detail: "Implementado. Hoy puedes compilarlo desde el código" },
      { name: "Linux", status: "soon", detail: "Implementado para X11. Hoy puedes compilarlo desde el código" },
    ],
    watch: "Seguir las versiones",
    vote: "Pide tu plataforma",
  },
  fork: {
    eyebrow: "Código abierto · MIT",
    title: "Hazla tuya",
    lead: "TimeTrack está pensada para bifurcarse (fork). Modifícala a mano o deja que un agente de programación con IA haga el trabajo: el proyecto incluye una guía escrita para agentes.",
    points: [
      {
        title: "Una base limpia sobre la que construir",
        body: "Un dominio puro, puertos explícitos y un adaptador por sistema operativo, para que los cambios sean pequeños, locales y fáciles de probar.",
      },
      {
        title: "Instrucciones para agentes de IA",
        body: "AGENTS.md describe la arquitectura, las reglas que hay que respetar y los comandos exactos para verificar un cambio.",
      },
      {
        title: "Cambia la marca en una tarde",
        body: "La guía para hacer un fork enumera cada nombre, icono y clave que cambiar, con ideas y ejemplos de instrucciones.",
      },
    ],
    agentsTitle: "Funciona bien con",
    agents: ["Claude Code", "Antigravity", "Cursor", "Codex", "GitHub Copilot"],
    promptTitle: "Ejemplo de instrucción",
    prompt: "Lee AGENTS.md. Añade una exportación CSV de los totales por actividad para un rango de fechas, siguiendo la receta de principio a fin, y ejecuta todos los comandos de verificación.",
    agentsLink: "Leer AGENTS.md",
    forkingLink: "Guía para hacer un fork",
    forkLink: "Hacer un fork en GitHub",
  },
  support: {
    title: "Apoya el proyecto",
    lead: "TimeTrack es gratuita y seguirá siéndolo. Si te resulta útil, una estrella en GitHub ayuda a que otras personas la encuentren.",
    star: "Dar una estrella en GitHub",
    sponsor: "Patrocinar en GitHub",
  },
  cta: {
    title: "Empieza a ver tu día con claridad.",
    lead: "Gratis, privado y listo en un minuto.",
    primary: "Descargar para macOS",
    secondary: "Ver el código en GitHub",
  },
  footer: {
    tagline: "Un registro de tiempo privado para tu barra de menús.",
    license: "Licencia MIT",
    source: "Código fuente",
    releases: "Versiones",
    issues: "Informar de un problema",
  },
};
