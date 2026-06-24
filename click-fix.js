// v53 點擊修正：讓整個日期格都能點，並補強手機 Safari / 快取後的全域函式綁定
(function () {
  function exposeGlobals() {
    const names = [
      'loadPublicData',
      'queryMySchedule',
      'selectShift',
      'confirmSelection',
      'releaseMyShift',
      'cancelRelease',
      'claimReleasedShift',
      'toggleDate',
      'expandAllDates',
      'collapseAllDates'
    ];

    names.forEach((name) => {
      try {
        if (typeof window[name] !== 'function' && typeof eval(name) === 'function') {
          window[name] = eval(name);
        }
      } catch (error) {
        // 不阻斷頁面，只做相容補強
      }
    });
  }

  function getDateKeyFromCell(cell) {
    if (!cell) return '';
    if (cell.dataset.dateKey) return cell.dataset.dateKey;

    const button = cell.querySelector('.day-toggle[onclick*="toggleDate"]');
    if (!button) return '';

    const onclickText = button.getAttribute('onclick') || '';
    const matched = onclickText.match(/toggleDate\(['"]([^'"]+)['"]\)/);
    return matched ? matched[1] : '';
  }

  function enhanceCalendarCells() {
    document.querySelectorAll('.calendar-day.collapsed-day, .calendar-day.expanded-day').forEach((cell) => {
      const key = getDateKeyFromCell(cell);
      if (!key) return;
      cell.dataset.dateKey = key;
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.style.cursor = 'pointer';
    });
  }

  function toggleCell(cell) {
    const key = getDateKeyFromCell(cell);
    if (!key) return;
    exposeGlobals();
    if (typeof window.toggleDate === 'function') {
      window.toggleDate(key);
    } else if (typeof toggleDate === 'function') {
      toggleDate(key);
    }
  }

  function isInteractiveTarget(target) {
    return Boolean(target && target.closest('button, input, select, textarea, a, [data-no-cell-toggle]'));
  }

  function installDelegatedClick() {
    const root = document.querySelector('#shiftList') || document;

    root.addEventListener('click', (event) => {
      if (isInteractiveTarget(event.target)) return;
      const cell = event.target.closest('.calendar-day.collapsed-day, .calendar-day.expanded-day');
      if (!cell || !root.contains(cell)) return;
      event.preventDefault();
      toggleCell(cell);
    });

    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (isInteractiveTarget(event.target)) return;
      const cell = event.target.closest('.calendar-day.collapsed-day, .calendar-day.expanded-day');
      if (!cell || !root.contains(cell)) return;
      event.preventDefault();
      toggleCell(cell);
    });
  }

  function injectClickStyle() {
    if (document.querySelector('#calendarClickFixStyle')) return;
    const style = document.createElement('style');
    style.id = 'calendarClickFixStyle';
    style.textContent = `
      .calendar-day.collapsed-day,
      .calendar-day.expanded-day {
        cursor: pointer !important;
        touch-action: manipulation !important;
      }
      .calendar-day button,
      .calendar-day input,
      .calendar-day select,
      .calendar-day textarea,
      .calendar-day a {
        pointer-events: auto !important;
      }
      button.day-number.day-toggle {
        position: relative !important;
        z-index: 2 !important;
        -webkit-tap-highlight-color: rgba(15, 23, 42, 0.12);
      }
      @media (max-width: 720px) {
        .calendar-day.collapsed-day,
        .calendar-day.expanded-day {
          min-height: 48px !important;
        }
        button.day-number.day-toggle {
          min-height: 44px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function boot() {
    exposeGlobals();
    injectClickStyle();
    installDelegatedClick();
    enhanceCalendarCells();

    const observer = new MutationObserver(() => {
      exposeGlobals();
      enhanceCalendarCells();
    });
    observer.observe(document.querySelector('#shiftList') || document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
