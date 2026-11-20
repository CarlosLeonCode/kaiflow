/**
 * English UI copy: the source of truth for every user-facing string. Spanish (`es.ts`) must
 * have exactly the same keys and function signatures (see `Messages`). Values are strings, or
 * functions for interpolation and plurals.
 */
export const en = {
  platform: {
    /** Where the app icon lives, as a noun after "from the". */
    tray: { macos: "menu bar", other: "system tray" },
    /** How each OS names the device and the place where the app icon lives (`platformWords`). */
    words: {
      macos: { device: "this Mac", Device: "This Mac", tray: "menu bar", Tray: "Menu bar" },
      other: { device: "this computer", Device: "This computer", tray: "system tray", Tray: "System tray" },
    },
  },
  common: {
    cancel: "Cancel",
    done: "Done",
    dismiss: "Dismiss",
    somethingWentWrong: "Something went wrong.",
    /** Display names of the system identities (`shared/lib/labels`). */
    labels: {
      manualApp: "Assigned manually",
      unassigned: "Unassigned",
      noTitle: "No window title",
    },
  },
  /** Backend errors in plain words (`describeError`). */
  errors: {
    invalidPattern: (pattern: string, reason: string) => `The pattern "${pattern}" is not valid: ${reason}`,
    shortcutUnavailable: (shortcut: string, reason: string) => `The shortcut ${shortcut} is unavailable: ${reason}`,
    permissionDenied: "Accessibility access is not granted.",
    focusUnavailable: "Focus sessions need window tracking, which is unavailable right now.",
    aiNotEnabled: "AI analysis is off for this provider. Switch it on in Settings > AI first.",
    aiKeyMissing: "No API key is saved for this provider. Add one in Settings > AI.",
    secretStoreUnavailable: (reason: string) =>
      `There is no secure place to keep API keys on this computer (${reason}). Keys are never stored in plain text, so this provider stays off.`,
    notFound: "That item no longer exists.",
    confirmationRequired: "This action needs confirmation.",
  },
  /** Shared design-system primitives. */
  ui: {
    about: (subject: string) => `About ${subject}`,
    sectionIntro: {
      what: "What this is",
      can: "What you can do here",
      example: "Example",
      dismiss: (title: string) => `Dismiss introduction to ${title}`,
      diagram: "Example of how time is sorted",
      becomes: "becomes",
    },
  },
  charts: {
    /** Inline, after a label: "Monday, 9 AM: nothing tracked". */
    nothingTracked: "nothing tracked",
    /** A table cell or a sentence of its own. */
    nothingTrackedCell: "Nothing tracked",
    nothingTrackedSentence: "Nothing tracked.",
    period: "Period",
    trackedTime: "Tracked time",
    heatmap: {
      hint: "Hover or focus a cell for details.",
      weekday: "Weekday",
      hour: "Hour",
    },
    bars: {
      hint: "Hover or focus a bar for details.",
      total: "Total",
      breakdown: "Breakdown",
    },
    trend: {
      hint: "Hover the chart for details.",
      summary: (count: number, first: string, last: string, peak: string, peakLabel: string) =>
        `${count} points from ${first} to ${last}. Peak ${peak} on ${peakLabel}.`,
    },
    ratio: {
      productive: "Productive",
      distracting: "Distracting",
      /** After the big percentage: "75% productive". */
      productiveSuffix: "productive",
      noData: "No productive or distracting data",
      explainer: "Productive time as a share of productive plus distracting time. Neutral time is left out.",
      hint: "Mark activities as productive or distracting in Activities to see this ratio.",
      label: (parts: string) => `Productive against distracting time: ${parts}`,
      neutral: "Neutral:",
      neutralNote: "(not part of the ratio)",
    },
  },
  shell: {
    nav: "Sections",
    /** The main window's content area. */
    dashboard: "Dashboard",
    groups: { daily: "Daily", "look-back": "Look back", setup: "Setup" },
    sections: {
      today: "Today",
      focus: "Focus",
      goals: "Goals",
      insights: "Insights",
      activities: "Activities",
      privacy: "Privacy",
      settings: "Settings",
    },
    help: (section: string) => `Help for ${section}`,
    about: (section: string) => `About ${section}`,
    /**
     * Role-agnostic section intros, all with the same three short lines: what this is, what you
     * can do here and a concrete example.
     */
    intros: {
      today: {
        title: "Your day so far",
        what: "A timeline of the apps and windows you used today, and for how long.",
        can: (tray: string) =>
          `Check today's total, see time per activity and per app, and pause tracking from the ${tray}.`,
        example: "See that the morning went to email and the afternoon to the quarterly report.",
      },
      focus: {
        title: "Focused blocks of time",
        what: "A timed block for one task, with a quiet nudge if you drift somewhere else.",
        can: "Start a session, choose which activities or apps count as on target, and see how it went.",
        example: "45 minutes to finish the budget review, with only the spreadsheet and the docs on target.",
      },
      goals: {
        title: "Targets for your time",
        what: "Targets that are checked for you as you work. Nothing is ever blocked.",
        can: "Set a minimum for an activity or a limit for an app, per day or week, and build a streak.",
        example: "At least 3 hours of Deep work on weekdays, or at most 30 minutes of social media a day.",
      },
      insights: {
        title: "Look back on your time",
        what: "Your tracked time over a day, a week, a month or the last 90 days.",
        can: "Compare periods and see your busiest hours. In the Week view, keep a note and run the optional AI analysis.",
        example: "Compare this week's client work with last week's, then note what to change.",
      },
      activities: {
        title: "What activities are for",
        what: "Apps tell you where you were. Activities tell you what you were doing, like Deep work or Client A.",
        can: "Add sorting rules that file your time by app or by words in the window title. Past time is sorted too.",
        example: "The same browser can be research in one tab and a distraction in another:",
        diagram: [
          { from: "Chrome + “YouTube” in the title", to: "Distraction" },
          { from: "VS Code, Excel or Figma", to: "Deep work" },
        ],
      },
      privacy: {
        title: "You decide what is stored",
        what: "Control over what gets recorded. Everything stays on this computer.",
        can: "Stop saving window titles, keep specific apps out of your records, and delete tracked data.",
        example: "Keep your banking app out of your records, or hide the titles of your messaging app.",
      },
      settings: {
        title: "How the app behaves",
        what: "Preferences for tracking, appearance, backups and the optional AI analysis.",
        can: "Adjust idle detection, the theme, the language, the first day of your week, startup, the shortcut and backups.",
        example: "Count 10 minutes away from the keyboard as a break instead of 5.",
      },
    },
  },
  tracking: {
    states: {
      running: "Tracking",
      paused: "Paused",
      stopped: "Not tracking",
      idle: "Idle",
      asleep: "Asleep",
    },
    /** Status line while tracking is degraded. */
    degradedStatus: { titlesOff: "Tracking, titles off", windowsUnavailable: "Tracking, windows unavailable" },
    toggle: { pause: "Pause tracking", resume: "Resume tracking", start: "Start tracking" },
    /** Shown when no app is in the foreground. */
    empty: {
      running: "Waiting for the first window.",
      paused: "Paused. Resume to keep counting.",
      stopped: "Tracking is off.",
      idle: "You seem to be away.",
      asleep: (device: string) => `${device} is asleep.`,
    },
    degraded: {
      accessibility_denied: {
        title: "Window titles are off",
        description: "Accessibility access is not granted, so only app names are recorded.",
      },
      wayland_session: {
        title: "Window tracking is unavailable on Wayland",
        description:
          "Wayland does not let apps see which window is in front, so time per app is not recorded. " +
          "Idle detection still works, and so do lock, sleep and focus timers. Log in to an X11 (Xorg) " +
          'session, such as "Ubuntu on Xorg", to track apps and window titles.',
      },
      no_display: {
        title: "No display found",
        description: "No display server could be reached, so no windows can be tracked.",
      },
      unknown: {
        title: "Window tracking is limited",
        description: "The app in front cannot be observed right now, so only idle time is recorded.",
      },
    },
    openSystemSettings: "Open System Settings",
    shortcutUnavailable: (shortcut: string) => `Shortcut ${shortcut} is unavailable`,
    shortcutFallback: (reason: string, tray: string) =>
      `${reason}. You can still pause and resume here or from the ${tray}.`,
    status: (label: string) => `Status: ${label}`,
    statusError: (message: string) => `Could not read the tracking status: ${message}`,
    now: "Now",
    currentActivity: "Current activity",
    topApps: "Top apps",
    topAppsToday: "Top apps today",
    loadingTopApps: "Loading top apps",
    noActivityToday: "No activity recorded yet today.",
    globalShortcut: "Global shortcut",
    openDashboard: "Open dashboard",
  },
  today: {
    loadError: (message: string) => `Could not load today: ${message}`,
    loading: "Loading today",
    empty: {
      title: "Nothing tracked yet today",
      setUpActivities: "Set up activities",
      running:
        "Tracking is on: keep working and your day fills in here. Meanwhile, set up activities so your time is sorted for you.",
      stopped: "Tracking is not running. Start it and your day will appear here.",
    },
    activeTime: "Active time",
    activeHint: "Time at your computer, not idle.",
    activeAndAway: "Active and away time",
    activeTotal: (duration: string) => `Active time ${duration}`,
    activeBar: (active: string, away: string) => `Active ${active}, away ${away}`,
    active: "Active",
    away: "Away",
    autoDiscarded: (count: number) =>
      `${count === 1 ? "1 short break" : `${count} short breaks`} discarded today. Change this in Settings, Idle.`,
    timeline: "Timeline",
    byApp: "By app",
    byActivity: "By activity",
    timelineEmpty: "Timeline of today: no activity",
    timelineSummary: (blocks: number) =>
      `Timeline of today: ${blocks} ${blocks === 1 ? "block" : "blocks"}, colored by activity. The same data is listed below by app and activity.`,
    timelineHint: "Hover a block for details.",
    timeByApp: "Time by app",
    timeByActivity: "Time by activity",
    titlesIn: (app: string) => `Window titles in ${app}`,
    noTitles: "No window titles recorded.",
    moreTitles: (count: number) => `and ${count} more`,
  },
  focus: {
    subtitle: "Timers, pomodoro cycles and gentle focus",
    loadError: (message: string) => `Could not load focus sessions: ${message}`,
    loading: "Loading focus sessions",
    kinds: { focus: "Focus", timer: "Timer", break: "Break" },
    /** A block without a task, in a sentence. */
    blockTitles: { focus: "Focus block", timer: "Timer", break: "Break" },
    endReasons: { completed: "Completed", cancelled: "Ended early", recovered: "Ended while the app was closed" },
    paused: "Paused",
    pausedTimer: (remaining: string) => `Paused, ${remaining.toLowerCase()}`,
    remaining: {
      timeUp: "Time is up",
      underMinute: "Under a minute left",
      minutes: (minutes: number) => `${minutes} minutes left`,
      duration: (duration: string) => `${duration} left`,
    },
    minutes: (minutes: number) => `${minutes} min`,
    extend: (minutes: number) => `+${minutes} min`,
    pause: "Pause",
    resume: "Resume",
    end: "End",
    activeTimer: "Active timer",
    stepAway: "Step away for a moment",
    untitled: "Untitled block",
    ofMinutes: (minutes: number) => `of ${minutes} min`,
    allowed: (summary: string) => `Allowed: ${summary}`,
    alertsSoFar: (count: number) => `${count === 1 ? "1 alert" : `${count} alerts`} so far`,
    notObserved: "Nothing is being tracked right now, so drift alerts are paused. The countdown keeps going.",
    allowedSummary: {
      activities: (count: number) => (count === 1 ? "1 activity" : `${count} activities`),
      apps: (count: number) => (count === 1 ? "1 app" : `${count} apps`),
      both: (activities: string, apps: string) => `${activities} and ${apps}`,
      nothing: "Nothing allowed",
    },
    alerts: (count: number) => (count === 0 ? "No alerts" : count === 1 ? "1 alert" : `${count} alerts`),
    rounds: (done: number, total: number) => `${done} of ${total} blocks before the long break`,
    drift: {
      label: "Drift alert",
      title: "Still on track?",
      body: (app: string, intent: string) => `You have been in ${app} for a while. Does it belong to “${intent}”?`,
      allowApp: "Allow this app",
      backToIt: "Back to it",
      endSession: "End session",
    },
    endCard: {
      label: "Block finished",
      titles: { break: "Break is over", focus: "Focus done", timer: "Time is up" },
      readyWhenYouAre: "Ready when you are.",
      niceWork: "Nice work. Take a moment before the next thing.",
      takeBreak: (minutes: number, long: boolean) => `Take a ${minutes}-minute ${long ? "long break" : "break"}?`,
      readyFor: (minutes: number, task: string) =>
        task ? `Ready for another ${minutes} minutes on “${task}”?` : `Ready for another ${minutes} minutes?`,
      startBreak: "Start break",
      startFocus: "Start focus",
      startTimer: "Start timer",
      skip: "Skip",
    },
    start: {
      label: "Start a block",
      task: "Task",
      placeholder: "What are you working on? (optional)",
      length: "Length",
      presetHints: { 25: "Pomodoro", 50: "Deep work", 90: "Long haul" },
      custom: "Custom",
      customHint: "your length",
      minutesLabel: "Minutes",
      minutesUnit: "minutes",
      advanced: "Advanced: drift nudges",
      off: "Off",
      picked: (count: number) => `${count} allowed`,
      legend: "What counts as on track",
      driftUnavailable: "Drift nudges need window tracking, which is unavailable right now. Timers still work.",
      pickHelp:
        "Pick what counts as on track. Time elsewhere for a while gets a gentle nudge; nothing is ever blocked. Leave it empty for a plain timer.",
      allowedActivities: "Allowed activities",
      activities: "Activities",
      allowedApps: "Allowed apps",
      recentApps: "Apps you used recently",
      noApps: "No apps have been tracked yet. Let tracking run for a while, then pick apps here.",
      kindFocus: "Focus block with drift nudges",
      kindTimer: "Plain timer: countdown and an alert",
      intentTooLong: (max: number) => `Keep the task under ${max} characters.`,
      badLength: "A block lasts between 1 minute and 12 hours.",
    },
    quick: {
      title: "Start a timer",
      task: "Task (optional)",
    },
    unavailable: {
      title: "Drift nudges are unavailable",
      body: (reason: string, detail: string) =>
        `Focus blocks need to see which app is in front to notice a drift, and tracking cannot do that right now. Plain timers still work. ${reason}. ${detail}`,
    },
    blocksToday: "Blocks done today",
    focusToday: "Focus time today",
    recent: "Recent sessions",
    onTarget: "On target",
    noData: "No data",
    timeSpent: "Time spent",
    summary: {
      label: "Session summary",
      none: "No tracked time during this session",
      headline: (percent: number) => `${percent}% of your time stayed on target`,
      elsewhere: "Elsewhere",
      driftAlerts: "Drift alerts",
      whereInstead: "Where the time went instead",
      topDistractions: "Top distractions",
    },
  },
  goals: {
    subtitle: "Targets for your time, and how you are doing.",
    loadError: (message: string) => `Could not load goals: ${message}`,
    loading: "Loading goals",
    newGoal: "New goal",
    editGoal: "Edit goal",
    dialogHint: "Goals only keep you informed: nothing is ever blocked.",
    noGoals: "No goals yet",
    createGoal: "Create a goal",
    emptyPage:
      "Set a target for an activity, an app or all your tracked time, like at least 4 hours of focused work every weekday or at most 30 minutes in email a day. Goals never block anything: they only keep you informed.",
    emptyStrip:
      "A goal turns your time into a target, like at least 4 hours of focused work a day or at most 30 minutes in email.",
    allGoals: "All goals",
    progress: "Goal progress",
    active: "Active",
    activeGoals: "Active goals",
    goalList: "Goal list",
    archived: "Archived",
    archivedGoals: "Archived goals",
    archivedList: "Archived list",
    badge: (state: string, goal: string) => `${state}: ${goal}. Dismiss`,
    edit: (goal: string) => `Edit ${goal}`,
    archive: (goal: string) => `Archive ${goal}`,
    restore: (goal: string) => `Restore ${goal}`,
    delete: (goal: string) => `Delete ${goal}`,
    dismissAlert: (goal: string) => `Dismiss the alert for ${goal}`,
    deleteTitle: (goal: string) => `Delete "${goal}"?`,
    deleteRemoves: "The goal and its streak history are removed. Your tracked time is not touched.",
    deleteUndo: "This cannot be undone. You can archive a goal instead to keep it.",
    deleteConfirm: "Delete goal",
    deletedActivity: "a deleted activity",
    /** Short weekday names, Monday first: the day buttons and the sentences ("on Mon and Wed"). */
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    /** Weekday names as used inside a sentence, Monday first. */
    daysInSentence: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    cadence: {
      everyDay: "every day",
      everyWeekday: "every weekday",
      everyWeekendDay: "every weekend day",
      noDay: "on no day",
      oneDay: (day: string) => `every ${day}`,
      someDays: (days: readonly string[]) => `on ${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`,
      everyWeek: "every week",
      everyMonth: "every month",
    },
    sentence: {
      minimum: "At least",
      maximum: "No more than",
      activity: (name: string) => `of ${name}`,
      app: (name: string) => `in ${name}`,
      total: "of tracked time",
    },
    suggested: {
      allTime: "All time",
      minimum: "at least",
      maximum: "at most",
      periods: { daily: "daily", weekly: "weekly", monthly: "monthly" },
    },
    streak: (count: number, period: "daily" | "weekly" | "monthly") =>
      `${count} ${{ daily: "day", weekly: "week", monthly: "month" }[period]}${count === 1 ? "" : "s"} in a row`,
    best: (count: number, period: "daily" | "weekly" | "monthly") =>
      `Best: ${count} ${{ daily: "day", weekly: "week", monthly: "month" }[period]}${count === 1 ? "" : "s"}`,
    streakLine: (run: string) => `Streak: ${run}`,
    atRisk: { daily: "At risk this day", weekly: "At risk this week", monthly: "At risk this month" },
    inARow: (count: number) => `${count} in a row`,
    states: {
      restDay: "Rest day",
      reached: "Goal reached",
      overLimit: "Over the limit",
      inProgress: "In progress",
      withinLimit: "Within the limit",
    },
    unseen: { reached: "Goal reached", exceeded: "Limit passed" },
    remaining: {
      toGo: (amount: string) => `${amount} to go`,
      targetMet: "Target met",
      left: (amount: string) => `${amount} left`,
      over: (amount: string) => `${amount} over`,
    },
    amountOf: (actual: string, target: string) => `${actual} of ${target}`,
    barLabel: (goal: string, actual: string, target: string, state: string) =>
      `${goal}: ${actual} of ${target}, ${state.toLowerCase()}`,
    notCountedToday: "Not counted today",
    problems: {
      nameTooLong: (max: number) => `The name can have at most ${max} characters.`,
      badParts: "Enter hours and minutes (minutes from 0 to 59).",
      zero: "The target must be longer than zero.",
      tooLong: { daily: "The target cannot be longer than one day.", weekly: "The target cannot be longer than one week.", monthly: "The target cannot be longer than one month." },
      noDays: "Choose at least one active day.",
      noApp: "Choose an app.",
    },
    form: {
      newLabel: "New goal",
      editLabel: (goal: string) => `Edit goal ${goal}`,
      track: "Track",
      whatToTrack: "What to track",
      scopes: { activity: "An activity", app: "An app", total: "All tracked time" },
      activity: "Activity",
      app: "App",
      noApps: "No apps have been tracked yet. Let tracking run for a while, then pick one here.",
      goalType: "Goal type",
      kinds: { minimum: "At least", maximum: "No more than" },
      amount: "Amount",
      hours: "Hours",
      hoursUnit: "h",
      minutes: "Minutes",
      minutesUnit: "min",
      repeats: "Repeats",
      period: "Period",
      periods: { daily: "Per day", weekly: "Per week", monthly: "Per month" },
      activeDays: "Active days",
      activeDaysPreset: "Active days preset",
      presets: { every: "Every day", weekdays: "Weekdays", custom: "Pick days" },
      daysOfWeek: "Days of the week",
      restDays: "Rest days are not counted and never break a streak.",
      name: "Name (optional)",
      previewEmpty: "Fill in the details to see what this goal means.",
      save: "Save goal",
      add: "Add goal",
    },
  },
  idlePrompt: {
    label: "You were away",
    awayFor: "You were away for",
    lastIn: " · last in ",
    back: "Back to idle options",
    assignTitle: "Assign this time to an activity",
    noActivities: "No activities yet.",
    activities: "Activities",
    discard: "Discard",
    assignPrevious: "Assign to previous app",
    assignActivity: "Assign to activity…",
    expires: "If you do nothing, the time is discarded at",
    moreWaiting: (count: number) => `${count} more waiting.`,
  },
  updates: {
    available: (version: string) => `Version ${version} is available`,
    installingNote: "Installing. The app will restart in a moment.",
    restartNote: "Installing restarts the app; your tracking resumes on its own.",
    installing: "Installing...",
    tryAgain: "Try again",
    installAndRestart: "Install and restart",
    title: "Updates",
    check: "Check for updates",
    signedNote: "Installing restarts the app. Updates are signed and verified before they are applied.",
    upToDate: "You are on the latest version.",
    dailyNote: "The app checks once a day. This is the only time it uses the network.",
    installingLabel: "Installing update",
    installLabel: (version: string) => `Install and restart to version ${version}`,
    checkingLabel: "Checking for updates",
    checkLabel: "Check now for updates",
    checking: "Checking...",
    checkNow: "Check now",
    whatsNew: "What is new",
    installError: (message: string) => `Could not install: ${message}`,
    checkError: (message: string) => `Could not check for updates: ${message}`,
  },
  onboarding: {
    loading: "Loading",
    progress: "Progress",
    steps: { welcome: "Welcome", permissions: "Permissions", recording: "Recording", ready: "Ready" },
    headings: { welcome: "Know where your time goes", access: "Choose what to record", ready: "You're all set" },
    back: "Back",
    continue: "Continue",
    starting: "Starting…",
    welcome: {
      intro: (tray: string) =>
        `Kaiflow lives in your ${tray} and keeps a private log of which apps you use. Here is exactly what it reads and why.`,
      appInFront: "The app in front",
      appInFrontWayland: "The app you are using. Not available in a Wayland session; the next step explains why.",
      appInFrontText: "Always recorded, and it works right away. No permission needed.",
      titles: "Window titles (optional)",
      titlesMac: "The document or tab name. This one needs the Accessibility permission, and you can switch it off.",
      titlesWayland: "The document or tab name. Also unavailable on Wayland, and you can switch it off.",
      titlesOther: "The document or tab name of the active window. No permission needed, and you can switch it off.",
      keyboard: "Whether you are at the keyboard",
      keyboardText: "Only the time since your last input, to spot idle time. Never what you type.",
      privacyMac:
        "Everything stays on this Mac. Nothing is uploaded and there is no telemetry; the only network use is checking for app updates. Screen recording is never requested.",
      privacyOther: (device: string) =>
        `Everything stays on ${device}. Nothing is uploaded and there is no telemetry; the only network use is checking for app updates. Your screen, keystrokes and files are never read.`,
    },
    access: {
      recordTitles: "Record window titles",
      recordTitlesHint: "Off means only app names are stored. You can change this any time in Settings.",
      noPermission: "No permission needed",
      windowsText: "Windows lets Kaiflow read the active app and its window title without a permission prompt.",
      x11Text:
        "On an X11 session Kaiflow reads the active app and its window title from the display server, without a permission prompt.",
      storedOn: (device: string) =>
        `Only the name of the app in front and, if the switch above is on, its title are stored, on ${device}.`,
      waylandSession: "Wayland session",
      waylandBody:
        "Wayland does not let apps see which window is in front, so Kaiflow cannot record time per app or window titles in this session. Idle, lock and sleep detection, focus timers and goals still work.",
      waylandHowTo:
        "To track apps, log out and pick an X11 session on the login screen, such as “Ubuntu on Xorg” from the gear menu on Ubuntu. There is no permission to grant here.",
      accessibility: "Accessibility access",
      checking: "Checking…",
      granted: "Granted",
      missing: "Missing",
      grantedOn: "Window titles will be recorded.",
      grantedOff: "Granted. Window titles stay off while the switch above is off.",
      missingOn:
        "Without it, only app names are recorded. In System Settings, open Privacy & Security, then Accessibility, and switch on Kaiflow. This page updates by itself.",
      missingOff: "Not needed while window titles are off.",
      restartTitle: "Restart to apply",
      restartBody:
        "macOS sometimes only applies the permission to apps that start after it. If titles do not show up, restart Kaiflow.",
      restartNow: "Restart now",
    },
    ready: {
      macNote: "Tracking starts as soon as you finish and keeps working if you skip the permission.",
      waylandNote: "Tracking starts as soon as you finish. Until you use an X11 session it records idle and away time only.",
      otherNote: "Tracking starts as soon as you finish.",
      recording: "Recording",
      linuxTray: "Find Kaiflow in the system tray: its menu pauses tracking and opens the dashboard.",
      findIn: (tray: string) =>
        `Find Kaiflow in the ${tray}: click it for today's total, or open the dashboard for the full picture.`,
      gnome:
        "On GNOME the tray icon needs the AppIndicator extension (“AppIndicator and KStatusNotifierItem Support”). Ubuntu ships it already.",
      openAtLogin: "To start Kaiflow every time you sign in, turn on Open at login in Settings.",
    },
    summary: {
      waylandTitlesOn: "Idle time now; apps and titles on X11",
      waylandTitlesOff: "Idle time now; app names on X11",
      windowTracking: "Window tracking",
      unavailableWayland: "Unavailable on Wayland",
      titlesOn: "App names and window titles",
      titlesOff: "App names only",
      permission: "Permission",
      noneNeeded: "None needed",
      accessOn: "Accessibility is on",
      accessOffTitles: "Accessibility is off, so titles will be skipped until you allow it",
      accessNotNeeded: "Accessibility is not needed",
    },
  },
  settings: {
    appearance: {
      title: "Appearance",
      theme: "Theme",
      themes: { light: "Light", dark: "Dark", system: "System" },
      language: "Language",
      /** The other options are language names, written in their own language (not translated). */
      systemLanguage: "System",
    },
  },
} as const;

/** Literal strings widened to `string`, so translations type-check against English. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : { readonly [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;
