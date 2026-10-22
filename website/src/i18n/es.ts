import { LINKS } from "../lib/links";
import type { Content } from "./types";

export const es: Content = {
  meta: {
    title: "Kaiflow: descubre en qué se va tu día",
    description:
      "Un registro de tiempo privado y local que vive en la barra de menús de macOS, con Windows y Linux en beta. Seguimiento automático por app y ventana, objetivos, sesiones de enfoque y revisión semanal. Gratis, de código abierto (MIT) y fácil de adaptar con agentes de programación con IA.",
    ogAlt: "Kaiflow: mejora tu enfoque, un día a la vez. Un registro de tiempo privado que vive en la barra de menús.",
  },
  a11y: {
    skip: "Saltar al contenido",
    primaryNav: "Principal",
    languageNav: "Idioma",
    home: "Inicio de Kaiflow",
  },
  nav: { features: "Funciones", privacy: "Privacidad", install: "Instalar", faq: "Preguntas", download: "Descargar" },
  language: { en: "English", es: "Español" },
  hero: {
    eyebrow: "Gratis y de código abierto · Privado por diseño",
    title: "Descubre en qué se va tu día.",
    lead: "Kaiflow registra en segundo plano la app y la ventana que estás usando y convierte tu día en una línea de tiempo clara, sin cronómetros, sin cuentas y con tus datos en tu equipo.",
    primary: "Descargar para macOS",
    secondaryLabel: "También para",
    secondary: [
      { label: "Windows", href: LINKS.download },
      { label: "Linux", href: LINKS.download },
    ],
    betaBadge: "Beta",
    note: "Requiere macOS 13 o posterior. Compilación universal para Apple silicon e Intel.",
    notice: "Gratis. Sin notarización de Apple: la primera vez, ábrela desde Ajustes del Sistema → Privacidad y seguridad.",
    noticeLink: "Ver los pasos de la primera apertura",
    videoLabel:
      "Un breve video animado: tu día se pierde entre apps; Kaiflow te muestra a dónde se va, registra en privado la app que usas, te permite fijar una meta y enfocarte, y te ayuda a mejorar un poco cada día.",
    pauseVideo: "Pausar video",
    playVideo: "Reproducir video",
  },
  features: {
    title: "Qué obtienes",
    items: [
      {
        title: "Línea de tiempo automática",
        body: "Cada app y ventana que usas, registrada en segundo plano. Nada que iniciar ni detener.",
      },
      {
        title: "Objetivos y rachas",
        body: "Metas diarias o semanales que alcanzar, o límites que respetar, con rachas.",
      },
      {
        title: "Enfoque en la barra de menús",
        body: "Define una intención y una cuenta atrás. Un aviso discreto aparece si te desvías.",
      },
      {
        title: "Revisión semanal, IA opcional",
        body: "Un resumen tranquilo de tu semana. Añade análisis con IA solo si lo pides.",
      },
    ],
    shots: [
      {
        key: "overview",
        alt: "El panel Resumen de una semana: 15 horas y 57 minutos en total, un porcentaje de enfoque, barras apiladas por día y un mapa de calor de las horas con más actividad.",
      },
      {
        key: "focus",
        alt: "Una sesión de enfoque en curso llamada Escribir informe, con 40 minutos restantes, una barra de progreso y botones para añadir 10 minutos o terminar la sesión.",
      },
    ],
  },
  privacy: {
    title: "Tu tiempo es tuyo. Tus datos, también.",
    items: [
      {
        title: "Solo la app activa y su título",
        body: "Nunca tu pantalla, lo que escribes, el portapapeles ni tus archivos.",
      },
      {
        title: "Guardado en local, sin cuentas",
        body: "Nada sale de tu equipo, salvo la comprobación de actualizaciones y la revisión con IA, si la ejecutas.",
      },
      {
        title: "Código abierto, MIT",
        body: "Gratis para siempre. Lee el código y úsala en cualquier trabajo.",
      },
    ],
    fork: "¿Quieres cambiarla? Haz un fork: el repositorio incluye una guía para agentes de programación con IA.",
    forkLink: "Leer AGENTS.md",
  },
  download: {
    title: "Descarga e instalación",
    lead: "Gratis, en GitHub Releases. Windows y Linux están en beta: registran el tiempo de la misma forma, pero se han probado menos.",
    available: "Disponible",
    beta: "Beta",
    platforms: [
      { name: "macOS", status: "available", detail: "DMG universal para macOS 13 o posterior", cta: "Descargar" },
      { name: "Windows", status: "beta", detail: "Instalador (.exe) o MSI para Windows 10 y 11", cta: "Descargar la beta" },
      { name: "Linux", status: "beta", detail: "AppImage o .deb. Seguimiento completo en X11", cta: "Descargar la beta" },
    ],
    firstOpen: {
      title: "¿La abres por primera vez?",
      items: [
        {
          title: "macOS",
          steps: [
            "macOS 15 o posterior: abre Kaiflow, pulsa Listo y ve a Ajustes del Sistema → Privacidad y seguridad para pulsar Abrir igualmente.",
            "macOS 13 y 14: en Aplicaciones, haz clic derecho en Kaiflow y elige Abrir.",
            "Concede Accesibilidad cuando se te pida para registrar los títulos de ventana. Sin ese permiso, se registra igualmente el nombre de las apps.",
          ],
        },
        {
          title: "Windows",
          steps: [
            "El instalador no tiene firma de código. Si aparece SmartScreen, pulsa Más información → Ejecutar de todas formas.",
            "Kaiflow vive en la bandeja del sistema, junto al reloj.",
          ],
        },
        {
          title: "Linux",
          steps: [
            "Haz ejecutable el AppImage y ábrelo, o instala el .deb en Ubuntu 22.04, Debian 12 o posteriores.",
            "En GNOME, el icono de la bandeja necesita la extensión AppIndicator.",
          ],
          code: "chmod +x Kaiflow_*.AppImage && ./Kaiflow_*.AppImage\nsudo apt install ./Kaiflow_*.deb",
        },
      ],
    },
  },
  faq: {
    title: "Preguntas frecuentes",
    items: [
      {
        q: "¿Es gratis?",
        a: "Sí. Kaiflow es gratuita y de código abierto con licencia MIT, también para uso comercial. Sin cuentas, sin suscripciones y sin versiones de pago.",
      },
      {
        q: "¿Por qué macOS muestra un aviso al abrirla?",
        a: "Kaiflow no está notarizada por Apple, algo que requiere una cuenta de desarrollador de pago, así que macOS avisa como con cualquier app que no ha revisado. Ábrela una vez desde Ajustes del Sistema → Privacidad y seguridad y macOS recordará tu decisión.",
      },
      {
        q: "¿Dónde se guardan mis datos?",
        a: "En una base de datos local en tu equipo (en macOS, ~/Library/Application Support/com.carlosleon.kaiflow/). Puedes exportarla en JSON, restaurar una copia diaria o borrar cualquier periodo en cualquier momento.",
      },
      {
        q: "¿Funciona en Linux con Wayland?",
        a: "En parte. Wayland no permite que las apps vean qué ventana está activa, así que solo se registran la inactividad, el bloqueo y el reposo. Elige una sesión X11 al iniciar sesión para un seguimiento completo.",
      },
    ],
  },
  footer: {
    tagline: "Mejora tu enfoque, un día a la vez.",
    nameNote: "El nombre une kaizen, el hábito de mejorar un poco cada día, y flow, el estado de concentración profunda.",
    license: "Licencia MIT",
    source: "Código fuente",
    releases: "Versiones",
    issues: "Informar de un problema",
    star: "Dar una estrella en GitHub",
    sponsor: "Patrocinar",
  },
};
