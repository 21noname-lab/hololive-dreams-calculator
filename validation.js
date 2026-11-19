(() => {
  "use strict";

  const STORAGE_KEY = "hololiveDreamsSpotlightValidationRecords";
  const SCHEMA_VERSION = "1";
  const MIN_ANALYSIS_RECORDS = 5;
  const root = document.querySelector("#spotlight-validation-root");

  if (!root) {
    throw new Error("Spotlight validation root was not found.");
  }

  const songRateOptions = Array.from({ length: 41 }, (_, index) => {
    const value = index + 14;
    return `<option value="${value}">${value}%</option>`;
  }).join("");
  const boostOptions = Object.keys(BOOST_MULTIPLIERS)
    .map(Number)
    .sort((left, right) => left - right)
    .map((value) => `<option value="${value}">${value}炊き</option>`)
    .join("");

  root.innerHTML = `
    <fieldset class="spotlight-validation">
      <legend>スポットライト実測データの検証</legend>
      <p class="validation-description">
        実測値を記録し、現在の計算機による予測値との差を比較します。記録はこのブラウザー内に保存されます。
      </p>
      <p class="validation-note">
        全体スコアはFEVER込みの最終値として記録します。差分は「予測 − 実測」です。
      </p>
      <form id="validation-record-form">
        <div class="validation-form-grid">
          <label for="validation-personal-score">
            個人リザルトスコア
            <input id="validation-personal-score" type="number" min="0" step="1" required>
          </label>
          <label for="validation-multi-score">
            マルチ全体スコア（FEVER込み）
            <input id="validation-multi-score" type="number" min="0" step="1" required>
          </label>
          <label for="validation-actual-points">
            実際の獲得Pt
            <input id="validation-actual-points" type="number" min="0" step="1" required>
          </label>
          <label for="validation-bonus-percent">
            特攻倍率（%）
            <input id="validation-bonus-percent" type="number" min="0" step="1" required>
          </label>
          <label for="validation-song-rate">
            曲長ボーナス
            <select id="validation-song-rate" required>${songRateOptions}</select>
          </label>
          <label for="validation-boost-count">
            ブースト数
            <select id="validation-boost-count" required>${boostOptions}</select>
          </label>
          <label for="validation-holopass">
            ホロパス
            <select id="validation-holopass" required>
              <option value="false">なし</option>
              <option value="true">あり</option>
            </select>
          </label>
        </div>
        <div class="validation-actions">
          <button class="validation-primary-button" type="submit">実測データを追加</button>
        </div>
      </form>

      <p id="validation-error" class="validation-message is-error" role="alert" hidden></p>
      <p id="validation-status" class="validation-message" role="status" aria-live="polite"></p>

      <div class="validation-file-actions">
        <button id="validation-export" class="validation-secondary-button" type="button">CSVエクスポート</button>
        <button id="validation-import-button" class="validation-secondary-button" type="button">CSVインポート</button>
        <input id="validation-import-file" type="file" accept=".csv,text/csv" hidden>
      </div>

      <section class="validation-records" aria-labelledby="validation-records-title">
        <h3 id="validation-records-title">実測記録</h3>
        <div class="validation-table-wrap">
          <table class="validation-table">
            <thead>
              <tr>
                <th scope="col">記録日時</th>
                <th scope="col">個人スコア</th>
                <th scope="col">全体スコア（FEVER込み）</th>
                <th scope="col">特攻 / 曲長</th>
                <th scope="col">ブースト / パス</th>
                <th scope="col">実測Pt</th>
                <th scope="col">予測値・差分</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody id="validation-record-list"></tbody>
          </table>
        </div>
      </section>

      <section class="validation-analysis" aria-labelledby="validation-analysis-title">
        <h3 id="validation-analysis-title">係数比較（参考分析）</h3>
        <div id="validation-analysis-content" class="validation-analysis-content" aria-live="polite"></div>
      </section>
    </fieldset>
  `;

  const form = root.querySelector("#validation-record-form");
  const errorElement = root.querySelector("#validation-error");
  const statusElement = root.querySelector("#validation-status");
  const recordList = root.querySelector("#validation-record-list");
  const analysisContent = root.querySelector("#validation-analysis-content");
  const importFile = root.querySelector("#validation-import-file");
  const eventMode = document.querySelector("#event-mode");
  let records = [];
  let storageReady = true;

  const csvHeaders = [
    "schema_version",
    "record_id",
    "recorded_at",
    "event_type",
    "live_mode",
    "personal_score",
    "multi_score",
    "multi_score_fever_included",
    "actual_points",
    "bonus_percent",
    "song_rate_percent",
    "boost_count",
    "holopass"
  ];

  function showError(message, error) {
    errorElement.textContent = message;
    errorElement.hidden = false;
    statusElement.textContent = "";
    if (error) console.error(message, error);
  }

  function showStatus(message) {
    errorElement.textContent = "";
    errorElement.hidden = true;
    statusElement.textContent = message;
  }

  function validateRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("記録の形式が正しくありません。");
    }

    const requiredNumbers = [
      ["personalScore", "個人スコア"],
      ["multiScore", "全体スコア"],
      ["actualPoints", "実測Pt"],
      ["bonusPercent", "特攻倍率"],
      ["songRatePercent", "曲長ボーナス"],
      ["boostCount", "ブースト数"]
    ];

    requiredNumbers.forEach(([key, label]) => {
      if (!Number.isSafeInteger(record[key]) || record[key] < 0) {
        throw new Error(`${label}は0以上の整数である必要があります。`);
      }
    });

    if (record.eventType !== "spotlight" || record.liveMode !== "multi") {
      throw new Error("スポットライト・マルチの記録のみインポートできます。");
    }
    if (record.multiScoreFeverIncluded !== true) {
      throw new Error("全体スコアはFEVER込みとして記録してください。");
    }
    if (record.songRatePercent < 14 || record.songRatePercent > 54) {
      throw new Error("曲長ボーナスは14〜54%の範囲である必要があります。");
    }
    if (!Object.prototype.hasOwnProperty.call(BOOST_MULTIPLIERS, record.boostCount)) {
      throw new Error("このブースト数は現行計算機で予測できません。");
    }
    if (typeof record.holopass !== "boolean") {
      throw new Error("ホロパスの有無が正しくありません。");
    }
    if (typeof record.id !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(record.id)) {
      throw new Error("記録IDが正しくありません。");
    }
    if (typeof record.recordedAt !== "string" || !Number.isFinite(Date.parse(record.recordedAt))) {
      throw new Error("記録日時が正しくありません。");
    }

    return {
      id: record.id,
      recordedAt: record.recordedAt,
      eventType: record.eventType,
      liveMode: record.liveMode,
      personalScore: record.personalScore,
      multiScore: record.multiScore,
      multiScoreFeverIncluded: record.multiScoreFeverIncluded,
      actualPoints: record.actualPoints,
      bonusPercent: record.bonusPercent,
      songRatePercent: record.songRatePercent,
      boostCount: record.boostCount,
      holopass: record.holopass
    };
  }

  function loadRecords() {
    let serialized;
    try {
      serialized = localStorage.getItem(STORAGE_KEY);
      if (!serialized) return [];
      const saved = JSON.parse(serialized);
      if (!saved || saved.version !== 1 || !Array.isArray(saved.records)) {
        throw new Error("保存データの形式またはバージョンが正しくありません。");
      }
      return saved.records.map(validateRecord);
    } catch (error) {
      storageReady = false;
      showError("検証データを読み込めませんでした。保存データを変更せず、操作を停止しました。", error);
      root.querySelectorAll("input, select, button").forEach((control) => {
        control.disabled = true;
      });
      return [];
    }
  }

  function saveRecords(nextRecords) {
    if (!storageReady) {
      showError("検証データを安全に読み込めていないため、保存できません。");
      return false;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        records: nextRecords
      }));
      records = nextRecords;
      showStatus("検証データをこのブラウザーに保存しました。");
      return true;
    } catch (error) {
      showError("LocalStorageへの保存に失敗しました。データは変更されていません。", error);
      return false;
    }
  }

  function getCurrentPredictions(record) {
    const parameters = {
      liveMode: "multi",
      unitScore: record.personalScore,
      multiScore: record.multiScore,
      scoreCorrection: EVENT_TYPES.spotlight.scoreCorrection,
      bonus: record.bonusPercent,
      passMultiplier: record.holopass ? 2 : 1,
      songRate: record.songRatePercent / 100,
      boostRate: BOOST_MULTIPLIERS[record.boostCount]
    };

    return {
      direct: calculateEventPoints(parameters),
      scenarios: calculateAdditionalPoints(parameters)
    };
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("ja-JP");
  }

  function formatDelta(value) {
    if (value > 0) return `+${formatNumber(value)}`;
    if (value < 0) return `−${formatNumber(Math.abs(value))}`;
    return "0";
  }

  function describeDelta(value) {
    if (value > 0) return "予測が実測より高い";
    if (value < 0) return "予測が実測より低い";
    return "予測と実測が一致";
  }

  function createCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    return cell;
  }

  function appendPrediction(list, label, predicted, actual) {
    const item = document.createElement("div");
    item.className = "validation-prediction";
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    const delta = predicted - actual;
    const deltaText = document.createElement("span");
    deltaText.className = delta > 0
      ? "validation-delta-high"
      : delta < 0
        ? "validation-delta-low"
        : "validation-delta-even";
    deltaText.textContent = `差分（予測 − 実測） ${formatDelta(delta)} pt（${describeDelta(delta)}）`;
    description.append(
      document.createTextNode(`予測 ${formatNumber(predicted)} pt / `),
      deltaText
    );
    item.append(term, description);
    list.appendChild(item);
  }

  function appendPredictionDetails(cell, record) {
    const details = document.createElement("details");
    details.className = "validation-predictions";
    const summary = document.createElement("summary");
    summary.textContent = "予測値と差分を表示";
    details.appendChild(summary);

    try {
      const predictions = getCurrentPredictions(record);
      const list = document.createElement("dl");
      list.className = "validation-prediction-list";
      appendPrediction(list, "既存の基礎計算経路", predictions.direct, record.actualPoints);
      appendPrediction(list, "手動下振れ", predictions.scenarios.manualLow, record.actualPoints);
      appendPrediction(list, "手動上振れ", predictions.scenarios.manualHigh, record.actualPoints);
      appendPrediction(list, "オート上振れ（個人スコア1.0倍）", predictions.scenarios.autoHigh, record.actualPoints);
      appendPrediction(list, "オート下振れ", predictions.scenarios.autoLow, record.actualPoints);
      details.appendChild(list);
    } catch (error) {
      const message = document.createElement("p");
      message.textContent = "予測計算に失敗しました。入力と計算条件を確認してください。";
      details.appendChild(message);
      console.error("Could not calculate a validation record.", error);
    }

    cell.appendChild(details);
  }

  function formatRecordedAt(value) {
    return new Date(value).toLocaleString("ja-JP");
  }

  function renderRecords() {
    recordList.replaceChildren();

    if (records.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.textContent = "実測記録はまだありません。";
      row.appendChild(cell);
      recordList.appendChild(row);
      return;
    }

    records.forEach((record) => {
      const row = document.createElement("tr");
      row.append(
        createCell(formatRecordedAt(record.recordedAt)),
        createCell(formatNumber(record.personalScore)),
        createCell(formatNumber(record.multiScore)),
        createCell(`${record.bonusPercent}% / ${record.songRatePercent}%`),
        createCell(`${record.boostCount}炊き / ${record.holopass ? "あり" : "なし"}`),
        createCell(`${formatNumber(record.actualPoints)} pt`)
      );

      const predictionCell = document.createElement("td");
      appendPredictionDetails(predictionCell, record);
      row.appendChild(predictionCell);

      const actionsCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "validation-delete-button";
      deleteButton.textContent = "削除";
      deleteButton.setAttribute("aria-label", `${formatRecordedAt(record.recordedAt)}の記録を削除`);
      deleteButton.addEventListener("click", () => {
        if (!window.confirm("この実測記録を削除しますか？")) return;
        const nextRecords = records.filter((candidate) => candidate.id !== record.id);
        if (saveRecords(nextRecords)) {
          render();
        }
      });
      actionsCell.appendChild(deleteButton);
      row.appendChild(actionsCell);
      recordList.appendChild(row);
    });
  }

  function multiplierFor(record) {
    return (1 + record.bonusPercent / 100)
      * (1 + record.songRatePercent / 100)
      * BOOST_MULTIPLIERS[record.boostCount]
      * (record.holopass ? 2 : 1);
  }

  function solveLinearSystem(matrix, vector) {
    const size = vector.length;
    const augmented = matrix.map((row, index) => row.slice().concat(vector[index]));

    for (let column = 0; column < size; column += 1) {
      let pivotRow = column;
      for (let row = column + 1; row < size; row += 1) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
          pivotRow = row;
        }
      }
      if (Math.abs(augmented[pivotRow][column]) < 1e-10) {
        throw new Error("個人スコアと全体スコアを分離して推定できません。");
      }
      [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];

      const pivot = augmented[column][column];
      for (let entry = column; entry <= size; entry += 1) {
        augmented[column][entry] /= pivot;
      }
      for (let row = 0; row < size; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        for (let entry = column; entry <= size; entry += 1) {
          augmented[row][entry] -= factor * augmented[column][entry];
        }
      }
    }

    return augmented.map((row) => row[size]);
  }

  function fitCoefficients(dataset) {
    const rows = dataset.map((record) => ({
      x: record.personalScore / 15000,
      y: record.multiScore / 75000,
      target: record.actualPoints / multiplierFor(record)
    }));
    const meanX = rows.reduce((sum, row) => sum + row.x, 0) / rows.length;
    const meanY = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
    const scaleX = Math.sqrt(rows.reduce((sum, row) => sum + (row.x - meanX) ** 2, 0) / rows.length);
    const scaleY = Math.sqrt(rows.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0) / rows.length);

    if (scaleX === 0 || scaleY === 0) {
      throw new Error("個人スコアまたは全体スコアに変化がなく、係数を分離できません。");
    }

    const normalizedRows = rows.map((row) => ({
      x: (row.x - meanX) / scaleX,
      y: (row.y - meanY) / scaleY,
      target: row.target
    }));
    const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
    const vector = [0, 0, 0];

    normalizedRows.forEach((row) => {
      const features = [1, row.x, row.y];
      for (let left = 0; left < 3; left += 1) {
        vector[left] += features[left] * row.target;
        for (let right = 0; right < 3; right += 1) {
          matrix[left][right] += features[left] * features[right];
        }
      }
    });

    const normalizedCoefficients = solveLinearSystem(matrix, vector);
    const personalCoefficient = normalizedCoefficients[1] / scaleX;
    const multiCoefficient = normalizedCoefficients[2] / scaleY;
    const constant = normalizedCoefficients[0]
      - personalCoefficient * meanX
      - multiCoefficient * meanY;
    const centeredProduct = rows.reduce(
      (sum, row) => sum + (row.x - meanX) * (row.y - meanY),
      0
    );
    const correlation = centeredProduct
      / Math.sqrt(
        rows.reduce((sum, row) => sum + (row.x - meanX) ** 2, 0)
        * rows.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0)
      );

    return { constant, personalCoefficient, multiCoefficient, correlation };
  }

  function ceilWithPrecision(value) {
    const nearestInteger = Math.round(value);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;
    return Math.abs(value - nearestInteger) <= tolerance ? nearestInteger : Math.ceil(value);
  }

  function predictCandidate(record, coefficients) {
    const value = coefficients.constant
      + coefficients.personalCoefficient * (record.personalScore / 15000)
      + coefficients.multiCoefficient * (record.multiScore / 75000);
    return ceilWithPrecision(value * multiplierFor(record));
  }

  function predictionMetrics(dataset, predictor) {
    const errors = dataset.map((record) => predictor(record) - record.actualPoints);
    const absoluteErrors = errors.map(Math.abs);
    return {
      mae: absoluteErrors.reduce((sum, value) => sum + value, 0) / errors.length,
      rmse: Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length),
      maxError: Math.max(...absoluteErrors)
    };
  }

  function appendAnalysisText(text, className) {
    const paragraph = document.createElement("p");
    if (className) paragraph.className = className;
    paragraph.textContent = text;
    analysisContent.appendChild(paragraph);
  }

  function renderAnalysis() {
    analysisContent.replaceChildren();

    if (records.length < MIN_ANALYSIS_RECORDS) {
      appendAnalysisText(
        `記録が${records.length}件のため係数は推定しません。目安として最低${MIN_ANALYSIS_RECORDS}件の実測記録が必要です。`
      );
      appendAnalysisText(
        "件数を満たしても、個人スコアと全体スコアの構成に十分な違いがない場合は推定できないか、信頼性が低くなります。"
      );
      return;
    }

    let coefficients;
    try {
      coefficients = fitCoefficients(records);
    } catch (error) {
      appendAnalysisText(error.message, "validation-warning");
      appendAnalysisText("現行係数を基準として表示し、代替係数は推定していません。");
      return;
    }

    const currentPredictor = (record) => getCurrentPredictions(record).scenarios.autoHigh;
    const candidatePredictor = (record) => predictCandidate(record, coefficients);
    const currentMetrics = predictionMetrics(records, currentPredictor);
    const candidateMetrics = predictionMetrics(records, candidatePredictor);
    const looErrors = [];
    let looAvailable = true;

    for (let index = 0; index < records.length; index += 1) {
      try {
        const trainingSet = records.filter((_, candidateIndex) => candidateIndex !== index);
        const foldCoefficients = fitCoefficients(trainingSet);
        looErrors.push(predictCandidate(records[index], foldCoefficients) - records[index].actualPoints);
      } catch (error) {
        looAvailable = false;
        break;
      }
    }

    appendAnalysisText(`現行モデル（固定120、個人/15,000、全体/75,000）の平均絶対誤差: ${formatNumber(Math.round(currentMetrics.mae))} pt`);
    appendAnalysisText(`実測からの推定値（固定値=${coefficients.constant.toFixed(3)}、個人係数=${coefficients.personalCoefficient.toFixed(5)}、全体係数=${coefficients.multiCoefficient.toFixed(5)})`);
    appendAnalysisText(`推定モデルの平均絶対誤差: ${formatNumber(Math.round(candidateMetrics.mae))} pt / RMSE: ${formatNumber(Math.round(candidateMetrics.rmse))} pt / 最大誤差: ${formatNumber(Math.round(candidateMetrics.maxError))} pt`);

    if (looAvailable) {
      const looMae = looErrors.reduce((sum, value) => sum + Math.abs(value), 0) / looErrors.length;
      appendAnalysisText(`1件ずつ除外した検証の平均絶対誤差: ${formatNumber(Math.round(looMae))} pt`);
    } else {
      appendAnalysisText(
        "一部の除外検証でスコア構成を分離できません。独立した検証誤差は算出できません。",
        "validation-warning"
      );
    }

    if (Math.abs(coefficients.correlation) >= 0.98) {
      appendAnalysisText(
        `個人スコアと全体スコアの相関が強い（${coefficients.correlation.toFixed(3)}）ため、両係数を独立に特定するのは困難です。`,
        "validation-warning"
      );
    } else {
      appendAnalysisText(
        `個人スコアと全体スコアの相関: ${coefficients.correlation.toFixed(3)}`
      );
    }

    appendAnalysisText(
      "推定値は登録データへの参考フィットです。公式仕様の証明ではなく、既存計算機の式にも反映しません。",
      "validation-warning"
    );
  }

  function render() {
    renderRecords();
    renderAnalysis();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function readIntegerInput(selector, label) {
    const input = root.querySelector(selector);
    const raw = input.value.trim();
    if (raw === "") throw new Error(`${label}を入力してください。`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}は0以上の整数で入力してください。`);
    }
    return value;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    try {
      const record = validateRecord({
        id: createId(),
        recordedAt: new Date().toISOString(),
        eventType: "spotlight",
        liveMode: "multi",
        personalScore: readIntegerInput("#validation-personal-score", "個人リザルトスコア"),
        multiScore: readIntegerInput("#validation-multi-score", "マルチ全体スコア"),
        multiScoreFeverIncluded: true,
        actualPoints: readIntegerInput("#validation-actual-points", "実際の獲得Pt"),
        bonusPercent: readIntegerInput("#validation-bonus-percent", "特攻倍率"),
        songRatePercent: Number(root.querySelector("#validation-song-rate").value),
        boostCount: Number(root.querySelector("#validation-boost-count").value),
        holopass: root.querySelector("#validation-holopass").value === "true"
      });
      if (saveRecords(records.concat(record))) {
        form.reset();
        render();
      }
    } catch (error) {
      showError(error.message, error);
    }
  });

  function escapeCsv(value) {
    const text = String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function recordToCsvRow(record) {
    return [
      SCHEMA_VERSION,
      record.id,
      record.recordedAt,
      record.eventType,
      record.liveMode,
      record.personalScore,
      record.multiScore,
      record.multiScoreFeverIncluded,
      record.actualPoints,
      record.bonusPercent,
      record.songRatePercent,
      record.boostCount,
      record.holopass
    ];
  }

  function exportCsv() {
    const rows = [csvHeaders, ...records.map(recordToCsvRow)];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hololive-dreams-spotlight-validation.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus(`${records.length}件の実測記録をCSVに出力しました。`);
  }

  function parseCsv(text) {
    const source = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"' && field === "") {
        quoted = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n" || character === "\r") {
        row.push(field);
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        field = "";
        if (character === "\r" && source[index + 1] === "\n") index += 1;
      } else {
        field += character;
      }
    }

    if (quoted) throw new Error("CSVの引用符が閉じられていません。");
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
    return rows;
  }

  function parseImportedRecord(row, rowNumber) {
    if (row.length !== csvHeaders.length) {
      throw new Error(`${rowNumber}行目: 列数が正しくありません。`);
    }
    const values = Object.fromEntries(csvHeaders.map((header, index) => [header, row[index]]));
    if (values.schema_version !== SCHEMA_VERSION) {
      throw new Error(`${rowNumber}行目: 未対応のCSVバージョンです。`);
    }

    const parseInteger = (key, label) => {
      if (!/^(0|[1-9]\d*)$/.test(values[key])) {
        throw new Error(`${rowNumber}行目: ${label}は0以上の整数である必要があります。`);
      }
      const value = Number(values[key]);
      if (!Number.isSafeInteger(value)) {
        throw new Error(`${rowNumber}行目: ${label}が安全に扱える範囲を超えています。`);
      }
      return value;
    };

    if (values.multi_score_fever_included !== "true") {
      throw new Error(`${rowNumber}行目: 全体スコアはFEVER込みである必要があります。`);
    }
    if (values.holopass !== "true" && values.holopass !== "false") {
      throw new Error(`${rowNumber}行目: ホロパスの値が正しくありません。`);
    }

    return validateRecord({
      id: values.record_id,
      recordedAt: values.recorded_at,
      eventType: values.event_type,
      liveMode: values.live_mode,
      personalScore: parseInteger("personal_score", "個人スコア"),
      multiScore: parseInteger("multi_score", "全体スコア"),
      multiScoreFeverIncluded: true,
      actualPoints: parseInteger("actual_points", "実測Pt"),
      bonusPercent: parseInteger("bonus_percent", "特攻倍率"),
      songRatePercent: parseInteger("song_rate_percent", "曲長ボーナス"),
      boostCount: parseInteger("boost_count", "ブースト数"),
      holopass: values.holopass === "true"
    });
  }

  async function importCsv(file) {
    let text;
    try {
      text = await file.text();
    } catch (error) {
      showError("CSVファイルを読み込めませんでした。", error);
      return;
    }

    let imported;
    try {
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("CSVに実測データがありません。");
      const headers = rows[0];
      if (headers.length !== csvHeaders.length
        || headers.some((header, index) => header !== csvHeaders[index])) {
        throw new Error("CSVヘッダーが未対応です。エクスポートした形式を使用してください。");
      }

      imported = rows.slice(1).map((row, index) => parseImportedRecord(row, index + 2));
      const ids = new Set();
      imported.forEach((record, index) => {
        if (ids.has(record.id)) {
          throw new Error(`${index + 2}行目: CSV内で記録IDが重複しています。`);
        }
        ids.add(record.id);
      });
    } catch (error) {
      showError(`CSVを取り込めませんでした。既存データは変更していません。${error.message}`, error);
      return;
    }

    const existingIds = new Set(records.map((record) => record.id));
    const additions = imported.filter((record) => !existingIds.has(record.id));
    const skipped = imported.length - additions.length;

    if (additions.length === 0) {
      showStatus(`新規データはありません。既存IDの${skipped}件は上書きせずスキップしました。`);
      return;
    }

    if (saveRecords(records.concat(additions))) {
      render();
      showStatus(`${additions.length}件を追加しました。既存IDの${skipped}件は上書きせずスキップしました。`);
    }
  }

  root.querySelector("#validation-export").addEventListener("click", exportCsv);
  root.querySelector("#validation-import-button").addEventListener("click", () => {
    importFile.click();
  });
  importFile.addEventListener("change", () => {
    const file = importFile.files && importFile.files[0];
    if (file) importCsv(file);
    importFile.value = "";
  });

  function updateVisibility() {
    root.hidden = eventMode.value !== "spotlight";
  }

  eventMode.addEventListener("change", updateVisibility);
  records = loadRecords();
  updateVisibility();
  render();
})();
