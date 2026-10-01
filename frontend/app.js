(() => {
  const state = {
    filter: "all",
    leads: [],
    activeLeadId: null,
  };

  const el = (id) => document.getElementById(id);

  // ---------- API helpers ----------

  async function apiGet(path) {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `POST ${path} failed: ${res.status}`);
    }
    return res.json();
  }

  // ---------- Status / metrics ----------

  const STATUS_STYLES = {
    RUNNING: { dot: "bg-emerald-400 pulse", text: "text-emerald-300" },
    PAUSED: { dot: "bg-amber-400", text: "text-amber-300" },
    STOPPED: { dot: "bg-slate-500", text: "text-slate-400" },
  };

  function renderState(s) {
    const style = STATUS_STYLES[s.status] || STATUS_STYLES.STOPPED;
    el("status-dot").className = `h-2 w-2 rounded-full ${style.dot}`;
    el("status-text").textContent = s.status;
    el("status-text").className = `font-semibold ${style.text}`;

    el("btn-start").disabled = s.status === "RUNNING";
    el("btn-pause").disabled = s.status !== "RUNNING";
    el("btn-stop").disabled = s.status === "STOPPED";
    [el("btn-start"), el("btn-pause"), el("btn-stop")].forEach((b) => {
      b.classList.toggle("opacity-40", b.disabled);
      b.classList.toggle("cursor-not-allowed", b.disabled);
    });

    if (typeof s.dailyEmailTarget === "number") el("m-target").textContent = s.dailyEmailTarget;
  }

  function renderMetrics(m) {
    el("m-sent").textContent = m.emails_sent_today ?? 0;
    el("m-audits").textContent = m.audits_completed_today ?? 0;
    el("m-replies").textContent = m.replies_received_today ?? 0;
    el("m-meetings").textContent = m.meetings_booked_today ?? 0;
    const target = Number(el("m-target").textContent) || 500;
    const pct = Math.min(100, Math.round(((m.emails_sent_today ?? 0) / target) * 100));
    el("m-sent-bar").style.width = `${pct}%`;
  }

  async function refreshState() {
    const s = await apiGet("/state");
    renderState(s);
    renderMetrics(s);
  }

  // ---------- Live log ----------

  const LEVEL_COLOR = {
    info: "text-slate-300",
    success: "text-emerald-400",
    warn: "text-amber-400",
    error: "text-rose-400",
  };

  function appendLogLine(entry) {
    const container = el("log-container");
    const line = document.createElement("div");
    line.className = `log-line ${LEVEL_COLOR[entry.level] || "text-slate-300"}`;
    const time = new Date(entry.created_at + "Z").toLocaleTimeString();
    line.textContent = `[${time}] [${entry.worker}] ${entry.message}`;
    container.appendChild(line);
    while (container.children.length > 300) container.removeChild(container.firstChild);
    container.scrollTop = container.scrollHeight;
  }

  // ---------- Leads table ----------

  const STATUS_BADGE = {
    DISCOVERED: "bg-slate-700 text-slate-300",
    NEW: "bg-slate-700 text-slate-300",
    AUDITING: "bg-sky-900 text-sky-300",
    AUDITED: "bg-sky-900 text-sky-300",
    AUDIT_FAILED: "bg-rose-950 text-rose-400",
    DRAFTING: "bg-violet-950 text-violet-300",
    READY_TO_SEND: "bg-violet-950 text-violet-300",
    SENDING: "bg-indigo-950 text-indigo-300",
    EMAILED: "bg-indigo-950 text-indigo-300",
    SEND_FAILED: "bg-rose-950 text-rose-400",
    REPLIED: "bg-amber-950 text-amber-300",
    INTERESTED: "bg-emerald-950 text-emerald-300",
    NOT_INTERESTED: "bg-slate-800 text-slate-500",
    QUESTION: "bg-amber-950 text-amber-300",
    MEETING_BOOKED: "bg-emerald-900 text-emerald-200",
  };

  function timeAgo(iso) {
    const diffMs = Date.now() - new Date(iso + "Z").getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function renderLeadsTable() {
    const tbody = el("leads-tbody");
    tbody.innerHTML = "";
    el("leads-empty").classList.toggle("hidden", state.leads.length > 0);

    for (const lead of state.leads) {
      const tr = document.createElement("tr");
      tr.className = "border-t border-slate-800 hover:bg-slate-800/60 cursor-pointer";
      tr.dataset.leadId = lead.id;
      const badge = STATUS_BADGE[lead.status] || "bg-slate-800 text-slate-300";
      tr.innerHTML = `
        <td class="px-4 py-2 font-medium text-slate-200">${escapeHtml(lead.domain)}</td>
        <td class="px-4 py-2 text-slate-400">${escapeHtml(lead.niche || "-")}</td>
        <td class="px-4 py-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge}">${lead.status}</span></td>
        <td class="px-4 py-2 text-slate-500">${timeAgo(lead.updated_at)}</td>
      `;
      tr.addEventListener("click", () => openLeadPanel(lead.id));
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
  }

  async function loadLeads() {
    state.leads = await apiGet(`/leads?filter=${state.filter}`);
    renderLeadsTable();
  }

  function setFilter(filter) {
    state.filter = filter;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      const active = btn.dataset.filter === filter;
      btn.classList.toggle("bg-slate-800", active);
      btn.classList.toggle("text-white", active);
      btn.classList.toggle("text-slate-400", !active);
    });
    loadLeads();
  }

  // ---------- Lead detail panel ----------

  async function openLeadPanel(id) {
    state.activeLeadId = id;
    const data = await apiGet(`/leads/${id}`);
    el("panel-domain").textContent = data.lead.domain;

    const flaws = data.audit?.flaws_json ? JSON.parse(data.audit.flaws_json) : [];
    const latestEmail = data.emails?.[data.emails.length - 1];
    const latestReply = data.replies?.[data.replies.length - 1];

    el("panel-content").innerHTML = `
      <div>
        <p class="text-slate-500 uppercase tracking-wide text-[10px] mb-1">Status</p>
        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE[data.lead.status] || "bg-slate-800 text-slate-300"}">${data.lead.status}</span>
      </div>

      <div>
        <p class="text-slate-500 uppercase tracking-wide text-[10px] mb-1">Audit Flaws</p>
        ${
          flaws.length
            ? `<ul class="list-disc list-inside space-y-1 text-slate-300">${flaws.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
            : `<p class="text-slate-500">No audit yet.</p>`
        }
        ${data.audit ? `<p class="mt-2 text-slate-500">SSL: ${data.audit.has_ssl ? "yes" : "no"} &middot; Mobile: ${data.audit.mobile_responsive ? "ok" : "issues"} &middot; Load: ${data.audit.load_time_ms ?? "-"}ms</p>` : ""}
      </div>

      <div>
        <p class="text-slate-500 uppercase tracking-wide text-[10px] mb-1">Email Sent</p>
        ${
          latestEmail
            ? `<div class="rounded-md border border-slate-800 bg-slate-950 p-3">
                 <p class="font-semibold text-slate-200 mb-1">${escapeHtml(latestEmail.subject)}</p>
                 <p class="text-slate-400 whitespace-pre-wrap">${escapeHtml(latestEmail.body)}</p>
                 <p class="mt-2 text-slate-600">via ${escapeHtml(latestEmail.smtp_account)} &middot; ${timeAgo(latestEmail.sent_at)}</p>
               </div>`
            : data.lead.draft_body
            ? `<div class="rounded-md border border-dashed border-slate-700 bg-slate-950 p-3">
                 <p class="font-semibold text-slate-400 mb-1">${escapeHtml(data.lead.draft_subject || "")} (draft)</p>
                 <p class="text-slate-500 whitespace-pre-wrap">${escapeHtml(data.lead.draft_body)}</p>
               </div>`
            : `<p class="text-slate-500">No email sent yet.</p>`
        }
      </div>

      <div>
        <p class="text-slate-500 uppercase tracking-wide text-[10px] mb-1">Reply</p>
        ${
          latestReply
            ? `<div class="rounded-md border border-slate-800 bg-slate-950 p-3">
                 <p class="mb-1"><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_BADGE[latestReply.classification] || "bg-slate-800"}">${latestReply.classification || "UNCLASSIFIED"}</span></p>
                 <p class="text-slate-400 whitespace-pre-wrap">${escapeHtml(latestReply.body || "")}</p>
               </div>`
            : `<p class="text-slate-500">No reply yet.</p>`
        }
      </div>

      <button id="btn-mark-booked" class="w-full mt-2 px-3 py-2 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold ${data.lead.status === "MEETING_BOOKED" ? "opacity-40 cursor-not-allowed" : ""}" ${data.lead.status === "MEETING_BOOKED" ? "disabled" : ""}>
        ${data.lead.status === "MEETING_BOOKED" ? "Meeting Booked" : "Mark Meeting Booked"}
      </button>
    `;

    const bookBtn = el("btn-mark-booked");
    if (bookBtn && !bookBtn.disabled) {
      bookBtn.addEventListener("click", async () => {
        await apiPost(`/leads/${id}/mark-meeting-booked`);
        openLeadPanel(id);
        loadLeads();
      });
    }

    el("panel-backdrop").classList.remove("hidden");
    el("lead-panel").classList.remove("hidden");
  }

  function closeLeadPanel() {
    el("panel-backdrop").classList.add("hidden");
    el("lead-panel").classList.add("hidden");
    state.activeLeadId = null;
  }

  // ---------- Add leads modal ----------

  function openAddLeadModal() {
    el("add-lead-backdrop").classList.remove("hidden");
  }
  function closeAddLeadModal() {
    el("add-lead-backdrop").classList.add("hidden");
    el("bulk-leads-input").value = "";
  }

  async function submitBulkLeads() {
    const raw = el("bulk-leads-input").value.trim();
    if (!raw) return closeAddLeadModal();

    const leads = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",").map((s) => s.trim());
        // An email can sit in any column; the rest are domain, niche, contact name in order.
        const contact_email = parts.find((p) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p));
        const [domain, niche, contact_name] = parts.filter((p) => p !== contact_email);
        return {
          domain,
          niche: niche || undefined,
          contact_name: contact_name || undefined,
          contact_email: contact_email || undefined,
        };
      })
      .filter((l) => l.domain);

    if (leads.length === 0) return closeAddLeadModal();

    await apiPost("/leads/bulk", { leads });
    closeAddLeadModal();
    loadLeads();
  }

  // ---------- Toasts ----------

  function showInterestedToast(payload) {
    const container = el("toast-container");
    const toast = document.createElement("div");
    toast.className =
      "log-line rounded-lg border border-emerald-700 bg-emerald-950 text-emerald-200 px-4 py-3 shadow-lg max-w-sm cursor-pointer";
    toast.innerHTML = `
      <p class="font-semibold text-sm mb-1">🔥 ${escapeHtml(payload.domain)} is INTERESTED</p>
      <p class="text-xs text-emerald-300/80 line-clamp-3">${escapeHtml(payload.snippet)}</p>
    `;
    toast.addEventListener("click", () => openLeadPanel(payload.leadId));
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 12000);
  }

  function showErrorToast(message) {
    const toast = document.createElement("div");
    toast.className =
      "log-line rounded-lg border border-rose-700 bg-rose-950 text-rose-200 px-4 py-3 shadow-lg max-w-sm text-xs cursor-pointer";
    toast.textContent = message;
    toast.addEventListener("click", () => toast.remove());
    el("toast-container").appendChild(toast);
    setTimeout(() => toast.remove(), 12000);
  }

  /** Runs a button action, surfacing server errors instead of failing silently. */
  function action(fn) {
    return () => fn().catch((err) => showErrorToast(err.message)).finally(refreshState);
  }

  // ---------- WebSocket ----------

  function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.addEventListener("open", () => el("ws-indicator").classList.replace("bg-slate-600", "bg-emerald-400"));
    ws.addEventListener("close", () => {
      el("ws-indicator").classList.replace("bg-emerald-400", "bg-rose-500");
      setTimeout(connectWebSocket, 2000);
    });

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "log":
          appendLogLine(msg.payload);
          break;
        case "log_backfill":
          el("log-container").innerHTML = "";
          msg.payload.forEach(appendLogLine);
          break;
        case "metrics":
          renderMetrics(msg.payload);
          break;
        case "state_change":
          refreshState();
          break;
        case "lead_update":
          loadLeads();
          if (state.activeLeadId === msg.payload.leadId) openLeadPanel(msg.payload.leadId);
          break;
        case "interested_alert":
          showInterestedToast(msg.payload);
          loadLeads();
          break;
      }
    });
  }

  // ---------- Wiring ----------

  function init() {
    el("btn-start").addEventListener("click", action(() => apiPost("/start")));
    el("btn-pause").addEventListener("click", action(() => apiPost("/pause")));
    el("btn-stop").addEventListener("click", action(() => apiPost("/stop")));
    el("btn-retry-failed").addEventListener(
      "click",
      action(() => apiPost("/leads/retry-failed").then(loadLeads))
    );

    document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => setFilter(btn.dataset.filter)));

    el("panel-close").addEventListener("click", closeLeadPanel);
    el("panel-backdrop").addEventListener("click", closeLeadPanel);

    el("btn-add-lead").addEventListener("click", openAddLeadModal);
    el("btn-cancel-add").addEventListener("click", closeAddLeadModal);
    el("btn-submit-add").addEventListener("click", submitBulkLeads);
    el("add-lead-backdrop").addEventListener("click", (e) => {
      if (e.target === el("add-lead-backdrop")) closeAddLeadModal();
    });

    refreshState();
    loadLeads();
    connectWebSocket();

    setInterval(refreshState, 10000);
    setInterval(loadLeads, 15000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
