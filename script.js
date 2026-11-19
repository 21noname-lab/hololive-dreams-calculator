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

function normalizeCharacterStatuses(eventType) {
  if (!characterList) return;

  characterList.querySelectorAll(".character-status").forEach((select, index) => {
    const allowedStatuses = eventType === "spotlight" && index > 0
      ? CHARACTER_STATUSES.filter((status) => status.value !== "pu")
      : CHARACTER_STATUSES;
    if (!allowedStatuses.some((status) => status.value === select.value)) {
      select.value = eventType === "spotlight" && index > 0 ? "target" : "pu";
    }
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
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
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
    autoHigh: calculateScenario(1.0),
    autoLow: calculateScenario(0.9)
  };
}

function validateLiveInputs(liveMode) {
  const unitScore = getSafeNumber("#unit-score");
  const multiScore = getSafeNumber("#multi-score");
  const songRatePercent = getSafeNumber("#song-rate");
  const boostCount = getSafeNumber("#boost-count");
  const boostRate = BOOST_MULTIPLIERS[boostCount];

  if (unitScore === null || unitScore < 0) return { error: "リザルトスコアを0以上で入力してください。" };
  if (liveMode === "multi" && (multiScore === null || multiScore < 0)) {
    return { error: "全体スコアを0以上で入力してください。" };
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
    songRate: songRatePercent / 100,
    boostRate
  };
}

function updateLiveDisplay(liveMode) {
  const isMulti = liveMode === "multi";
  const multiField = document.querySelector("#multi-score-field");
  if (multiField) multiField.hidden = !isMulti;
}

function updateCalculator() {
  if (!document.querySelector("#event-mode") || !document.querySelector("#point-result")) return;
  const eventType = document.querySelector("#event-mode").value;
  const eventSetting = EVENT_TYPES[eventType];
  const mode = eventSetting.rateTable;
  const liveMode = document.querySelector("#live-mode").value;
  normalizeCharacterStatuses(eventType);
  const bonus = calculateFormationBonus(mode, getCharacterSettings());
  document.querySelector("#formation-bonus").textContent = `${bonus}%`;
  updateLiveDisplay(liveMode);

  const values = validateLiveInputs(liveMode);
  const errorElement = document.querySelector("#point-error");
  const resultElement = document.querySelector("#point-result");

  if (values.error) {
    errorElement.textContent = values.error;
    resultElement.textContent = "—";
    ["manual-low-result", "manual-high-result", "auto-high-result", "auto-low-result"].forEach((id) => {
      document.querySelector(`#${id}`).textContent = "—";
    });
    return;
  }

  errorElement.textContent = "";
  const passMultiplier = Number(document.querySelector("#holopass").value);
  const points = calculateEventPoints({
    liveMode,
    unitScore: values.unitScore,
    multiScore: values.multiScore,
    scoreCorrection: eventSetting.scoreCorrection,
    bonus,
    passMultiplier,
    songRate: values.songRate,
    boostRate: values.boostRate
  });
  resultElement.textContent = points.toLocaleString("ja-JP");

  const additionalPoints = calculateAdditionalPoints({
    liveMode,
    unitScore: values.unitScore,
    multiScore: values.multiScore,
    scoreCorrection: eventSetting.scoreCorrection,
    bonus,
    passMultiplier,
    songRate: values.songRate,
    boostRate: values.boostRate
  });
  document.querySelector("#manual-low-result").textContent = additionalPoints.manualLow.toLocaleString("ja-JP");
  document.querySelector("#manual-high-result").textContent = additionalPoints.manualHigh.toLocaleString("ja-JP");
  document.querySelector("#auto-high-result").textContent = additionalPoints.autoHigh.toLocaleString("ja-JP");
  document.querySelector("#auto-low-result").textContent = additionalPoints.autoLow.toLocaleString("ja-JP");
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

  ["event-mode", "live-mode", "song-rate", "boost-count", "holopass", "theme-mode"].forEach((id) => {
    applySavedSelectValue(`#${id}`, saved[id]);
  });
  updateCharacterStatusOptions(document.querySelector("#event-mode").value);

  ["unit-score", "multi-score"].forEach((id) => {
    const input = document.querySelector(`#${id}`);
    if (input && typeof saved[id] === "string") input.value = saved[id];
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
    "live-mode": document.querySelector("#live-mode").value,
    "unit-score": document.querySelector("#unit-score").value,
    "multi-score": document.querySelector("#multi-score").value,
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

function resetSettings() {
  document.querySelector("#unit-score").value = "0";
  document.querySelector("#multi-score").value = "0";
  updateCalculator();
  saveSettings();
}

createCharacterInputs();
createSongRateOptions();
const themeMode = document.querySelector("#theme-mode");
updateCharacterStatusOptions(document.querySelector("#event-mode").value);
restoreSettings();
if (themeMode) {
  themeMode.addEventListener("change", () => {
    document.body.dataset.theme = themeMode.value;
  });
}
document.querySelectorAll("input, select").forEach((control) => {
  control.addEventListener("input", () => {
    if (control.id === "event-mode") updateCharacterStatusOptions(control.value);
    updateCalculator();
    saveSettings();
  });
  control.addEventListener("change", () => {
    if (control.id === "event-mode") updateCharacterStatusOptions(control.value);
    updateCalculator();
    saveSettings();
  });
});
document.querySelector("#reset-settings").addEventListener("click", resetSettings);
updateCalculator();
