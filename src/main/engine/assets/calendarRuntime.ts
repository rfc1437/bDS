export const CALENDAR_RUNTIME_JS = String.raw`(() => {
  const button = document.querySelector('[data-blog-calendar-toggle]');
  const panel = document.querySelector('[data-blog-calendar-panel]');
  const closeButton = document.querySelector('[data-blog-calendar-close]');
  const calendarRoot = document.querySelector('[data-blog-calendar-root]');
  const status = document.querySelector('[data-blog-calendar-status]');

  if (!button || !panel || !calendarRoot || !status) {
    return;
  }

  const labels = {
    loading: panel.getAttribute('data-i18n-loading') || 'Loading calendar…',
    error: panel.getAttribute('data-i18n-error') || 'Calendar data could not be loaded.',
  };

  let isInitialized = false;
  let years = {};
  let months = {};
  let days = {};
  let maxYearCount = 0;
  let maxMonthCount = 0;
  let maxDayCount = 0;

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function normalizeCountMap(value) {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const map = {};
    for (const [key, rawCount] of Object.entries(value)) {
      const count = Number(rawCount);
      if (!Number.isFinite(count) || count <= 0) {
        continue;
      }
      map[key] = Math.floor(count);
    }

    return map;
  }

  function computeMaxCount(value) {
    const counts = Object.values(value || {});
    if (counts.length === 0) {
      return 0;
    }
    return Math.max(...counts.map((count) => Number(count) || 0));
  }

  function applyHeatStyle(target, count, maxCount) {
    if (!(target instanceof HTMLElement) || !Number.isFinite(count) || count <= 0 || !Number.isFinite(maxCount) || maxCount <= 0) {
      target?.style?.setProperty('--blog-calendar-heat-alpha', '0');
      target?.style?.setProperty('--blog-calendar-heat-hue', '210');
      return;
    }

    const normalized = Math.min(1, count / maxCount);
    const hue = Math.round(210 - (210 * normalized));
    const alpha = (0.30 + normalized * 0.65).toFixed(3);

    target.style.setProperty('--blog-calendar-heat-hue', String(hue));
    target.style.setProperty('--blog-calendar-heat-alpha', alpha);
  }

  function navigateTo(pathname) {
    if (!pathname) {
      return;
    }
    window.location.assign(pathname);
  }

  function parseInitialYearMonth() {
    const initialYearRaw = button.getAttribute('data-blog-calendar-year');
    const initialMonthRaw = button.getAttribute('data-blog-calendar-month');

    const initialYear = Number(initialYearRaw);
    const initialMonth = Number(initialMonthRaw);

    let selectedYear = Number.isInteger(initialYear) && initialYear > 0 ? initialYear : null;
    let selectedMonth = Number.isInteger(initialMonth) && initialMonth >= 1 && initialMonth <= 12
      ? (initialMonth - 1)
      : null;

    if (!Number.isInteger(selectedYear) || !Number.isInteger(selectedMonth)) {
      const pathname = window.location.pathname || '';
      const parts = pathname.split('/').filter(Boolean);
      const pathYear = Number(parts[0]);
      const pathMonth = Number(parts[1]);

      if (!Number.isInteger(selectedYear) && Number.isInteger(pathYear) && pathYear > 0 && String(parts[0]).length === 4) {
        selectedYear = pathYear;
      }

      if (!Number.isInteger(selectedMonth) && Number.isInteger(pathMonth) && pathMonth >= 1 && pathMonth <= 12) {
        selectedMonth = pathMonth - 1;
      }
    }

    return { selectedYear, selectedMonth };
  }

  async function loadCalendarData() {
    const response = await fetch('/calendar.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('calendar.json request failed');
    }

    const parsed = await response.json();
    years = normalizeCountMap(parsed?.years);
    months = normalizeCountMap(parsed?.months);
    days = normalizeCountMap(parsed?.days);
    maxYearCount = computeMaxCount(years);
    maxMonthCount = computeMaxCount(months);
    maxDayCount = computeMaxCount(days);
  }

  function getDateFromClickEvent(event) {
    if (!(event?.target instanceof Element)) {
      return '';
    }

    const dateEl = event.target.closest('[data-vc-date]');
    if (!(dateEl instanceof HTMLElement)) {
      return '';
    }

    return dateEl.dataset.vcDate || '';
  }

  async function initializeCalendar() {
    if (isInitialized) {
      return;
    }

    status.textContent = labels.loading;

    try {
      await loadCalendarData();

      const Calendar = window.VanillaCalendarPro?.Calendar;
      if (typeof Calendar !== 'function') {
        throw new Error('Vanilla Calendar Pro is unavailable');
      }

      const initialYearMonth = parseInitialYearMonth();
      const calendarOptions = {
        ...(Number.isInteger(initialYearMonth.selectedYear) ? { selectedYear: initialYearMonth.selectedYear } : {}),
        ...(Number.isInteger(initialYearMonth.selectedMonth) ? { selectedMonth: initialYearMonth.selectedMonth } : {}),
        onCreateDateEls(_self, dateEl) {
          const dateKey = dateEl.dataset.vcDate || '';
          const count = Number(days[dateKey] || 0);
          const buttonEl = dateEl.querySelector('[data-vc-date-btn]');

          if (!(buttonEl instanceof HTMLElement)) {
            return;
          }

          if (count <= 0) {
            dateEl.removeAttribute('data-blog-calendar-has-posts');
            applyHeatStyle(buttonEl, 0, maxDayCount);
            return;
          }

          dateEl.setAttribute('data-blog-calendar-has-posts', 'true');
          applyHeatStyle(buttonEl, count, maxDayCount);
        },
        onCreateMonthEls(self, monthEl) {
          if (!(monthEl instanceof HTMLElement)) {
            return;
          }

          const monthIndex = Number(monthEl.dataset.vcMonthsMonth);
          const selectedYear = Number(self?.context?.selectedYear);
          if (!Number.isInteger(monthIndex) || !Number.isInteger(selectedYear)) {
            monthEl.removeAttribute('data-blog-calendar-has-posts');
            applyHeatStyle(monthEl, 0, maxMonthCount);
            return;
          }

          const monthKey = String(selectedYear) + '-' + pad2(monthIndex + 1);
          const count = Number(months[monthKey] || 0);
          if (count <= 0) {
            monthEl.removeAttribute('data-blog-calendar-has-posts');
            applyHeatStyle(monthEl, 0, maxMonthCount);
            return;
          }

          monthEl.setAttribute('data-blog-calendar-has-posts', 'true');
          applyHeatStyle(monthEl, count, maxMonthCount);
        },
        onCreateYearEls(_self, yearEl) {
          if (!(yearEl instanceof HTMLElement)) {
            return;
          }

          const yearValue = Number(yearEl.dataset.vcYearsYear);
          if (!Number.isInteger(yearValue)) {
            yearEl.removeAttribute('data-blog-calendar-has-posts');
            applyHeatStyle(yearEl, 0, maxYearCount);
            return;
          }

          const yearKey = String(yearValue);
          const count = Number(years[yearKey] || 0);
          if (count <= 0) {
            yearEl.removeAttribute('data-blog-calendar-has-posts');
            applyHeatStyle(yearEl, 0, maxYearCount);
            return;
          }

          yearEl.setAttribute('data-blog-calendar-has-posts', 'true');
          applyHeatStyle(yearEl, count, maxYearCount);
        },
        onClickDate(_self, event) {
          const dateKey = getDateFromClickEvent(event);
          if (!dateKey || !days[dateKey]) {
            return;
          }

          const [year, month, day] = dateKey.split('-');
          if (!year || !month || !day) {
            return;
          }

          navigateTo('/' + year + '/' + month + '/' + day + '/');
        },
        onClickMonth(self) {
          const selectedYear = Number(self?.context?.selectedYear);
          const selectedMonth = Number(self?.context?.selectedMonth);

          if (!Number.isInteger(selectedYear) || !Number.isInteger(selectedMonth)) {
            return;
          }

          const monthKey = String(selectedYear) + '-' + pad2(selectedMonth + 1);
          if (!months[monthKey]) {
            return;
          }

          navigateTo('/' + String(selectedYear) + '/' + pad2(selectedMonth + 1) + '/');
        },
        onClickYear(self) {
          const selectedYear = Number(self?.context?.selectedYear);

          if (!Number.isInteger(selectedYear)) {
            return;
          }

          const yearKey = String(selectedYear);
          if (!years[yearKey]) {
            return;
          }

          navigateTo('/' + String(selectedYear) + '/');
        },
      };

      const calendar = new Calendar('[data-blog-calendar-root]', calendarOptions);

      calendar.init();
      status.textContent = '';
      status.setAttribute('hidden', 'hidden');
      isInitialized = true;
    } catch {
      status.textContent = labels.error;
      status.removeAttribute('hidden');
    }
  }

  function setPanelOpen(isOpen) {
    if (isOpen) {
      panel.removeAttribute('hidden');
      void initializeCalendar();
      return;
    }

    panel.setAttribute('hidden', 'hidden');
  }

  button.addEventListener('click', () => {
    const isHidden = panel.hasAttribute('hidden');
    setPanelOpen(isHidden);
  });

  if (closeButton) {
    closeButton.addEventListener('click', () => {
      setPanelOpen(false);
    });
  }
})();`;
