// Detected Brands panel — upper-right, directly below the admin Debug toggle.
// Shows what the sponsor VLM saw on the visitor (brands, style, colors,
// accessories). Doubly gated: CSS hides it unless body.admin-debug is set,
// and the panel keeps the `hidden` class until a report arrives.

export function formatBrandEntries(report) {
  if (!report) return [];
  const groups = [
    { label: 'Brands', values: report.brands || [] },
    { label: 'Style', values: report.clothingStyle || [] },
    { label: 'Colors', values: report.colors || [] },
    { label: 'Accessories', values: report.accessories || [] },
    { label: 'Labels', values: report.labels || [] },
  ];
  // Brands is the headline act: always shown, even as an explicit "none".
  // The other groups only earn a line when the VLM saw something.
  return groups
    .filter((g, i) => i === 0 || g.values.length)
    .map((g) => ({
      label: g.label,
      text: g.values.length ? g.values.join(', ') : 'none detected',
    }));
}

export function createBrandPanel() {
  let report = null;
  return {
    get report() {
      return report;
    },
    get entries() {
      return formatBrandEntries(report);
    },
    setReport(next) {
      report = next || null;
    },
    clear() {
      report = null;
    },
  };
}

export function initBrandPanel(doc = document, panel = createBrandPanel()) {
  const root = doc.getElementById('brand-panel');
  const list = doc.getElementById('brand-list');

  // VLM output is untrusted — build nodes with textContent, never innerHTML.
  const sync = () => {
    if (!root || !list) return;
    const entries = panel.entries;
    root.classList.toggle('hidden', !entries.length);
    list.textContent = '';
    for (const entry of entries) {
      const li = doc.createElement('li');
      const label = doc.createElement('span');
      label.className = 'brand-label';
      label.textContent = entry.label;
      li.appendChild(label);
      li.appendChild(doc.createTextNode(' ' + entry.text));
      list.appendChild(li);
    }
  };

  sync();
  return {
    setReport(report) {
      panel.setReport(report);
      sync();
    },
    clear() {
      panel.clear();
      sync();
    },
  };
}
