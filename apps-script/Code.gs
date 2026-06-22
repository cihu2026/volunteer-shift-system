const CONFIG = {
  SPREADSHEET_ID: '1A1gTUYUDlyR7kN47CQYksid37GeMxPOIh4il5ms-ZR4',
  SHEETS: {
    TEACHERS: 'Teachers',
    SHIFTS: 'Shifts',
    SELECTIONS: 'Selections',
    SWAPS: 'SwapRequests'
  }
};

const HEADERS = {
  Teachers: ['teacherId', 'name', 'active', 'phone', 'email', 'note'],
  Shifts: ['shiftId', 'date', 'weekday', 'site', 'duty', 'startTime', 'endTime', 'reportTime', 'quota', 'status', 'note'],
  Selections: ['selectionId', 'teacherId', 'teacherName', 'shiftId', 'confirmed', 'selectedAt', 'confirmedAt', 'note'],
  SwapRequests: ['requestId', 'teacherId', 'teacherName', 'originalShiftId', 'desiredShiftId', 'note', 'status', 'createdAt']
};

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  const params = normalizeParams_(e);
  const action = params.action || 'getPublicData';
  const callback = params.callback || '';

  try {
    let data;

    switch (action) {
      case 'setup':
        data = setupSystem();
        break;
      case 'importTeachers':
        data = importTeachersFromWorkbook();
        break;
      case 'getPublicData':
      case 'list':
        data = getPublicData();
        break;
      case 'lookupTeacher':
        data = lookupTeacher(params.query || params.teacherKey || '');
        break;
      case 'selectShift':
      case 'select':
        data = selectShift(params.teacherKey || params.teacherId || params.name || '', params.shiftId || '');
        break;
      case 'confirmShift':
      case 'confirm':
        data = confirmShift(params.teacherKey || params.teacherId || params.name || '', params.shiftId || '', params.selectionId || '');
        break;
      case 'requestSwap':
      case 'swap':
        data = requestSwap(
          params.teacherKey || params.teacherId || params.name || '',
          params.originalShiftId || '',
          params.desiredShiftId || '',
          params.note || ''
        );
        break;
      default:
        throw new Error('Unknown action: ' + action);
    }

    return jsonResponse_({ ok: true, action, data }, callback);
  } catch (error) {
    return jsonResponse_({ ok: false, action, error: String(error.message || error) }, callback);
  }
}

function setupSystem() {
  const ss = getSpreadsheet_();
  const teachersSheet = ensureSheet_(ss, CONFIG.SHEETS.TEACHERS, HEADERS.Teachers);
  const shiftsSheet = ensureSheet_(ss, CONFIG.SHEETS.SHIFTS, HEADERS.Shifts);
  ensureSheet_(ss, CONFIG.SHEETS.SELECTIONS, HEADERS.Selections);
  ensureSheet_(ss, CONFIG.SHEETS.SWAPS, HEADERS.SwapRequests);

  if (teachersSheet.getLastRow() <= 1) {
    teachersSheet.getRange(2, 1, 3, HEADERS.Teachers.length).setValues([
      ['T001', '王老師', true, '', '', '示範資料'],
      ['T002', '陳老師', true, '', '', '示範資料'],
      ['T003', '林老師', true, '', '', '示範資料']
    ]);
  }

  if (shiftsSheet.getLastRow() <= 1) {
    shiftsSheet.getRange(2, 1, 8, HEADERS.Shifts.length).setValues([
      ['S001', '2026/07/05', '日', 'A點', 'A點上午班', '09:00', '13:00', '08:50', 1, 'open', ''],
      ['S002', '2026/07/05', '日', 'A點', 'A點下午班', '12:00', '16:00', '11:50', 1, 'open', ''],
      ['S003', '2026/07/05', '日', '慈湖遊客中心', '上午-1', '08:30', '12:30', '08:20', 1, 'open', ''],
      ['S004', '2026/07/05', '日', '慈湖遊客中心', '下午-1', '12:30', '16:30', '12:20', 1, 'open', ''],
      ['S005', '2026/07/05', '日', '北橫遊客中心', '上午-1', '08:30', '12:30', '08:20', 1, 'open', ''],
      ['S006', '2026/07/05', '日', '北橫遊客中心', '下午-1', '12:30', '16:30', '12:20', 1, 'open', ''],
      ['S007', '2026/07/06', '一', '導覽', '導覽第1梯', '08:45', '09:15', '08:35', 1, 'open', ''],
      ['S008', '2026/07/06', '一', '導覽', '導覽第3梯', '09:45', '10:15', '09:35', 1, 'open', '']
    ]);
  }

  formatSystemSheets_();
  return { message: 'setup completed', spreadsheetUrl: ss.getUrl() };
}

function importTeachersFromWorkbook() {
  setupSystem();

  const ss = getSpreadsheet_();
  const target = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  const existing = tableToObjects_(target);
  const existingIds = new Set(existing.map((row) => String(row.teacherId)));
  const newRows = [];

  ss.getSheets().forEach((sheet) => {
    if (Object.values(CONFIG.SHEETS).includes(sheet.getName())) return;

    const values = sheet.getDataRange().getDisplayValues();
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length - 1; c++) {
        const first = normalizeText_(values[r][c]);
        const second = normalizeText_(values[r][c + 1]);
        if (first === '學號' && second === '姓名') {
          for (let i = r + 1; i < values.length; i++) {
            const id = normalizeText_(values[i][c]);
            const name = normalizeText_(values[i][c + 1]);
            if (!id && !name) break;
            if (!id || !name) continue;
            if (id === '休園' || name === '休園' || name === '無名額') continue;
            if (existingIds.has(id)) continue;
            existingIds.add(id);
            newRows.push([id, name, true, '', '', '由 ' + sheet.getName() + ' 匯入']);
          }
        }
      }
    }
  });

  if (newRows.length > 0) {
    target.getRange(target.getLastRow() + 1, 1, newRows.length, HEADERS.Teachers.length).setValues(newRows);
  }

  return { imported: newRows.length, totalTeachers: tableToObjects_(target).length };
}

function getPublicData() {
  setupSystem();

  const ss = getSpreadsheet_();
  const teachers = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.TEACHERS))
    .filter((row) => String(row.active).toLowerCase() !== 'false');
  const shifts = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.SHIFTS))
    .filter((row) => String(row.status || 'open').toLowerCase() !== 'closed');
  const selections = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.SELECTIONS));
  const swaps = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.SWAPS));

  const selectionMap = groupBy_(selections, 'shiftId');
  const shiftsWithState = shifts.map((shift) => {
    const selected = selectionMap[shift.shiftId] || [];
    const quota = Number(shift.quota || 1);
    return {
      ...shift,
      quota,
      selectedCount: selected.length,
      remaining: Math.max(quota - selected.length, 0),
      selectedPeople: selected.map((item) => ({
        teacherId: item.teacherId,
        teacherName: item.teacherName,
        confirmed: String(item.confirmed).toLowerCase() === 'true'
      }))
    };
  });

  return {
    teachers,
    shifts: shiftsWithState,
    selections,
    swaps,
    generatedAt: new Date().toISOString()
  };
}

function lookupTeacher(query) {
  const teacher = findTeacher_(query);
  if (!teacher) throw new Error('查無此人，請確認學號或姓名。');

  const ss = getSpreadsheet_();
  const selections = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.SELECTIONS))
    .filter((row) => String(row.teacherId) === String(teacher.teacherId));
  const shifts = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.SHIFTS));
  const shiftById = keyBy_(shifts, 'shiftId');

  return {
    teacher,
    selections: selections.map((selection) => ({
      ...selection,
      shift: shiftById[selection.shiftId] || null
    }))
  };
}

function selectShift(teacherKey, shiftId) {
  if (!teacherKey) throw new Error('請輸入學號或姓名。');
  if (!shiftId) throw new Error('缺少 shiftId。');

  const lock = LockService.getScriptLock();
  lock.waitLock(8000);

  try {
    setupSystem();
    const ss = getSpreadsheet_();
    const teacher = findTeacher_(teacherKey);
    if (!teacher) throw new Error('查無此人，請確認學號或姓名。');

    const shiftsSheet = ss.getSheetByName(CONFIG.SHEETS.SHIFTS);
    const selectionsSheet = ss.getSheetByName(CONFIG.SHEETS.SELECTIONS);
    const shifts = tableToObjects_(shiftsSheet);
    const shift = shifts.find((row) => String(row.shiftId) === String(shiftId));
    if (!shift) throw new Error('查無此班別。');
    if (String(shift.status || 'open').toLowerCase() === 'closed') throw new Error('這個班別已關閉。');

    const selections = tableToObjects_(selectionsSheet);
    if (selections.some((row) => String(row.teacherId) === String(teacher.teacherId) && String(row.shiftId) === String(shiftId))) {
      throw new Error('你已經選過這一班。');
    }

    const selectedCount = selections.filter((row) => String(row.shiftId) === String(shiftId)).length;
    const quota = Number(shift.quota || 1);
    if (selectedCount >= quota) throw new Error('這個班別已額滿。');

    const selectionId = 'SEL-' + Utilities.getUuid().slice(0, 8);
    selectionsSheet.appendRow([
      selectionId,
      teacher.teacherId,
      teacher.name,
      shift.shiftId,
      false,
      new Date(),
      '',
      ''
    ]);

    return {
      selectionId,
      teacherId: teacher.teacherId,
      teacherName: teacher.name,
      shiftId: shift.shiftId,
      message: '選班成功，請記得按「我知道了」。'
    };
  } finally {
    lock.releaseLock();
  }
}

function confirmShift(teacherKey, shiftId, selectionId) {
  if (!teacherKey && !selectionId) throw new Error('請輸入學號／姓名，或提供 selectionId。');

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.SELECTIONS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const index = headerIndex_(headers);
  const teacher = teacherKey ? findTeacher_(teacherKey) : null;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const matchedBySelectionId = selectionId && String(row[index.selectionId]) === String(selectionId);
    const matchedByTeacherAndShift = teacher && String(row[index.teacherId]) === String(teacher.teacherId) && String(row[index.shiftId]) === String(shiftId);

    if (matchedBySelectionId || matchedByTeacherAndShift) {
      sheet.getRange(r + 1, index.confirmed + 1).setValue(true);
      sheet.getRange(r + 1, index.confirmedAt + 1).setValue(new Date());
      return { message: '已確認收到提醒。' };
    }
  }

  throw new Error('找不到要確認的選班紀錄。');
}

function requestSwap(teacherKey, originalShiftId, desiredShiftId, note) {
  if (!teacherKey) throw new Error('請輸入學號或姓名。');
  if (!originalShiftId) throw new Error('請選擇原本的班。');

  setupSystem();
  const teacher = findTeacher_(teacherKey);
  if (!teacher) throw new Error('查無此人，請確認學號或姓名。');

  const ss = getSpreadsheet_();
  const selections = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.SELECTIONS));
  const hasOriginal = selections.some((row) => String(row.teacherId) === String(teacher.teacherId) && String(row.shiftId) === String(originalShiftId));
  if (!hasOriginal) throw new Error('你沒有選這個原班別，不能申請換班。');

  const requestId = 'SWAP-' + Utilities.getUuid().slice(0, 8);
  ss.getSheetByName(CONFIG.SHEETS.SWAPS).appendRow([
    requestId,
    teacher.teacherId,
    teacher.name,
    originalShiftId,
    desiredShiftId || '',
    note || '',
    'open',
    new Date()
  ]);

  return { requestId, message: '已建立換班申請。' };
}

function findTeacher_(query) {
  setupSystem();
  const value = normalizeText_(query);
  if (!value) return null;

  const ss = getSpreadsheet_();
  const teachers = tableToObjects_(ss.getSheetByName(CONFIG.SHEETS.TEACHERS));
  return teachers.find((row) => {
    const active = String(row.active).toLowerCase() !== 'false';
    return active && (String(row.teacherId) === value || normalizeText_(row.name) === value);
  }) || null;
}

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = headers.every((header, i) => String(firstRow[i] || '') === header);
  if (!hasHeaders) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function formatSystemSheets_() {
  const ss = getSpreadsheet_();
  Object.values(CONFIG.SHEETS).forEach((sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#e5e7eb');
    sheet.autoResizeColumns(1, lastCol);
  });
}

function tableToObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];

  const range = sheet.getDataRange();
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const headers = values[0].map((item) => String(item).trim());
  const timeZone = 'Asia/Taipei';

  return values.slice(1).filter((row) => row.some((cell) => cell !== '')).map((row, rowIndex) => {
    const obj = {};
    headers.forEach((header, i) => {
      const value = row[i];
      const displayValue = normalizeText_(displayValues[rowIndex + 1][i]);

      // 排班日期只回傳 yyyy/MM/dd，不要帶 00:00:00，避免前端月曆判斷錯誤。
      if (header === 'date') {
        obj[header] = value instanceof Date
          ? Utilities.formatDate(value, timeZone, 'yyyy/MM/dd')
          : displayValue;
        return;
      }

      // 服務時間、結束時間、報到時間只回傳 HH:mm，不要出現 1899/12/31。
      if (['startTime', 'endTime', 'reportTime'].includes(header)) {
        obj[header] = displayValue;
        return;
      }

      // 選班、確認、換班建立時間才保留日期＋時間。
      if (value instanceof Date) {
        obj[header] = Utilities.formatDate(value, timeZone, 'yyyy/MM/dd HH:mm:ss');
        return;
      }

      obj[header] = value;
    });
    return obj;
  });
}

function headerIndex_(headers) {
  const index = {};
  headers.forEach((header, i) => {
    index[String(header).trim()] = i;
  });
  return index;
}

function keyBy_(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = row;
    return acc;
  }, {});
}

function groupBy_(rows, key) {
  return rows.reduce((acc, row) => {
    const groupKey = row[key];
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(row);
    return acc;
  }, {});
}

function normalizeText_(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeParams_(e) {
  const params = Object.assign({}, e && e.parameter ? e.parameter : {});

  if (e && e.postData && e.postData.contents) {
    try {
      Object.assign(params, JSON.parse(e.postData.contents));
    } catch (error) {
      // 表單或非 JSON POST 時略過。
    }
  }

  return params;
}

function jsonResponse_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(String(callback) + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
