export function normalizeArticle(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(4, '0').slice(-4);
}

export function parseOrderText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const map = new Map();

  for (const line of lines) {
    const cleaned = line
      .replace(/[–—−]/g, '-')
      .replace(/[,;]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const articleMatch = cleaned.match(/\d{1,}/);
    if (!articleMatch) continue;

    const article = normalizeArticle(articleMatch[0]);
    if (!article) continue;

    const numberMatches = cleaned.match(/\d+/g) || [];
    let quantity = 1;

    if (numberMatches.length >= 2) {
      quantity = Number(numberMatches[numberMatches.length - 1]);
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      quantity = 1;
    }

    map.set(article, (map.get(article) || 0) + quantity);
  }

  const items = [...map.entries()]
    .map(([article, quantity]) => ({ article, quantity }))
    .sort((a, b) => a.article.localeCompare(b.article));

  return {
    items,
    totalItems: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0)
  };
}
