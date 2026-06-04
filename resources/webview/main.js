(function () {
  const vscode = acquireVsCodeApi();
  const statusEl = document.getElementById('status');
  const agentEl = document.getElementById('agent');
  const messagesEl = document.getElementById('messages');
  const contextEl = document.getElementById('context');
  const promptEl = document.getElementById('prompt');
  const btnSend = document.getElementById('btnSend');
  const btnClear = document.getElementById('btnClear');
  const btnReconnect = document.getElementById('btnReconnect');
  const btnNewSession = document.getElementById('btnNewSession');
  const btnAbort = document.getElementById('btnAbort');

  let streamingNode = null;
  let selectedAgent = '';

  function setStatus(state, detail) {
    const labels = {
      connecting: 'Conectando…',
      connected: detail ? `Conectado (${detail})` : 'Conectado',
      disconnected: 'Desconectado',
      error: detail ? `Error: ${detail}` : 'Error',
      idle: 'Listo',
      busy: 'Pensando…',
    };
    statusEl.textContent = labels[state] || state;
    statusEl.className = state;
  }

  function appendMessage(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function updateStream(text) {
    if (!streamingNode) {
      streamingNode = appendMessage('assistant', text);
    } else {
      streamingNode.textContent = text;
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function finishStream(text) {
    if (streamingNode) {
      streamingNode.textContent = text;
    } else if (text) {
      appendMessage('assistant', text);
    }
    streamingNode = null;
  }

  function fillAgents(agents, current) {
    agentEl.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '(agente por defecto)';
    agentEl.appendChild(empty);
    for (const a of agents) {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.description ? `${a.name} — ${a.description}` : a.name;
      agentEl.appendChild(opt);
    }
    agentEl.value = current || '';
    selectedAgent = agentEl.value;
  }

  function send() {
    const text = promptEl.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'send', text, agent: agentEl.value || selectedAgent });
    promptEl.value = '';
  }

  btnSend.addEventListener('click', send);
  btnClear.addEventListener('click', () => {
    messagesEl.innerHTML = '';
    streamingNode = null;
  });
  btnReconnect.addEventListener('click', () => vscode.postMessage({ type: 'reconnect' }));
  btnNewSession.addEventListener('click', () => vscode.postMessage({ type: 'newSession' }));
  btnAbort.addEventListener('click', () => vscode.postMessage({ type: 'abort' }));
  agentEl.addEventListener('change', () => {
    selectedAgent = agentEl.value;
    vscode.postMessage({ type: 'setAgent', agent: selectedAgent });
  });

  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        fillAgents(msg.agents || [], msg.selectedAgent);
        contextEl.textContent = (msg.context || []).join(', ');
        if (msg.sessionId) {
          appendMessage('system', `Sesión: ${msg.sessionId.slice(0, 8)}…`);
        }
        break;
      case 'connection':
        setStatus(msg.state, msg.detail);
        break;
      case 'status':
        setStatus(msg.state === 'busy' ? 'busy' : 'idle');
        btnSend.disabled = msg.state === 'busy';
        break;
      case 'user':
        appendMessage('user', msg.text);
        break;
      case 'assistantStream':
        updateStream(msg.text);
        break;
      case 'assistantDone':
        finishStream(msg.text);
        break;
      case 'system':
        appendMessage('system', msg.text);
        break;
      case 'error':
        appendMessage('error', msg.message);
        streamingNode = null;
        break;
      case 'context':
        contextEl.textContent = (msg.items || []).join(', ');
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
