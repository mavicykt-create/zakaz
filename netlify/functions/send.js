export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const text = body.text || "";

    if (!text.trim()) {
      return { statusCode: 400, body: "empty text" };
    }

    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      return { statusCode: 500, body: errorText };
    }

    return {
      statusCode: 200,
      body: "ok"
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: e.message || "error"
    };
  }
}