(function () {
  const vscode = acquireVsCodeApi();
  
  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('chatInput');
  const sendBtn    = document.getElementById('sendBtn');
  const typingEl   = document.getElementById('typing');
  const welcomeEl  = document.getElementById('opencode-welcome');
  const modelBtn   = document.getElementById('modelBtn');
  const modelNameEl = document.getElementById('modelName');
  const dropdown   = document.getElementById('modelDropdown');
  const dropOverlay = document.getElementById('dropOverlay');
  const modePill = document.getElementById('modePill');
  const contextBar = document.getElementById('contextBar');

  // Seleccionamos los botones de las herramientas (usaremos sus titles o indices, mejor añadimos un event listener al botón de adjuntar por su tooltip)
  const attachBtn = Array.from(document.querySelectorAll('.tool-btn')).find(b => b.title.includes('Adjuntar'));

  let streamingNode = null;
  let streamingBodyNode = null;
  let streamingMetaNode = null;
  let selectedModel = '';
  let selectedMode = 'auto'; // agent / auto
  let attachments = [];



  function setStatus(state, detail) {
    if (state === 'busy') {
      showTyping();
      sendBtn.disabled = true;
      inputEl.disabled = true;
      // Switch send button to abort mode
      sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
      sendBtn.title = "Cancelar (Esc)";
      sendBtn.onclick = () => { vscode.postMessage({ type: 'abort' }); };
      sendBtn.disabled = false;

    } else {
      hideTyping();
      sendBtn.disabled = false;
      inputEl.disabled = false;
      // Restore send button to send mode
      sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
      sendBtn.title = "Enviar (Enter)";
      sendBtn.onclick = sendMessage;
      sendBtn.disabled = false;

      if (state === 'idle') inputEl.focus();
    }
  }
  
  

  function appendMeta(node, metrics) {
    if (!metrics) return;
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.style.fontSize = '10px';
    meta.style.color = 'var(--text-muted)';
    meta.style.marginTop = '6px';
    meta.style.textAlign = 'right';
    meta.textContent = `Tokens - In: ${metrics.input || 0} | Out: ${metrics.output || 0}`;
    node.appendChild(meta);
  }

  function showTyping() {
    typingEl.classList.add('visible');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    typingEl.classList.remove('visible');
  }

  function renderBody(text) {
    return text
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code>${escHtml(code.trim())}</code></pre>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function createMsgElement(role, text) {
    if (welcomeEl && (role === 'user' || role === 'ai')) {
      welcomeEl.style.display = 'none';
    }

    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');

    const msgEl = document.createElement('div');
    msgEl.className = 'msg ' + role;

    const isSystem = role === 'system' || role === 'error';
    const displayRole = isSystem ? role : (role === 'ai' ? 'opencode' : 'tú');
    const avatarTxt = isSystem ? '!' : (role === 'ai' ? 'OC' : 'Tú');
    
    let bodyHtml = renderBody(text);
    if (role === 'error') {
      bodyHtml = `<span style="color: #ff6b6b">${escHtml(text)}</span>`;
      msgEl.style.backgroundColor = 'rgba(255, 0, 0, 0.05)';
      msgEl.style.border = '1px solid rgba(255, 0, 0, 0.2)';
    } else if (role === 'system') {
      bodyHtml = `<span style="color: var(--text-muted); font-style: italic">${escHtml(text)}</span>`;
      msgEl.style.backgroundColor = 'transparent';
      msgEl.style.border = 'none';
    }

    msgEl.innerHTML = `
      <div class="msg-header">
        <div class="msg-avatar ${role}">${avatarTxt}</div>
        <span class="msg-role">${displayRole}</span>
        <span class="msg-time">${time}</span>
      </div>
      <div class="msg-body">${bodyHtml}</div>
      <div class="msg-actions">
        <button class="msg-act-btn" onclick="copyMsg(this)">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          copiar
        </button>
        ${role === 'ai' ? `<button class="msg-act-btn"><svg viewBox="0 0 24 24"><path d="M23 7L16 12L23 17V7zM1 5h12a2 2 0 012 2v10a2 2 0 01-2 2H1a2 2 0 01-2-2V7a2 2 0 012-2z"/></svg>insertar</button>` : ''}
      </div>
    `;

    return msgEl;
  }

  function appendMessage(role, text) {
    const msgEl = createMsgElement(role, text);
    typingEl.before(msgEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return msgEl;
  }

  function updateStream(text) {
    if (!streamingNode) {
      streamingNode = appendMessage('ai', text);
      streamingBodyNode = streamingNode.querySelector('.msg-body');
    } else {
      if (streamingBodyNode) {
        streamingBodyNode.innerHTML = renderBody(text);
      }
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function finishStream(text, metrics) {
    if (streamingNode) {
      if (streamingBodyNode && text) {
         streamingBodyNode.innerHTML = renderBody(text);
      }
    } else if (text) {
      streamingNode = appendMessage('ai', text);
      streamingBodyNode = streamingNode.querySelector('.msg-body');
    }
    
    if (streamingNode && metrics) {
      appendMeta(streamingNode.querySelector('.msg-body'), metrics);
    }
    
    streamingNode = null;
    streamingBodyNode = null;
    streamingMetaNode = null;
  }

  window.copyMsg = function(btn) {
    const body = btn.closest('.msg').querySelector('.msg-body');
    navigator.clipboard.writeText(body.innerText);
    btn.textContent = 'copiado ✓';
    setTimeout(() => {
      btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> copiar`;
    }, 1500);
  };

  /* auto-resize textarea */
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  /* envio con Enter (Shift+Enter = salto) */
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Initial mode set; actual handler updated via setStatus

  function renderAttachments() {
    // Buscar tags de adjuntos en la barra superior o en un div nuevo
    // Reutilizaremos el contextBar
    const existingAtts = contextBar.querySelectorAll('.ctx-att');
    existingAtts.forEach(el => el.remove());
    
    attachments.forEach((att, index) => {
      const tag = document.createElement('div');
      tag.className = 'ctx-tag ctx-att';
      tag.style.backgroundColor = '#1a334d';
      tag.style.borderColor = '#29527a';
      tag.style.color = '#7ab8ff';
      tag.innerHTML = `
        <svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:2;"><path d="M21.44 11.05L12.25 20.24a6 6 0 01-8.49-8.49l9.2-9.19a4 4 0 015.66 5.65L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        ${att.filename || 'Adjunto'}
        <span class="ctx-tag-close">
          <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>
        </span>
      `;
      tag.querySelector('.ctx-tag-close').onclick = () => {
        attachments.splice(index, 1);
        renderAttachments();
      };
      
      const addBtn = contextBar.querySelector('.ctx-add');
      if (addBtn) {
          contextBar.insertBefore(tag, addBtn);
      } else {
          contextBar.appendChild(tag);
      }
    });
  }

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text && attachments.length === 0) return;
    
    inputEl.value = '';
    inputEl.style.height = 'auto';
    
    vscode.postMessage({ 
      type: 'send', 
      text, 
      agent: selectedMode === 'agent' ? 'agents' : '', // simplified map
      model: selectedModel,
      attachments: [...attachments]
    });
    
    attachments = [];
    renderAttachments();
  }

  window.sendQuick = function(text) {
    vscode.postMessage({
      type: 'quickAction',
      text: text,
      model: selectedModel
    });
  };

  window.addCtxTag = function() {
    vscode.postMessage({ type: 'addContextFile' });
  };

  // Header buttons
  document.querySelector('[title="Nueva sesión"]').addEventListener('click', () => vscode.postMessage({ type: 'newSession' }));
  document.querySelector('[title="Historial"]').addEventListener('click', () => vscode.postMessage({ type: 'showHistory' }));
  document.querySelector('[title="Configuración"]').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
  
  if (attachBtn) {
    attachBtn.addEventListener('click', () => vscode.postMessage({ type: 'attachFile' }));
  }

  const insertCodeBtn = Array.from(document.querySelectorAll('.tool-btn')).find(b => b.title.includes('Insertar código'));
  const activeFileBtn = Array.from(document.querySelectorAll('.tool-btn')).find(b => b.title.includes('Archivo activo como contexto'));
  const selectionBtn = Array.from(document.querySelectorAll('.tool-btn')).find(b => b.title.includes('Selección del editor'));
  const gitDiffBtn = Array.from(document.querySelectorAll('.tool-btn')).find(b => b.title.includes('Git diff actual'));

  if (insertCodeBtn) {
    insertCodeBtn.addEventListener('click', () => vscode.postMessage({ type: 'insertCodeBlock' }));
  }
  if (activeFileBtn) {
    activeFileBtn.addEventListener('click', () => vscode.postMessage({ type: 'addCurrentFileToContext' }));
  }
  if (selectionBtn) {
    selectionBtn.addEventListener('click', () => vscode.postMessage({ type: 'addSelectionToContext' }));
  }
  if (gitDiffBtn) {
    gitDiffBtn.addEventListener('click', () => vscode.postMessage({ type: 'gitDiff' }));
  }

  /* dropdown modelo */
  modelBtn.addEventListener('click', e => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    dropOverlay.classList.toggle('open');
  });

  dropOverlay.addEventListener('click', () => {
    dropdown.classList.remove('open');
    dropOverlay.classList.remove('open');
  });

  dropdown.addEventListener('click', e => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;

    if (item.hasAttribute('data-value')) {
      selectedModel = item.dataset.value;
      modelNameEl.textContent = item.dataset.name;
      dropdown.querySelectorAll('[data-value]').forEach(i => i.querySelector('.dropdown-check').textContent = '');
      item.querySelector('.dropdown-check').textContent = '✓';
      dropdown.classList.remove('open');
      dropOverlay.classList.remove('open');
    }
  });
  dropdown.querySelectorAll('[data-mode]').forEach(item => {
    item.addEventListener('click', () => {
      selectedMode = item.dataset.mode;
      modePill.textContent = selectedMode;
      dropdown.querySelectorAll('[data-mode]').forEach(i => i.querySelector('.dropdown-check').textContent = '');
      item.querySelector('.dropdown-check').textContent = '✓';
      dropdown.classList.remove('open');
      dropOverlay.classList.remove('open');
    });
  });

  // Manejar pegar imágenes
  inputEl.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image/') === 0) {
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (event) => {
          attachments.push({
            type: 'file',
            mime: item.type,
            filename: `image-${Date.now()}.png`,
            url: event.target.result
          });
          renderAttachments();
        };
        reader.readAsDataURL(blob);
      }
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        // Clear existing messages
        const msgs = messagesEl.querySelectorAll('.msg');
        msgs.forEach(m => m.remove());
        if (welcomeEl) welcomeEl.style.display = 'block';

        if (msg.messages && msg.messages.length > 0) {
          if (welcomeEl) welcomeEl.style.display = 'none';
          msg.messages.forEach(m => {
            const role = m.role === 'assistant' ? 'ai' : m.role;
            const node = appendMessage(role, m.text);
            if (role === 'ai' && m.metrics) {
              appendMeta(node.querySelector('.msg-body'), m.metrics);
            }
          });
        }

        if (msg.models && msg.models.length > 0) {
          let section = dropdown.querySelector('.dropdown-section');
          if (section) {
            section.innerHTML = '<div class="dropdown-label">Modelo</div>';
          } else {
            section = document.createElement('div');
            section.className = 'dropdown-section';
            section.innerHTML = '<div class="dropdown-label">Modelo</div>';
            dropdown.insertBefore(section, dropdown.firstChild);
          }
          
          // Group models by provider
          const providers = {};
          msg.models.forEach(model => {
            const mId = typeof model === 'string' ? model : model.id;
            const mName = typeof model === 'string' ? model : model.name;
            
            let providerId = 'otros';
            let providerName = 'Otros';
            let modelDisplayName = mName;
            
            if (mId.includes('::')) {
              const parts = mId.split('::');
              providerId = parts[0];
              const nameParts = mName.split(' - ');
              if (nameParts.length > 1) {
                providerName = nameParts[0];
                modelDisplayName = nameParts.slice(1).join(' - ');
              } else {
                providerName = providerId;
              }
            }
            
            if (!providers[providerId]) {
              providers[providerId] = {
                id: providerId,
                name: providerName,
                models: []
              };
            }
            providers[providerId].models.push({
              id: mId,
              name: modelDisplayName,
              fullName: mName
            });
          });

          const modelsList = document.createElement('div');
          modelsList.className = 'dropdown-models-list';
          
          Object.values(providers).forEach(prov => {
            const group = document.createElement('div');
            group.className = 'provider-group';
            
            const hasSelected = prov.models.some(m => m.id === selectedModel);
            if (hasSelected) {
              group.classList.add('open');
            }
            
            const header = document.createElement('div');
            header.className = 'provider-header';
            header.innerHTML = `
              <span class="provider-name">${escHtml(prov.name)}</span>
              <span class="provider-arrow">${hasSelected ? '▾' : '▸'}</span>
            `;
            
            const modelsContainer = document.createElement('div');
            modelsContainer.className = 'provider-models';
            
            prov.models.forEach(m => {
              const item = document.createElement('div');
              item.className = 'dropdown-item';
              item.dataset.value = m.id;
              item.dataset.name = m.fullName;
              item.innerHTML = `
                <div class="dropdown-check">${selectedModel === m.id ? '✓' : ''}</div>
                <div style="flex:1;">${escHtml(m.name)}</div>
              `;
              modelsContainer.appendChild(item);
            });
            
            header.addEventListener('click', (e) => {
              e.stopPropagation();
              const isOpen = group.classList.contains('open');
              modelsList.querySelectorAll('.provider-group').forEach(g => {
                g.classList.remove('open');
                const arrow = g.querySelector('.provider-arrow');
                if (arrow) arrow.textContent = '▸';
              });
              
              if (!isOpen) {
                group.classList.add('open');
                const arrow = header.querySelector('.provider-arrow');
                if (arrow) arrow.textContent = '▾';
              }
            });
            
            group.appendChild(header);
            group.appendChild(modelsContainer);
            modelsList.appendChild(group);
          });
          
          section.appendChild(modelsList);

          if (!selectedModel) {
            const first = msg.models[0];
            selectedModel = typeof first === 'string' ? first : first.id;
            modelNameEl.textContent = typeof first === 'string' ? first : first.name;
          } else {
            const selectedObj = msg.models.find(m => (typeof m === 'string' ? m : m.id) === selectedModel);
            if (selectedObj) {
              modelNameEl.textContent = typeof selectedObj === 'string' ? selectedObj : selectedObj.name;
            }
          }
        }
        break;
      case 'connection':
        setStatus(msg.state, msg.detail);
        break;
      case 'status':
        setStatus(msg.state === 'busy' ? 'busy' : 'idle');
        break;
      case 'user':
        appendMessage('user', msg.text);
        break;
      case 'assistantStream':
        updateStream(msg.text);
        break;
      case 'assistantDone':
        finishStream(msg.text, msg.metrics);
        break;
      case 'system':
        appendMessage('system', msg.text);
        break;
      case 'error':
        appendMessage('error', msg.message);
        streamingNode = null;
        streamingBodyNode = null;
        streamingMetaNode = null;
        break;
      case 'context':
        // Limpiamos los tags de contexto (que no sean adjuntos)
        const existingCtx = contextBar.querySelectorAll('.ctx-tag:not(.ctx-att)');
        existingCtx.forEach(el => el.remove());
        
        (msg.items || []).forEach((item, index) => {
            const tag = document.createElement('div');
            tag.className = 'ctx-tag';
            tag.innerHTML = `
              <svg viewBox="0 0 16 16"><path d="M4 4h8M4 8h6M4 11h4" stroke-linecap="round"/></svg>
              ${item}
              <span class="ctx-tag-close">
                <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>
              </span>
            `;
            tag.querySelector('.ctx-tag-close').onclick = () => {
              vscode.postMessage({ type: 'removeContext', index });
            };
            const addBtn = contextBar.querySelector('.ctx-add');
            if (addBtn) contextBar.insertBefore(tag, addBtn);
            else contextBar.appendChild(tag);
        });
        break;
      case 'insertText':
        if (msg.text) {
          const start = inputEl.selectionStart;
          const end = inputEl.selectionEnd;
          const val = inputEl.value;
          inputEl.value = val.substring(0, start) + msg.text + val.substring(end);
          inputEl.focus();
          inputEl.selectionStart = inputEl.selectionEnd = start + msg.text.length;
          inputEl.style.height = 'auto';
          inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
        }
        break;
      case 'fileAttached':
        attachments.push(msg.attachment);
        renderAttachments();
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
