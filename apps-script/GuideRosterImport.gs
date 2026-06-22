// 導覽人員班表匯入功能
// 使用方式：在 Apps Script 專案新增同名檔案，貼上本檔內容，並在 Code.gs 的 handleRequest_ 加入 importGuideRoster action。

function importGuideRoster(monthInput) {
  setupSystem();

  const ss = getSpreadsheet_();
  const rosterSheet = ss.getSheetByName('後慈湖導覽人員班表');
  if (!rosterSheet) throw new Error('找不到「後慈湖導覽人員班表」。');

  const roster = rosterSheet.getDataRange().getDisplayValues();
  const target = parseRosterTarget_(roster, monthInput);
  const targetMonth = target.month;
  if (!targetMonth || targetMonth < 1 || targetMonth > 12) throw new Error('請輸入要匯入的月份，例如 8。');

  const teachersSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  const shiftsSheet = ss.getSheetByName(CONFIG.SHEETS.SHIFTS);
  const selectionsSheet = ss.getSheetByName(CONFIG.SHEETS.SELECTIONS);
  const shifts = tableToObjects_(shiftsSheet);
  const targetYear = target.year || inferYearFromShifts_(shifts, targetMonth);
  if (!targetYear) throw new Error('找不到該月份 Shifts，請先建立該月份班別。');

  const nameMap = buildNameMap_(ss);
  const teachers = tableToObjects_(teachersSheet);
  const teacherById = keyBy_(teachers, 'teacherId');
  const teacherByName = {};
  teachers.forEach((t) => teacherByName[cleanName_(t.name)] = t);

  const headerRow = findRosterHeaderRow_(roster);
  if (headerRow < 0) throw new Error('找不到標題列：日期、第1梯、第3梯、第5梯、A點、第7梯。');
  const columns = getRosterColumns_(roster[headerRow]);

  const shiftsByKey = {};
  shifts.forEach((s) => shiftsByKey[normalizeText_(s.date) + '|' + normalizeText_(s.duty)] = s);

  const selections = tableToObjects_(selectionsSheet);
  const usedShift = {};
  const usedTeacherShift = {};
  selections.forEach((s) => {
    usedShift[String(s.shiftId)] = s;
    usedTeacherShift[String(s.teacherId) + '|' + String(s.shiftId)] = true;
  });

  const rows = [];
  const imported = [];
  const missingTeachers = [];
  const missingShifts = [];
  const conflicts = [];
  const addedTeachers = [];

  for (let r = headerRow + 1; r < roster.length; r++) {
    const day = extractRosterDay_(roster[r][1] || roster[r][0]);
    if (!day) continue;
    const dateKey = formatDateKey_(targetYear, targetMonth, day);

    columns.forEach((col) => {
      const names = splitNames_(roster[r][col.index]);
      if (names.length === 0) return;
      const shift = shiftsByKey[dateKey + '|' + col.duty];
      if (!shift) {
        missingShifts.push(dateKey + ' ' + col.duty);
        return;
      }

      names.forEach((name) => {
        const teacher = resolveTeacher_(name, nameMap, teacherById, teacherByName);
        if (!teacher) {
          missingTeachers.push(name + '（' + dateKey + ' ' + col.duty + '）');
          return;
        }
        if (!teacherById[String(teacher.teacherId)]) {
          teachersSheet.appendRow([teacher.teacherId, teacher.name, true, '', '', '由導覽人員班表匯入']);
          teacherById[String(teacher.teacherId)] = teacher;
          teacherByName[cleanName_(teacher.name)] = teacher;
          addedTeachers.push(teacher.teacherId + ' ' + teacher.name);
        }
        if (usedTeacherShift[String(teacher.teacherId) + '|' + String(shift.shiftId)]) return;
        if (usedShift[String(shift.shiftId)]) {
          conflicts.push(shift.shiftId + ' 已有 ' + usedShift[String(shift.shiftId)].teacherName + '，未覆蓋 ' + teacher.name);
          return;
        }

        rows.push(['IMP-' + Utilities.getUuid().slice(0, 8), String(teacher.teacherId), teacher.name, shift.shiftId, false, new Date(), '', '由後慈湖導覽人員班表匯入；請老師確認']);
        usedShift[String(shift.shiftId)] = { teacherId: teacher.teacherId, teacherName: teacher.name, shiftId: shift.shiftId };
        usedTeacherShift[String(teacher.teacherId) + '|' + String(shift.shiftId)] = true;
        imported.push(dateKey + ' ' + col.duty + '：' + teacher.name);
      });
    });
  }

  if (rows.length > 0) {
    selectionsSheet.getRange(selectionsSheet.getLastRow() + 1, 1, rows.length, HEADERS.Selections.length).setValues(rows);
  }

  return {
    message: '導覽人員班表匯入完成。',
    targetYear: targetYear,
    targetMonth: targetMonth,
    importedCount: imported.length,
    addedTeacherCount: addedTeachers.length,
    conflictCount: conflicts.length,
    missingTeacherCount: unique_(missingTeachers).length,
    missingShiftCount: unique_(missingShifts).length,
    imported: imported.slice(0, 50),
    addedTeachers: addedTeachers.slice(0, 50),
    conflicts: conflicts.slice(0, 50),
    missingTeachers: unique_(missingTeachers).slice(0, 50),
    missingShifts: unique_(missingShifts).slice(0, 50)
  };
}

function parseRosterTarget_(values, monthInput) {
  const direct = parseInt(String(monthInput || '').replace(/\D/g, ''), 10);
  if (direct) return { month: direct, year: null };
  for (let r = 0; r < Math.min(values.length, 8); r++) {
    for (let c = 0; c < values[r].length; c++) {
      const text = normalizeText_(values[r][c]);
      const m = text.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月/);
      if (m) {
        const y = Number(m[1]);
        return { year: y < 1911 ? y + 1911 : y, month: Number(m[2]) };
      }
    }
  }
  return { month: null, year: null };
}

function findRosterHeaderRow_(values) {
  for (let r = 0; r < values.length; r++) {
    const joined = values[r].map(normalizeText_).join('|');
    if (joined.includes('日期') && (joined.includes('第1梯') || joined.includes('第3梯') || joined.includes('A點'))) return r;
  }
  return -1;
}

function getRosterColumns_(headerRow) {
  const result = [];
  let aPoint = 0;
  headerRow.forEach((cell, index) => {
    const text = normalizeText_(cell);
    if (text.includes('第1梯')) result.push({ index, duty: '第1梯' });
    if (text.includes('第3梯')) result.push({ index, duty: '第3梯' });
    if (text.includes('第5梯')) result.push({ index, duty: '第5梯' });
    if (text.includes('第7梯')) result.push({ index, duty: '第7梯' });
    if (text.includes('A點')) {
      aPoint += 1;
      result.push({ index, duty: aPoint === 1 ? 'A點上午' : 'A點下午' });
    }
  });
  return result;
}

function extractRosterDay_(value) {
  const text = normalizeText_(value);
  if (!text || isSkipCell_(text)) return null;
  const m = text.match(/\d+/);
  return m ? Number(m[0]) : null;
}

function splitNames_(value) {
  const text = normalizeText_(value);
  if (!text || isSkipCell_(text)) return [];
  return text.replace(/[，、／/]/g, '\n').split(/\n+/).map(cleanName_).filter((x) => x && !isSkipCell_(x));
}

function isSkipCell_(value) {
  const text = cleanName_(value);
  return !text || ['休園', '無名額', '無人認養', 'NA', 'N/A', 'X', 'Ｘ', '-', '—', '－', '空班'].includes(text);
}

function buildNameMap_(ss) {
  const result = { byId: {}, byName: {} };
  const sheet = ss.getSheetByName('name');
  if (!sheet) return result;
  const values = sheet.getDataRange().getDisplayValues();
  for (let r = 1; r < values.length; r++) {
    const id = normalizeText_(values[r][0]);
    const name = cleanName_(values[r][1]);
    if (!id || !name) continue;
    result.byId[id] = { teacherId: id, name: name };
    result.byName[name] = { teacherId: id, name: name };
  }
  return result;
}

function resolveTeacher_(text, nameMap, teacherById, teacherByName) {
  const key = cleanName_(text);
  if (nameMap.byId[key]) return nameMap.byId[key];
  if (nameMap.byName[key]) return nameMap.byName[key];
  if (teacherById[key]) return { teacherId: String(teacherById[key].teacherId), name: cleanName_(teacherById[key].name) };
  if (teacherByName[key]) return { teacherId: String(teacherByName[key].teacherId), name: cleanName_(teacherByName[key].name) };
  return null;
}

function inferYearFromShifts_(shifts, month) {
  for (let i = 0; i < shifts.length; i++) {
    const m = normalizeText_(shifts[i].date).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m && Number(m[2]) === Number(month)) return Number(m[1]);
  }
  return null;
}

function formatDateKey_(year, month, day) {
  return String(year) + '/' + String(month).padStart(2, '0') + '/' + String(day).padStart(2, '0');
}

function cleanName_(value) {
  return String(value == null ? '' : value).replace(/[\s　]/g, '').replace(/（.*?）|\(.*?\)/g, '').trim();
}

function unique_(values) {
  return Array.from(new Set(values));
}
