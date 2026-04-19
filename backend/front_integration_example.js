// Пример кода для текущего фронта.
// Вставь это в место, где сейчас отправляется заявка.

async function submitOrderToBackend(orderText, comment = '') {
  const response = await fetch('https://YOUR_BACKEND_DOMAIN/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: orderText,
      comment
    })
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Не удалось отправить заказ');
  }

  return data;
}
