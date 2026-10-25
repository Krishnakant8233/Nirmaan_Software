/**
 * IMPORTANT: every permission check in this file (isManager(), canEditTask(),
 * hiding a "New task" button, etc.) is a UX convenience only -- it decides
 * what to *show*, never what to *allow*. The real enforcement is entirely
 * server-side (roles_required / project_access_required / the manager-vs-
 * assignee check in update_task). If this file got every check backwards,
 * the worst outcome is a confusing UI -- not a security hole -- because
 * the API re-checks everything itself regardless of what the UI sent.
 */

const state = {
  user: null,
  authMode: "login",
  projects: [],
  currentProject: null,
  tasks: [],
  team: [],
  pendingUsers: [],
  messages: [],
  progressUpdates: [],
  files: [],
  activity: [],
  notifications: [],
  syncStatus: navigator.onLine ? "online" : "offline",
  lastSyncedAt: null,
};

const root = document.getElementById("app");

function isManager() {
  return !!state.user && (state.user.role === "boss" || state.user.role === "project_manager");
}

function isBoss() {
  return !!state.user && state.user.role === "boss";
}

function canPostProgress() {
  return !!state.user && ["boss", "project_manager", "contractor"].includes(state.user.role);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function roleLabel(role) {
  return {
    boss: "Boss / Admin",
    project_manager: "Project Manager",
    architect: "Architect",
    contractor: "Contractor",
    client: "Client",
  }[role] || role;
}

/* ------------------------------- Rendering ------------------------------ */

function render() {
  mount(root, state.user ? renderShell() : renderAuthScreen());
}

function renderAuthScreen() {
  const isLogin = state.authMode === "login";
  return el("div", { class: "auth-screen" }, [
    el("div", { class: "auth-card" }, [
      el("div", { class: "brand" }, [
        el("div", { class: "brand-mark" }, ["N"]),
        el("div", {}, [
          el("p", { class: "brand-name" }, ["Nirmaan"]),
          el("p", { class: "brand-tag" }, ["Site control, not spreadsheets"]),
        ]),
      ]),
      el("div", { class: "auth-tabs" }, [
        el(
          "button",
          {
            class: isLogin ? "tab active" : "tab",
            onclick: () => {
              state.authMode = "login";
              render();
            },
          },
          ["Log in"]
        ),
        el(
          "button",
          {
            class: !isLogin ? "tab active" : "tab",
            onclick: () => {
              state.authMode = "register";
              render();
            },
          },
          ["Register"]
        ),
      ]),
      isLogin ? renderLoginForm() : renderRegisterForm(),
    ]),
  ]);
}

function renderLoginForm() {
  const phoneInput = el("input", { type: "tel", placeholder: "Phone number", autocomplete: "tel" });
  const passwordInput = el("input", {
    type: "password",
    placeholder: "Password",
    autocomplete: "current-password",
  });

  const submit = async (e) => {
    e.preventDefault();
    try {
      const data = await apiRequest("/auth/login", {
        method: "POST",
        auth: false,
        body: { phone: phoneInput.value.trim(), password: passwordInput.value },
      });
      setTokens(data);
      state.user = data.user;
      showToast(`Welcome back, ${data.user.name}.`, "success");
      await loadProjects();
      if (state.projects.length) await selectProject(state.projects[0].id);
      else render();
      state.syncStatus = navigator.onLine ? "online" : "offline";
      state.lastSyncedAt = new Date();
      startAutoSync();
    } catch (_err) {
      // apiRequest already showed a toast with the real server message.
    }
  };

  return el("form", { class: "auth-form", onsubmit: submit }, [
    el("label", {}, ["Phone", phoneInput]),
    el("label", {}, ["Password", passwordInput]),
    el("button", { class: "btn btn-primary", type: "submit" }, ["Log in"]),
  ]);
}

function renderRegisterForm() {
  const nameInput = el("input", { type: "text", placeholder: "Full name" });
  const phoneInput = el("input", { type: "tel", placeholder: "Phone number" });
  const passwordInput = el("input", { type: "password", placeholder: "Password (min 6 characters)" });
  const roleSelect = el("select", {}, [
    el("option", { value: "project_manager" }, ["Project Manager"]),
    el("option", { value: "architect" }, ["Architect"]),
    el("option", { value: "contractor" }, ["Contractor"]),
    el("option", { value: "client" }, ["Client"]),
  ]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/auth/register", {
        method: "POST",
        auth: false,
        body: {
          name: nameInput.value.trim(),
          phone: phoneInput.value.trim(),
          password: passwordInput.value,
          role: roleSelect.value,
        },
      });
      showToast("Registered. A Boss must approve your account before you can log in.", "success");
      state.authMode = "login";
      render();
    } catch (_err) {
      /* toasted already */
    }
  };

  return el("form", { class: "auth-form", onsubmit: submit }, [
    el("label", {}, ["Name", nameInput]),
    el("label", {}, ["Phone", phoneInput]),
    el("label", {}, ["Password", passwordInput]),
    el("label", {}, ["Role", roleSelect]),
    el("button", { class: "btn btn-primary", type: "submit" }, ["Register"]),
    el("p", { class: "hint" }, ["Boss accounts aren't self-registered -- ask an existing Boss."]),
  ]);
}



function openDialog(title, content) {
  const close = () => { document.removeEventListener("keydown", onKey); backdrop.remove(); };
  const onKey = e => { if (e.key === "Escape") close(); };
  const closeBtn = el("button", { class: "btn btn-ghost", type: "button", onclick: close, "aria-label": "Close" }, ["×"]);
  const backdrop = el("div", { class: "dialog-backdrop" }, [el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title }, [
    el("div", { class: "dialog-head" }, [el("h2", {}, [title]), closeBtn]), content
  ])]);
  document.addEventListener("keydown", onKey); document.body.appendChild(backdrop); closeBtn.focus();
}

function renderSyncStatus() {
  const labels = { online: "Online", syncing: "Syncing…", offline: "Offline" };
  const title = state.lastSyncedAt ? `Last synced ${state.lastSyncedAt.toLocaleTimeString()}` : "Internet synchronization status";
  return el("span", { class: `sync-status sync-${state.syncStatus}`, title, role: "status", "aria-live": "polite" }, [
    el("span", { class: "sync-dot", "aria-hidden": "true" }, []), labels[state.syncStatus] || "Online"
  ]);
}

function renderNotificationButton() {
  const unread = state.notifications.filter(n => !n.isRead).length;
  return el("button", { class: "btn btn-ghost notification-btn", title: "Notifications", "aria-label": `${unread} unread notifications`, onclick: openNotifications }, [unread ? `🔔 ${unread}` : "🔔"]);
}

function openNotifications() {
  const rows = state.notifications.length ? state.notifications.map(n => el("button", { class: `notification-row ${n.isRead ? "" : "unread"}`, onclick: async () => { if (!n.isRead) { await apiRequest(`/notifications/${n.id}/read`, { method: "PATCH" }); n.isRead=true; render(); } } }, [
    el("strong", {}, [n.text]), el("span", { class: "hint" }, [new Date(n.createdAt).toLocaleString()])
  ])) : [el("p", { class: "hint" }, ["No notifications yet."])];
  openDialog("Notifications", el("div", { class: "notification-list" }, rows));
}

async function loadNotifications() {
  try { const data = await apiRequest("/notifications"); state.notifications = data.notifications; } catch (_err) { state.notifications = []; }
}

function renderShell() {
  return el("div", { class: "shell" }, [
    el("header", { class: "topbar" }, [
      el("div", { class: "brand brand-compact" }, [
        el("div", { class: "brand-mark" }, ["N"]),
        el("p", { class: "brand-name" }, ["Nirmaan"]),
      ]),
      el("div", { class: "topbar-user" }, [
        renderSyncStatus(),
        el("button", { class: "btn btn-ghost install-app-btn", type: "button", onclick: installNirmaan, title: "Install Nirmaan on this device" }, ["Install"]),
        renderNotificationButton(),
        el("span", { class: "user-name" }, [state.user.name]),
        el("span", { class: "badge role-badge" }, [roleLabel(state.user.role)]),
        el(
          "button",
          {
            class: "btn btn-ghost",
            onclick: () => {
              clearTokens();
              stopAutoSync();
              state.user = null;
              state.projects = [];
              state.currentProject = null;
              render();
            },
          },
          ["Log out"]
        ),
      ]),
    ]),
    el("div", { class: "layout" }, [
      el("aside", { class: "sidebar" }, [renderSidebar()]),
      el("main", { class: "content" }, [
        state.currentProject ? renderProjectDetail() : renderEmptyState(),
      ]),
    ]),
  ]);
}

function renderSidebar() {
  const children = [el("h2", { class: "sidebar-title" }, ["Projects"])];

  children.push(
    el(
      "div",
      { class: "project-list" },
      state.projects.map((p) =>
        el(
          "button",
          {
            class:
              "project-item" + (state.currentProject && state.currentProject.id === p.id ? " active" : ""),
            onclick: () => selectProject(p.id),
          },
          [
            el("span", { class: "site-tag" }, [`Site ${p.siteCode}`]),
            el("span", { class: "project-name" }, [p.name]),
            el("span", { class: `status-pill status-${p.status}` }, [p.status.replace("_", " ")]),
          ]
        )
      )
    )
  );

  if (state.projects.length === 0) {
    children.push(el("p", { class: "hint" }, ["No projects yet."]));
  }

  if (isBoss()) {
    children.push(renderCreateProjectForm());
    children.push(renderPendingApprovals());
  }

  return el("div", {}, children);
}

function renderCreateProjectForm() {
  const codeInput = el("input", { type: "text", placeholder: "Site code (e.g. A)", maxlength: "10" });
  const nameInput = el("input", { type: "text", placeholder: "Project name" });
  const budgetInput = el("input", { type: "number", placeholder: "Budget (INR)" });

  const submit = async (e) => {
    e.preventDefault();
    try {
      const data = await apiRequest("/projects", {
        method: "POST",
        body: {
          siteCode: codeInput.value.trim(),
          name: nameInput.value.trim(),
          budget: Number(budgetInput.value) || 0,
        },
      });
      showToast(`${data.project.name} created.`, "success");
      codeInput.value = "";
      nameInput.value = "";
      budgetInput.value = "";
      await loadProjects();
      render();
    } catch (_err) {
      /* toasted already */
    }
  };

  return el("form", { class: "inline-form", onsubmit: submit }, [
    el("h3", {}, ["New project"]),
    codeInput,
    nameInput,
    budgetInput,
    el("button", { class: "btn btn-primary btn-small", type: "submit" }, ["Create"]),
  ]);
}

function renderPendingApprovals() {
  const wrap = el("div", { class: "pending-section" }, [
    el("div", { class: "panel-header" }, [
      el("h3", {}, ["Pending approvals"]),
      el(
        "button",
        {
          class: "btn btn-small btn-ghost",
          type: "button",
          onclick: async () => {
            await loadPendingUsers();
            render();
          },
        },
        ["Refresh"]
      ),
    ]),
  ]);

  if (state.pendingUsers.length === 0) {
    wrap.appendChild(el("p", { class: "hint" }, ["Nobody waiting."]));
    return wrap;
  }

  for (const u of state.pendingUsers) {
    wrap.appendChild(
      el("div", { class: "pending-row" }, [
        el("div", {}, [
          el("p", { class: "pending-name" }, [u.name]),
          el("p", { class: "hint" }, [`${roleLabel(u.role)} · `, el("span", { class: "id-tag" }, [u.id])]),
        ]),
        el(
          "button",
          {
            class: "btn btn-small",
            onclick: async () => {
              try {
                await apiRequest(`/auth/users/${u.id}/approve`, { method: "POST" });
                showToast(`${u.name} approved.`, "success");
                await loadPendingUsers();
                render();
              } catch (_err) {
                /* toasted already */
              }
            },
          },
          ["Approve"]
        ),
      ])
    );
  }
  return wrap;
}

function renderEmptyState() {
  return el("div", { class: "empty-state" }, [
    el("p", {}, ["Select a project from the sidebar to see its team and tasks."]),
  ]);
}

function renderProjectDetail() {
  const p = state.currentProject;
  return el("div", { class: "project-detail" }, [
    el("div", { class: "project-header" }, [
      el("div", {}, [
        el("p", { class: "site-tag" }, [`Site ${p.siteCode}`]),
        el("h1", {}, [p.name]),
        el("p", { class: "hint" }, [p.location || "No location set"]),
      ]),
      el("span", { class: `status-pill status-${p.status}` }, [p.status.replace("_", " ")]),
    ]),

    el("section", { class: "overview-grid", "aria-label": "Project overview" }, [
      el("div", { class: "overview-card" }, [el("span", { class: "hint" }, ["Progress"]), el("strong", {}, [`${Math.round(p.progressPercent || 0)}%`])]),
      el("div", { class: "overview-card" }, [el("span", { class: "hint" }, ["Budget"]), el("strong", {}, [formatMoney(p.budget || 0)])]),
      el("div", { class: "overview-card" }, [el("span", { class: "hint" }, ["Spent"]), el("strong", {}, [formatMoney(p.spent || 0)])]),
    ]),

    el("section", { class: "panel" }, [
      el("div", { class: "panel-header" }, [el("h2", {}, ["Team"]), isManager() ? renderGrantAccessForm() : null]),
      renderTeamList(),
    ]),

    el("section", { class: "panel" }, [
      el("div", { class: "panel-header" }, [
        el("h2", {}, ["Tasks"]),
        isManager() ? renderCreateTaskButton() : null,
      ]),
      renderTaskList(),
    ]),

    el("section", { class: "panel progress-panel" }, [
      el("div", { class: "panel-header" }, [
        el("div", {}, [el("h2", {}, ["Site updates"]), el("p", { class: "hint" }, ["Photos, voice notes, and daily progress from site."])]),
        canPostProgress() ? el("button", { class: "btn btn-small btn-primary", onclick: openProgressComposer }, ["+ Post update"]) : null,
      ]),
      canPostProgress() ? el("div", { class: "progress-feature-strip", onclick: openProgressComposer, role: "button", tabindex: "0", onkeydown: e => { if (e.key === "Enter" || e.key === " ") openProgressComposer(); } }, [
        el("span", {}, ["🖼 Upload photos"]), el("span", {}, ["📸 Live camera"]), el("span", {}, ["🎙 Voice note"]), el("span", {}, ["🗣 Speech-to-text"])
      ]) : null,
      renderProgressUpdates(),
    ]),

    el("section", { class: "panel" }, [
      el("div", { class: "panel-header" }, [el("h2", {}, ["Feedback"])]),
      renderFeedbackPanel(),
    ]),

    renderPersonalTools(),
  ]);
}


function renderPersonalTools() {
  const searchInput = el("input", { type: "search", placeholder: "Search tasks, updates, feedback, files…", "aria-label": "Search this project" });
  const results = el("div", { class: "search-results" });
  const doSearch = async (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (q.length < 2) { results.replaceChildren(el("p", { class: "hint" }, ["Type at least 2 characters."])); return; }
    try {
      const data = await apiRequest(`/projects/${state.currentProject.id}/search?q=${encodeURIComponent(q)}`);
      results.replaceChildren(...(data.results.length ? data.results.map(r => el("div", { class: "search-result" }, [
        el("span", { class: "badge" }, [r.type]), el("strong", {}, [r.title]), el("p", { class: "hint" }, [r.text || ""])
      ])) : [el("p", { class: "hint" }, ["No matches."])]));
    } catch (_err) {}
  };

  const fileInput = el("input", { type: "file", accept: ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt" });
  const upload = async (e) => {
    e.preventDefault();
    if (!fileInput.files[0]) return showToast("Choose a file first.", "error");
    const fd = new FormData(); fd.append("file", fileInput.files[0]);
    try { await apiFormRequest(`/projects/${state.currentProject.id}/files`, fd); fileInput.value = ""; await loadFiles(); render(); showToast("File uploaded.", "success"); } catch (_err) {}
  };
  const fileRows = state.files.length ? state.files.map(f => el("div", { class: "file-row" }, [
    el("div", {}, [el("strong", {}, [f.name]), el("p", { class: "hint" }, [`${Math.max(1, Math.round(f.sizeBytes/1024))} KB · ${f.uploadedBy ? f.uploadedBy.name : "Unknown"}`])]),
    el("button", { class: "btn btn-small", onclick: async () => { try { const blob = await apiBlob(`/api/projects/${state.currentProject.id}/files/${f.id}`); const u=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=u; a.download=f.name; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000); } catch(_e){ showToast("Could not download file.","error"); } } }, ["Download"])
  ])) : [el("p", { class: "hint" }, ["No project files yet."])];

  const activityRows = state.activity.length ? state.activity.slice(0,10).map(a => el("div", { class: "activity-row" }, [
    el("strong", {}, [a.actor ? a.actor.name : "System"]), el("span", {}, [a.detail || a.action]), el("span", { class: "hint" }, [new Date(a.createdAt).toLocaleString()])
  ])) : [el("p", { class: "hint" }, ["Activity will appear as files and other tracked actions are added."])];

  return el("section", { class: "panel" }, [
    el("div", { class: "panel-header" }, [el("h2", {}, ["Tools & files"]), el("button", { class: "btn btn-small", onclick: exportCurrentProject }, ["Export backup"])]),
    el("form", { class: "tool-search", onsubmit: doSearch }, [searchInput, el("button", { class: "btn btn-small", type: "submit" }, ["Search"])]), results,
    el("h3", {}, ["Project files"]), el("form", { class: "file-upload", onsubmit: upload }, [fileInput, el("button", { class: "btn btn-small btn-primary", type: "submit" }, ["Upload file"])]),
    el("div", { class: "file-list" }, fileRows),
    el("h3", {}, ["Recent activity"]), el("div", { class: "activity-list" }, activityRows),
  ]);
}

async function exportCurrentProject() {
  try {
    const blob = await apiBlob(`/api/projects/${state.currentProject.id}/export`);
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${state.currentProject.siteCode}-backup.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (_err) { showToast("Could not export this project.", "error"); }
}

function renderFeedbackPanel() {
  const list = el(
    "div",
    { class: "message-list" },
    state.messages.length
      ? state.messages.map(renderMessage)
      : [el("p", { class: "hint" }, ["No feedback yet. Anyone on this site's team can post here."])]
  );

  const bodyInput = el("textarea", { placeholder: "Share an update, a question, or feedback...", rows: "2" });
  const submit = async (e) => {
    e.preventDefault();
    const body = bodyInput.value.trim();
    if (!body) return;
    try {
      await apiRequest(`/projects/${state.currentProject.id}/messages`, {
        method: "POST",
        body: { body },
      });
      bodyInput.value = "";
      await loadMessages();
      render();
      const el2 = document.querySelector(".message-list");
      if (el2) el2.scrollTop = el2.scrollHeight;
    } catch (_err) {
      /* toasted already */
    }
  };

  return el("div", {}, [
    list,
    el("form", { class: "feedback-form", onsubmit: submit }, [
      bodyInput,
      el("button", { class: "btn btn-small btn-primary", type: "submit" }, ["Post"]),
    ]),
  ]);
}

function renderMessage(m) {
  const when = new Date(m.createdAt);
  const timeLabel = isNaN(when.getTime())
    ? ""
    : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return el("div", { class: "message-row" }, [
    el("div", { class: "message-meta" }, [
      el("span", { class: "message-sender" }, [m.sender ? m.sender.name : "Unknown"]),
      m.sender ? el("span", { class: "badge role-badge" }, [roleLabel(m.sender.role)]) : null,
      el("span", { class: "hint" }, [timeLabel]),
    ]),
    el("p", { class: "message-body" }, [m.body]),
  ]);
}

function renderGrantAccessForm() {
  const idInput = el("input", { type: "text", placeholder: "User ID, e.g. TW-TK-1234" });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/projects/${state.currentProject.id}/access`, {
        method: "POST",
        body: { userId: idInput.value.trim() },
      });
      showToast("Access granted.", "success");
      idInput.value = "";
      await loadTeam();
      render();
    } catch (_err) {
      /* toasted already */
    }
  };
  return el("form", { class: "inline-form inline-form-row", onsubmit: submit }, [
    idInput,
    el("button", { class: "btn btn-small", type: "submit" }, ["Grant access"]),
  ]);
}

function renderTeamList() {
  if (state.team.length === 0) {
    return el("p", { class: "hint" }, ["Nobody's been granted access to this site yet."]);
  }
  return el(
    "div",
    { class: "team-list" },
    state.team.map((u) =>
      el("div", { class: "team-row" }, [
        el("div", {}, [
          el("span", {}, [u.name]),
          el("p", { class: "hint" }, [el("span", { class: "id-tag" }, [u.id])]),
        ]),
        el("div", { class: "team-actions" }, [
          el("span", { class: "badge role-badge" }, [roleLabel(u.role)]),
          isBoss() ? el("button", { class: "btn btn-small btn-danger", type: "button", onclick: async () => {
            if (!window.confirm(`Revoke ${u.name}'s access to this project?`)) return;
            try { await apiRequest(`/projects/${state.currentProject.id}/access/${u.id}`, { method: "DELETE" }); showToast("Access revoked.", "success"); await loadTeam(); render(); } catch (_err) {}
          } }, ["Revoke"]) : null,
        ]),
      ])
    )
  );
}

function renderCreateTaskButton() {
  return el("button", { class: "btn btn-small btn-primary", onclick: () => openTaskForm() }, ["+ New task"]);
}

let taskFormOpen = false;

function openTaskForm() {
  taskFormOpen = true;
  render();
  const input = document.querySelector(".task-form input[type=text]");
  if (input) input.focus();
}

function renderTaskList() {
  const items = [];
  if (taskFormOpen) items.push(renderTaskForm());
  if (state.tasks.length === 0 && !taskFormOpen) {
    items.push(el("p", { class: "hint" }, ["No tasks yet."]));
  }
  for (const task of state.tasks) items.push(renderTaskCard(task));
  return el("div", { class: "task-list" }, items);
}

function renderTaskForm() {
  const titleInput = el("input", { type: "text", placeholder: "Task title" });
  const assigneeInput = el("input", { type: "text", placeholder: "Assignee user ID (optional)" });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/projects/${state.currentProject.id}/tasks`, {
        method: "POST",
        body: {
          title: titleInput.value.trim(),
          assigneeId: assigneeInput.value.trim() || undefined,
        },
      });
      showToast("Task created.", "success");
      taskFormOpen = false;
      await loadTasks();
      render();
    } catch (_err) {
      /* toasted already */
    }
  };

  return el("form", { class: "task-form inline-form", onsubmit: submit }, [
    titleInput,
    assigneeInput,
    el("div", { class: "form-actions" }, [
      el("button", { class: "btn btn-small btn-primary", type: "submit" }, ["Add task"]),
      el(
        "button",
        {
          class: "btn btn-small btn-ghost",
          type: "button",
          onclick: () => {
            taskFormOpen = false;
            render();
          },
        },
        ["Cancel"]
      ),
    ]),
  ]);
}

function renderTaskCard(task) {
  const isAssignee = !!(task.assignee && state.user && task.assignee.id === state.user.id);
  const canEditFully = isManager();
  const canEditStatus = canEditFully || isAssignee;

  const statusSelect = el(
    "select",
    { disabled: !canEditStatus },
    ["pending", "in_progress", "delayed", "done"].map((s) =>
      el("option", { value: s, selected: s === task.status }, [s.replace("_", " ")])
    )
  );

  const progressInput = el("input", {
    type: "number",
    min: "0",
    max: "100",
    value: String(task.progressPercent),
    disabled: !canEditStatus,
  });

  const saveStatus = async () => {
    const pct = Number(progressInput.value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { showToast("Progress must be between 0 and 100.", "error"); progressInput.focus(); return; }
    try {
      await apiRequest(`/projects/${state.currentProject.id}/tasks/${task.id}`, {
        method: "PATCH",
        body: { status: statusSelect.value, progressPercent: pct },
      });
      showToast("Task updated.", "success");
      await loadTasks();
      render();
    } catch (_err) {
      /* toasted already, including the real "you can only update status
         and progressPercent" message if a non-manager somehow sends more */
    }
  };

  const deleteTask = async () => {
    if (!window.confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;
    try {
      await apiRequest(`/projects/${state.currentProject.id}/tasks/${task.id}`, { method: "DELETE" });
      showToast("Task deleted.", "success");
      await loadTasks();
      render();
    } catch (_err) {
      /* toasted already */
    }
  };

  return el("div", { class: "task-card" }, [
    el("div", { class: "task-card-header" }, [
      el("p", { class: "task-title" }, [task.title]),
      el("span", { class: `priority-pill priority-${task.priority}` }, [task.priority]),
    ]),
    el("p", { class: "hint" }, [task.assignee ? `Assigned to ${task.assignee.name}` : "Unassigned"]),
    el("div", { class: "task-controls" }, [
      el("label", { class: "task-field" }, ["Status", statusSelect]),
      el("label", { class: "task-field" }, ["Progress %", progressInput]),
      canEditStatus
        ? el("button", { class: "btn btn-small", onclick: saveStatus }, ["Save"])
        : el("span", { class: "hint" }, ["Read-only for you"]),
      canEditFully ? el("button", { class: "btn btn-small btn-danger", onclick: deleteTask }, ["Delete"]) : null,
    ]),
  ]);
}


/* --------------------------- Site progress media ------------------------- */
let progressDialog = null;
let activeRecorder = null;
let activeStream = null;
let cameraStream = null;
let recordedAudio = null;
let speechRecognizer = null;
let lightboxUrls = [];
let progressPreviewUrls = [];
let recordingTimer = null;

function renderProgressUpdates() {
  if (!state.progressUpdates.length) return el("p", { class: "hint" }, ["No site updates posted yet."]);
  return el("div", { class: "progress-feed" }, state.progressUpdates.map(renderProgressCard));
}

function renderProgressCard(update) {
  const card = el("article", { class: "progress-card" });
  const when = new Date(update.createdAt || update.logDate);
  card.appendChild(el("div", { class: "progress-card-head" }, [
    el("div", {}, [el("h3", {}, [update.title]), el("p", { class: "hint" }, [`${update.author.name} · ${isNaN(when) ? update.logDate : when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`])]),
    update.progressPercentSnapshot == null ? null : el("span", { class: "progress-number" }, [`${Math.round(update.progressPercentSnapshot)}%`]),
  ]));
  if (update.description) card.appendChild(el("p", { class: "progress-copy" }, [update.description]));
  if (update.photos && update.photos.length) {
    const grid = el("div", { class: "photo-grid" });
    update.photos.forEach((photo, index) => {
      const button = el("button", { class: "photo-tile", type: "button", "aria-label": `Open photo ${index + 1}` }, [el("span", { class: "photo-loading" }, ["Loading photo…"])]);
      hydrateImageButton(button, photo.url, update.photos, index); grid.appendChild(button);
    });
    card.appendChild(grid);
  }
  if (update.audioUrl) { const audioWrap = el("div", { class: "voice-note" }, [el("strong", {}, ["Voice note"]), el("span", { class: "hint" }, ["Loading audio…"])]); hydrateAudio(audioWrap, update.audioUrl); card.appendChild(audioWrap); }
  if (update.audioTranscript) card.appendChild(el("div", { class: "transcript" }, [el("strong", {}, ["Transcript"]), el("p", {}, [update.audioTranscript])]));
  return card;
}

async function hydrateImageButton(button, mediaPath, allPhotos, index) {
  try { const blob = await apiBlob(mediaPath); const url = URL.createObjectURL(blob); button._objectUrl = url; button.replaceChildren(el("img", { src: url, alt: allPhotos[index].caption || `Site progress photo ${index + 1}` })); button.onclick = () => openLightbox(allPhotos, index); }
  catch (_err) { button.replaceChildren(el("span", { class: "hint" }, ["Photo unavailable"])); }
}
async function hydrateAudio(wrap, mediaPath) {
  try { const blob = await apiBlob(mediaPath); const url = URL.createObjectURL(blob); wrap.replaceChildren(el("strong", {}, ["Voice note"]), el("audio", { controls: true, preload: "metadata", src: url })); }
  catch (_err) { wrap.replaceChildren(el("span", { class: "hint" }, ["Voice note unavailable"])); }
}
async function openLightbox(photos, startIndex) {
  lightboxUrls.forEach(URL.revokeObjectURL); lightboxUrls = [];
  try {
    const urls = await Promise.all(photos.map(async p => { const u = URL.createObjectURL(await apiBlob(p.url)); lightboxUrls.push(u); return u; }));
    let index = startIndex; const image = el("img", { class: "lightbox-image", alt: "Site progress photo" }); const counter = el("span", { class: "lightbox-counter" }); const overlay = el("div", { class: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Photo viewer" });
    const show = () => { image.src = urls[index]; image.alt = photos[index].caption || `Site progress photo ${index + 1}`; counter.textContent = `${index + 1} / ${urls.length}`; };
    const close = () => { document.removeEventListener("keydown", keys); overlay.remove(); lightboxUrls.forEach(URL.revokeObjectURL); lightboxUrls = []; };
    const keys = e => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") { index = (index - 1 + urls.length) % urls.length; show(); } if (e.key === "ArrowRight") { index = (index + 1) % urls.length; show(); } };
    overlay.append(el("div", { class: "lightbox-toolbar" }, [counter, el("button", { class: "lightbox-close", onclick: close, "aria-label": "Close photo viewer" }, ["×"])]), image);
    if (urls.length > 1) overlay.append(el("button", { class: "lightbox-nav lightbox-prev", onclick: () => { index = (index - 1 + urls.length) % urls.length; show(); }, "aria-label": "Previous photo" }, ["‹"]), el("button", { class: "lightbox-nav lightbox-next", onclick: () => { index = (index + 1) % urls.length; show(); }, "aria-label": "Next photo" }, ["›"]));
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); }); document.body.appendChild(overlay); document.addEventListener("keydown", keys); show(); overlay.querySelector(".lightbox-close").focus();
  } catch (_err) { showToast("Could not open this photo.", "error"); }
}

function openProgressComposer() {
  if (progressDialog) return;
  const title = el("input", { type: "text", placeholder: "e.g. Ground floor slab completed", maxlength: "200" });
  const description = el("textarea", { rows: "3", placeholder: "What changed on site today?" });
  const progress = el("input", { type: "number", min: "0", max: "100", placeholder: "Overall progress %" });
  const galleryInput = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/heic", multiple: true, class: "visually-hidden" });
  const fallbackCameraInput = el("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden" });
  const selectedPhotos = [];
  const preview = el("div", { class: "media-preview-grid", "aria-live": "polite" });
  const photoStatus = el("span", { class: "hint" }, ["No photos attached."]);
  const cameraPanel = el("div", { class: "camera-panel hidden" });
  const cameraVideo = el("video", { class: "camera-video", autoplay: true, playsinline: true, muted: true });
  const cameraCanvas = el("canvas", { class: "hidden" });
  const captureButton = el("button", { class: "btn btn-primary", type: "button" }, ["Capture photo"]);
  const switchButton = el("button", { class: "btn", type: "button" }, ["Switch camera"]);
  const closeCameraButton = el("button", { class: "btn", type: "button" }, ["Close camera"]);
  cameraPanel.append(cameraVideo, cameraCanvas, el("div", { class: "camera-actions" }, [captureButton, switchButton, closeCameraButton]));
  let facingMode = "environment";
  const transcript = el("textarea", { rows: "4", placeholder: "Live transcript appears here. You can edit it before posting." });
  const recordStatus = el("span", { class: "hint", "aria-live": "polite" }, ["No voice note recorded."]);
  const audioPreview = el("audio", { controls: true, class: "hidden", preload: "metadata" });
  const recordButton = el("button", { class: "media-action", type: "button" }, ["🎙 Record voice note"]);
  const deleteRecording = el("button", { class: "btn btn-small hidden", type: "button" }, ["Delete recording"]);
  const speechButton = el("button", { class: "media-action", type: "button" }, ["🗣 Start speech-to-text"]);
  const galleryButton = el("button", { class: "media-action", type: "button" }, ["🖼 Upload photos"]);
  const cameraButton = el("button", { class: "media-action", type: "button" }, ["📸 Open camera"]);
  const capability = el("p", { class: "capability-note" }, [window.isSecureContext ? "Camera and microphone are available when you grant browser permission." : "Camera and microphone require HTTPS or localhost. Photo upload still works here."]);
  const form = el("form", { class: "progress-form" }); const cancel = el("button", { class: "btn", type: "button" }, ["Cancel"]); const submit = el("button", { class: "btn btn-primary", type: "submit" }, ["Post update"]);
  const dialog = el("div", { class: "dialog-backdrop" }, [el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "progress-dialog-title" }, [el("div", { class: "dialog-head" }, [el("div", {}, [el("p", { class: "site-tag" }, [`Site ${state.currentProject.siteCode}`]), el("h2", { id: "progress-dialog-title" }, ["Post site update"])]), el("button", { class: "btn btn-ghost", type: "button", onclick: closeProgressComposer, "aria-label": "Close" }, ["×"])]), form])]);

  function refreshPhotos() {
    progressPreviewUrls.forEach(URL.revokeObjectURL); progressPreviewUrls = []; preview.replaceChildren();
    selectedPhotos.forEach((file, index) => { const url = URL.createObjectURL(file); progressPreviewUrls.push(url); const remove = el("button", { type: "button", class: "media-preview-remove", "aria-label": `Remove photo ${index + 1}` }, ["×"]); remove.onclick = () => { selectedPhotos.splice(index, 1); refreshPhotos(); }; preview.append(el("div", { class: "media-preview-item" }, [el("img", { src: url, alt: `Selected photo ${index + 1}` }), remove])); });
    photoStatus.textContent = selectedPhotos.length ? `${selectedPhotos.length} photo${selectedPhotos.length === 1 ? "" : "s"} attached.` : "No photos attached.";
  }
  function addFiles(files) { for (const file of files) { if (selectedPhotos.length >= 12) { showToast("You can attach up to 12 photos per update.", "error"); break; } if (!file.type.startsWith("image/")) { showToast("Only image files can be attached as photos.", "error"); continue; } selectedPhotos.push(file); } refreshPhotos(); }
  async function startCamera() {
    if (!supportsCamera()) { fallbackCameraInput.click(); return; }
    stopMediaStream(cameraStream); cameraStream = null;
    try { cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false }); cameraVideo.srcObject = cameraStream; cameraPanel.classList.remove("hidden"); await cameraVideo.play(); }
    catch (_err) { showToast("Camera permission was not available. You can upload a photo instead.", "error"); }
  }
  function stopCamera() { stopMediaStream(cameraStream); cameraStream = null; cameraVideo.srcObject = null; cameraPanel.classList.add("hidden"); }
  galleryButton.onclick = () => galleryInput.click(); galleryInput.onchange = () => { addFiles([...galleryInput.files]); galleryInput.value = ""; };
  fallbackCameraInput.onchange = () => { addFiles([...fallbackCameraInput.files]); fallbackCameraInput.value = ""; };
  cameraButton.onclick = startCamera; closeCameraButton.onclick = stopCamera; switchButton.onclick = async () => { facingMode = facingMode === "environment" ? "user" : "environment"; await startCamera(); };
  captureButton.onclick = () => { if (!cameraVideo.videoWidth) return showToast("Camera is still starting.", "error"); cameraCanvas.width = cameraVideo.videoWidth; cameraCanvas.height = cameraVideo.videoHeight; cameraCanvas.getContext("2d").drawImage(cameraVideo, 0, 0); addFiles([dataUrlToFile(cameraCanvas.toDataURL("image/jpeg", .9), `camera-${Date.now()}.jpg`)]); };
  recordButton.onclick = () => toggleRecording(recordButton, recordStatus, audioPreview, deleteRecording);
  deleteRecording.onclick = () => { recordedAudio = null; if (audioPreview.src) URL.revokeObjectURL(audioPreview.src); audioPreview.removeAttribute("src"); audioPreview.classList.add("hidden"); deleteRecording.classList.add("hidden"); recordStatus.textContent = "No voice note recorded."; recordButton.textContent = "🎙 Record voice note"; };
  speechButton.onclick = () => toggleSpeech(speechButton, transcript);
  form.append(el("label", {}, ["Title", title]), el("label", {}, ["Details", description]), el("label", {}, ["Progress", progress]), capability, el("div", { class: "media-action-grid" }, [galleryButton, cameraButton, recordButton, speechButton]), galleryInput, fallbackCameraInput, cameraPanel, photoStatus, preview, el("div", { class: "record-preview" }, [recordStatus, audioPreview, deleteRecording]), el("label", {}, ["Transcript / site note", transcript]), el("div", { class: "dialog-actions" }, [cancel, submit]));
  cancel.onclick = closeProgressComposer;
  form.onsubmit = async e => { e.preventDefault(); if (!title.value.trim()) { showToast("Add a title for this update.", "error"); title.focus(); return; } if (progress.value !== "" && (!Number.isFinite(Number(progress.value)) || Number(progress.value) < 0 || Number(progress.value) > 100)) { showToast("Progress must be between 0 and 100.", "error"); progress.focus(); return; } if (activeRecorder && activeRecorder.state === "recording") return showToast("Stop the voice recording before posting.", "error"); const totalBytes = selectedPhotos.reduce((sum, f) => sum + f.size, 0) + (recordedAudio ? recordedAudio.size : 0); if (totalBytes > 24 * 1024 * 1024) return showToast("Attachments are too large. Keep photos and audio under 24 MB total.", "error"); const fd = new FormData(); fd.append("title", title.value.trim()); fd.append("description", description.value.trim()); fd.append("transcript", transcript.value.trim()); if (progress.value) fd.append("progressPercent", progress.value); selectedPhotos.forEach(f => fd.append("photos", f)); if (recordedAudio) fd.append("audio", recordedAudio, `voice-note.${audioExtension(recordedAudio.type)}`); submit.disabled = true; submit.textContent = "Posting…"; try { await apiFormRequest(`/projects/${state.currentProject.id}/progress`, fd); showToast("Site update posted.", "success"); closeProgressComposer(); await loadProgress(); render(); } catch (_err) { submit.disabled = false; submit.textContent = "Post update"; } };
  const escape = e => { if (e.key === "Escape") closeProgressComposer(); }; dialog._escape = escape; dialog._stopCamera = stopCamera; document.addEventListener("keydown", escape); document.body.appendChild(dialog); progressDialog = dialog; recordedAudio = null; cancel.focus();
}

function closeProgressComposer() {
  if (!progressDialog) return;
  if (progressDialog._escape) document.removeEventListener("keydown", progressDialog._escape); if (progressDialog._stopCamera) progressDialog._stopCamera();
  if (activeRecorder && activeRecorder.state !== "inactive") activeRecorder.stop(); stopMediaStream(activeStream); activeStream = null;
  if (speechRecognizer) { try { speechRecognizer.stop(); } catch (_err) {} } speechRecognizer = null;
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  progressPreviewUrls.forEach(URL.revokeObjectURL); progressPreviewUrls = []; activeRecorder = null; progressDialog.remove(); progressDialog = null;
}

async function toggleRecording(button, status, audioPreview, deleteButton) {
  if (activeRecorder && activeRecorder.state === "recording") { activeRecorder.stop(); button.textContent = "🎙 Record again"; return; }
  if (!supportsRecording()) { showToast("Voice recording requires a supported browser over HTTPS or localhost.", "error"); return; }
  try {
    stopMediaStream(activeStream); activeStream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = []; const mimeType = preferredAudioMimeType(); activeRecorder = mimeType ? new MediaRecorder(activeStream, { mimeType }) : new MediaRecorder(activeStream); const started = Date.now();
    activeRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    activeRecorder.onerror = () => showToast("The voice recording stopped unexpectedly.", "error");
    activeRecorder.onstop = () => { if (recordingTimer) clearInterval(recordingTimer); recordingTimer = null; recordedAudio = new Blob(chunks, { type: activeRecorder.mimeType || "audio/webm" }); stopMediaStream(activeStream); activeStream = null; if (audioPreview.src) URL.revokeObjectURL(audioPreview.src); audioPreview.src = URL.createObjectURL(recordedAudio); audioPreview.classList.remove("hidden"); deleteButton.classList.remove("hidden"); status.textContent = `Voice note ready · ${Math.max(1, Math.round((Date.now()-started)/1000))}s`; };
    activeRecorder.start(500); button.textContent = "■ Stop recording"; status.textContent = "Recording · 0:00"; recordingTimer = setInterval(() => { const sec = Math.floor((Date.now()-started)/1000); status.textContent = `Recording · ${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`; }, 500);
  } catch (_err) { stopMediaStream(activeStream); activeStream = null; showToast("Microphone permission was not available.", "error"); }
}

function toggleSpeech(button, transcript) {
  if (speechRecognizer) { speechRecognizer.stop(); speechRecognizer = null; button.textContent = "🗣 Start speech-to-text"; return; }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition; if (!Recognition) { showToast("Live speech-to-text is not supported here. You can still type or edit the transcript.", "error"); return; }
  const r = new Recognition(); r.continuous = true; r.interimResults = true; r.lang = "en-IN"; let committed = transcript.value.trim();
  r.onresult = e => { let interim = ""; for (let i=e.resultIndex; i<e.results.length; i++) { const text=e.results[i][0].transcript; if (e.results[i].isFinal) committed = `${committed} ${text}`.trim(); else interim += text; } transcript.value = `${committed}${interim ? ` ${interim}` : ""}`.trim(); };
  r.onerror = e => { if (e.error !== "aborted") showToast(`Speech recognition stopped: ${e.error}.`, "error"); };
  r.onend = () => { speechRecognizer = null; button.textContent = "🗣 Start speech-to-text"; };
  try { r.start(); speechRecognizer = r; button.textContent = "■ Stop speech-to-text"; } catch (_err) { showToast("Could not start speech recognition.", "error"); }
}

async function loadProgress() { const data = await apiRequest(`/projects/${state.currentProject.id}/progress`); state.progressUpdates = data.updates; }


window.addEventListener("pagehide", () => {
  stopMediaStream(activeStream); stopMediaStream(cameraStream);
  lightboxUrls.forEach(URL.revokeObjectURL); progressPreviewUrls.forEach(URL.revokeObjectURL);
});

/* ------------------------------ Data loading ----------------------------- */

async function loadProjects() {
  try {
    const data = await apiRequest("/projects");
    state.projects = data.projects;
    if (isBoss()) await loadPendingUsers();
  } catch (_err) {
    /* toasted already */
  }
}

async function loadPendingUsers() {
  try {
    const data = await apiRequest("/auth/pending");
    state.pendingUsers = data.users;
  } catch (_err) {
    /* toasted already */
  }
}

async function selectProject(projectId) {
  try {
    const [projectData, teamData, tasksData, messagesData, progressData, filesData, activityData] = await Promise.all([
      apiRequest(`/projects/${projectId}`),
      apiRequest(`/projects/${projectId}/team`),
      apiRequest(`/projects/${projectId}/tasks`),
      apiRequest(`/projects/${projectId}/messages`),
      apiRequest(`/projects/${projectId}/progress`),
      apiRequest(`/projects/${projectId}/files`),
      apiRequest(`/projects/${projectId}/activity`),
    ]);
    state.currentProject = projectData.project;
    state.team = teamData.team;
    state.tasks = tasksData.tasks;
    state.messages = messagesData.messages;
    state.progressUpdates = progressData.updates;
    state.files = filesData.files;
    state.activity = activityData.activity;
    taskFormOpen = false;
    render();
  } catch (_err) {
    /* toasted already */
  }
}

async function loadTeam() {
  const data = await apiRequest(`/projects/${state.currentProject.id}/team`);
  state.team = data.team;
}

async function loadTasks() {
  const data = await apiRequest(`/projects/${state.currentProject.id}/tasks`);
  state.tasks = data.tasks;
}

async function loadFiles() {
  const data = await apiRequest(`/projects/${state.currentProject.id}/files`);
  state.files = data.files;
}

async function loadMessages() {
  const data = await apiRequest(`/projects/${state.currentProject.id}/messages`);
  state.messages = data.messages;
}

/* ------------------------- Internet synchronization ---------------------- */
const SYNC_INTERVAL_MS = 15000;
let syncTimer = null;
let syncInFlight = false;

async function syncFromServer({ forceRender = true } = {}) {
  if (!state.user || syncInFlight || !navigator.onLine) {
    if (!navigator.onLine && state.syncStatus !== "offline") { state.syncStatus = "offline"; if (forceRender) render(); }
    return;
  }
  syncInFlight = true;
  state.syncStatus = "syncing";
  if (forceRender) render();
  try {
    const selectedId = state.currentProject?.id;
    await Promise.all([loadProjects(), loadNotifications()]);
    if (selectedId && state.projects.some(p => p.id === selectedId)) await selectProject(selectedId);
    else if (state.projects.length) await selectProject(state.projects[0].id);
    state.syncStatus = "online";
    state.lastSyncedAt = new Date();
  } catch (_err) {
    state.syncStatus = navigator.onLine ? "online" : "offline";
  } finally {
    syncInFlight = false;
    if (forceRender) render();
  }
}

function startAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(() => syncFromServer({ forceRender: true }), SYNC_INTERVAL_MS);
}
function stopAutoSync() { if (syncTimer) clearInterval(syncTimer); syncTimer = null; }

window.addEventListener("online", () => { state.syncStatus = "online"; render(); syncFromServer(); });
window.addEventListener("offline", () => { state.syncStatus = "offline"; render(); });
window.addEventListener("nirmaan:network", e => {
  const next = e.detail?.state;
  if (next === "offline") { state.syncStatus = "offline"; render(); }
  else if (next === "online" && state.syncStatus === "offline") { state.syncStatus = "online"; render(); }
});

/* --------------------------------- Boot ---------------------------------- */

async function boot() {
  if (!isLoggedIn()) { render(); return; }
  try {
    const me = await apiRequest("/auth/me", { silent: true });
    state.user = me.user;
    await Promise.all([loadProjects(), loadNotifications()]);
    if (state.projects.length) await selectProject(state.projects[0].id);
    else render();
    state.syncStatus = navigator.onLine ? "online" : "offline";
    state.lastSyncedAt = new Date();
    startAutoSync();
    render();
  } catch (_err) { clearTokens(); state.user = null; stopAutoSync(); render(); }
}

boot();

/* ------------------------------ PWA install ------------------------------ */
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  window.dispatchEvent(new CustomEvent("nirmaan:pwa-installable"));
});
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; showToast("Nirmaan installed on this device.", "success"); });
async function installNirmaan() {
  if (!deferredInstallPrompt) { showToast("Use your browser menu and choose Add to Home Screen / Install App.", "info"); return; }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
}
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
