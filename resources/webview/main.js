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
  const stopBtn    = document.getElementById('stopBtn');
  const stopBtnSep = document.getElementById('stopBtnSep');

// Seleccionamos los botones de las herramientas usando IDs específicos
   const attachFileBtn = document.getElementById('attachFileBtn');
   const attachFolderBtn = document.getElementById('attachFolderBtn');
   const insertCodeBtn = document.getElementById('insertCodeBtn');
   const currentFileBtn = document.getElementById('currentFileBtn');
   const selectionBtn = document.getElementById('selectionBtn');
   const gitDiffBtn = document.getElementById('gitDiffBtn');
   const gitContextBtn = document.getElementById('gitContextBtn');
   const contextAddBtn = document.getElementById('contextAddBtn');

   let streamingNode = null;
   let streamingBodyNode = null;
   let streamingMetaNode = null;
   let selectedModel = '';
   let selectedAgent = '';
   let selectedMode = 'auto'; // agent / auto
   let attachments = [];
   let costData = {};
   let generationInterval = null;
   let generationStartTime = null;



  
  const TRANSLATIONS = {
    en: {
      'agent': 'Agent',
      'mode': 'Mode',
      'clearChat': 'Clear chat',
      'settings': 'Settings',
      'costs': 'Cumulative Costs',
      'hideCosts': 'Hide costs',
      'gitContext': 'Add Git info to context',
      'ready': 'OpenCode ready',
      'readyDesc': 'Ask a question, generate code or open a file as context.',
      'thinking': 'Thinking...'
    }
  };

  function applyI18n() {
    const lang = window.vscodeLang?.startsWith('en') ? 'en' : null;
    if (!lang) return;
    
    const t = TRANSLATIONS[lang];
    if (!t) return;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (t[key]) el.setAttribute('title', t[key]);
    });
  }

  applyI18n();


  function setStatus(state, detail) {
    if (state === 'busy') {
      showTyping(detail);
      if (!generationInterval) {
        generationStartTime = Date.now();
        generationInterval = setInterval(() => {
          const elapsed = ((Date.now() - generationStartTime) / 1000).toFixed(1);
          const timerEl = document.getElementById('typingTimer');
          if (timerEl) {
            timerEl.textContent = `(${elapsed}s)`;
          }
        }, 100);
      }
      sendBtn.disabled = true;
      inputEl.disabled = true;
       // Switch send button to abort mode
       sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
       sendBtn.title = "Cancelar (Esc)";
       sendBtn.classList.add('abort');
       sendBtn.onclick = () => { vscode.postMessage({ type: 'abort' }); };
       sendBtn.disabled = false;
       if (stopBtn) stopBtn.style.display = 'inline-flex';
       if (stopBtnSep) stopBtnSep.style.display = 'block';

    } else {
      if (generationInterval) {
        clearInterval(generationInterval);
        generationInterval = null;
      }
      const timerEl = document.getElementById('typingTimer');
      if (timerEl) {
        timerEl.textContent = '';
      }
      hideTyping();
      sendBtn.disabled = false;
      inputEl.disabled = false;
       // Restore send button to send mode
       sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`;
       sendBtn.title = "Enviar (Enter)";
       sendBtn.classList.remove('abort');
       sendBtn.onclick = sendMessage;
       sendBtn.disabled = false;
       if (stopBtn) stopBtn.style.display = 'none';
       if (stopBtnSep) stopBtnSep.style.display = 'none';

      if (state === 'idle') inputEl.focus();
    }
  }
  
  

   function appendMeta(node, metrics) {
     if (!metrics) return;
     const meta = document.createElement('div');
     meta.className = 'msg-meta';
     meta.style.fontSize = '10px';
     meta.style.color = 'var(--text-sec)';
     meta.style.marginTop = '6px';
     meta.style.textAlign = 'right';
     let timeStr = '';
     if (generationStartTime) {
       timeStr = ` | Tiempo: ${((Date.now() - generationStartTime) / 1000).toFixed(1)}s`;
     }
     meta.textContent = `Tokens - In: ${metrics.input || 0} | Out: ${metrics.output || 0}${timeStr}`;
     node.appendChild(meta);
   }

   function updateMonthlyTotal() {
        const totalDiv = document.getElementById('monthlyTotal');
        if (!totalDiv) return;
        // Aggregate by month (YYYY-MM)
        const monthMap = {};
        for (const date in costData) {
            const month = date.slice(0,7); // YYYY-MM
            if (!monthMap[month]) monthMap[month] = { usd: 0, eur: 0 };
            const models = costData[date];
            for (const model in models) {
                monthMap[month].usd += models[model].usd;
                monthMap[month].eur += models[model].eur;
            }
        }
        // Get latest month
        const months = Object.keys(monthMap).sort((a,b)=> new Date(b)-new Date(a));
        if (months.length===0) {
            totalDiv.textContent='';
            return;
        }
        const latest = months[0];
        const data = monthMap[latest];
        totalDiv.innerHTML = `Total: ${latest}<br>${data.usd.toFixed(6)}$ || ${data.eur.toFixed(6)}€`;
    }

   function updateCostPanel() {
      // Also update monthly total card
      updateMonthlyTotal();
     const costContent = document.getElementById('costContent');
     if (!costContent) return;

     costContent.innerHTML = '';

     const dates = Object.keys(costData).sort((a, b) => new Date(b) - new Date(a));

     dates.forEach(date => {
       const dateEntry = document.createElement('div');
       dateEntry.className = 'cost-entry';

       const dateHeader = document.createElement('div');
       dateHeader.className = 'cost-date';
       dateHeader.textContent = date;

       const models = costData[date];
       const modelEntries = Object.keys(models).map(model => {
         const modelEntry = document.createElement('div');
         modelEntry.className = 'cost-model';

         const modelName = document.createElement('span');
         modelName.className = 'cost-model-name';
         modelName.textContent = model;
         modelName.title = model;

         const modelCost = document.createElement('span');
         modelCost.className = 'cost-amount';
         modelCost.textContent = `$${models[model].usd.toFixed(6)} | €${models[model].eur.toFixed(6)}`;

         modelEntry.appendChild(modelName);
         modelEntry.appendChild(modelCost);

         return modelEntry;
       });

       dateEntry.appendChild(dateHeader);
       modelEntries.forEach(entry => dateEntry.appendChild(entry));

       costContent.appendChild(dateEntry);
     });
   }

  function showTyping(detail) {
    const typingTextEl = document.getElementById('typingText');
    if (typingTextEl) {
      typingTextEl.textContent = detail || 'Pensando...';
    }
    typingEl.classList.add('visible');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    typingEl.classList.remove('visible');
  }

  function renderBody(text) {
    let html = text
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code>${escHtml(code.trim())}</code></pre>`)
      .replace(/`([^`]+)`/g, (_, code) => `<code>${escHtml(code)}</code>`);

    // Reemplazar indicadores de llamadas a herramientas con spinners y estilos Premium
    html = html.replace(/[>&gt;]\s*⚙️\s*Ejecutando:\s*<code>([^<]+)<\/code>\.\.\./g, (_, tool) => {
      return `<div class="tool-status running">
        <span class="tool-spinner"></span>
        <span>Ejecutando herramienta: <strong>${tool}</strong></span>
      </div>`;
    });

    html = html.replace(/[>&gt;]\s*✅\s*Completado:\s*<code>([^<]+)<\/code>/g, (_, tool) => {
      return `<div class="tool-status success">
        <span class="tool-icon-check">✓</span>
        <span>Completado: <strong>${tool}</strong></span>
      </div>`;
    });

    html = html.replace(/[>&gt;]\s*❌\s*Error en\s*<code>([^<]+)<\/code>/g, (_, tool) => {
      return `<div class="tool-status error">
        <span class="tool-icon-error">✗</span>
        <span>Error en: <strong>${tool}</strong></span>
      </div>`;
    });

    html = html.replace(/[>&gt;]\s*🔐\s*Esperando permiso:\s*<code>([^<]+)<\/code>\.\.\./g, (_, permTitle) => {
      return `<div class="tool-status error" style="border-color: var(--accent-dim); color: var(--text-pri);">
        <span class="tool-spinner" style="border-top-color: #ffb300; border-right-color: #ffb300;"></span>
        <span>Esperando permiso: <strong>${permTitle}</strong> (revisa la notificación en la esquina inferior derecha)</span>
      </div>`;
    });

    html = html.replace(/\n/g, '<br>');
    return html;
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
    msgEl.dataset.rawText = text; // Guardar texto original para edición

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
        ${role === 'user' ? `
          <button class="msg-act-btn btn-edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            editar
          </button>
        ` : ''}
        <button class="msg-act-btn btn-copy">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          copiar
        </button>
        ${role === 'ai' ? `<button class="msg-act-btn"><svg viewBox="0 0 24 24"><path d="M23 7L16 12L23 17V7zM1 5h12a2 2 0 012 2v10a2 2 0 01-2 2H1a2 2 0 01-2-2V7a2 2 0 012-2z"/></svg>insertar</button>` : ''}
      </div>
    `;

    return msgEl;
  }

  function appendMessage(role, text) {
    const threshold = 120;
    const isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= threshold;

    const msgEl = createMsgElement(role, text);
    typingEl.before(msgEl);

    if (role === 'user' || isNearBottom) {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
    }
    return msgEl;
  }

  function clearChat() {
    vscode.postMessage({ type: 'clearChat' });
  }

  function updateStream(text) {
    const threshold = 120;
    const isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= threshold;

    if (!streamingNode) {
      streamingNode = appendMessage('ai', text);
      streamingBodyNode = streamingNode.querySelector('.msg-body');
    } else {
      if (streamingBodyNode) {
        streamingBodyNode.innerHTML = renderBody(text);
      }
    }
    if (isNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function finishStream(text, metrics) {
    const threshold = 120;
    const isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= threshold;

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

    if (isNearBottom) {
      messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
    }
  }

  window.copyMsg = function(btn) {
    const body = btn.closest('.msg').querySelector('.msg-body');
    vscode.postMessage({ type: 'copyToClipboard', text: body.innerText });
    btn.textContent = 'copiado ✓';
    setTimeout(() => {
      btn.innerHTML = `<svg viewBox="0 0 24 24" style="width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> copiar`;
    }, 1500);
  };

  messagesEl.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) {
      window.editMsg(editBtn);
      return;
    }
    const copyBtn = e.target.closest('.btn-copy');
    if (copyBtn) {
      window.copyMsg(copyBtn);
      return;
    }
  });

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
    const existingAtts = contextBar.querySelectorAll('.ctx-att');
    existingAtts.forEach(el => el.remove());
    
    attachments.forEach((att, index) => {
      const tag = document.createElement('div');
      tag.className = 'ctx-tag ctx-att';
      tag.style.backgroundColor = '#1a334d';
      tag.style.borderColor = '#29527a';
      tag.style.color = '#7ab8ff';

      const isImg = att.mime && att.mime.startsWith('image/');
      const iconOrThumb = isImg 
        ? `<img src="${att.url}" style="width:16px;height:16px;object-fit:cover;border-radius:2px;" />`
        : `<svg viewBox="0 0 24 24" style="width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:2;"><path d="M21.44 11.05L12.25 20.24a6 6 0 01-8.49-8.49l9.2-9.19a4 4 0 015.66 5.65L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>`;

      tag.innerHTML = `
        ${iconOrThumb}
        <span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 4px;">${att.filename || 'Adjunto'}</span>
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

  window.editMsg = function(btn) {
    const msgEl = btn.closest('.msg');
    const rawText = msgEl.dataset.rawText || '';
    inputEl.value = rawText;
    inputEl.focus();
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  };

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text && attachments.length === 0) return;

    appendMessage('user', text || '(Solo adjuntos)');
    setStatus('busy');
    
    inputEl.value = '';
    inputEl.style.height = 'auto';
    
    vscode.postMessage({ 
      type: 'send', 
      text, 
      agent: selectedAgent || '',
      model: selectedModel,
      attachments: [...attachments]
    });
    
    attachments = [];
    renderAttachments();
  }

  window.sendQuick = function(text) {
    appendMessage('user', text);
    setStatus('busy');
    vscode.postMessage({
      type: 'quickAction',
      text: text,
      model: selectedModel,
      agent: selectedAgent || ''
    });
  };

   window.addCtxTag = function() {
     vscode.postMessage({ type: 'addContextFile' });
   };

   window.addContextFile = function() {
     showButtonFeedback(contextAddBtn, contextAddBtn.innerHTML, 500);
     vscode.postMessage({ type: 'addContextFile' });
   };

   window.addCurrentFile = function() {
     showButtonFeedback(contextAddBtn, contextAddBtn.innerHTML, 500);
     vscode.postMessage({ type: 'addCurrentFileToContext' });
   };

   window.addSelection = function() {
     showButtonFeedback(contextAddBtn, contextAddBtn.innerHTML, 500);
     vscode.postMessage({ type: 'addSelectionToContext' });
   };

   window.addOpenFiles = function() {
     showButtonFeedback(contextAddBtn, contextAddBtn.innerHTML, 500);
     vscode.postMessage({ type: 'addOpenFilesToContext' });
   };

   window.attachFolder = function() {
     showButtonFeedback(contextAddBtn, contextAddBtn.innerHTML, 500);
     vscode.postMessage({ type: 'attachFolder' });
   };

   function showButtonFeedback(button, originalContent, duration = 1000) {
     const originalHTML = button.innerHTML;
     button.style.opacity = '0.5';
     button.disabled = true;
     setTimeout(() => {
       button.innerHTML = originalContent;
       button.style.opacity = '1';
       button.disabled = false;
     }, duration);
   }

  function updateTopbarDisplay() {
    const agentText = selectedAgent ? `@${selectedAgent}` : 'Default';
    const modelText = selectedModel ? selectedModel.split('::').pop() : 'default';
    if (modelNameEl) modelNameEl.innerHTML = `<span class="model-display">${escHtml(modelText)}</span>`;
    const agentNameEl = document.getElementById('agentName');
    if (agentNameEl) agentNameEl.textContent = agentText;
  }

  // Header buttons
   const exportChatBtn = document.getElementById('exportChatBtn');
   if (exportChatBtn) {
     exportChatBtn.addEventListener('click', () => {
       vscode.postMessage({ type: 'exportChat' });
     });
   }

    const toggleCostPanelBtn = document.getElementById('toggleCostPanelBtn');
    const closeCostPanelBtn = document.getElementById('closeCostPanelBtn');

    function toggleCostPanel() {
      document.body.classList.toggle('cost-panel-open');
    }

    if (toggleCostPanelBtn) {
      toggleCostPanelBtn.addEventListener('click', toggleCostPanel);
    }
    if (closeCostPanelBtn) {
      closeCostPanelBtn.addEventListener('click', toggleCostPanel);
    }
     if (stopBtn) {
       stopBtn.addEventListener('click', () => {
         vscode.postMessage({ type: 'abort' });
       });
     }
  document.getElementById('clearChatBtn').addEventListener('click', () => {
    clearChat();
  });
  document.querySelector('[title="Nueva sesión"]').addEventListener('click', () => vscode.postMessage({ type: 'newSession' }));
  document.querySelector('[title="Historial"]').addEventListener('click', () => vscode.postMessage({ type: 'showHistory' }));
  document.querySelector('[title="Configuración"]').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
  
  if (attachFileBtn) {
    attachFileBtn.addEventListener('click', () => {
      showButtonFeedback(attachFileBtn, attachFileBtn.innerHTML, 500);
      vscode.postMessage({ type: 'attachFile' });
    });
  }

  if (attachFolderBtn) {
    attachFolderBtn.addEventListener('click', () => {
      showButtonFeedback(attachFolderBtn, attachFolderBtn.innerHTML, 500);
      vscode.postMessage({ type: 'attachFolder' });
    });
  }

  if (insertCodeBtn) {
    insertCodeBtn.addEventListener('click', () => {
      showButtonFeedback(insertCodeBtn, insertCodeBtn.innerHTML, 500);
      vscode.postMessage({ type: 'insertCodeBlock' });
    });
  }

  if (currentFileBtn) {
    currentFileBtn.addEventListener('click', () => {
      showButtonFeedback(currentFileBtn, currentFileBtn.innerHTML, 500);
      vscode.postMessage({ type: 'addCurrentFileToContext' });
    });
  }

  if (selectionBtn) {
    selectionBtn.addEventListener('click', () => {
      showButtonFeedback(selectionBtn, selectionBtn.innerHTML, 500);
      vscode.postMessage({ type: 'addSelectionToContext' });
    });
  }

if (gitDiffBtn) {
     gitDiffBtn.addEventListener('click', () => {
       showButtonFeedback(gitDiffBtn, gitDiffBtn.innerHTML, 500);
       vscode.postMessage({ type: 'gitDiff' });
     });
   }

   if (gitContextBtn) {
     gitContextBtn.addEventListener('click', () => {
       showButtonFeedback(gitContextBtn, gitContextBtn.innerHTML, 500);
       vscode.postMessage({ type: 'addGitToContext' });
     });
   }

  if (contextAddBtn) {
    contextAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const contextMenu = document.getElementById('contextMenu');
      if (contextMenu) {
        contextMenu.classList.toggle('show');
      }
      showButtonFeedback(contextAddBtn, contextAddBtn.innerHTML, 500);
    });
  }

  // Cerrar el menú cuando se hace clic fuera
  document.addEventListener('click', (e) => {
    const contextDropdown = document.querySelector('.context-dropdown');
    const contextMenu = document.getElementById('contextMenu');
    if (contextDropdown && !contextDropdown.contains(e.target) && contextMenu) {
      contextMenu.classList.remove('show');
    }
  });

  /* dropdown modelo, agente, modo */
  const agentBtn = document.getElementById('agentBtn');
  const agentDropdown = document.getElementById('agentDropdown');
  const modeBtn = document.getElementById('modeBtn');
  const modeDropdown = document.getElementById('modeDropdown');

  function closeAllDropdowns() {
    dropdown.classList.remove('open');
    if(agentDropdown) agentDropdown.classList.remove('open');
    if(modeDropdown) modeDropdown.classList.remove('open');
    dropOverlay.classList.remove('open');
  }

  modelBtn.addEventListener('click', e => {
    e.stopPropagation();
    closeAllDropdowns();
    dropdown.classList.add('open');
    dropOverlay.classList.add('open');
  });

  if (agentBtn) {
    agentBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeAllDropdowns();
      agentDropdown.classList.add('open');
      dropOverlay.classList.add('open');
    });
  }

  if (modeBtn) {
    modeBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeAllDropdowns();
      modeDropdown.classList.add('open');
      dropOverlay.classList.add('open');
    });
  }

  dropOverlay.addEventListener('click', closeAllDropdowns);

  function handleDropdownClick(e) {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;

    if (item.dataset.value !== undefined || item.dataset.model !== undefined) {
      selectedModel = item.dataset.value || item.dataset.model;
      dropdown.querySelectorAll('[data-value], [data-model]').forEach(i => {
        const check = i.querySelector('.dropdown-check');
        if(check) check.textContent = '';
        i.classList.remove('active');
      });
      const check = item.querySelector('.dropdown-check');
      if(check) check.textContent = '✓';
      item.classList.add('active');
      closeAllDropdowns();
      updateTopbarDisplay();
      vscode.postMessage({ type: 'setModel', model: selectedModel });
    } else if (item.dataset.agent !== undefined) {
      selectedAgent = item.dataset.agent;
      const list = document.querySelector('.dropdown-agents-list');
      if (list) {
        list.querySelectorAll('[data-agent]').forEach(i => {
          const check = i.querySelector('.dropdown-check');
          if(check) check.textContent = '';
          i.classList.remove('active');
        });
      }
      const check = item.querySelector('.dropdown-check');
      if(check) check.textContent = '✓';
      item.classList.add('active');
      closeAllDropdowns();
      updateTopbarDisplay();
      vscode.postMessage({ type: 'setAgent', agent: selectedAgent });
    } else if (item.dataset.mode !== undefined) {
      selectedMode = item.dataset.mode;
      const mPill = document.getElementById('modePill');
      if (mPill) mPill.textContent = selectedMode;
      const mName = document.getElementById('modeName');
      if (mName) mName.textContent = selectedMode;
      
      const p = item.closest('.dropdown');
      if (p) {
        p.querySelectorAll('[data-mode]').forEach(i => {
          const check = i.querySelector('.dropdown-check');
          if(check) check.textContent = '';
        });
      }
      const check = item.querySelector('.dropdown-check');
      if(check) check.textContent = '✓';
      closeAllDropdowns();
    }
  }

  dropdown.addEventListener('click', handleDropdownClick);
  if (agentDropdown) agentDropdown.addEventListener('click', handleDropdownClick);
  if (modeDropdown) modeDropdown.addEventListener('click', handleDropdownClick);

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

   function calculateCost(inputTokens, outputTokens, model) {
     const modelPrices = {
       'mistral-medium-latest': { input: 2.00, output: 6.00 },
       'default': { input: 2.00, output: 6.00 }
     };

     const price = modelPrices[model] || modelPrices['default'];
     const usd = (inputTokens * price.input + outputTokens * price.output) / 1000000;
     const eur = usd * 0.92;

     return { usd, eur };
   }

   window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
       case 'init':
         costData = msg.costData || {};
         updateCostPanel();
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

        // Renderizar agentes en el desplegable
        if (msg.selectedAgent !== undefined) {
          selectedAgent = msg.selectedAgent;
        }
        if (msg.agents) {
          let agentSection = agentDropdown.querySelector('.dropdown-section-agents');
          if (!agentSection) {
            agentSection = document.createElement('div');
            agentSection.className = 'dropdown-section dropdown-section-agents';
            agentDropdown.appendChild(agentSection);
          }
          agentSection.innerHTML = '<div class="dropdown-label">Agente</div>';
          const agentsList = document.createElement('div');
          agentsList.className = 'dropdown-agents-list';
          agentsList.style.maxHeight = '150px';
          agentsList.style.overflowY = 'auto';

          // Opción Default
          const defaultItem = document.createElement('div');
          defaultItem.className = 'dropdown-item' + (!selectedAgent ? ' active' : '');
          defaultItem.dataset.agent = '';
          defaultItem.innerHTML = `
            <div class="dropdown-check">${!selectedAgent ? '✓' : ''}</div>
            <div style="flex:1;">Default</div>
          `;
          agentsList.appendChild(defaultItem);

          const internalAgents = ['compaction', 'plan', 'summary', 'title'];
          msg.agents.forEach(agent => {
            if (internalAgents.includes(agent.name)) return;
            
            const item = document.createElement('div');
            item.className = 'dropdown-item' + (selectedAgent === agent.name ? ' active' : '');
            item.dataset.agent = agent.name;
            item.title = agent.description || '';
            item.innerHTML = `
              <div class="dropdown-check">${selectedAgent === agent.name ? '✓' : ''}</div>
              <div style="flex:1;">${escHtml(agent.name)}</div>
            `;
            agentsList.appendChild(item);
          });
          agentSection.appendChild(agentsList);
        }

        // Renderizar Quick Actions configurables
        if (msg.quickActions && msg.quickActions.length > 0) {
          const container = document.getElementById('quickActionsContainer');
          if (container) {
            container.innerHTML = '';
            msg.quickActions.forEach(qa => {
              const btn = document.createElement('button');
              btn.className = 'qa-btn';
              btn.onclick = () => sendQuick(qa.text);
              let svg = '';
              if (qa.icon === 'info') {
                svg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
              } else if (qa.icon === 'bug') {
                svg = '<svg viewBox="0 0 24 24"><path d="M9 9l-3-3M15 9l3-3M9 15l-3 3M15 15l3 3M12 21a9 9 0 100-18 9 9 0 000 18z"/></svg>';
              } else if (qa.icon === 'test') {
                svg = '<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4M7 2h10l2 2v16l-2 2H7l-2-2V4l2-2z"/></svg>';
              } else if (qa.icon === 'refactor') {
                svg = '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
              } else {
                svg = '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"/></svg>';
              }
              btn.innerHTML = `${svg} ${escHtml(qa.label)}`;
              container.appendChild(btn);
            });
          }
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

          if (msg.selectedModel) {
            selectedModel = msg.selectedModel;
            // Find the model name from the list
            const foundModel = msg.models.find(m => (typeof m === 'string' ? m : m.id) === selectedModel);
            if (foundModel) {
              // handled by updateTopbarDisplay
            } else {
              selectedModel = '';
            }
          }

          if (!selectedModel) {
            const first = msg.models[0];
            selectedModel = typeof first === 'string' ? first : first.id;
          }
          
          updateTopbarDisplay();
        }
        break;
      case 'chatCleared':
        // Eliminar todos los mensajes del DOM
        const msgsToClear = messagesEl.querySelectorAll('.msg');
        msgsToClear.forEach(m => m.remove());
        if (welcomeEl) welcomeEl.style.display = 'block';
        break;
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
        if (msg.statusDetail) {
          const typingTextEl = document.getElementById('typingText');
          if (typingTextEl) {
            typingTextEl.textContent = msg.statusDetail;
          }
        }
        break;
       case 'assistantDone':
         finishStream(msg.text, msg.metrics);
         if (msg.metrics) {
           const today = new Date().toISOString().split('T')[0];
           const model = selectedModel || 'default';
           const cost = calculateCost(msg.metrics.input, msg.metrics.output, model);

           if (!costData[today]) {
             costData[today] = {};
           }

           if (!costData[today][model]) {
             costData[today][model] = { usd: 0, eur: 0 };
           }

           costData[today][model].usd += cost.usd;
           costData[today][model].eur += cost.eur;

           updateCostPanel();
         }
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
       case 'gitInfoUpdate':
         // Actualizar visualización de Git en tiempo real
         if (msg.gitInfo) {
           const gitSummary = `${msg.gitInfo.hasChanges ? '⚠️' : '✅'} \`${msg.gitInfo.branch}\` | ${msg.gitInfo.commits.length} commits`;
           // Podrías mostrar esto en un panel de Git si existe
           const gitStatusEl = document.getElementById('gitStatus');
           if (gitStatusEl) {
             gitStatusEl.textContent = gitSummary;
             gitStatusEl.style.display = 'block';
           }
         } else {
           const gitStatusEl = document.getElementById('gitStatus');
           if (gitStatusEl) {
             gitStatusEl.style.display = 'none';
           }
         }
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
