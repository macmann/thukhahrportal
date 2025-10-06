async function requestPairing(clientId, tabId) {
  const response = await fetch('/pair/init', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ client_id: clientId, tab_id: tabId })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Failed to start pairing');
  }

  return response.json();
}

window.requestPairing = requestPairing;
