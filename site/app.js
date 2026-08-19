(() => {
  "use strict";

  const DATA_PATH = "./data.json";
  const CONFIDENT_RUN_THRESHOLD = 12;
  const HOUR_MS = 60 * 60 * 1000;

  const sampleFallback = {
    generated_at: "2026-08-19T21:42:39.643Z",
    repo: "austenstone/actions-external-cron",
    window: { start: "2026-08-18T00:00:00.000Z", end: "2026-08-18T23:00:00.000Z", slots: 24 },
    sources: [
      {
        source: "deno-deploy",
        runs: 24,
        confident: true,
        reliability: 1,
        p50_ms: 1900,
        p90_ms: 2500,
        worst_ms: 3100,
        failed: 0,
        is_control: false,
        samples: [
          { slot: "2026-08-18T00:00:00.000Z", drift_ms: 1800, conclusion: "success" },
          { slot: "2026-08-18T01:00:00.000Z", drift_ms: -800, conclusion: "success" },
          { slot: "2026-08-18T02:00:00.000Z", drift_ms: 2100, conclusion: "success" }
        ]
      },
      {
        source: "cloudflare",
        runs: 24,
        confident: true,
        reliability: 1,
        p50_ms: 2800,
        p90_ms: 3300,
        worst_ms: 3500,
        failed: 0,
        is_control: false,
        samples: [
          { slot: "2026-08-18T00:00:00.000Z", drift_ms: 2750, conclusion: "success" },
          { slot: "2026-08-18T01:00:00.000Z", drift_ms: 2910, conclusion: "success" },
          { slot: "2026-08-18T02:00:00.000Z", drift_ms: 3050, conclusion: "success" }
        ]
      },
      {
        source: "github-schedule",
        runs: 24,
        confident: true,
        reliability: 1,
        p50_ms: 671900,
        p90_ms: 736000,
        worst_ms: 802500,
        failed: 0,
        is_control: true,
        samples: [
          { slot: "2026-08-18T00:00:00.000Z", drift_ms: 666000, conclusion: "success" },
          { slot: "2026-08-18T01:00:00.000Z", drift_ms: 681000, conclusion: "success" },
          { slot: "2026-08-18T02:00:00.000Z", drift_ms: 702000, conclusion: "success" }
        ]
      }
    ]
  };

  // Keys must match the `source` each example actually sends. Verified against
  // examples/*/ — aliases cover the plural/short spellings people reach for.
  const sourceLabels = {
    "aws-eventbridge": "AWS EventBridge",
    "azure-logic-app": "Azure Logic Apps",
    "azure-logic-apps": "Azure Logic Apps",
    cloudflare: "Cloudflare Workers",
    "cloudflare-worker": "Cloudflare Workers",
    deno: "Deno Deploy",
    "deno-deploy": "Deno Deploy",
    "gcp-cloud-scheduler": "GCP Cloud Scheduler",
    "gcp-scheduler": "GCP Cloud Scheduler",
    "github-schedule": "GitHub schedule",
    "vercel-cron": "Vercel Cron"
  };

  const $ = (selector) => document.querySelector(selector);

  const escapeHtml = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const labelForSource = (source) =>
    sourceLabels[source] ??
    source
      .split("-")
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");

  const isControl = ({ is_control: isControlSource, source }) => isControlSource || source === "github-schedule";

  const formatDuration = (milliseconds) => {
    if (!Number.isFinite(milliseconds)) {
      return "—";
    }

    const sign = milliseconds < 0 ? "-" : "";
    const absoluteSeconds = Math.abs(milliseconds) / 1000;

    if (absoluteSeconds < 60) {
      return `${sign}${absoluteSeconds.toFixed(1)}s`;
    }

    const minutes = Math.floor(absoluteSeconds / 60);
    const seconds = absoluteSeconds - minutes * 60;
    return `${sign}${minutes}m ${seconds.toFixed(1)}s`;
  };

  const formatPercent = (value) => {
    if (!Number.isFinite(value)) {
      return "—";
    }

    const percent = value * 100;
    return `${percent >= 99.95 ? "100" : percent.toFixed(1)}%`;
  };

  const formatDateTime = (isoString) => {
    if (!isoString) {
      return "—";
    }

    const date = new Date(isoString);
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC"
        }).format(date);
  };

  const sortedSources = (sources) =>
    [...sources].sort((first, second) => {
      if (Boolean(first.confident) !== Boolean(second.confident)) {
        return first.confident ? -1 : 1;
      }

      return (first.p50_ms ?? Number.POSITIVE_INFINITY) - (second.p50_ms ?? Number.POSITIVE_INFINITY);
    });

  const reliabilityClass = (reliability) => {
    if (!Number.isFinite(reliability) || reliability < 0.95) {
      return "danger";
    }

    return reliability < 0.99 ? "warning" : "";
  };

  const loadData = async () => {
    try {
      const response = await fetch(DATA_PATH, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Unable to fetch ${DATA_PATH}: HTTP ${response.status}`);
      }

      return { data: await response.json(), usedFallback: false };
    } catch (error) {
      console.warn("Using bundled sample data because data.json could not be fetched.", error);
      return { data: sampleFallback, usedFallback: true };
    }
  };

  const confidentExternalSources = (sources) =>
    sources.filter((source) => source.confident && !isControl(source));

  const bestReliableExternal = (sources) =>
    confidentExternalSources(sources).sort((first, second) => {
      const reliabilityDelta = (second.reliability ?? 0) - (first.reliability ?? 0);
      return Math.abs(reliabilityDelta) > 0.0001
        ? reliabilityDelta
        : (first.p50_ms ?? Number.POSITIVE_INFINITY) - (second.p50_ms ?? Number.POSITIVE_INFINITY);
    })[0];

  const setText = (selector, value) => {
    const element = $(selector);
    if (element) {
      element.textContent = value;
    }
  };

  const renderDataNote = (usedFallback) => {
    const note = $("#data-note");
    if (!note) {
      return;
    }

    note.hidden = !usedFallback;
    note.textContent = usedFallback
      ? "Rendering bundled sample data because ./data.json could not be fetched. This keeps the dashboard usable when opened directly as a file; served Pages builds use the generated fixture."
      : "";
  };

  const renderVerdict = (data, sources) => {
    const title = $("#verdict-title");
    const copy = $("#verdict-copy");

    if (!title || !copy) {
      return;
    }

    if (sources.length === 0) {
      title.textContent = "No scheduler reports yet.";
      copy.textContent = "The dashboard is wired up, but this window has not collected any runs yet.";
      return;
    }

    const control = sources.find(isControl);
    const bestExternal = bestReliableExternal(sources);

    if (!control?.confident || !bestExternal) {
      title.textContent = "Not enough confident data yet.";
      copy.textContent = `A verdict requires GitHub schedule plus at least one external scheduler with ${CONFIDENT_RUN_THRESHOLD}+ runs.`;
      return;
    }

    const diffMs = control.p50_ms - bestExternal.p50_ms;
    const sourceName = labelForSource(bestExternal.source);
    const controlName = labelForSource(control.source);

    if (diffMs > 0) {
      title.textContent = `${sourceName} fires ${formatDuration(diffMs)} sooner than ${controlName}.`;
    } else if (diffMs < 0) {
      title.textContent = `${controlName} is ${formatDuration(Math.abs(diffMs))} ahead of the best external scheduler.`;
    } else {
      title.textContent = `${sourceName} and ${controlName} are tied on median drift.`;
    }

    copy.textContent = `${sourceName} hit ${formatPercent(bestExternal.reliability)} of slots with ${formatDuration(bestExternal.p50_ms)} median drift. ${controlName} is the visually marked control group.`;
  };

  const renderMetrics = (data, sources) => {
    const { window: dataWindow = {} } = data;
    const totalSamples = sources.reduce((count, source) => count + (source.samples?.length ?? 0), 0);
    const lowConfidence = sources.filter((source) => !source.confident).length;
    const bestExternal = bestReliableExternal(sources);
    const control = sources.find(isControl);

    setText("#metric-window", `${dataWindow.slots ?? "—"} slots`);
    setText("#metric-slots", `${formatDateTime(dataWindow.start)} → ${formatDateTime(dataWindow.end)} UTC`);
    setText("#metric-best", bestExternal ? labelForSource(bestExternal.source) : "—");
    setText(
      "#metric-best-detail",
      bestExternal
        ? `${formatPercent(bestExternal.reliability)} slots • ${formatDuration(bestExternal.p50_ms)} median`
        : "Waiting for a confident external source"
    );
    setText("#metric-control", control ? formatDuration(control.p50_ms) : "—");
    setText(
      "#metric-control-detail",
      control ? `${formatPercent(control.reliability)} slots hit • ${control.runs} runs` : "No control sample yet"
    );
    setText("#metric-samples", String(totalSamples));
    setText(
      "#metric-confidence",
      totalSamples === 0
        ? "Waiting for the first run"
        : lowConfidence > 0
          ? `${lowConfidence} low-confidence source${lowConfidence === 1 ? "" : "s"}`
          : "All ranked sources are confident"
    );
  };

  const sourceCell = (source) => {
    const badges = [
      isControl(source) ? '<span class="badge control">Control</span>' : "",
      !source.confident
        ? '<abbr class="badge confidence" title="Fewer than 12 runs. Treat this sample as directional only.">Low confidence †</abbr>'
        : ""
    ]
      .filter(Boolean)
      .join("");

    return `<td>
      <span class="source-name">${escapeHtml(labelForSource(source.source))}</span>
      <span class="source-id">${escapeHtml(source.source)}</span>
      ${badges ? `<span class="badge-row">${badges}</span>` : ""}
    </td>`;
  };

  const renderTable = (sources) => {
    const body = $("#leaderboard-body");
    if (!body) {
      return;
    }

    if (sources.length === 0) {
      body.innerHTML = '<tr><td colspan="7">No scheduler data has been collected for this window yet.</td></tr>';
      return;
    }

    body.innerHTML = sortedSources(sources)
      .map((source) => {
        const rowClasses = [isControl(source) ? "control-row" : "", !source.confident ? "low-confidence-row" : ""]
          .filter(Boolean)
          .join(" ");
        const confidenceSuffix = source.confident ? "" : " †";
        const reliability = source.reliability ?? 0;

        return `<tr class="${rowClasses}">
          ${sourceCell(source)}
          <td>${source.runs ?? 0}</td>
          <td><span class="reliability-pill ${reliabilityClass(reliability)}">${formatPercent(reliability)}</span></td>
          <td>${formatDuration(source.p50_ms)}${confidenceSuffix}</td>
          <td>${formatDuration(source.p90_ms)}${confidenceSuffix}</td>
          <td>${formatDuration(source.worst_ms)}${confidenceSuffix}</td>
          <td>${source.failed ?? 0}</td>
        </tr>`;
      })
      .join("");
  };

  const signedLog = (milliseconds) => {
    const seconds = Math.abs(milliseconds) / 1000;
    const transformed = Math.log10(1 + seconds);
    return milliseconds < 0 ? -transformed : transformed;
  };

  const chartColor = (source) => {
    if (!source.confident) {
      return "var(--faint)";
    }

    if (isControl(source)) {
      return "var(--control)";
    }

    return "var(--success)";
  };

  // Hand-rolled SVG avoids a CDN/runtime dependency and lets us use a signed log scale for negative drift.
  const renderMedianChart = (sources) => {
    const container = $("#median-chart");
    if (!container) {
      return;
    }

    if (sources.length === 0) {
      container.innerHTML = '<p class="chart-empty">No median drift to chart yet.</p>';
      return;
    }

    const rows = sortedSources(sources);
    const width = 1000;
    const rowHeight = 54;
    const margin = { top: 32, right: 132, bottom: 42, left: 190 };
    const height = margin.top + margin.bottom + rows.length * rowHeight;
    const values = rows.map((source) => signedLog(source.p50_ms ?? 0));
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(0, ...values);
    const span = maxValue === minValue ? 1 : maxValue - minValue;
    const plotWidth = width - margin.left - margin.right;
    const x = (value) => margin.left + ((value - minValue) / span) * plotWidth;
    const zeroX = x(0);

    const rowMarkup = rows
      .map((source, index) => {
        const y = margin.top + index * rowHeight + rowHeight / 2;
        const value = signedLog(source.p50_ms ?? 0);
        const valueX = x(value);
        const startX = Math.min(zeroX, valueX);
        const barWidth = Math.max(3, Math.abs(valueX - zeroX));
        const labelX = valueX >= zeroX ? Math.min(valueX + 18, width - margin.right + 12) : Math.max(valueX - 18, 16);
        const anchor = valueX >= zeroX ? "start" : "end";
        const dash = source.confident ? "" : ' stroke-dasharray="5 5"';
        const opacity = source.confident ? "1" : "0.48";
        const title = `${labelForSource(source.source)} median drift ${formatDuration(source.p50_ms)}`;

        return `<g aria-label="${escapeHtml(title)}">
          <text x="18" y="${y + 5}" class="chart-label">${escapeHtml(labelForSource(source.source))}${source.confident ? "" : " †"}</text>
          <line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" class="grid-line" />
          <rect x="${startX}" y="${y - 9}" width="${barWidth}" height="18" rx="9" fill="${chartColor(source)}" opacity="${opacity}"${dash} />
          <circle cx="${valueX}" cy="${y}" r="4" fill="${chartColor(source)}" opacity="${opacity}" />
          <text x="${labelX}" y="${y + 5}" text-anchor="${anchor}" class="chart-value">${escapeHtml(formatDuration(source.p50_ms))}</text>
        </g>`;
      })
      .join("");

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="median-title median-desc">
      <title id="median-title">Median drift by scheduler</title>
      <desc id="median-desc">Signed logarithmic bar chart comparing median drift. The leaderboard table provides the exact text equivalent.</desc>
      <line x1="${zeroX}" x2="${zeroX}" y1="${margin.top - 12}" y2="${height - margin.bottom + 10}" class="zero-line" />
      <text x="${zeroX}" y="${height - 12}" text-anchor="middle" class="axis-label">0 drift</text>
      <text x="${margin.left}" y="18" class="axis-label">early</text>
      <text x="${width - margin.right}" y="18" text-anchor="end" class="axis-label">late, log scale</text>
      ${rowMarkup}
    </svg>`;
  };

  const sampleXPosition = (slot, dataWindow, margin, plotWidth) => {
    const start = new Date(dataWindow.start).getTime();
    const slots = Math.max(1, dataWindow.slots ?? 1);
    const slotTime = new Date(slot).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(slotTime)) {
      return margin.left;
    }

    const slotIndex = Math.min(slots - 1, Math.max(0, Math.round((slotTime - start) / HOUR_MS)));
    return margin.left + (slotIndex / Math.max(1, slots - 1)) * plotWidth;
  };

  const renderStripChart = (data, sources) => {
    const container = $("#strip-chart");
    if (!container) {
      return;
    }

    const rows = sortedSources(sources).filter((source) => (source.samples?.length ?? 0) > 0);

    if (rows.length === 0) {
      container.innerHTML = '<p class="chart-empty">No hourly samples to chart yet.</p>';
      return;
    }

    const width = 1000;
    const rowHeight = 44;
    const margin = { top: 36, right: 34, bottom: 40, left: 190 };
    const height = margin.top + margin.bottom + rows.length * rowHeight;
    const plotWidth = width - margin.left - margin.right;
    const maxDrift = Math.max(1, ...rows.flatMap((source) => source.samples.map((sample) => Math.abs(sample.drift_ms ?? 0))));
    const tickSlots = [0, 6, 12, 18, Math.max(0, (data.window?.slots ?? 1) - 1)];

    const ticks = [...new Set(tickSlots)]
      .map((slotIndex) => {
        const x = margin.left + (slotIndex / Math.max(1, (data.window?.slots ?? 1) - 1)) * plotWidth;
        return `<g>
          <line x1="${x}" x2="${x}" y1="${margin.top - 10}" y2="${height - margin.bottom + 8}" class="grid-line" />
          <text x="${x}" y="${height - 12}" text-anchor="middle" class="axis-label">${String(slotIndex).padStart(2, "0")}:00</text>
        </g>`;
      })
      .join("");

    const lanes = rows
      .map((source, index) => {
        const y = margin.top + index * rowHeight + rowHeight / 2;
        const samples = source.samples
          .map((sample) => {
            const x = sampleXPosition(sample.slot, data.window ?? {}, margin, plotWidth);
            const drift = sample.drift_ms ?? 0;
            const failed = sample.conclusion && sample.conclusion !== "success";
            const radius = 4 + Math.min(8, (Math.log10(1 + Math.abs(drift) / 1000) / Math.log10(1 + maxDrift / 1000)) * 8);
            const color = failed ? "var(--danger)" : drift < 0 ? "var(--early)" : chartColor(source);
            const opacity = source.confident ? "0.92" : "0.45";
            const title = `${labelForSource(source.source)} ${formatDuration(drift)} at ${sample.slot}${failed ? ` (${sample.conclusion})` : ""}`;

            return failed
              ? `<g aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title><path d="M ${x - radius} ${y - radius} L ${x + radius} ${y + radius} M ${x + radius} ${y - radius} L ${x - radius} ${y + radius}" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="${opacity}" /></g>`
              : `<circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}" fill="${color}" opacity="${opacity}" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title></circle>`;
          })
          .join("");

        return `<g>
          <text x="18" y="${y + 5}" class="chart-label">${escapeHtml(labelForSource(source.source))}${source.confident ? "" : " †"}</text>
          <line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" class="grid-line lane" />
          ${samples}
        </g>`;
      })
      .join("");

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="strip-title strip-desc">
      <title id="strip-title">Hourly drift samples by source</title>
      <desc id="strip-desc">Dot strip showing each scheduler sample by hourly slot. Dot size increases logarithmically with drift. The leaderboard table provides exact summary values.</desc>
      ${ticks}
      ${lanes}
    </svg>`;
  };

  const renderFooter = (data) => {
    setText("#generated-at", `Generated: ${formatDateTime(data.generated_at)} UTC`);

    const repoLink = $("#repo-link");
    if (repoLink && data.repo) {
      repoLink.href = `https://github.com/${data.repo}`;
      repoLink.textContent = data.repo;
    }
  };

  const render = ({ data, usedFallback }) => {
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const emptyState = $("#empty-state");

    renderDataNote(usedFallback);
    renderVerdict(data, sources);
    renderMetrics(data, sources);
    renderTable(sources);
    renderMedianChart(sources);
    renderStripChart(data, sources);
    renderFooter(data);

    if (emptyState) {
      emptyState.hidden = sources.length > 0;
    }
  };

  loadData()
    .then(render)
    .catch((error) => {
      console.error("Dashboard render failed", error);
      setText("#verdict-title", "Dashboard failed to render.");
      setText("#verdict-copy", "Check the browser console for the data parsing or rendering error.");
    });

  window.cronDashboard = { formatDuration, render };
})();
