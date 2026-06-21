/**
 * 志工／老師選班系統安全後端
 *
 * 用法：
 * 1. 到 Google 試算表：擴充功能 → Apps Script。
 * 2. 貼上本檔內容。
 * 3. 修改 ADMIN_TOKEN。
 * 4. 執行 setupBackend 一次，授權。
 * 5. 部署 → 新增部署作業 → 網路應用程式。
 *    執行身分：我
 *    存取權：知道連結的任何人
 * 6. 把 Web App URL 貼回 GitHub Pages 前端。
 */

const CONFIG = {
  SPREADSHEET_ID: '1te6Eql2eBh7l4JgFb-fOuHmmH-mtWdpc',
  ADMIN_TOKEN: 'CHANGE_ME_ADMIN_TOKEN',
  SHEET_TEACHERS: 'Teachers',
  SHEET_SHIFTS: 'Shifts',
  SHEET_SELECTIONS: 'Selections'
};

const HEADERS = {
  teachers: ['teacher_id', 'display_name', 'email', 'active'],
  shifts: ['shift_id', 'date', 'duty', 'time', 'report_time', 'place', 'quota', 'visible'],
  selections: ['selection_id', 'teacher_id', 'shift_id', 'confirmed', 'selected_at', 'confirmed_at']
};

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || 'status';

  try {
    if (action === 'status') return json_({ ok: true, message: 'API 正常' });
    if (action === 'setup') return json_(setupBackend_(params));
    if (action === 'importTeachers') return json_(importTeachersFromRoster_(params));
    if (action === 'query') return json_(queryTeacher_(params));
    if (action === 'select') return json_(selectShift_(params));
    if (action === 'confirm') return json_(confirmSelection_(params));
    if (action === 'admin') return json_(adminReport_(params));

    return json_({ ok: false, error: '未知 action：' + action });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function setupBackend() {
  return setupBackend_({ token: CONFIG.ADMIN_TOKEN });
}

function setupBackend_(params) {
  requireAdmin_(params);
  const ss = openSpreadsheet_();
  ensureSheet_(ss, CONFIG.SHEET_TEACHERS, HEADERS.teachers);
  ensureSheet_(ss, CONFIG.SHEET_SHIFTS, HEADERS.shifts);
  ensureSheet_(ss, CONFIG.SHEET_SELECTIONS, HEADERS.selections);

  const shiftSheet = ss.getSheetByName(CONFIG.SHEET_SHIFTS);
  if (shiftSheet.getLastRow() === 1) {
    shiftSheet.getRange(2, 1, 5, HEADERS.shifts.length).setValues([
      ['S001', '2026/07/05（日）', 'A哨上午班', '09:00－12:00', '08:50', 'A哨', 1, true],
      ['S002', '2026/07/05（日）', 'A哨下午班', '12:00－13:30', '11:50', 'A哨', 1, true],
      ['S003', '2026/07/06（一）', '導覽第 1 梯', '09:00－09:30', '08:50', '導覽集合處', 2, true],
      ['S004', '2026/07/06（一）', '導覽第 3 梯', '10:00－10:30', '09:50', '導覽集合處', 2, true],
      ['S005', '2026/07/07（二）', '留守支援', '09:00－12:00', '08:50', '遊客中心', 1, true]
    ]);
  }

  return { ok: true, message: '後端工作表已建立完成' };
}

function importTeachersFromRoster_(params) {
  requireAdmin_(params);
  setupBackend_(params);

  const ss = openSpreadsheet_();
  const teacherSheet = ss.getSheetByName(CONFIG.SHEET_TEACHERS);
  const existing = new Set(readObjects_(teacherSheet).map(row => String(row.teacher_id)));
  const roster = scanRoster_(ss);
  const rowsToAppend = [];

  roster.forEach(person => {
    if (!existing.has(person.teacher_id)) {
      rowsToAppend.push([person.teacher_id, person.display_name, '', true]);
      existing.add(person.teacher_id);
    }
  });

  if (rowsToAppend.length > 0) {
    teacherSheet.getRange(teacherSheet.getLastRow() + 1, 1, rowsToAppend.length, HEADERS.teachers.length).setValues(rowsToAppend);
  }

  return {
    ok: true,
    message: '已匯入 ' + rowsToAppend.length + ' 位人員；略過已存在 ' + (roster.length - rowsToAppend.length) + ' 位。'
  };
}

function queryTeacher_(params) {
  setupBackend_({ token: CONFIG.ADMIN_TOKEN });

  const code = clean_(params.q || params.teacher_id || '');
  if (!code) throw new Error('請輸入個人代碼。');

  const teacher = getTeacherById_(code);
  if (!teacher) throw new Error('查無此代碼，請確認是否輸入正確。');
  if (!isTruthy_(teacher.active)) throw new Error('此代碼目前未啟用。');

  return {
    ok: true,
    teacher: publicTeacher_(teacher),
    selections: getSelectionsForTeacher_(teacher.teacher_id),
    availableShifts: getAvailableShifts_()
  };
}

function selectShift_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    setupBackend_({ token: CONFIG.ADMIN_TOKEN });

    const teacherId = clean_(params.teacher_id || '');
    const shiftId = clean_(params.shift_id || '');
    if (!teacherId || !shiftId) throw new Error('缺少 teacher_id 或 shift_id。');

    const teacher = getTeacherById_(teacherId);
    const shift = getShiftById_(shiftId);
    if (!teacher) throw new Error('查無此人員代碼。');
    if (!shift) throw new Error('查無此班別。');
    if (!isTruthy_(shift.visible)) throw new Error('此班別目前未開放。');

    const selectedCount = getSelectedCount_(shiftId);
    const quota = Number(shift.quota || 0);
    if (selectedCount >= quota) throw new Error('此班別已額滿。');

    const ss = openSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.SHEET_SELECTIONS);
    const existing = readObjects_(sheet).some(row => {
      return clean_(row.teacher_id) === teacherId && clean_(row.shift_id) === shiftId;
    });
    if (existing) throw new Error('你已經選過這一班。');

    const selectionId = Utilities.getUuid();
    sheet.appendRow([selectionId, teacherId, shiftId, false, new Date(), '']);

    return {
      ok: true,
      message: '選班成功，請記得按「我知道了」。',
      teacher: publicTeacher_(teacher),
      selections: getSelectionsForTeacher_(teacherId),
      availableShifts: getAvailableShifts_()
    };
  } finally {
    lock.releaseLock();
  }
}

function confirmSelection_(params) {
  setupBackend_({ token: CONFIG.ADMIN_TOKEN });

  const teacherId = clean_(params.teacher_id || '');
  const selectionId = clean_(params.selection_id || '');
  if (!teacherId || !selectionId) throw new Error('缺少 teacher_id 或 selection_id。');

  const ss = openSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_SELECTIONS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idCol = headers.indexOf('selection_id');
  const teacherCol = headers.indexOf('teacher_id');
  const confirmedCol = headers.indexOf('confirmed');
  const confirmedAtCol = headers.indexOf('confirmed_at');

  for (let i = 1; i < values.length; i += 1) {
    if (clean_(values[i][idCol]) === selectionId && clean_(values[i][teacherCol]) === teacherId) {
      sheet.getRange(i + 1, confirmedCol + 1).setValue(true);
      sheet.getRange(i + 1, confirmedAtCol + 1).setValue(new Date());
      return {
        ok: true,
        message: '已確認收到提醒。',
        selections: getSelectionsForTeacher_(teacherId),
        availableShifts: getAvailableShifts_()
      };
    }
  }

  throw new Error('查無此選班紀錄，或代碼不符。');
}

function adminReport_(params) {
  requireAdmin_(params);
  setupBackend_(params);

  const teachers = readObjects_(openSpreadsheet_().getSheetByName(CONFIG.SHEET_TEACHERS));
  const teacherMap = new Map(teachers.map(row => [clean_(row.teacher_id), row]));
  const selections = readObjects_(openSpreadsheet_().getSheetByName(CONFIG.SHEET_SELECTIONS));

  return {
    ok: true,
    selections: selections.map(row => {
      const teacher = teacherMap.get(clean_(row.teacher_id));
      const shift = getShiftById_(row.shift_id) || {};
      return {
        selection_id: row.selection_id,
        teacher_id: row.teacher_id,
        display_name: teacher ? teacher.display_name : '',
        shift_id: row.shift_id,
        date: shift.date || '',
        duty: shift.duty || '',
        time: shift.time || '',
        place: shift.place || '',
        confirmed: isTruthy_(row.confirmed),
        selected_at: row.selected_at || '',
        confirmed_at: row.confirmed_at || ''
      };
    })
  };
}

function getSelectionsForTeacher_(teacherId) {
  const ss = openSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_SELECTIONS);
  return readObjects_(sheet)
    .filter(row => clean_(row.teacher_id) === clean_(teacherId))
    .map(row => {
      const shift = getShiftById_(row.shift_id) || {};
      return {
        selection_id: row.selection_id,
        shift_id: row.shift_id,
        date: shift.date || '',
        duty: shift.duty || '',
        time: shift.time || '',
        report_time: shift.report_time || '',
        place: shift.place || '',
        confirmed: isTruthy_(row.confirmed),
        selected_at: row.selected_at || '',
        confirmed_at: row.confirmed_at || ''
      };
    });
}

function getAvailableShifts_() {
  const ss = openSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_SHIFTS);
  return readObjects_(sheet)
    .filter(row => isTruthy_(row.visible))
    .map(row => {
      const selectedCount = getSelectedCount_(row.shift_id);
      const quota = Number(row.quota || 0);
      return {
        shift_id: row.shift_id,
        date: row.date,
        duty: row.duty,
        time: row.time,
        report_time: row.report_time,
        place: row.place,
        quota,
        selected_count: selectedCount,
        remaining: Math.max(quota - selectedCount, 0)
      };
    });
}

function getSelectedCount_(shiftId) {
  const ss = openSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_SELECTIONS);
  return readObjects_(sheet).filter(row => clean_(row.shift_id) === clean_(shiftId)).length;
}

function getTeacherById_(teacherId) {
  const ss = openSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_TEACHERS);
  return readObjects_(sheet).find(row => clean_(row.teacher_id) === clean_(teacherId));
}

function getShiftById_(shiftId) {
  const ss = openSpreadsheet_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_SHIFTS);
  return readObjects_(sheet).find(row => clean_(row.shift_id) === clean_(shiftId));
}

function scanRoster_(ss) {
  const result = [];
  ss.getSheets().forEach(sheet => {
    const values = sheet.getDataRange().getDisplayValues();
    for (let r = 0; r < values.length; r += 1) {
      const row = values[r].map(cell => clean_(cell));
      const idCol = row.findIndex(cell => cell === '學號' || cell === '代碼' || cell === '編號');
      const nameCol = row.findIndex(cell => cell === '姓名');
      if (idCol < 0 || nameCol < 0) continue;

      let blankCount = 0;
      for (let rr = r + 1; rr < values.length; rr += 1) {
        const id = clean_(values[rr][idCol]);
        const name = clean_(values[rr][nameCol]);

        if (!id && !name) {
          blankCount += 1;
          if (blankCount >= 3) break;
          continue;
        }
        blankCount = 0;

        if (!id || !name) continue;
        if (!/^\d+$/.test(id)) continue;
        if (['休園', '無名額', '無人認養'].includes(name)) continue;

        result.push({ teacher_id: id, display_name: name });
      }
    }
  });

  const seen = new Set();
  return result.filter(person => {
    if (seen.has(person.teacher_id)) return false;
    seen.add(person.teacher_id);
    return true;
  });
}

function ensureSheet_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const needHeader = headers.some((header, index) => currentHeaders[index] !== header);
  if (sheet.getLastRow() === 0 || needHeader) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function readObjects_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];

  const headers = values[0].map(cell => clean_(cell));
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  }).filter(row => Object.values(row).some(value => clean_(value)));
}

function openSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function publicTeacher_(teacher) {
  return {
    teacher_id: teacher.teacher_id,
    display_name: teacher.display_name
  };
}

function requireAdmin_(params) {
  const token = clean_((params && params.token) || '');
  if (!CONFIG.ADMIN_TOKEN || CONFIG.ADMIN_TOKEN === 'CHANGE_ME_ADMIN_TOKEN') {
    throw new Error('請先在 Apps Script 裡修改 ADMIN_TOKEN。');
  }
  if (token !== CONFIG.ADMIN_TOKEN) {
    throw new Error('管理員 token 錯誤。');
  }
}

function isTruthy_(value) {
  const text = clean_(value).toLowerCase();
  return ['true', 'yes', 'y', '1', '是', '開放'].includes(text);
}

function clean_(value) {
  return String(value == null ? '' : value).trim();
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
