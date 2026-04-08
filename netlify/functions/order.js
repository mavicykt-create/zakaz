exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { rows, comment } = JSON.parse(event.body || '{}');

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: 'No rows' })
      };
    }

    const lines = rows.map(r => `${r.article} - ${r.quantity}`);
    const text = [
      'Новая заявка',
      '',
      ...lines,
      comment ? '' : null,
      comment ? `Комментарий: ${comment}` : null
    ].filter(Boolean).join('\n');

    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text
        })
      }
    );

    const resultText = await response.text();

    if (!response.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          telegram_error: resultText
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, telegram_result: resultText })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: e.message || 'Server error'
      })
    };
  }
};
