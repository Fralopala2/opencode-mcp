async function test() {
  const baseUrl = 'http://127.0.0.1:4096';
  
  // 1. Crear sesión
  const sessionRes = await fetch(`${baseUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test Session' })
  });
  const session = await sessionRes.json();
  const sessionId = session.id;
  console.log('Sesión creada:', sessionId);

  // 2. Escuchar eventos (SSE)
  const controller = new AbortController();
  const eventPromise = (async () => {
    const response = await fetch(`${baseUrl}/event`, {
      headers: { 'Accept': 'text/event-stream' },
      signal: controller.signal
    });

    if (!response.ok || !response.body) {
      throw new Error(`SSE error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!controller.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;

        const json = dataLine.replace(/^data:\s*/, '');
        if (!json || json === '[DONE]') continue;

        try {
          const event = JSON.parse(json);
          console.log('EVENTO RECIBIDO:', event.type, JSON.stringify(event.properties));
          if (event.type === 'session.idle' && event.properties?.sessionID === sessionId) {
            console.log('\nSesión terminada (idle).');
            controller.abort();
            return;
          }
        } catch (e) {
          // ignore
        }
      }
    }
  })();

  // 3. Enviar prompt
  await fetch(`${baseUrl}/session/${sessionId}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parts: [{ type: 'text', text: 'responde con la palabra "OK" únicamente' }]
    })
  });

  await eventPromise.catch(err => {
    if (err.name !== 'AbortError') {
      console.error('Error en eventos:', err);
    }
  });
}

test().catch(console.error);
