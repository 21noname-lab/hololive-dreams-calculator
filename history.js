(() => {
  "use strict";

  const SETTINGS_KEY = "hololiveDreamsPointCalculator";
  const eventTabs = Array.from(document.querySelectorAll("[data-event]"));
  const tierSelect = document.querySelector("#history-tier");
  const sortSelect = document.querySelector("#history-sort");
  const rankingList = document.querySelector("#history-ranking");
  const emptyMessage = document.querySelector("#history-empty");
  const dataWarning = document.querySelector("#history-data-warning");
  const themeMessage = document.querySelector("#history-theme-message");
  let selectedEvent = "rally";
  let selectedTier = tierSelect.value;

  function showThemeMessage(message, error) {
    themeMessage.textContent = message;
    themeMessage.hidden = false;
    if (error) console.error(message, error);
  }

  function applyTheme(theme) {
    document.body.dataset.theme = theme;
  }

  function loadTheme() {
    try {
      const serialized = localStorage.getItem(SETTINGS_KEY);
      if (!serialized) return;
      const settings = JSON.parse(serialized);
      if (settings && (settings["theme-mode"] === "light" || settings["theme-mode"] === "dark")) {
        applyTheme(settings["theme-mode"]);
      }
    } catch (error) {
      showThemeMessage("保存された表示モードを読み込めませんでした。", error);
    }
  }

  function updateEventTabs() {
    eventTabs.forEach((tab) => {
      const isSelected = tab.dataset.event === selectedEvent;
      tab.classList.toggle("is-active", isSelected);
      tab.setAttribute("aria-pressed", String(isSelected));
    });
  }

  function getRecords() {
    const source = selectedEvent === "rally" ? window.RALLY_DATA : window.SPOTLIGHT_DATA;
    if (!Array.isArray(source)) {
      return { records: [], invalidCount: 1 };
    }

    let invalidCount = 0;
    const validRecords = [];
    source.forEach((record, index) => {
      if (!record
        || typeof record !== "object"
        || Array.isArray(record)
        || !Number.isFinite(record.order)
        || typeof record.name !== "string"
        || record.name.trim() === "") {
        invalidCount += 1;
        return;
      }
      const points = record[selectedTier];
      if (!Number.isFinite(points) || points < 0) {
        invalidCount += 1;
        return;
      }
      validRecords.push({
        order: record.order,
        name: record.name.trim(),
        points,
        sourceIndex: index
      });
    });
    return { records: validRecords, invalidCount };
  }

  function compareNumbers(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  function sortRecords(records, sortMode) {
    return records.slice().sort((left, right) => {
      if (sortMode === "points-desc") {
        return compareNumbers(right.points, left.points)
          || compareNumbers(left.order, right.order)
          || compareNumbers(left.sourceIndex, right.sourceIndex);
      }
      if (sortMode === "points-asc") {
        return compareNumbers(left.points, right.points)
          || compareNumbers(left.order, right.order)
          || compareNumbers(left.sourceIndex, right.sourceIndex);
      }
      return compareNumbers(left.order, right.order)
        || compareNumbers(left.sourceIndex, right.sourceIndex);
    });
  }

  function createRankingRow(record) {
    const row = document.createElement("tr");
    row.className = "history-ranking-row";

    const name = document.createElement("td");
    name.className = "history-name-cell";
    name.textContent = record.name;
    name.title = record.name;

    const points = document.createElement("td");
    points.className = "history-points-cell";
    points.textContent = `${record.points.toLocaleString("ja-JP")}pt`;

    row.append(name, points);
    return row;
  }

  function render() {
    updateEventTabs();

    const { records, invalidCount } = getRecords();
    if (invalidCount > 0) {
      dataWarning.textContent = `形式が不正なデータ${invalidCount}件を表示対象から除外しました。`;
      dataWarning.hidden = false;
    } else {
      dataWarning.textContent = "";
      dataWarning.hidden = true;
    }

    const sortedRecords = sortRecords(records, sortSelect.value);
    const rows = document.createDocumentFragment();
    sortedRecords.forEach((record) => rows.appendChild(createRankingRow(record)));
    rankingList.replaceChildren(rows);
    emptyMessage.hidden = sortedRecords.length > 0;
  }

  eventTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      selectedEvent = tab.dataset.event;
      render();
    });
  });

  tierSelect.addEventListener("change", () => {
    selectedTier = tierSelect.value;
    render();
  });
  sortSelect.addEventListener("change", render);

  loadTheme();
  render();
})();
