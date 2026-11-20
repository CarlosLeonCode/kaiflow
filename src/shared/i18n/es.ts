import type { Messages } from "./en";

/** Spanish UI copy: neutral, professional, addressed with "tú". Keys mirror `en.ts`. */
export const es: Messages = {
  platform: {
    tray: { macos: "barra de menús", other: "bandeja del sistema" },
  },
  shell: {
    nav: "Secciones",
    groups: { daily: "Día a día", "look-back": "Retrospectiva", setup: "Configuración" },
    sections: {
      today: "Hoy",
      focus: "Enfoque",
      goals: "Objetivos",
      insights: "Estadísticas",
      activities: "Actividades",
      privacy: "Privacidad",
      settings: "Ajustes",
    },
    help: (section) => `Ayuda sobre ${section}`,
    about: (section) => `Acerca de ${section}`,
    intros: {
      today: {
        title: "Tu día hasta ahora",
        what: "Una línea de tiempo de las apps y ventanas que usaste hoy, y durante cuánto tiempo.",
        can: (tray) => `Consulta el total de hoy y el tiempo por actividad y por app, y pausa el registro desde la ${tray}.`,
        example: "Descubre que la mañana se fue en correos y la tarde en el informe trimestral.",
      },
      focus: {
        title: "Bloques de tiempo enfocado",
        what: "Un bloque con tiempo para una tarea, con un aviso discreto si te desvías a otra cosa.",
        can: "Inicia una sesión, elige qué actividades o apps cuentan como parte del enfoque y mira cómo te fue.",
        example: "45 minutos para terminar la revisión del presupuesto, solo con la hoja de cálculo y los documentos.",
      },
      goals: {
        title: "Objetivos para tu tiempo",
        what: "Objetivos que se comprueban solos mientras trabajas. Nunca se bloquea nada.",
        can: "Fija un mínimo para una actividad o un límite para una app, por día o por semana, y suma una racha.",
        example: "Al menos 3 horas de trabajo profundo entre semana, o como máximo 30 minutos de redes sociales al día.",
      },
      insights: {
        title: "Mira atrás en tu tiempo",
        what: "Tu tiempo registrado en un día, una semana, un mes o los últimos 90 días.",
        can: "Compara periodos y ve tus horas de más actividad. En la vista Semana, toma notas y usa el análisis opcional con IA.",
        example: "Compara el trabajo para clientes de esta semana con el de la anterior y anota qué cambiar.",
      },
      activities: {
        title: "Para qué sirven las actividades",
        what: "Las apps dicen dónde estabas. Las actividades dicen qué hacías, como Trabajo profundo o Cliente A.",
        can: "Añade reglas que clasifican tu tiempo por app o por palabras del título de la ventana. También el tiempo pasado.",
        example: "El mismo navegador puede ser investigación en una pestaña y distracción en otra:",
        diagram: [
          { from: "Chrome + “YouTube” en el título", to: "Distracción" },
          { from: "VS Code, Excel o Figma", to: "Trabajo profundo" },
        ],
      },
      privacy: {
        title: "Tú decides qué se guarda",
        what: "Control sobre lo que se registra. Todo se queda en este equipo.",
        can: "Deja de guardar títulos de ventanas, excluye apps concretas de tus registros y borra datos registrados.",
        example: "Excluye tu app del banco de tus registros u oculta los títulos de tu app de mensajería.",
      },
      settings: {
        title: "Cómo se comporta la app",
        what: "Preferencias de registro, apariencia, copias de seguridad y el análisis opcional con IA.",
        can: "Ajusta la inactividad, el tema, el idioma, el primer día de la semana, el inicio, el atajo y las copias.",
        example: "Cuenta 10 minutos lejos del teclado como una pausa en lugar de 5.",
      },
    },
  },
  settings: {
    appearance: {
      title: "Apariencia",
      theme: "Tema",
      themes: { light: "Claro", dark: "Oscuro", system: "Sistema" },
      language: "Idioma",
      systemLanguage: "Sistema",
    },
  },
};
