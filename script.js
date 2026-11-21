// イベントの倍率データをイベントタイプごとに分けて管理します。
const RATE_DATA = {
  rally: {
    pu: 60,
    target: 30,
    nonTarget: 0
  },
  spotlight: {
    pu: 100,
    target: 50,
    nonTarget: 0
  }
};

// 提供された表の凸数ごとの加算値です。
const CONV_BONUS = {
  5: [0, 15, 18, 22, 26, 30],
  4: [0, 6, 7, 8, 9, 10],
  3: [0, 1, 1, 2, 2, 3]
};

// イベント種類ごとのスコア補正値と使用倍率テーブルを一元管理します。
const EVENT_TYPES = {
  rally: {
    scoreCorrection: 60000,
    rateTable: "rally"
  },
  spotlight: {
    scoreCorrection: 75000,
    rateTable: "spotlight"
  }
};

const BOOST_MULTIPLIERS = {
  0: 1,
  1: 8,
  2: 16,
  3: 24,
  5: 37,
  10: 56
};

const SCORE_RANKS = {
  "S+9": { totalScore: 25000000 },
  "S+8": { totalScore: 22500000 },
  "S+7": { totalScore: 20000000 },
  "S+6": { totalScore: 17500000 },
  "S+5": { totalScore: 15000000 },
  "S+4": { totalScore: 12500000 },
  "S+3": { totalScore: 10000000 },
  "S+2": { totalScore: 7500000 }
};

const STORAGE_KEY = "hololiveDreamsPointCalculator";
const characterList = document.querySelector("#character-list");
const CHARACTER_STATUSES = [
  { value: "pu", label: "PU" },
  { value: "target", label: "対象内" },
  { value: "nonTarget", label: "対象外" }
];

// 計算処理と画面更新を分離しやすい入力データ生成です。
function createSongRateOptions() {
  const songRateSelect = document.querySelector("#song-rate");
  if (!songRateSelect) return;

  for (let percent = 14; percent <= 54; percent += 1) {
    const option = document.createElement("option");
    option.value = String(percent);
    option.textContent = `${percent}%`;
    songRateSelect.appendChild(option);
  }
  songRateSelect.value = "54";
}

function createCharacterInputs() {
  if (!characterList) return;
  for (let index = 0; index < 5; index += 1) {
    const card = document.createElement("div");
    card.className = "character-card";
    card.innerHTML = `
      <h3>キャラクター ${index + 1}</h3>
      <label>
        対象区分
        <select class="character-status" data-index="${index}">
        </select>
      </label>
      <label>
        レアリティ
        <select class="character-rarity" data-index="${index}">
          <option value="5">★5</option>
          <option value="4">★4</option>
          <option value="3">★3</option>
        </select>
      </label>
      <label>
        凸数
        <select class="character-conv" data-index="${index}">
          <option value="0">無凸</option>
          <option value="1">1凸</option>
          <option value="2">2凸</option>
          <option value="3">3凸</option>
          <option value="4">4凸</option>
          <option value="5">完凸</option>
        </select>
      </label>
    `;
    characterList.appendChild(card);
  }
}

function updateCharacterStatusOptions(eventType) {
  if (!characterList) return;

  characterList.querySelectorAll(".character-status").forEach((select, index) => {
    const previousValue = select.value;
    const options = eventType === "spotlight" && index > 0
      ? CHARACTER_STATUSES.filter((status) => status.value !== "pu")
      : CHARACTER_STATUSES;

    select.replaceChildren(...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));

    const hasPreviousValue = options.some((status) => status.value === previousValue);
    const defaultStatus = options.some((status) => status.value === "pu") ? "pu" : "target";
    select.value = hasPreviousValue ? previousValue : defaultStatus;
  });
}

function normalizeConvValue(value) {
  const savedValue = String(value).trim();
  if (savedValue === "0凸" || savedValue === "無凸" || savedValue === "無凸（0凸）") return "0";
  if (savedValue === "5凸" || savedValue === "完凸" || savedValue === "完凸（5凸）") return "5";
  if (/^[1-4]凸$/.test(savedValue)) return savedValue.slice(0, 1);
  if (/^[0-5]$/.test(savedValue)) return savedValue;
  return null;
}

function getCharacterSettings() {
  if (!characterList) return [];
  return Array.from(characterList.querySelectorAll(".character-card")).map((card) => ({
    status: card.querySelector(".character-status").value,
    rarity: Number(card.querySelector(".character-rarity").value),
    conv: Number(card.querySelector(".character-conv").value)
  }));
}

function calculateCharacterRate(mode, setting) {
  const base = RATE_DATA[mode][setting.status];
  const convBonus = CONV_BONUS[setting.rarity][setting.conv] ?? 0;
  return base + convBonus;
}

function calculateFormationBonus(mode, settings) {
  return settings.reduce((sum, setting) => sum + calculateCharacterRate(mode, setting), 0);
}

function getSafeNumber(id) {
  const input = document.querySelector(id);
  if (!input) return null;
  if (input.value.trim() === "") return null;
  const value = Number(input.value.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function formatNumericInput(input) {
  if (input.type !== "text") return;
  const raw = input.value;
  if (!/^[\d,]*$/.test(raw)) return;

  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  const digitsBeforeStart = raw.slice(0, selectionStart).replace(/\D/g, "").length;
  const digitsBeforeEnd = raw.slice(0, selectionEnd).replace(/\D/g, "").length;
  const formatted = raw.replace(/,/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (formatted === raw) return;

  input.value = formatted;
  if (selectionStart !== null && selectionEnd !== null) {
    const getPosition = (digitCount) => {
      if (digitCount === 0) return 0;
      let digitsSeen = 0;
      for (let index = 0; index < formatted.length; index += 1) {
        if (/\d/.test(formatted[index])) digitsSeen += 1;
        if (digitsSeen === digitCount) return index + 1;
      }
      return formatted.length;
    };
    input.setSelectionRange(getPosition(digitsBeforeStart), getPosition(digitsBeforeEnd));
  }
}

function calculateEventPoints({ liveMode, unitScore, multiScore, scoreCorrection, bonus, passMultiplier, songRate, boostRate }) {
  if (liveMode === "solo") {
    const base = Math.ceil((120 + unitScore / 15000) * (1 + bonus / 100));
    return Math.ceil(base * (1 + songRate) * boostRate * passMultiplier);
  }

  const base = Math.ceil((120 + unitScore / 15000 + multiScore / scoreCorrection) * (1 + bonus / 100));
  return Math.ceil(base * (1 + songRate) * boostRate * passMultiplier);
}

function calculateAdditionalPoints({ liveMode, unitScore, multiScore, scoreCorrection, bonus, passMultiplier, songRate, boostRate }) {
  const calculateScenario = (unitScoreMultiplier) => calculateEventPoints({
    liveMode,
    unitScore: unitScore * unitScoreMultiplier,
    multiScore,
    scoreCorrection,
    bonus,
    passMultiplier,
    songRate,
    boostRate
  });

  return {
    manualLow: calculateScenario(1.2),
    manualHigh: calculateScenario(1.3),
    autoLow: calculateScenario(0.9),
    autoHigh: calculateScenario(1.0)
  };
}

function calculatePointRange({ liveMode, unitScore, multiScore, scoreCorrection, bonus, passMultiplier, songRate, boostRate }) {
  const calculateScenario = (unitScoreMultiplier) => calculateEventPoints({
    liveMode,
    unitScore: unitScore * unitScoreMultiplier,
    multiScore,
    scoreCorrection,
    bonus,
    passMultiplier,
    songRate,
    boostRate
  });

  return {
    low: calculateScenario(1.2),
    high: calculateScenario(1.5)
  };
}

function validateLiveInputs(liveMode) {
  const unitScore = getSafeNumber("#unit-score");
  const multiScore = getSelectedMultiScore();
  const bonusInput = document.querySelector("#bonus-percent");
  const bonusPercent = bonusInput && bonusInput.value.trim() === ""
    ? 0
    : getSafeNumber("#bonus-percent");
  const songRatePercent = getSafeNumber("#song-rate");
  const boostCount = getSafeNumber("#boost-count");
  const boostRate = BOOST_MULTIPLIERS[boostCount];

  if (unitScore === null || unitScore < 0) return { error: "ユニットスコアを0以上で入力してください。" };
  if (liveMode === "multi" && (multiScore === null || multiScore < 0)) {
    return { error: "全体スコアを0以上で入力してください。" };
  }
  if (bonusPercent === null || bonusPercent < 0) {
    return { error: "獲得ボーナスを0以上で入力してください。" };
  }
  if (songRatePercent === null || songRatePercent < 14 || songRatePercent > 54) {
    return { error: "曲長ボーナスを選択してください。" };
  }
  if (!Number.isFinite(boostRate)) {
    return { error: "ブースト数を選択してください。" };
  }

  return {
    unitScore,
    multiScore: multiScore ?? 0,
    bonusPercent,
    songRate: songRatePercent / 100,
    boostRate
  };
}

function updateLiveDisplay(liveMode) {
  const isMulti = liveMode === "multi";
  const multiField = document.querySelector("#multi-score-field");
  if (multiField) multiField.hidden = !isMulti;
}

function getSelectedMultiScore() {
  const rank = document.querySelector("#multi-score-rank").value;
  if (rank === "custom") return getSafeNumber("#multi-score");
  return SCORE_RANKS[rank]?.totalScore ?? null;
}

function updateMultiScoreDisplay() {
  const rank = document.querySelector("#multi-score-rank").value;
  const customInput = document.querySelector("#multi-score");
  const customHelp = document.querySelector("#multi-score-help");
  customInput.hidden = rank !== "custom";
  customHelp.hidden = rank !== "custom";
}

function updateLiveCount(pointRange) {
  const input = document.querySelector("#target-score");
  const result = document.querySelector("#live-count-result");
  const lowResult = document.querySelector("#low-live-count-result");
  const error = document.querySelector("#live-count-error");
  error.textContent = "";

  if (!pointRange || input.value.trim() === "") {
    result.textContent = "—";
    lowResult.textContent = "—";
    return;
  }

  const targetScore = getSafeNumber("#target-score");
  if (targetScore === null || targetScore < 0) {
    result.textContent = "—";
    lowResult.textContent = "—";
    error.textContent = "希望スコアを0以上で入力してください。";
    return;
  }
  if (!Number.isFinite(pointRange.high)
    || !Number.isFinite(pointRange.low)
    || pointRange.high <= 0
    || pointRange.low <= 0) {
    result.textContent = "—";
    lowResult.textContent = "—";
    error.textContent = "イベントポイントの予測値を確認してください。";
    return;
  }

  const averagePoints = (pointRange.low + pointRange.high) / 2;
  const liveCount = Math.ceil(targetScore / averagePoints);
  const lowLiveCount = Math.ceil(targetScore / pointRange.low);
  if (!Number.isFinite(liveCount) || !Number.isFinite(lowLiveCount)) {
    result.textContent = "—";
    lowResult.textContent = "—";
    error.textContent = "希望スコアまたはイベントポイントの予測値を確認してください。";
    return;
  }
  result.textContent = liveCount.toLocaleString("ja-JP");
  lowResult.textContent = lowLiveCount.toLocaleString("ja-JP");
}

function updateValidationDisplay() {
  const eventType = document.querySelector("#validation-event-mode").value;
  document.querySelector("#validation-content").hidden = !eventType;
}

function updateCalculator() {
  if (!document.querySelector("#event-mode") || !document.querySelector("#point-result")) return;
  const eventType = document.querySelector("#event-mode").value;
  const pointContent = document.querySelector("#point-content");
  if (pointContent) pointContent.hidden = !eventType;
  if (!eventType) {
    document.querySelector("#point-error").textContent = "";
    document.querySelector("#point-result").textContent = "—";
    ["low-result", "high-result"].forEach((id) => {
      document.querySelector(`#${id}`).textContent = "—";
    });
    updateLiveCount(null);
    return;
  }
  const eventSetting = EVENT_TYPES[eventType];
  const mode = eventSetting.rateTable;
  const liveMode = document.querySelector("#live-mode").value;
  updateLiveDisplay(liveMode);

  const values = validateLiveInputs(liveMode);
  const errorElement = document.querySelector("#point-error");
  const resultElement = document.querySelector("#point-result");

  if (values.error) {
    errorElement.textContent = values.error;
    resultElement.textContent = "—";
    ["low-result", "high-result"].forEach((id) => {
      document.querySelector(`#${id}`).textContent = "—";
    });
    updateLiveCount(null);
    return;
  }

  errorElement.textContent = "";
  const passMultiplier = Number(document.querySelector("#holopass").value);
  const points = calculateEventPoints({
    liveMode,
    unitScore: values.unitScore,
    multiScore: values.multiScore,
    scoreCorrection: eventSetting.scoreCorrection,
    bonus: values.bonusPercent,
    passMultiplier,
    songRate: values.songRate,
    boostRate: values.boostRate
  });
  resultElement.textContent = points.toLocaleString("ja-JP");

  const pointRange = calculatePointRange({
    liveMode,
    unitScore: values.unitScore,
    multiScore: values.multiScore,
    scoreCorrection: eventSetting.scoreCorrection,
    bonus: values.bonusPercent,
    passMultiplier,
    songRate: values.songRate,
    boostRate: values.boostRate
  });
  document.querySelector("#low-result").textContent = pointRange.low.toLocaleString("ja-JP");
  document.querySelector("#high-result").textContent = pointRange.high.toLocaleString("ja-JP");
  updateLiveCount(pointRange);
}

function updateBonusDisplay() {
  const eventType = document.querySelector("#bonus-event-mode").value;
  const bonusContent = document.querySelector("#bonus-content");
  bonusContent.hidden = !eventType;
  if (!eventType) return;

  updateCharacterStatusOptions(eventType);
  const mode = EVENT_TYPES[eventType].rateTable;
  const formationBonus = calculateFormationBonus(mode, getCharacterSettings());
  document.querySelector("#formation-bonus").textContent = `${formationBonus}%`;
}

function setActivePage(pageName) {
  document.querySelectorAll(".page-tab").forEach((tab) => {
    const isActive = tab.dataset.page === pageName;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.pagePanel !== pageName;
  });
}

function showStorageError(message, error) {
  const status = document.querySelector("#storage-error");
  if (status) {
    status.textContent = message;
    status.hidden = false;
  }
  console.error(message, error);
}

function clearStorageError() {
  const status = document.querySelector("#storage-error");
  if (!status) return;
  status.textContent = "";
  status.hidden = true;
}

function applySavedSelectValue(selector, value) {
  const select = document.querySelector(selector);
  if (!select || value === undefined || value === null) return;
  const savedValue = String(value);
  if (Array.from(select.options).some((option) => option.value === savedValue)) {
    select.value = savedValue;
  }
}

function restoreSettings() {
  let serialized;
  try {
    serialized = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    showStorageError("この端末から設定を読み込めませんでした。", error);
    return;
  }
  if (!serialized) return;

  let saved;
  try {
    saved = JSON.parse(serialized);
  } catch (error) {
    showStorageError("保存された設定を読み込めませんでした。", error);
    return;
  }
  if (!saved || typeof saved !== "object") return;

  ["live-mode", "multi-score-rank", "song-rate", "boost-count", "holopass", "theme-mode"].forEach((id) => {
    applySavedSelectValue(`#${id}`, saved[id]);
  });
  if (saved["event-mode-selected"] === true) {
    applySavedSelectValue("#event-mode", saved["event-mode"]);
  }
  if (saved["bonus-event-mode-selected"] === true) {
    applySavedSelectValue("#bonus-event-mode", saved["bonus-event-mode"]);
  }
  if (saved["validation-event-mode-selected"] === true) {
    applySavedSelectValue("#validation-event-mode", saved["validation-event-mode"]);
  }

  ["unit-score", "multi-score", "bonus-percent", "target-score"].forEach((id) => {
    const input = document.querySelector(`#${id}`);
    if (input && typeof saved[id] === "string") {
      input.value = saved[id];
      formatNumericInput(input);
    }
  });

  if (themeMode) document.body.dataset.theme = themeMode.value;

  if (Array.isArray(saved.characters)) {
    const cards = Array.from(characterList.querySelectorAll(".character-card"));
    saved.characters.slice(0, cards.length).forEach((character, index) => {
      if (!character || typeof character !== "object") return;
      applySavedSelectValue(`#character-list .character-card:nth-child(${index + 1}) .character-status`, character.status);
      applySavedSelectValue(`#character-list .character-card:nth-child(${index + 1}) .character-rarity`, character.rarity);
      const convValue = normalizeConvValue(character.conv);
      if (convValue !== null) {
        applySavedSelectValue(`#character-list .character-card:nth-child(${index + 1}) .character-conv`, convValue);
      }
    });
  }

  saveSettings();
}

function saveSettings() {
  const saved = {
    "event-mode": document.querySelector("#event-mode").value,
    "event-mode-selected": document.querySelector("#event-mode").value !== "",
    "bonus-event-mode": document.querySelector("#bonus-event-mode").value,
    "bonus-event-mode-selected": document.querySelector("#bonus-event-mode").value !== "",
    "validation-event-mode": document.querySelector("#validation-event-mode").value,
    "validation-event-mode-selected": document.querySelector("#validation-event-mode").value !== "",
    "live-mode": document.querySelector("#live-mode").value,
    "unit-score": document.querySelector("#unit-score").value,
    "multi-score": document.querySelector("#multi-score").value,
    "multi-score-rank": document.querySelector("#multi-score-rank").value,
    "bonus-percent": document.querySelector("#bonus-percent").value,
    "target-score": document.querySelector("#target-score").value,
    "song-rate": document.querySelector("#song-rate").value,
    "boost-count": document.querySelector("#boost-count").value,
    holopass: document.querySelector("#holopass").value,
    "theme-mode": themeMode ? themeMode.value : "light",
    characters: getCharacterSettings()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    clearStorageError();
  } catch (error) {
    showStorageError("設定をこの端末に保存できませんでした。", error);
  }
}

createCharacterInputs();
createSongRateOptions();
const themeMode = document.querySelector("#theme-mode");
updateCharacterStatusOptions("rally");
restoreSettings();
updateBonusDisplay();
updateMultiScoreDisplay();
updateValidationDisplay();
document.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.inputMode === "numeric") {
    formatNumericInput(event.target);
  }
}, true);
if (themeMode) {
  themeMode.addEventListener("change", () => {
    document.body.dataset.theme = themeMode.value;
  });
}
document.querySelectorAll("input, select").forEach((control) => {
  control.addEventListener("input", () => {
    if (control.id === "multi-score-rank") updateMultiScoreDisplay();
    if (control.id === "validation-event-mode") updateValidationDisplay();
    if (control.id !== "bonus-event-mode"
      && control.id !== "validation-event-mode"
      && control.id !== "theme-mode") updateCalculator();
    if (control.classList.contains("character-status")
      || control.classList.contains("character-rarity")
      || control.classList.contains("character-conv")) {
      updateBonusDisplay();
    }
    saveSettings();
  });
  control.addEventListener("change", () => {
    if (control.id === "multi-score-rank") updateMultiScoreDisplay();
    if (control.id === "bonus-event-mode") {
      updateBonusDisplay();
    } else if (control.id === "validation-event-mode") {
      updateValidationDisplay();
    } else if (control.id !== "theme-mode") {
      updateCalculator();
    }
    if (control.classList.contains("character-status")
      || control.classList.contains("character-rarity")
      || control.classList.contains("character-conv")) {
      updateBonusDisplay();
    }
    saveSettings();
  });
});
document.querySelectorAll(".page-tab").forEach((tab) => {
  tab.addEventListener("click", () => setActivePage(tab.dataset.page));
});
updateCalculator();
