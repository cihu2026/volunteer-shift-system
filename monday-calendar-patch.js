// 將月曆改成星期一開始，不動原本選班功能
(function () {
  function renderMondayShiftCalendar() {
    const target = document.querySelector('#shiftList');
    if (!target) return;
    const data = window.state || state;
    if (!data.publicData) {
      renderMessage('#shiftList', '尚未載入月曆。');
      return;
    }

    const shifts = (data.publicData.shifts || []).slice().sort(compareShift);
    if (shifts.length === 0) {
      renderMessage('#shiftList', '目前沒有可顯示的班別。');
      return;
    }

    const monthInfo = getCalendarMonth(shifts);
    const grouped = groupBy(shifts, (shift) => shift.date);
    const firstDay = new Date(monthInfo.year, monthInfo.month - 1, 1);
    const daysInMonth = new Date(monthInfo.year, monthInfo.month, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7; // 週一=0，週日=6
    const headerNames = ['一', '二', '三', '四', '五', '六', '日'];
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const cells = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push('<div class="calendar-day empty-day"></div>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${monthInfo.year}/${String(monthInfo.month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
      const date = new Date(monthInfo.year, monthInfo.month - 1, day);
      const weekday = date.getDay();
      const dayShifts = grouped[dateKey] || [];
      const missingCount = dayShifts.reduce((sum, shift) => sum + Number(shift.remaining || 0), 0);
      const restDay = weekday === 2 && dayShifts.length === 0;
      const hasShifts = dayShifts.length > 0;
      const expanded = hasShifts && data.expandedDates.has(dateKey);
      const dayClass = hasShifts ? (expanded ? 'expanded-day' : 'collapsed-day') : '';
      const hintText = hasShifts ? (expanded ? '｜收合' : '｜點開') : '';
      const dateHeader = hasShifts
        ? `<button type="button" class="day-number day-toggle" onclick="toggleDate('${escapeAttr(dateKey)}')" aria-expanded="${expanded ? 'true' : 'false'}">
            <strong>${day}</strong>
            <span>週${weekdayNames[weekday]}${missingCount ? `｜缺 ${missingCount}` : ''}${hintText}</span>
          </button>`
        : `<div class="day-number"><strong>${day}</strong><span>週${weekdayNames[weekday]}</span></div>`;

      cells.push(`
        <div class="calendar-day ${restDay ? 'rest-day' : ''} ${dayClass}">
          ${dateHeader}
          ${restDay ? '<div class="rest-note">週二休園</div>' : hasShifts ? (expanded ? renderDayShifts(dayShifts) : renderDaySummary(dayShifts, dateKey)) : '<div class="empty">尚無開放班別</div>'}
        </div>
      `);
    }

    target.innerHTML = `
      <div class="month-toolbar">
        <div>
          <h3>${monthInfo.year} 年 ${monthInfo.month} 月</h3>
          <p class="hint">預設先折疊成日期摘要；點日期展開當天班別。黃色是釋出待認領，綠色是你已選。</p>
        </div>
        <div class="month-actions">
          <span class="badge">共 ${shifts.length} 個班別</span>
          <button type="button" class="mini-button" onclick="expandAllDates()">全部展開</button>
          <button type="button" class="mini-button" onclick="collapseAllDates()">全部收合</button>
        </div>
      </div>
      <div class="calendar-wrap">
        <div class="calendar-grid calendar-head">${headerNames.map((day) => `<div>${day}</div>`).join('')}</div>
        <div class="calendar-grid">${cells.join('')}</div>
      </div>
    `;
  }

  window.renderShiftCalendar = renderMondayShiftCalendar;
})();
