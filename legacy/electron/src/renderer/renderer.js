// --- NEW: WINDOW CONTROL BUTTONS ---
const minimizeBtn = document.getElementById("minimize-btn");
const maximizeBtn = document.getElementById("maximize-btn");
const closeBtn = document.getElementById("close-btn");

minimizeBtn.addEventListener("click", () => window.api.window.minimize());
maximizeBtn.addEventListener("click", () => window.api.window.maximize());
closeBtn.addEventListener("click", () => window.api.window.close());
// --- END NEW ---

const toggleBtn = document.getElementById("toggle-tracking-btn");
const reportContainer = document.getElementById("report-container");
let isTracking = false;

// Initial button style
toggleBtn.classList.add("bg-emerald-500", "hover:bg-emerald-600", "text-white");

// Format seconds into a readable string "Xh Ym Zs"
function formatTime(totalSeconds) {
  totalSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

// Handle button click
toggleBtn.addEventListener("click", () => {
  isTracking = !isTracking;
  updateButtonState();
  window.api.toggleTracking();

  if (isTracking) {
    reportContainer.innerHTML = `
            <div class="text-center bg-slate-700/50 p-8 rounded-lg">
                <p class="text-slate-400 animate-pulse">Tracking in progress...</p>
            </div>
        `;
  }
});

function updateButtonState() {
  // Clear existing color classes
  toggleBtn.classList.remove(
    "bg-emerald-500",
    "hover:bg-emerald-600",
    "bg-red-500",
    "hover:bg-red-600"
  );

  if (isTracking) {
    toggleBtn.textContent = "Stop Tracking";
    toggleBtn.classList.add("bg-red-500", "hover:bg-red-600", "text-white");
  } else {
    toggleBtn.textContent = "Start Tracking";
    toggleBtn.classList.add(
      "bg-emerald-500",
      "hover:bg-emerald-600",
      "text-white"
    );
  }
}

// Listen for data updates from the main process
window.api.onUpdateData((data) => {
  reportContainer.innerHTML = "";

  // Sort apps by total time spent (descending)
  const sortedApps = Object.entries(data).sort(
    ([, a], [, b]) => b.totalTime - a.totalTime
  );

  if (sortedApps.length === 0 && !isTracking) {
    reportContainer.innerHTML = `
            <div class="text-center bg-slate-700/50 p-8 rounded-lg">
                <p class="text-slate-400">No activity was tracked. Click "Start Tracking" to begin.</p>
            </div>
        `;
    return;
  }

  // Render each app's data
  for (const [appName, details] of sortedApps) {
    const appElement = document.createElement("div");
    appElement.className = "bg-slate-700 p-4 rounded-lg shadow-md";

    // Sort titles within the app by time
    const sortedTitles = Object.entries(details)
      .filter(([key]) => key !== "totalTime")
      .sort(([, a], [, b]) => b - a);

    let titlesHtml = "";
    if (
      sortedTitles.length > 1 ||
      (sortedTitles.length === 1 && sortedTitles[0][0] !== "Unknown Title")
    ) {
      titlesHtml = `<ul class="mt-3 space-y-2 text-sm text-slate-400 pl-4 border-l-2 border-slate-600">`;
      for (const [title, time] of sortedTitles) {
        titlesHtml += `
                    <li class="flex justify-between items-center">
                        <span class="truncate pr-4" title="${title}">${title}</span>
                        <span class="font-mono bg-slate-600/50 text-slate-300 rounded px-2 py-0.5">${formatTime(
                          time
                        )}</span>
                    </li>
                `;
      }
      titlesHtml += `</ul>`;
    }

    appElement.innerHTML = `
            <div class="flex justify-between items-center">
                <h3 class="text-lg font-bold text-cyan-300">${appName}</h3>
                <span class="text-xl font-semibold text-white">${formatTime(
                  details.totalTime
                )}</span>
            </div>
            ${titlesHtml}
        `;

    reportContainer.appendChild(appElement);
  }
});
