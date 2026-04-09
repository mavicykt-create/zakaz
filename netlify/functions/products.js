export async function handler() {
  try {
    const feedUrl = 'https://milku.ru/site1/export-google-whatsp/';
    const res = await fetch(feedUrl);

    if (!res.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'feed fetch failed' })
      };
    }

    const xml = await res.text();
    const itemMatches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const products = {};

    for (const item of itemMatches) {
      const idMatch = item.match(/<g:id>([\s\S]*?)<\/g:id>/i);
      const priceMatch = item.match(/<g:price>([\s\S]*?)<\/g:price>/i);

      if (!idMatch || !priceMatch) continue;

      const article = String(idMatch[1]).trim();
      const rawPrice = String(priceMatch[1]).trim();
      const price = parseFloat(rawPrice.replace(',', '.').replace(/[^\d.]/g, ''));

      if (!article || Number.isNaN(price)) continue;
     products[article] = { price };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(products)
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || 'parse error' })
    };
  }
}
