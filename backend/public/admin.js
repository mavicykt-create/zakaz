const tbody = document.getElementById('ordersTableBody');
const ordersInfo = document.getElementById('ordersInfo');
const reloadButton = document.getElementById('reloadButton');
const statusFilter = document.getElementById('statusFilter');

function formatDate(value) {
  return new Date(value).toLocaleString('ru-RU');
}

function statusLabel(status) {
  switch (status) {
    case 'new': return 'Новый';
    case 'processing': return 'В работе';
    case 'done': return 'Выполнен';
    case 'cancelled': return 'Отменён';
    default: return status;
  }
}

async function updateStatus(orderId, nextStatus) {
  const response = await fetch(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: nextStatus })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Не удалось поменять статус');
  }
}

function renderRows(orders) {
  tbody.innerHTML = '';

  for (const order of orders) {
    const tr = document.createElement('tr');

    const itemsHtml = order.items
      .map((item) => `<div><strong>${item.article}</strong> — ${item.quantity}</div>`)
      .join('');

    tr.innerHTML = `
      <td>#${order.id}</td>
      <td>${formatDate(order.createdAt)}</td>
      <td>
        <select data-order-id="${order.id}" class="statusSelect">
          <option value="new" ${order.status === 'new' ? 'selected' : ''}>Новый</option>
          <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>В работе</option>
          <option value="done" ${order.status === 'done' ? 'selected' : ''}>Выполнен</option>
          <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Отменён</option>
        </select>
      </td>
      <td>${order.totalItems}</td>
      <td>${order.totalQuantity}</td>
      <td>${order.comment || '—'}</td>
      <td>${itemsHtml}</td>
    `;

    tbody.appendChild(tr);
  }

  document.querySelectorAll('.statusSelect').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const element = event.currentTarget;
      const orderId = element.dataset.orderId;
      const nextStatus = element.value;
      try {
        element.disabled = true;
        await updateStatus(orderId, nextStatus);
        await loadOrders();
      } catch (error) {
        alert(error.message);
      } finally {
        element.disabled = false;
      }
    });
  });
}

async function loadOrders() {
  ordersInfo.textContent = 'Загрузка…';
  tbody.innerHTML = '';

  const status = statusFilter.value;
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`/api/orders${query}`);

  if (!response.ok) {
    ordersInfo.textContent = 'Ошибка загрузки заказов.';
    return;
  }

  const data = await response.json();
  const orders = data.orders || [];
  ordersInfo.textContent = `Всего заказов: ${orders.length}`;
  renderRows(orders);
}

reloadButton.addEventListener('click', () => {
  loadOrders().catch((error) => {
    ordersInfo.textContent = error.message;
  });
});

statusFilter.addEventListener('change', () => {
  loadOrders().catch((error) => {
    ordersInfo.textContent = error.message;
  });
});

loadOrders().catch((error) => {
  ordersInfo.textContent = error.message;
});
