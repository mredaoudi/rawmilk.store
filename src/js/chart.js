// Cash-flow chart drawn as inline SVG, with no chart library.
// One line (expected scenario) over a light band (pessimistic to optimistic).

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 260;
const MARGIN = { top: 20, right: 18, bottom: 44 };
const TABLE_STEP = 12; // months between rows in the table view

function svg(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

function html(name, className, parent, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}

// Round axis values (…, −20 000, −10 000, 0, 10 000, …) covering min..max.
export function niceTicks(min, max, target = 4) {
  if (!(max > min)) return [min];
  const rough = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/**
 * @param {HTMLElement} root   Focusable container the chart is drawn into.
 * @param {HTMLTableElement} table  Table view of the same numbers.
 * @param {object} text  Translated strings and number formatters.
 */
export function createChart(root, table, text) {
  let data = null;
  let geometry = null;
  let activeMonth = null;

  const plot = svg('svg', { role: 'img', class: 'chart-svg' }, root);
  const tooltip = html('div', 'chart-tooltip', root);
  tooltip.hidden = true;

  function draw() {
    if (!data) return;
    const width = Math.max(root.clientWidth, 280);
    const months = data.expected.length - 1;

    const values = [...data.low, ...data.high, ...data.expected, 0];
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const tickLabels = ticks.map(text.compact);
    const left = Math.max(...tickLabels.map((label) => label.length)) * 7.5 + 14;

    const plotWidth = width - left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (month) => left + (month / months) * plotWidth;
    const y = (value) => MARGIN.top + ((yMax - value) / (yMax - yMin || 1)) * plotHeight;
    geometry = { left, plotWidth, months, x, y };

    plot.replaceChildren();
    plot.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    plot.setAttribute('aria-label', text.label(data.expected[0], data.expected[months]));

    // Grid and axes.
    ticks.forEach((tick, index) => {
      svg(
        'line',
        {
          x1: left,
          x2: left + plotWidth,
          y1: y(tick),
          y2: y(tick),
          class: tick === 0 ? 'chart-zero' : 'chart-grid',
        },
        plot,
      );
      svg(
        'text',
        { x: left - 8, y: y(tick), dy: '0.32em', 'text-anchor': 'end', class: 'chart-tick' },
        plot,
      ).textContent = tickLabels[index];
    });
    for (let month = 0; month <= months; month += 12) {
      svg(
        'text',
        { x: x(month), y: HEIGHT - MARGIN.bottom + 18, 'text-anchor': 'middle', class: 'chart-tick' },
        plot,
      ).textContent = String(month);
    }
    svg(
      'text',
      { x: left + plotWidth / 2, y: HEIGHT - 6, 'text-anchor': 'middle', class: 'chart-tick' },
      plot,
    ).textContent = text.xAxis;

    // Scenario band, then the expected line on top.
    const point = (value, month) => `${x(month).toFixed(1)},${y(value).toFixed(1)}`;
    const band = [...data.low.map(point), ...data.high.map(point).reverse()].join(' ');
    svg('polygon', { points: band, class: 'chart-band' }, plot);
    svg('polyline', { points: data.expected.map(point).join(' '), class: 'chart-line' }, plot);

    // Where the investment is paid back.
    const payback = data.paybackMonths;
    const showPayback = typeof payback === 'number' && payback > 0 && payback <= months;
    if (showPayback) {
      svg('circle', { cx: x(payback), cy: y(0), r: 5, class: 'chart-dot' }, plot);
      // Skipped near the right edge, where it would run into the end label.
      if (payback <= months - 10) {
        const nearEdge = payback > months * 0.7;
        svg(
          'text',
          {
            x: x(payback) + (nearEdge ? -8 : 8),
            y: y(0) + (nearEdge ? -10 : 18),
            'text-anchor': nearEdge ? 'end' : 'start',
            class: 'chart-label',
          },
          plot,
        ).textContent = text.paidBack;
      }
    }

    // End point with its value.
    const endValue = data.expected[months];
    const endY = y(endValue);
    svg('circle', { cx: x(months), cy: endY, r: 5, class: 'chart-dot' }, plot);
    svg(
      'text',
      {
        x: x(months),
        y: endY - 12 < MARGIN.top + 4 ? endY + 22 : endY - 12,
        'text-anchor': 'end',
        class: 'chart-label chart-label-strong',
      },
      plot,
    ).textContent = text.money(endValue);

    // Hover layer.
    svg('line', { class: 'chart-crosshair', y1: MARGIN.top, y2: MARGIN.top + plotHeight }, plot);
    svg('circle', { class: 'chart-dot chart-hover-dot', r: 5 }, plot);
    svg(
      'rect',
      { x: left, y: MARGIN.top, width: plotWidth, height: plotHeight, class: 'chart-hit' },
      plot,
    );

    drawTable(months);
    if (activeMonth !== null) show(activeMonth);
  }

  function drawTable(months) {
    const head = table.tHead.rows[0];
    while (head.cells.length > 1) head.deleteCell(-1);
    const body = table.tBodies[0];
    body.replaceChildren();

    const rows = [
      [text.pessimistic, data.low],
      [text.expected, data.expected],
      [text.optimistic, data.high],
    ];
    for (let month = 0; month <= months; month += TABLE_STEP) {
      const th = html('th', '', head, String(month));
      th.scope = 'col';
    }
    for (const [name, series] of rows) {
      const row = body.insertRow();
      const th = html('th', '', row, name);
      th.scope = 'row';
      for (let month = 0; month <= months; month += TABLE_STEP) {
        html('td', '', row, text.money(series[month]));
      }
    }
  }

  function show(month) {
    if (!geometry) return;
    const { x, y, left, plotWidth, months } = geometry;
    activeMonth = Math.min(Math.max(Math.round(month), 0), months);
    const cx = x(activeMonth);

    const crosshair = plot.querySelector('.chart-crosshair');
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    const dot = plot.querySelector('.chart-hover-dot');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', y(data.expected[activeMonth]));
    plot.classList.add('is-active');

    tooltip.replaceChildren();
    html('p', 'chart-tooltip-title', tooltip, text.month(activeMonth));
    const expected = html('p', 'chart-tooltip-row', tooltip);
    html('span', 'key key-line', expected);
    html('strong', '', expected, text.money(data.expected[activeMonth]));
    html('span', 'chart-tooltip-name', expected, text.expected);
    const range = html('p', 'chart-tooltip-row', tooltip);
    html('span', 'key key-band', range);
    html(
      'strong',
      '',
      range,
      `${text.money(data.low[activeMonth])} – ${text.money(data.high[activeMonth])}`,
    );
    html('span', 'chart-tooltip-name', range, text.range);

    tooltip.hidden = false;
    const scale = root.clientWidth / (left + plotWidth + MARGIN.right);
    const tipWidth = tooltip.offsetWidth;
    let tipLeft = cx * scale + 12;
    if (tipLeft + tipWidth > root.clientWidth) tipLeft = cx * scale - tipWidth - 12;
    tooltip.style.left = `${Math.max(tipLeft, 0)}px`;
  }

  function hide() {
    activeMonth = null;
    tooltip.hidden = true;
    plot.classList.remove('is-active');
  }

  function monthAt(event) {
    const box = plot.getBoundingClientRect();
    const scale = box.width / (geometry.left + geometry.plotWidth + MARGIN.right);
    const px = (event.clientX - box.left) / scale;
    return ((px - geometry.left) / geometry.plotWidth) * geometry.months;
  }

  plot.addEventListener('pointermove', (event) => geometry && show(monthAt(event)));
  plot.addEventListener('pointerdown', (event) => geometry && show(monthAt(event)));
  plot.addEventListener('pointerleave', () => {
    if (document.activeElement !== root) hide();
  });
  root.addEventListener('focus', () => geometry && show(activeMonth ?? 0));
  root.addEventListener('blur', hide);
  root.addEventListener('keydown', (event) => {
    if (!geometry) return;
    const current = activeMonth ?? 0;
    const moves = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: geometry.months,
    };
    if (event.key === 'Escape') hide();
    if (!(event.key in moves)) return;
    event.preventDefault();
    show(moves[event.key]);
  });

  new ResizeObserver(draw).observe(root);

  return {
    /** @param {{ expected: number[], low: number[], high: number[], paybackMonths: any }} next */
    update(next) {
      data = next;
      draw();
    },
  };
}
