(() => {
  "use strict";

  const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
  const TARGET_SHEET_NAMES = ["ｶｴﾗ", "ﾄﾜ", "ｱｰﾆｬ", "ﾗﾌﾟﾗｽ", "ｼｵﾘ"];
  const REQUIRED_HEADERS = [
    "曲長ボーナス",
    "個人スコア",
    "全体スコア",
    "炊き数",
    "ポイント"
  ];
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const MAX_ENTRY_SIZE = 8 * 1024 * 1024;
  const MAX_TOTAL_UNCOMPRESSED_SIZE = 20 * 1024 * 1024;
  const MAX_LIVE_RECORDS = 10000;

  function normalizeSheetName(value) {
    return String(value ?? "").trim().normalize("NFKC").trim().replace(/\s/g, "");
  }

  const TARGET_SHEETS = new Set(TARGET_SHEET_NAMES.map(normalizeSheetName));

  function normalizeText(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s/g, "");
  }

  function readUint16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, true);
  }

  function findEndOfCentralDirectory(view) {
    const minimumOffset = Math.max(0, view.byteLength - 22 - 65535);
    for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
      if (readUint32(view, offset) !== 0x06054b50) continue;
      const commentLength = readUint16(view, offset + 20);
      if (offset + 22 + commentLength === view.byteLength) return offset;
    }
    throw new Error("XLSXのZIP目録を読み取れません。");
  }

  function readZipDirectory(buffer) {
    const view = new DataView(buffer);
    const eocdOffset = findEndOfCentralDirectory(view);
    const diskNumber = readUint16(view, eocdOffset + 4);
    const centralDisk = readUint16(view, eocdOffset + 6);
    const entriesOnDisk = readUint16(view, eocdOffset + 8);
    const entryCount = readUint16(view, eocdOffset + 10);
    const centralSize = readUint32(view, eocdOffset + 12);
    const centralOffset = readUint32(view, eocdOffset + 16);

    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new Error("複数ディスク形式のExcelファイルには対応していません。");
    }
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("ZIP64形式のExcelファイルには対応していません。");
    }
    if (centralOffset + centralSize > eocdOffset) {
      throw new Error("XLSXのZIP目録が破損しています。");
    }

    const entries = new Map();
    const decoder = new TextDecoder("utf-8");
    let offset = centralOffset;
    let totalUncompressedSize = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > view.byteLength || readUint32(view, offset) !== 0x02014b50) {
        throw new Error("XLSXのZIP目録が破損しています。");
      }

      const flags = readUint16(view, offset + 8);
      const compressionMethod = readUint16(view, offset + 10);
      const compressedSize = readUint32(view, offset + 20);
      const uncompressedSize = readUint32(view, offset + 24);
      const nameLength = readUint16(view, offset + 28);
      const extraLength = readUint16(view, offset + 30);
      const commentLength = readUint16(view, offset + 32);
      const localHeaderOffset = readUint32(view, offset + 42);
      const nameOffset = offset + 46;
      const nextOffset = nameOffset + nameLength + extraLength + commentLength;

      if (nextOffset > view.byteLength) {
        throw new Error("XLSXのZIP目録が破損しています。");
      }
      if ((flags & 0x0001) !== 0) {
        throw new Error("暗号化されたExcelファイルは読み込めません。");
      }
      if (compressionMethod !== 0 && compressionMethod !== 8) {
        throw new Error("未対応のZIP圧縮形式です。");
      }
      if (compressedSize === 0xffffffff
        || uncompressedSize === 0xffffffff
        || localHeaderOffset === 0xffffffff
        || uncompressedSize > MAX_ENTRY_SIZE) {
        throw new Error("Excelファイル内のデータサイズが対応上限を超えています。");
      }

      totalUncompressedSize += uncompressedSize;
      if (totalUncompressedSize > MAX_TOTAL_UNCOMPRESSED_SIZE) {
        throw new Error("Excelファイルの展開サイズが対応上限を超えています。");
      }

      const name = decoder.decode(new Uint8Array(buffer, nameOffset, nameLength));
      entries.set(name, {
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
      offset = nextOffset;
    }

    return entries;
  }

  async function readZipEntry(buffer, entries, name) {
    const entry = entries.get(name);
    if (!entry) return null;

    const view = new DataView(buffer);
    const offset = entry.localHeaderOffset;
    if (offset + 30 > view.byteLength || readUint32(view, offset) !== 0x04034b50) {
      throw new Error(`Excelファイル内の「${name}」を読み取れません。`);
    }

    const nameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    const dataOffset = offset + 30 + nameLength + extraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataEnd > view.byteLength) {
      throw new Error(`Excelファイル内の「${name}」が破損しています。`);
    }

    const compressed = new Uint8Array(buffer, dataOffset, entry.compressedSize);
    let result;
    if (entry.compressionMethod === 0) {
      result = compressed.slice();
    } else {
      if (typeof DecompressionStream !== "function") {
        throw new Error("このブラウザーはXLSXの展開に対応していません。最新のブラウザーを使用してください。");
      }
      try {
        const stream = new Blob([compressed])
          .stream()
          .pipeThrough(new DecompressionStream("deflate-raw"));
        const reader = stream.getReader();
        const chunks = [];
        let totalSize = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalSize += value.byteLength;
          if (totalSize > MAX_ENTRY_SIZE) {
            await reader.cancel();
            throw new Error("展開後のデータサイズが対応上限を超えています。");
          }
          chunks.push(value);
        }
        result = new Uint8Array(totalSize);
        let resultOffset = 0;
        chunks.forEach((chunk) => {
          result.set(chunk, resultOffset);
          resultOffset += chunk.byteLength;
        });
      } catch (error) {
        throw new Error(`XLSXを展開できませんでした: ${error.message}`);
      }
    }

    if (result.byteLength !== entry.uncompressedSize) {
      throw new Error(`Excelファイル内の「${name}」のサイズが一致しません。`);
    }
    return result;
  }

  function normalizePackagePath(basePath, target) {
    const segments = target.startsWith("/")
      ? []
      : basePath.split("/").filter(Boolean);
    target.split("/").forEach((segment) => {
      if (!segment || segment === ".") return;
      if (segment === "..") {
        segments.pop();
      } else {
        segments.push(segment);
      }
    });
    return segments.join("/");
  }

  function parseXml(text, label) {
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (document.documentElement.localName === "parsererror"
      || document.getElementsByTagName("parsererror").length > 0) {
      throw new Error(`Excelファイル内の「${label}」が正しいXMLではありません。`);
    }
    return document;
  }

  async function readXml(buffer, entries, path, required = true) {
    const bytes = await readZipEntry(buffer, entries, path);
    if (!bytes) {
      if (required) throw new Error(`Excelファイルに「${path}」がありません。`);
      return null;
    }
    return parseXml(new TextDecoder("utf-8").decode(bytes), path);
  }

  function relationshipMap(document) {
    const relationships = new Map();
    if (!document) return relationships;
    Array.from(document.getElementsByTagNameNS(PACKAGE_REL_NS, "Relationship")).forEach((relationship) => {
      relationships.set(relationship.getAttribute("Id"), {
        target: relationship.getAttribute("Target"),
        type: relationship.getAttribute("Type")
      });
    });
    return relationships;
  }

  function getColumnIndex(reference) {
    const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase();
    if (!letters) throw new Error(`Excelセル位置「${reference}」が正しくありません。`);
    return Array.from(letters).reduce(
      (value, character) => value * 26 + character.charCodeAt(0) - 64,
      0
    );
  }

  function getCellValue(cell, sharedStrings) {
    const type = cell.getAttribute("t");
    if (type === "inlineStr") {
      return Array.from(cell.getElementsByTagNameNS(MAIN_NS, "t"))
        .map((text) => text.textContent)
        .join("");
    }

    const valueElement = cell.getElementsByTagNameNS(MAIN_NS, "v")[0];
    if (!valueElement) return "";
    const value = valueElement.textContent;

    if (type === "s") {
      const index = Number(value);
      if (!Number.isSafeInteger(index) || index < 0 || index >= sharedStrings.length) {
        throw new Error("共有文字列の参照が正しくありません。");
      }
      return sharedStrings[index];
    }
    if (type === "b") return value === "1" ? "true" : "false";
    return value;
  }

  function readSheetRows(document, sharedStrings) {
    const rows = new Map();
    Array.from(document.getElementsByTagNameNS(MAIN_NS, "row")).forEach((rowElement) => {
      const rowNumber = Number(rowElement.getAttribute("r"));
      if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) return;
      const cells = new Map();
      Array.from(rowElement.children)
        .filter((cell) => cell.localName === "c")
        .forEach((cell) => {
          const reference = cell.getAttribute("r");
          const column = getColumnIndex(reference);
          const formula = cell.getElementsByTagNameNS(MAIN_NS, "f").length > 0;
          cells.set(column, {
            value: getCellValue(cell, sharedStrings),
            formula
          });
        });
      rows.set(rowNumber, cells);
    });
    return rows;
  }

  function cellAt(rows, rowNumber, column) {
    return rows.get(rowNumber)?.get(column) || { value: "", formula: false };
  }

  function findBonusCell(rows) {
    const row = rows.get(3);
    if (!row) return { value: "", formula: false };

    for (const [column, cell] of row) {
      if (normalizeText(cell.value) !== "イベント獲得ボーナス") continue;
      const nextCells = Array.from(row.entries())
        .filter(([nextColumn, nextCell]) => nextColumn > column && nextCell.value !== "")
        .sort(([left], [right]) => left - right);
      return nextCells[0]?.[1] || { value: "", formula: false };
    }
    return { value: "", formula: false };
  }

  function findLiveBlocks(rows) {
    const sectionRow = rows.get(5);
    const headerRow = rows.get(6);
    if (!sectionRow || !headerRow) return [];

    const sections = Array.from(sectionRow.entries())
      .map(([column, cell]) => ({ column, name: normalizeText(cell.value) }))
      .filter(({ name }) => name === "ライブ" || name === "ミニゲーム")
      .sort((left, right) => left.column - right.column);
    const liveSections = sections.filter(({ name }) => name === "ライブ");

    return liveSections.map((section, index) => {
      const nextSection = sections.find(({ column }) => column > section.column);
      const endColumn = nextSection?.column ?? Number.POSITIVE_INFINITY;
      const columnByHeader = new Map();

      Array.from(headerRow.entries()).forEach(([column, cell]) => {
        if (column < section.column || column >= endColumn) return;
        const header = normalizeText(cell.value);
        if (header) columnByHeader.set(header, column);
      });

      const columns = {};
      REQUIRED_HEADERS.concat("備考").forEach((header) => {
        const column = columnByHeader.get(header);
        if (column !== undefined) columns[header] = column;
      });
      const missingHeaders = REQUIRED_HEADERS.filter((header) => columns[header] === undefined);
      if (missingHeaders.length > 0) {
        throw new Error(`ライブ欄${index + 1}の列見出しを特定できません: ${missingHeaders.join("、")}`);
      }

      const entries = [];
      Array.from(rows.keys())
        .filter((rowNumber) => rowNumber >= 8)
        .sort((left, right) => left - right)
        .forEach((rowNumber) => {
          const values = {};
          const formulas = [];
          REQUIRED_HEADERS.concat("備考").forEach((header) => {
            const column = columns[header];
            const cell = cellAt(rows, rowNumber, column);
            values[header] = cell.value;
            if (cell.formula) formulas.push(header);
          });
          if (formulas.length === 0
            && Object.values(values).every((value) => String(value).trim() === "")) {
            return;
          }
          entries.push({
            rowNumber,
            values,
            formulas
          });
        });

      const dateCell = cellAt(rows, 7, section.column);
      return {
        blockNumber: index + 1,
        dateValue: dateCell.value,
        dateFormula: dateCell.formula,
        bonusCell: findBonusCell(rows),
        entries
      };
    });
  }

  async function readWorkbook(file) {
    if (!file || !/\.xlsx$/i.test(file.name)) {
      throw new Error("拡張子が.xlsxのExcelファイルを選択してください。");
    }
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      throw new Error("Excelファイルが空、または10MBの上限を超えています。");
    }

    const buffer = await file.arrayBuffer();
    const entries = readZipDirectory(buffer);
    const rootRelationships = relationshipMap(
      await readXml(buffer, entries, "_rels/.rels", false)
    );
    const officeDocument = Array.from(rootRelationships.values())
      .find(({ type }) => type.endsWith("/officeDocument"));
    const workbookPath = officeDocument
      ? normalizePackagePath("", officeDocument.target)
      : "xl/workbook.xml";
    const workbook = await readXml(buffer, entries, workbookPath);
    const workbookDirectory = workbookPath.slice(0, workbookPath.lastIndexOf("/"));
    const relationshipsPath = `${workbookDirectory}/_rels/${workbookPath.slice(workbookPath.lastIndexOf("/") + 1)}.rels`;
    const workbookRelationships = relationshipMap(
      await readXml(buffer, entries, relationshipsPath)
    );
    const sharedStringsRelationship = Array.from(workbookRelationships.values())
      .find(({ type }) => type.endsWith("/sharedStrings"));
    const sharedStringsDocument = sharedStringsRelationship
      ? await readXml(
        buffer,
        entries,
        normalizePackagePath(workbookDirectory, sharedStringsRelationship.target)
      )
      : null;
    const sharedStrings = sharedStringsDocument
      ? Array.from(sharedStringsDocument.getElementsByTagNameNS(MAIN_NS, "si"))
        .map((item) => Array.from(item.getElementsByTagNameNS(MAIN_NS, "t"))
          .map((text) => text.textContent)
          .join(""))
      : [];
    const workbookProperties = workbook.getElementsByTagNameNS(MAIN_NS, "workbookPr")[0];
    const date1904 = workbookProperties?.getAttribute("date1904") === "1"
      || workbookProperties?.getAttribute("date1904") === "true";
    const workbookSheets = Array.from(workbook.getElementsByTagNameNS(MAIN_NS, "sheet"));

    if (workbookSheets.length === 0) {
      throw new Error("Excelブックにシートがありません。");
    }

    const sheets = [];
    for (const sheet of workbookSheets) {
      const name = sheet.getAttribute("name");
      const normalizedName = normalizeSheetName(name);
      const relationshipId = sheet.getAttributeNS(DOC_REL_NS, "id");
      const relationship = workbookRelationships.get(relationshipId);
      if (!relationship) {
        throw new Error(`シート「${name}」の参照先が見つかりません。`);
      }
      const sheetPath = normalizePackagePath(workbookDirectory, relationship.target);
      const sheetDocument = await readXml(buffer, entries, sheetPath);
      const rows = readSheetRows(sheetDocument, sharedStrings);
      const liveBlocks = findLiveBlocks(rows);

      sheets.push({
        name,
        isTarget: TARGET_SHEETS.has(normalizedName),
        liveBlocks
      });
    }

    const normalizedSheets = new Set(sheets.map(({ name }) => normalizeSheetName(name)));
    const missingSheets = Array.from(TARGET_SHEETS)
      .filter((name) => !normalizedSheets.has(name));
    if (missingSheets.length > 0) {
      throw new Error(`対象シートが見つかりません: ${missingSheets.join("、")}`);
    }

    const targetSheetsWithoutLiveBlocks = sheets
      .filter(({ isTarget, liveBlocks }) => isTarget && liveBlocks.length === 0)
      .map(({ name }) => name);
    if (targetSheetsWithoutLiveBlocks.length > 0) {
      throw new Error(`ライブ記録欄が見つからない対象シートがあります: ${targetSheetsWithoutLiveBlocks.join("、")}`);
    }

    const liveRecordCount = sheets.reduce(
      (total, sheet) => total + sheet.liveBlocks.reduce(
        (blockTotal, block) => blockTotal + block.entries.length,
        0
      ),
      0
    );
    if (liveRecordCount > MAX_LIVE_RECORDS) {
      throw new Error(`ライブ記録が${MAX_LIVE_RECORDS}件を超えています。対象を分けてください。`);
    }

    return { sheets, date1904 };
  }

  window.SpotlightXlsxImport = { readWorkbook };
})();
