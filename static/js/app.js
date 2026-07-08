/* global Sortable */
"use strict";

// ── State ──────────────────────────────────────────────────────────────────
let state = { groups: [], selectedBookmarkIds: new Set(), selectionMode: false };
let sortableInstances = [];
let groupSortable = null;
let allGroupsCollapsed = false;

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function showToast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (type ? " " + type : "");
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2800);
}

function isBookmarkSelected(bmId) {
  return state.selectedBookmarkIds.has(bmId);
}

function toggleBookmarkSelection(bmId, force) {
  const selected = state.selectedBookmarkIds.has(bmId);
  let nextSelected = selected;
  if (force === true) nextSelected = true;
  else if (force === false) nextSelected = false;
  else nextSelected = !selected;

  if (nextSelected) state.selectedBookmarkIds.add(bmId);
  else state.selectedBookmarkIds.delete(bmId);

  const tile = document.querySelector(`.tile[data-bm-id='${bmId}']`);
  if (tile) tile.classList.toggle("selected", nextSelected);
}

function clearBookmarkSelection() {
  state.selectedBookmarkIds.clear();
  document.querySelectorAll(".tile.selected").forEach((tile) => tile.classList.remove("selected"));
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

// ── Favicon helpers ─────────────────────────────────────────────────────────
const LETTER_COLORS = [
  "#6c63ff","#ff6584","#43c6ac","#f7b733","#4facfe",
  "#ff9a9e","#a18cd1","#84fab0","#fddb92","#d4fc79",
];

function letterColor(title) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return LETTER_COLORS[Math.abs(h) % LETTER_COLORS.length];
}

function faviconEl(bookmark) {
  if (bookmark.icon) {
    const img = document.createElement("img");
    img.className = "tile-favicon";
    img.src = bookmark.icon;
    img.alt = "";
    img.onerror = () => img.replaceWith(letterAvatar(bookmark.title));
    return img;
  }
  // Try Google favicon service
  try {
    const domain = new URL(bookmark.url).hostname;
    const img = document.createElement("img");
    img.className = "tile-favicon";
    img.src = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`;
    img.alt = "";
    img.onerror = () => img.replaceWith(letterAvatar(bookmark.title));
    return img;
  } catch {
    return letterAvatar(bookmark.title);
  }
}

function letterAvatar(title) {
  const div = el("div", "tile-favicon-letter");
  div.style.background = letterColor(title);
  div.textContent = (title || "?").charAt(0).toUpperCase();
  return div;
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderAll() {
  const container = $("groupsContainer");
  container.innerHTML = "";
  sortableInstances.forEach((s) => s.destroy());
  sortableInstances = [];
  if (groupSortable) { groupSortable.destroy(); groupSortable = null; }

  if (state.groups.length === 0) {
    $("emptyState").style.display = "";
    $("noResults").style.display = "none";
    return;
  }
  $("emptyState").style.display = "none";

  state.groups.forEach((group) => {
    const section = buildGroupSection(group);
    container.appendChild(section);
  });

  // Group-level drag-and-drop
  groupSortable = Sortable.create(container, {
    animation: 150,
    handle: ".group-drag-handle",
    ghostClass: "sortable-ghost",
    chosenClass: "sortable-chosen",
    onEnd({ oldIndex, newIndex }) {
      if (oldIndex === newIndex) return;
      const moved = state.groups.splice(oldIndex, 1)[0];
      state.groups.splice(newIndex, 0, moved);
      const payload = state.groups.map((g, i) => ({ id: g.id, position: i }));
      apiFetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: payload }),
      }).catch((e) => showToast(e.message, "error"));
    },
  });

  applySearch();
}

function buildGroupSection(group) {
  const section = el("div", "group-section");
  section.dataset.groupId = group.id;

  // Header
  const header = el("div", "group-header");

  const dragHandle = el("span", "group-drag-handle");
  dragHandle.title = "Drag to reorder";
  dragHandle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/>
    <circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/>
    <circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/>
  </svg>`;

  const collapseToggle = el("button", "collapse-toggle");
  collapseToggle.type = "button";
  collapseToggle.title = "Toggle group";
  collapseToggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M6 9l6 6 6-6"/>
  </svg>`;
  collapseToggle.addEventListener("click", () => {
    const collapsed = section.classList.toggle("collapsed");
    if (collapsed) {
      section.classList.add("collapsed");
    } else {
      section.classList.remove("collapsed");
    }
  });

  const nameEl = el("span", "group-name");
  nameEl.textContent = group.name;

  const badge = el("span", "group-badge");
  badge.textContent = group.bookmarks.length;

  const actions = el("div", "group-actions");

  const btnSelectAll = el("button", "btn-icon");
  btnSelectAll.title = "Select all bookmarks";
  btnSelectAll.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
    <polyline points="6 12 10 16 18 8"/>
  </svg>`;
  btnSelectAll.addEventListener("click", () => {
    const allSelected = group.bookmarks.every((bm) => state.selectedBookmarkIds.has(bm.id));
    group.bookmarks.forEach((bm) => toggleBookmarkSelection(bm.id, !allSelected));
  });
  btnSelectAll.style.display = state.selectionMode ? "inline-flex" : "none";

  const btnMoveSelected = el("button", "btn-icon");
  btnMoveSelected.title = "Move selected bookmarks";
  btnMoveSelected.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M5 12h14"/><path d="M13 5l7 7-7 7"/>
  </svg>`;
  btnMoveSelected.addEventListener("click", () => openMoveSelectedModal(group.id));
  btnMoveSelected.style.display = state.selectionMode ? "inline-flex" : "none";

  const btnAddBm = el("button", "btn-icon");
  btnAddBm.title = "Add bookmark";
  btnAddBm.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>`;
  btnAddBm.addEventListener("click", () => openBookmarkModal(null, group.id));

  const btnRename = el("button", "btn-icon");
  btnRename.title = "Rename group";
  btnRename.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`;
  btnRename.addEventListener("click", () => openGroupModal(group));

  const btnDel = el("button", "btn-icon");
  btnDel.title = "Delete group";
  btnDel.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>`;
  btnDel.style.color = "var(--danger)";
  btnDel.addEventListener("click", () => confirmDeleteGroup(group));

  actions.append(btnMoveSelected, btnSelectAll, btnAddBm, btnRename, btnDel);
  header.append(dragHandle, collapseToggle, nameEl, badge, actions);

  // Tile grid
  const grid = el("div", "tile-grid");
  grid.dataset.groupId = group.id;

  group.bookmarks.forEach((bm) => {
    grid.appendChild(buildTile(bm));
  });

  // Sortable for tiles
  const s = Sortable.create(grid, {
    group: "bookmarks",
    animation: 150,
    ghostClass: "sortable-ghost",
    chosenClass: "sortable-chosen",
    onEnd({ item, to, oldIndex, newIndex }) {
      const bmId = parseInt(item.dataset.bmId);
      const targetGroupId = parseInt(to.dataset.groupId);
      // Update state
      let srcGroup = state.groups.find((g) => g.bookmarks.some((b) => b.id === bmId));
      if (!srcGroup) return;
      const [bm] = srcGroup.bookmarks.splice(oldIndex, 1);
      bm.group_id = targetGroupId;
      const targetGroup = state.groups.find((g) => g.id === targetGroupId);
      targetGroup.bookmarks.splice(newIndex, 0, bm);

      // Update badge counts
      updateBadges();

      const payload = targetGroup.bookmarks.map((b, i) => ({
        id: b.id,
        group_id: targetGroupId,
        position: i,
      }));
      // If moved between groups also send source group positions
      let allBm = [...payload];
      if (srcGroup.id !== targetGroupId) {
        allBm = allBm.concat(
          srcGroup.bookmarks.map((b, i) => ({ id: b.id, group_id: srcGroup.id, position: i }))
        );
      }
      apiFetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarks: allBm }),
      }).catch((e) => showToast(e.message, "error"));
    },
  });
  sortableInstances.push(s);

  section.append(header, grid);
  if (allGroupsCollapsed) {
    section.classList.add("collapsed");
  }
  return section;
}

function updateSelectionModeButton() {
  const btn = $("btnSelectionMode");
  if (!btn) return;
  btn.classList.toggle("btn-primary", state.selectionMode);
  btn.classList.toggle("btn-secondary", !state.selectionMode);
  btn.querySelector("span").textContent = state.selectionMode ? "Done" : "Select";
  const icon = btn.querySelector("svg");
  if (icon) icon.style.transform = state.selectionMode ? "rotate(90deg)" : "rotate(0deg)";
}

function toggleSelectionMode() {
  state.selectionMode = !state.selectionMode;
  if (!state.selectionMode) {
    clearBookmarkSelection();
  }
  updateSelectionModeButton();
  renderAll();
}

function updateAllGroupsToggle(value) {
  allGroupsCollapsed = value;
  document.querySelectorAll(".group-section").forEach((sec) => {
    sec.classList.toggle("collapsed", allGroupsCollapsed);
  });
  const toggleButton = $("btnToggleGroups");
  if (toggleButton) {
    const label = toggleButton.querySelector("span");
    if (label) {
      label.textContent = allGroupsCollapsed ? "Expand all" : "Collapse all";
    }
    const icon = toggleButton.querySelector("svg");
    if (icon) {
      icon.style.transform = allGroupsCollapsed ? "rotate(-180deg)" : "rotate(0deg)";
    }
  }
}

function buildTile(bm) {
  const tile = el("div", "tile");
  tile.dataset.bmId = bm.id;
  tile.dataset.title = bm.title.toLowerCase();
  tile.dataset.url = bm.url.toLowerCase();

  tile.appendChild(faviconEl(bm));

  const title = el("span", "tile-title");
  title.textContent = bm.title;
  tile.appendChild(title);

  // Action buttons (edit / delete)
  const actions = el("div", "tile-actions");

  const btnEdit = el("button", "btn-icon");
  btnEdit.title = "Edit";
  btnEdit.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`;
  btnEdit.addEventListener("click", (e) => { e.stopPropagation(); openBookmarkModal(bm); });

  const btnDel = el("button", "btn-icon");
  btnDel.title = "Delete";
  btnDel.style.color = "var(--danger)";
  btnDel.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>`;
  btnDel.addEventListener("click", (e) => { e.stopPropagation(); confirmDeleteBookmark(bm); });

  actions.append(btnEdit, btnDel);
  const selectButton = el("button", "tile-select");
  selectButton.type = "button";
  selectButton.title = "Select bookmark";
  selectButton.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="4" y="4" width="16" height="16" rx="3" ry="3"/>
    <polyline points="7 13 10 16 17 9"/>
  </svg>`;
  selectButton.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBookmarkSelection(bm.id);
  });
  selectButton.style.display = state.selectionMode ? "inline-flex" : "none";
  tile.appendChild(selectButton);
  tile.classList.toggle("selected", isBookmarkSelected(bm.id));
  tile.appendChild(actions);

  // Open URL on tile click
  tile.addEventListener("click", () => window.open(bm.url, "_blank", "noopener,noreferrer"));

  return tile;
}

function updateBadges() {
  document.querySelectorAll(".group-section").forEach((sec) => {
    const gid = parseInt(sec.dataset.groupId);
    const group = state.groups.find((g) => g.id === gid);
    if (group) {
      const badge = sec.querySelector(".group-badge");
      if (badge) badge.textContent = group.bookmarks.length;
    }
  });
}

function openMoveSelectedModal(sourceGroupId) {
  const selectedIds = Array.from(state.selectedBookmarkIds);
  if (selectedIds.length === 0) {
    showToast("Select bookmarks first.", "error");
    return;
  }

  const targetSelect = $("moveTargetGroup");
  targetSelect.innerHTML = "";
  state.groups
    .filter((g) => g.id !== sourceGroupId)
    .forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      targetSelect.appendChild(opt);
    });

  if (!targetSelect.options.length) {
    showToast("No other group available to move selected bookmarks.", "error");
    return;
  }

  $("moveSourceGroupId").value = sourceGroupId;
  $("moveSelectedCount").textContent = `${selectedIds.length} bookmark(s) selected`;
  openModal("modalMoveSelected");
}

const formMoveSelected = $("formMoveSelected");
if (formMoveSelected) {
  formMoveSelected.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sourceGroupId = parseInt($("moveSourceGroupId").value);
    const targetGroupId = parseInt($("moveTargetGroup").value);
    const selectedIds = Array.from(state.selectedBookmarkIds);

    if (!selectedIds.length) {
      showToast("No bookmarks selected.", "error");
      return;
    }
    if (sourceGroupId === targetGroupId) {
      showToast("Choose a different group to move bookmarks.", "error");
      return;
    }

    try {
      await Promise.all(selectedIds.map((id) =>
        apiFetch(`/api/bookmarks/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ group_id: targetGroupId }),
        })
      ));
      showToast(`${selectedIds.length} bookmark(s) moved`, "success");
      clearBookmarkSelection();
      closeModal("modalMoveSelected");
      await loadData();
      renderAll();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// ── Search ─────────────────────────────────────────────────────────────────
function applySearch() {
  const q = ($("searchInput").value || "").trim().toLowerCase();
  const mode = ($("searchMode")?.value || "both");
  let totalVisible = 0;

  document.querySelectorAll(".group-section").forEach((sec) => {
    const groupName = sec.querySelector(".group-name")?.textContent.toLowerCase() || "";
    const groupMatch = q && groupName.includes(q);
    let sectionVisible = 0;

    sec.querySelectorAll(".tile").forEach((tile) => {
      const titleMatches = tile.dataset.title.includes(q);
      const urlMatches = tile.dataset.url.includes(q);
      const tileMatch = !q || titleMatches || urlMatches;
      let showTile = false;

      if (mode === "categories") {
        showTile = q && groupMatch;
      } else if (mode === "bookmarks") {
        showTile = tileMatch;
      } else {
        showTile = tileMatch || groupMatch;
      }

      tile.style.display = showTile ? "" : "none";
      if (showTile) sectionVisible++;
    });

    if (mode === "categories" && q && groupMatch) {
      sec.querySelectorAll(".tile").forEach((tile) => { tile.style.display = ""; });
      sectionVisible = sec.querySelectorAll(".tile").length;
    }

    totalVisible += sectionVisible;
    sec.style.display = sectionVisible === 0 && q ? "none" : "";
  });

  $("noResults").style.display = q && totalVisible === 0 ? "" : "none";
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function openModal(id) { $(id).style.display = "flex"; }
function closeModal(id) { $(id).style.display = "none"; }

document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.modal));
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ── Bookmark modal ─────────────────────────────────────────────────────────
function openBookmarkModal(bm = null, defaultGroupId = null) {
  $("modalBookmarkTitle").textContent = bm ? "Edit Bookmark" : "Add Bookmark";
  $("bmId").value = bm ? bm.id : "";
  $("bmTitle").value = bm ? bm.title : "";
  $("bmUrl").value = bm ? bm.url : "";
  $("bmIcon").value = bm ? bm.icon : "";

  // Populate group select
  const sel = $("bmGroup");
  sel.innerHTML = "";
  state.groups.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    if (bm ? g.id === bm.group_id : g.id === defaultGroupId) opt.selected = true;
    sel.appendChild(opt);
  });

  openModal("modalBookmark");
  setTimeout(() => $("bmTitle").focus(), 50);
}

const formBookmark = $("formBookmark");
if (formBookmark) {
  formBookmark.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("bmId").value;
    const body = {
      title: $("bmTitle").value.trim(),
      url: $("bmUrl").value.trim(),
      group_id: parseInt($("bmGroup").value),
      icon: $("bmIcon").value.trim(),
    };
    try {
      if (id) {
        await apiFetch(`/api/bookmarks/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        showToast("Bookmark updated", "success");
      } else {
        await apiFetch("/api/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        showToast("Bookmark added", "success");
      }
      closeModal("modalBookmark");
      await loadData();
      renderAll();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// ── Group modal ────────────────────────────────────────────────────────────
function openGroupModal(group = null) {
  $("modalGroupTitle").textContent = group ? "Rename Group" : "New Group";
  $("grpId").value = group ? group.id : "";
  $("grpName").value = group ? group.name : "";
  openModal("modalGroup");
  setTimeout(() => $("grpName").focus(), 50);
}

const formGroup = $("formGroup");
if (formGroup) {
  formGroup.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("grpId").value;
    const body = { name: $("grpName").value.trim() };
    try {
      if (id) {
        await apiFetch(`/api/groups/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        showToast("Group renamed", "success");
      } else {
        await apiFetch("/api/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        showToast("Group created", "success");
      }
      closeModal("modalGroup");
      await loadData();
      renderAll();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// ── Confirm delete ─────────────────────────────────────────────────────────
let _confirmCallback = null;

function showConfirm(msg, callback) {
  $("confirmMsg").textContent = msg;
  _confirmCallback = callback;
  openModal("modalConfirm");
}

const confirmOkButton = $("confirmOk");
if (confirmOkButton) {
  confirmOkButton.addEventListener("click", async () => {
    if (_confirmCallback) {
      closeModal("modalConfirm");
      await _confirmCallback();
      _confirmCallback = null;
    }
  });
}

function confirmDeleteBookmark(bm) {
  showConfirm(`Delete bookmark "${bm.title}"? This cannot be undone.`, async () => {
    try {
      await apiFetch(`/api/bookmarks/${bm.id}`, { method: "DELETE" });
      showToast("Bookmark deleted");
      await loadData();
      renderAll();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

function confirmDeleteGroup(group) {
  showConfirm(
    `Delete group "${group.name}" and all its ${group.bookmarks.length} bookmark(s)? This cannot be undone.`,
    async () => {
      try {
        await apiFetch(`/api/groups/${group.id}`, { method: "DELETE" });
        showToast("Group deleted");
        await loadData();
        renderAll();
      } catch (err) {
        showToast(err.message, "error");
      }
    }
  );
}

// ── Import ──────────────────────────────────────────────────────────────────
const btnImport = $("btnImport");
if (btnImport) {
  btnImport.addEventListener("click", () => $("fileInput").click());
}

const fileInput = $("fileInput");
if (fileInput) {
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await apiFetch("/api/import", { method: "POST", body: formData });
      showToast(
        `Imported ${result.imported_groups} group(s) and ${result.imported_bookmarks} bookmark(s)`,
        "success"
      );
      if ($("groupsContainer")) {
        await loadData();
        renderAll();
      }
    } catch (err) {
      showToast(err.message, "error");
    }
    fileInput.value = "";
  });
}

const btnExport = $("btnExport");
if (btnExport) {
  btnExport.addEventListener("click", () => {
    window.location.href = "/export-bookmarks";
  });
}

const btnCleanDuplicates = $("btnCleanDuplicates");
if (btnCleanDuplicates) {
  btnCleanDuplicates.addEventListener("click", async () => {
    try {
      const result = await apiFetch("/api/clean-duplicates", { method: "POST" });
      const message = `Removed ${result.removed} duplicate(s)`;
      const resultEl = $("duplicateResult");
      if (resultEl) {
        resultEl.textContent = message;
      }
      showToast(message, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

const btnAddGroup = $("btnAddGroup");
if (btnAddGroup) {
  btnAddGroup.addEventListener("click", () => openGroupModal(null));
}

const btnToggleGroups = $("btnToggleGroups");
if (btnToggleGroups) {
  btnToggleGroups.addEventListener("click", () => {
    updateAllGroupsToggle(!allGroupsCollapsed);
  });
}

const btnSelectionMode = $("btnSelectionMode");
if (btnSelectionMode) {
  btnSelectionMode.addEventListener("click", toggleSelectionMode);
  updateSelectionModeButton();
}

const searchInput = $("searchInput");
const searchMode = $("searchMode");
if (searchInput) {
  searchInput.addEventListener("input", () => {
    $("clearSearch").style.display = searchInput.value ? "" : "none";
    applySearch();
  });
}
if (searchMode) {
  searchMode.addEventListener("change", () => applySearch());
}

const clearSearch = $("clearSearch");
if (clearSearch) {
  clearSearch.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    clearSearch.style.display = "none";
    applySearch();
  });
}

const btnSettings = $("btnSettings");
if (btnSettings) {
  btnSettings.addEventListener("click", () => {
    window.location.href = "/settings";
  });
}

// ── Data loading ────────────────────────────────────────────────────────────
async function loadData() {
  state.groups = await apiFetch("/api/data");
}

// ── Init ────────────────────────────────────────────────────────────────────
(async () => {
  if (!$("groupsContainer")) {
    return;
  }

  try {
    await loadData();
    renderAll();
  } catch (err) {
    showToast("Failed to load data: " + err.message, "error");
  }
})();
