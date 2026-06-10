(function installCursorMcpFollowup() {
  const NAME = "__cursorMcpFollowup";

  if (window[NAME] && typeof window[NAME].uninstall === "function") {
    window[NAME].uninstall();
  }

  const config = {
    styleId: "cursor-mcp-followup-style",
    panelId: "cursor-mcp-followup-panel",
    mountScanMs: 600,
    reconnectMs: 3000,
    scanStart: 8765,
    scanCount: 5,
    probeTimeoutMs: 2500,
    // 按需扫描：仅在「启动时」和「展开端口下拉框时」各扫一次，不做后台/持续扫描。
    customValue: "__custom__",
    lang: "zh-CN",
    // 发送场景重连成功（onopen）后，若服务端未及时推送会话状态，则等待此毫秒数后兜底直接发送。
    sendAfterOpenMs: 350,
    // 常用提示词所在 ui_settings.json 的绝对路径；注入脚本会按平台替换此占位符（Windows 用正斜杠）。
    // 面板借道现有 WS 的 run_command 读写该文件，不读本地 fs、不依赖 CORS。
    settingsPath: "__MCP_SETTINGS_PATH__",
    // 读取配置的完整命令：Mac/Linux 为 `cat <path>`，Windows 为 python UTF-8 读取（注入时按平台生成）。
    readCmd: "__MCP_READ_CMD__",
    // 写回配置时使用的 python 命令名（注入时探测：python / py / python3）。
    pyCmd: "__MCP_PY__",
    // run_command 拉取提示词的兜底超时（毫秒）。
    promptLoadTimeoutMs: 4000,
  };

  const state = {
    installedAt: new Date().toISOString(),
    socket: null,
    socketPort: null,
    connectSeq: 0,
    currentState: "offline",
    currentSession: null,
    wantSend: false,
    mounted: false,
    scanning: false,
    foundPorts: [],
    portProjects: {},
    // 端口 → 窗口真实工作区路径 / 项目名（取自 server 进程的 WORKSPACE_FOLDER_PATHS / CURSOR_WORKSPACE_LABEL，
    // 由 Cursor 注入、不受 AI 传入的 project_directory 影响），用于把面板锁定到「本窗口」对应的端口。
    portWorkspaces: {},
    portLabels: {},
    portStatuses: {},
    selectedStatus: null,
    expanded: false,
    // 常用提示词 + 完整 ui_settings（办法①：首次拿到会话时经 WS run_command 拉取并缓存）。
    prompts: [],
    promptsLoaded: false,
    loadingPrompts: false,
    cmdBuffer: null,
    settings: null,
    writing: false,
    // 配置抽屉与编辑态。
    drawerOpen: false,
    editingId: null,
    // 自动提交倒计时。
    autoSubmitTimer: null,
    autoSubmitLeft: 0,
    asActiveId: null,
    autoSubmitSuppressed: false,
    // 输入法组字（拼音/注音等）进行中：此间回车用于上屏候选词，不应触发发送。
    composing: false,
    timers: [],
    // 自定义端口下拉的文档级监听（点空白处 / Esc 关闭菜单），uninstall 时移除。
    onDocPointerDown: null,
    onDocKeydown: null,
  };

  const SVG_NS = "http://www.w3.org/2000/svg";

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        if (key === "class") el.className = attrs[key];
        else el.setAttribute(key, String(attrs[key]));
      }
    }
    for (const child of children) {
      if (child == null) continue;
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return el;
  }

  function svgEl(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) el.setAttribute(key, String(attrs[key]));
    }
    for (const child of children) {
      if (child != null) el.appendChild(child);
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function ensureStyle() {
    if (document.getElementById(config.styleId)) return;

    const chevron =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M4 6l4 4 4-4' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

    const style = document.createElement("style");
    style.id = config.styleId;
    style.textContent = `
      #${config.panelId} {
        flex: 0 0 auto;
        margin: 4px 12px 6px;
        padding: 7px 10px 6px;
        border: 1px solid var(--vscode-input-border, rgba(228, 228, 228, .18));
        border-radius: 12px;
        background: var(--vscode-input-background, rgba(228, 228, 228, .035));
        color: var(--vscode-foreground, rgba(228, 228, 228, .92));
        font-family: var(--vscode-font-family, -apple-system, "system-ui", sans-serif);
        font-size: 13px;
        line-height: 1.4;
      }
      #${config.panelId} * { box-sizing: border-box; }

      #${config.panelId} .cmf-head {
        display: flex;
        align-items: center;
        gap: 7px;
        margin-bottom: 5px;
      }
      #${config.panelId} .cmf-badge {
        font-size: 9.5px; font-weight: 700; letter-spacing: .05em;
        padding: 1px 5px; border-radius: 4px;
        background: var(--vscode-badge-background, #88c0d0);
        color: var(--vscode-badge-foreground, #141414);
      }
      #${config.panelId} .cmf-status {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11.5px;
        color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .6));
        white-space: nowrap;
      }
      #${config.panelId} .cmf-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #66d19e; box-shadow: 0 0 0 3px rgba(102, 209, 158, .14);
      }
      #${config.panelId} .cmf-dot.off { background: var(--vscode-descriptionForeground, #888); box-shadow: none; }
      #${config.panelId} .cmf-spinner {
        width: 11px; height: 11px;
        border: 2px solid rgba(228, 228, 228, .22);
        border-top-color: var(--vscode-foreground, rgba(228, 228, 228, .85));
        border-radius: 50%;
        animation: cmf-spin 1s linear infinite;
      }
      @keyframes cmf-spin { to { transform: rotate(360deg); } }

      #${config.panelId} .cmf-spacer { flex: 1 1 auto; }
      #${config.panelId} .cmf-project {
        max-width: 140px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-size: 11.5px;
        color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .55));
      }
      #${config.panelId} .cmf-port {
        appearance: none; -webkit-appearance: none;
        height: 22px; padding: 0 20px 0 6px;
        border-radius: 4px;
        border: 1px solid transparent;
        background-color: transparent;
        background-image: url("${chevron}");
        background-repeat: no-repeat;
        background-position: right 5px center;
        color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .7));
        font-family: inherit; font-size: 11.5px; cursor: pointer; outline: none;
        transition: background-color .12s ease;
      }
      #${config.panelId} .cmf-port:hover { background-color: var(--vscode-list-hoverBackground, rgba(228, 228, 228, .07)); }
      #${config.panelId} .cmf-port:focus { background-color: var(--vscode-list-hoverBackground, rgba(228, 228, 228, .07)); }
      #${config.panelId} .cmf-prompts { max-width: 170px; flex: 0 1 auto; }

      /* 自定义端口下拉：触发按钮 + 浮层菜单（替代原生 <select>，以支持「点开→扫描→填充→展示」而不打断点选）。 */
      #${config.panelId} .cmf-portwrap { position: relative; display: inline-flex; flex: 0 0 auto; }
      #${config.panelId} .cmf-portbtn {
        appearance: none; -webkit-appearance: none;
        height: 22px; padding: 0 20px 0 8px;
        border-radius: 4px;
        border: 1px solid transparent;
        background-color: transparent;
        background-image: url("${chevron}");
        background-repeat: no-repeat;
        background-position: right 5px center;
        color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .7));
        font-family: inherit; font-size: 11.5px; cursor: pointer; outline: none;
        white-space: nowrap;
        transition: background-color .12s ease;
      }
      #${config.panelId} .cmf-portbtn:hover { background-color: var(--vscode-list-hoverBackground, rgba(228, 228, 228, .07)); }
      #${config.panelId} .cmf-portbtn.open { background-color: var(--vscode-list-hoverBackground, rgba(228, 228, 228, .1)); }
      #${config.panelId} .cmf-portmenu {
        position: absolute; top: calc(100% + 4px); right: 0; z-index: 1000;
        min-width: 100%; max-width: 300px; max-height: 240px; overflow-y: auto;
        padding: 4px;
        border: 1px solid var(--vscode-input-border, rgba(228, 228, 228, .18));
        border-radius: 8px;
        background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #252526));
        box-shadow: 0 6px 20px rgba(0, 0, 0, .32);
      }
      #${config.panelId} .cmf-opt {
        display: block; white-space: nowrap;
        padding: 4px 8px; border-radius: 5px;
        font-size: 11.5px; line-height: 1.5;
        color: var(--vscode-foreground, rgba(228, 228, 228, .9));
        cursor: pointer;
      }
      #${config.panelId} .cmf-opt:hover { background: var(--vscode-list-hoverBackground, rgba(228, 228, 228, .1)); }
      #${config.panelId} .cmf-opt.sel { color: var(--vscode-foreground, #fff); background: var(--vscode-list-activeSelectionBackground, rgba(129, 161, 193, .22)); }
      #${config.panelId} .cmf-opt-custom { margin-top: 3px; padding-top: 6px; border-top: 1px solid var(--vscode-input-border, rgba(228, 228, 228, .12)); color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .7)); }
      #${config.panelId} .cmf-menuhint { display: flex; align-items: center; gap: 7px; padding: 6px 8px; font-size: 11.5px; color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .65)); }

      #${config.panelId} .cmf-scan {
        flex: 0 0 auto;
        width: 22px; height: 22px;
        border: 0; border-radius: 4px;
        display: inline-grid; place-items: center;
        background: transparent;
        color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .65));
        cursor: pointer;
        transition: background-color .12s ease, color .12s ease;
      }
      #${config.panelId} .cmf-scan:hover {
        background: var(--vscode-list-hoverBackground, rgba(228, 228, 228, .08));
        color: var(--vscode-foreground, rgba(228, 228, 228, .92));
      }
      #${config.panelId} .cmf-scan:disabled { cursor: default; }
      #${config.panelId} .cmf-scan.scanning { color: var(--vscode-foreground, rgba(228, 228, 228, .85)); }
      #${config.panelId} .cmf-scan.scanning svg { animation: cmf-spin 1s linear infinite; }
      #${config.panelId} .cmf-scan svg { width: 13px; height: 13px; }

      #${config.panelId} .cmf-custom {
        flex: 0 0 auto;
        width: 66px; height: 22px;
        padding: 0 6px;
        border-radius: 4px;
        border: 1px solid var(--vscode-input-border, rgba(228, 228, 228, .22));
        background: var(--vscode-input-background, rgba(228, 228, 228, .05));
        color: var(--vscode-input-foreground, rgba(228, 228, 228, .9));
        font-family: inherit; font-size: 11.5px; outline: none;
      }
      #${config.panelId} .cmf-custom:focus { border-color: var(--vscode-focusBorder, #569cd6); }
      #${config.panelId} .cmf-custom::placeholder { color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .42)); }

      #${config.panelId} .cmf-input {
        display: block;
        width: 100%;
        min-height: 22px; max-height: 160px;
        padding: 2px 0;
        border: 0; outline: 0; resize: none;
        background: transparent;
        color: var(--vscode-input-foreground, rgba(228, 228, 228, .92));
        font-family: inherit; font-size: 13px; line-height: 1.45;
      }
      #${config.panelId} .cmf-input::placeholder { color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .42)); }

      #${config.panelId} .cmf-foot {
        display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px;
      }
      #${config.panelId} .cmf-send {
        flex: 0 0 auto;
        width: 24px; height: 24px;
        border: 0; border-radius: 6px;
        display: inline-grid; place-items: center;
        background: transparent;
        color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .7));
        cursor: pointer;
        transition: background-color .12s ease, color .12s ease, opacity .12s ease;
      }
      #${config.panelId} .cmf-send:hover {
        background: var(--vscode-list-hoverBackground, rgba(228, 228, 228, .08));
        color: var(--vscode-foreground, rgba(228, 228, 228, .92));
      }
      #${config.panelId} .cmf-send.ready {
        background: var(--vscode-button-background, #81a1c1);
        color: var(--vscode-button-foreground, #141414);
      }
      #${config.panelId} .cmf-send.ready:hover { background: var(--vscode-button-hoverBackground, #87a6c4); }
      #${config.panelId} .cmf-send:disabled { opacity: .45; cursor: not-allowed; }
      #${config.panelId} .cmf-send:disabled:hover { background: transparent; color: var(--vscode-descriptionForeground, rgba(228, 228, 228, .7)); }
      #${config.panelId} .cmf-send svg { width: 15px; height: 15px; }

      #${config.panelId} .cmf-gear.active { color: var(--vscode-foreground, rgba(228,228,228,.95)); background: var(--vscode-list-hoverBackground, rgba(228,228,228,.12)); }
      #${config.panelId} .cmf-drawer {
        margin: 2px 0 6px; padding: 8px;
        border: 1px solid var(--vscode-input-border, rgba(228,228,228,.16));
        border-radius: 8px;
        background: var(--vscode-editorWidget-background, rgba(228,228,228,.03));
      }
      #${config.panelId} .cmf-drawer-title {
        display: flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; letter-spacing: .03em;
        color: var(--vscode-descriptionForeground, rgba(228,228,228,.6));
        margin: 2px 0 6px;
      }
      #${config.panelId} .cmf-drawer-title:not(:first-child) { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--vscode-input-border, rgba(228,228,228,.12)); }
      #${config.panelId} .cmf-mini {
        height: 22px; padding: 0 9px;
        border: 1px solid var(--vscode-input-border, rgba(228,228,228,.22));
        border-radius: 5px; background: transparent;
        color: var(--vscode-foreground, rgba(228,228,228,.85));
        font-family: inherit; font-size: 11.5px; cursor: pointer;
        transition: background-color .12s ease;
      }
      #${config.panelId} .cmf-mini:hover { background: var(--vscode-list-hoverBackground, rgba(228,228,228,.08)); }
      #${config.panelId} .cmf-mini.primary { background: var(--vscode-button-background, #81a1c1); color: var(--vscode-button-foreground, #141414); border-color: transparent; }
      #${config.panelId} .cmf-mini.primary:hover { background: var(--vscode-button-hoverBackground, #87a6c4); }
      #${config.panelId} .cmf-plist { display: flex; flex-direction: column; gap: 3px; }
      #${config.panelId} .cmf-pitem { display: flex; align-items: center; gap: 6px; padding: 3px 4px 3px 7px; border-radius: 5px; }
      #${config.panelId} .cmf-pitem:hover { background: var(--vscode-list-hoverBackground, rgba(228,228,228,.06)); }
      #${config.panelId} .cmf-pname { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--vscode-foreground, rgba(228,228,228,.9)); }
      #${config.panelId} .cmf-pbtn { flex: 0 0 auto; width: 22px; height: 20px; border: 0; border-radius: 4px; background: transparent; color: var(--vscode-descriptionForeground, rgba(228,228,228,.6)); cursor: pointer; font-size: 12px; line-height: 1; }
      #${config.panelId} .cmf-pbtn:hover { background: var(--vscode-list-hoverBackground, rgba(228,228,228,.1)); color: var(--vscode-foreground, rgba(228,228,228,.95)); }
      #${config.panelId} .cmf-pempty { font-size: 11.5px; color: var(--vscode-descriptionForeground, rgba(228,228,228,.5)); padding: 4px 7px; }
      #${config.panelId} .cmf-pedit { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      #${config.panelId} .cmf-field {
        width: 100%; padding: 4px 7px; border-radius: 5px;
        border: 1px solid var(--vscode-input-border, rgba(228,228,228,.22));
        background: var(--vscode-input-background, rgba(228,228,228,.05));
        color: var(--vscode-input-foreground, rgba(228,228,228,.92));
        font-family: inherit; font-size: 12px; outline: none;
      }
      #${config.panelId} .cmf-field:focus { border-color: var(--vscode-focusBorder, #569cd6); }
      #${config.panelId} .cmf-ta { resize: vertical; min-height: 48px; line-height: 1.45; }
      #${config.panelId} .cmf-pedit-actions { display: flex; justify-content: flex-end; gap: 6px; }
      #${config.panelId} .cmf-asrow { display: flex; align-items: center; gap: 7px; margin: 5px 0; font-size: 12px; color: var(--vscode-foreground, rgba(228,228,228,.85)); cursor: default; }
      #${config.panelId} .cmf-aslbl { font-size: 11.5px; color: var(--vscode-descriptionForeground, rgba(228,228,228,.6)); }
      #${config.panelId} .cmf-check { width: 14px; height: 14px; accent-color: var(--vscode-button-background, #81a1c1); cursor: pointer; }
      #${config.panelId} .cmf-num { width: 70px; flex: 0 0 auto; }
      #${config.panelId} .cmf-asselect { max-width: 150px; height: 24px; border: 1px solid var(--vscode-input-border, rgba(228,228,228,.22)); background-color: var(--vscode-input-background, rgba(228,228,228,.05)); }
      #${config.panelId} .cmf-asstatus { font-size: 11px; color: var(--vscode-descriptionForeground, rgba(228,228,228,.6)); }
      #${config.panelId} .cmf-asstatus.on { color: #66d19e; }
      #${config.panelId} .cmf-ascount { font-size: 11px; color: #e0a458; padding: 0 6px; cursor: pointer; user-select: none; white-space: nowrap; }
      #${config.panelId} .cmf-ascount:hover { color: #f0b76a; text-decoration: underline; }
    `;
    document.documentElement.appendChild(style);
  }

  const els = {};

  function setStatus(kind) {
    clear(els.status);
    if (kind === "spinner") {
      els.status.appendChild(h("span", { class: "cmf-spinner", "aria-hidden": "true" }));
      return;
    }
    if (kind === "ready") {
      els.status.appendChild(h("span", { class: "cmf-dot", "aria-hidden": "true" }));
      els.status.appendChild(h("span", null, "Ready"));
      return;
    }
    els.status.appendChild(h("span", { class: "cmf-dot off", "aria-hidden": "true" }));
    els.status.appendChild(h("span", null, "Offline"));
  }

  function setSendReady(ready) {
    els.sendBtn.className = ready ? "cmf-send ready" : "cmf-send";
  }

  // 发送按钮只要输入框有内容就可点击，不依赖连接状态，避免「点不了发送」
  function updateSendEnabled() {
    els.sendBtn.disabled = els.prompt.value.trim().length === 0;
  }

  function defaultPorts() {
    const arr = [];
    for (let i = 0; i < config.scanCount; i++) arr.push(String(config.scanStart + i));
    return arr;
  }

  function fillPortOptions(ports, selected) {
    const keep = selected != null ? String(selected) : els.portSelect ? els.portSelect.value : "";
    clear(els.portSelect);
    const list = ports && ports.length ? ports.map(String) : [String(config.scanStart)];
    for (const p of list) {
      els.portSelect.appendChild(h("option", { value: p }));
    }
    els.portSelect.appendChild(h("option", { value: config.customValue }, "自定义端口…"));
    els.portSelect.value = keep && list.includes(keep) ? keep : list[0];
    refreshOptionLabels();
  }

  // 确保隐藏 select（数据载体）里存在某端口的 option。自定义浮层用 foundPorts 渲染，
  // 但隐藏 select 只在全量扫描时重填；按需扫描新发现的端口必须补进来，否则给原生
  // <select> 设一个不存在的 value 会被静默置空 → 连空端口 offline。
  function ensurePortOption(value) {
    if (!els.portSelect) return;
    const v = String(value);
    const opts = Array.from(els.portSelect.options);
    if (opts.some((o) => o.value === v)) return;
    const custom = opts.find((o) => o.value === config.customValue);
    els.portSelect.insertBefore(h("option", { value: v }), custom || null);
  }

  function makeScanIcon() {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" });
    svg.appendChild(svgEl("circle", { cx: "11", cy: "11", r: "6", stroke: "currentColor", "stroke-width": "2" }));
    svg.appendChild(
      svgEl("path", { d: "M20 20l-3.4-3.4", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" })
    );
    return svg;
  }

  function makeRefreshIcon() {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" });
    const opts = { stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" };
    svg.appendChild(svgEl("path", Object.assign({ d: "M4 12a8 8 0 0 1 13.7-5.6L20 8" }, opts)));
    svg.appendChild(svgEl("path", Object.assign({ d: "M20 4v4h-4" }, opts)));
    svg.appendChild(svgEl("path", Object.assign({ d: "M20 12a8 8 0 0 1-13.7 5.6L4 16" }, opts)));
    svg.appendChild(svgEl("path", Object.assign({ d: "M4 20v-4h4" }, opts)));
    return svg;
  }

  function makeGearIcon() {
    const svg = svgEl("svg", { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" });
    const line = { stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" };
    const knobFill = "var(--vscode-input-background, #1e1e1e)";
    svg.appendChild(svgEl("line", Object.assign({ x1: "4", y1: "8", x2: "20", y2: "8" }, line)));
    svg.appendChild(svgEl("line", Object.assign({ x1: "4", y1: "16", x2: "20", y2: "16" }, line)));
    svg.appendChild(svgEl("circle", { cx: "9", cy: "8", r: "2.6", fill: knobFill, stroke: "currentColor", "stroke-width": "2" }));
    svg.appendChild(svgEl("circle", { cx: "15", cy: "16", r: "2.6", fill: knobFill, stroke: "currentColor", "stroke-width": "2" }));
    return svg;
  }

  function buildDrawer() {
    // —— 提示词管理 ——
    const pAdd = h("button", { class: "cmf-mini", type: "button" }, "+ 新增");
    const pTitle = h("div", { class: "cmf-drawer-title" }, h("span", null, "常用提示词"), h("span", { class: "cmf-spacer" }), pAdd);
    const plist = h("div", { class: "cmf-plist" });

    const pName = h("input", { class: "cmf-field", type: "text", placeholder: "名称" });
    const pContent = h("textarea", { class: "cmf-field cmf-ta", rows: "3", placeholder: "提示词内容" });
    const pSave = h("button", { class: "cmf-mini primary", type: "button" }, "保存");
    const pCancel = h("button", { class: "cmf-mini", type: "button" }, "取消");
    const pEdit = h("div", { class: "cmf-pedit" }, pName, pContent, h("div", { class: "cmf-pedit-actions" }, pCancel, pSave));
    pEdit.style.display = "none";

    // —— 自动提交 ——
    const asToggle = h("input", { class: "cmf-check", type: "checkbox" });
    const asTimeout = h("input", { class: "cmf-field cmf-num", type: "number", min: "5", max: "86400", step: "5" });
    const asSelect = h("select", { class: "cmf-port cmf-asselect", "aria-label": "自动提交提示词" });
    const asStatus = h("span", { class: "cmf-asstatus" }, "已停用");
    const asRow1 = h("label", { class: "cmf-asrow" }, asToggle, h("span", null, "启用自动提交"), h("span", { class: "cmf-spacer" }), asStatus);
    const asRow2 = h(
      "div",
      { class: "cmf-asrow" },
      h("span", { class: "cmf-aslbl" }, "超时(秒)"),
      asTimeout,
      h("span", { class: "cmf-aslbl" }, "提示词"),
      asSelect
    );

    const drawer = h(
      "div",
      { class: "cmf-drawer" },
      pTitle,
      plist,
      pEdit,
      h("div", { class: "cmf-drawer-title" }, h("span", null, "自动提交")),
      asRow1,
      asRow2
    );
    drawer.style.display = "none";

    els.drawer = drawer;
    els.plist = plist;
    els.pAdd = pAdd;
    els.pEdit = pEdit;
    els.pName = pName;
    els.pContent = pContent;
    els.pSave = pSave;
    els.pCancel = pCancel;
    els.asToggle = asToggle;
    els.asTimeout = asTimeout;
    els.asSelect = asSelect;
    els.asStatus = asStatus;

    return drawer;
  }

  function buildPanel() {
    // 隐藏的原生 <select> 仅作「数据载体」：继续承载当前选中 value 与 options 列表，
    // 让 fillPortOptions / connectSelectedPort 等既有读写逻辑（els.portSelect.value）保持不变；
    // 用户实际看到/交互的是下面的自定义触发按钮 + 浮层菜单（portBtn / portMenu）。
    const portSelect = h("select", { class: "cmf-port", "aria-hidden": "true", tabindex: "-1" });
    portSelect.style.display = "none";
    els.portSelect = portSelect;
    fillPortOptions(defaultPorts(), String(config.scanStart));

    const portBtnText = h("span", { class: "cmf-portbtn-text" }, "Port " + config.scanStart);
    const portBtn = h(
      "button",
      {
        class: "cmf-portbtn",
        type: "button",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
        "aria-label": "选择 MCP 前端端口",
        title: "选择 MCP 前端端口",
      },
      portBtnText
    );
    const portMenu = h("div", { class: "cmf-portmenu", role: "listbox" });
    portMenu.style.display = "none";
    const portWrap = h("div", { class: "cmf-portwrap" }, portBtn, portMenu, portSelect);
    els.portBtn = portBtn;
    els.portBtnText = portBtnText;
    els.portMenu = portMenu;
    els.portWrap = portWrap;

    const customInput = h("input", {
      class: "cmf-custom",
      type: "text",
      inputmode: "numeric",
      maxlength: "5",
      placeholder: "端口号",
      "aria-label": "自定义 MCP 端口",
    });
    customInput.style.display = "none";

    const scanBtn = h(
      "button",
      {
        class: "cmf-scan",
        type: "button",
        "aria-label": "扫描端口",
        title: "扫描端口 " + config.scanStart + "–" + (config.scanStart + config.scanCount - 1),
      },
      makeScanIcon()
    );

    const status = h("span", { class: "cmf-status", "aria-live": "polite" });
    status.appendChild(h("span", { class: "cmf-spinner", "aria-hidden": "true" }));

    const projectName = h("span", { class: "cmf-project", title: "" }, "No project");

    const gear = h(
      "button",
      { class: "cmf-scan cmf-gear", type: "button", "aria-label": "配置", title: "配置（提示词 / 自动提交）" },
      makeGearIcon()
    );

    const head = h(
      "div",
      { class: "cmf-head" },
      h("span", { class: "cmf-badge" }, "MCP"),
      status,
      h("span", { class: "cmf-spacer" }),
      scanBtn,
      portWrap,
      customInput,
      projectName,
      gear
    );

    const prompt = h("textarea", { class: "cmf-input", rows: "1", placeholder: "Add a follow-up" });

    const sendIcon = svgEl("svg", { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" });
    sendIcon.appendChild(svgEl("path", { d: "M5 12h13", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round" }));
    sendIcon.appendChild(
      svgEl("path", {
        d: "M13 6l6 6-6 6",
        stroke: "currentColor",
        "stroke-width": "2.2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    );

    const sendBtn = h(
      "button",
      { class: "cmf-send", type: "button", disabled: "", "aria-label": "Send feedback", title: "Send feedback" },
      sendIcon
    );

    const promptSelect = h("select", { class: "cmf-port cmf-prompts", "aria-label": "常用提示词", title: "插入常用提示词" });
    promptSelect.appendChild(h("option", { value: "" }, "常用提示词…"));
    promptSelect.style.display = "none";

    const promptRefresh = h(
      "button",
      { class: "cmf-scan cmf-refresh", type: "button", "aria-label": "刷新配置", title: "刷新常用提示词 / 配置" },
      makeRefreshIcon()
    );

    const asCount = h("span", { class: "cmf-ascount", title: "自动提交倒计时（点击取消）" }, "");
    asCount.style.display = "none";

    const foot = h("div", { class: "cmf-foot" }, promptSelect, promptRefresh, h("span", { class: "cmf-spacer" }), asCount, sendBtn);

    const drawer = buildDrawer();

    const panel = h("section", { id: config.panelId, "aria-label": "MCP follow-up composer" }, head, drawer, prompt, foot);

    els.panel = panel;
    els.gear = gear;
    els.status = status;
    els.portSelect = portSelect;
    els.customInput = customInput;
    els.scanBtn = scanBtn;
    els.projectName = projectName;
    els.prompt = prompt;
    els.sendBtn = sendBtn;
    els.sendIcon = sendIcon;
    els.promptSelect = promptSelect;
    els.promptRefresh = promptRefresh;
    els.asCount = asCount;
    // 状态文本已从面板移除；游离占位元素让现有状态写入成为无害空操作。
    els.hint = document.createElement("span");

    updatePortButton();
    wireEvents();
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findBar() {
    const bars = Array.from(document.querySelectorAll(".composer-bar")).filter(visible);
    bars.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return bars[0] || null;
  }

  function findInputArea(bar) {
    const fib = bar.querySelector(".full-input-box, .composer-input-blur-wrapper");
    if (!fib) return null;
    let cur = fib;
    while (cur && cur.parentElement && cur.parentElement !== bar) {
      cur = cur.parentElement;
    }
    return cur && cur.parentElement === bar ? cur : null;
  }

  function ensureMounted() {
    const bar = findBar();
    if (!bar) {
      state.mounted = false;
      return;
    }

    const inputArea = findInputArea(bar);
    if (!inputArea) {
      state.mounted = false;
      return;
    }

    if (els.panel.parentElement === bar && els.panel.nextElementSibling === inputArea) {
      state.mounted = true;
      return;
    }

    bar.insertBefore(els.panel, inputArea);
    state.mounted = true;
  }

  function basename(dir) {
    return (
      String(dir || "")
        .split(/[\\/]/)
        .filter(Boolean)
        .pop() || ""
    );
  }

  // 路径规范化：统一分隔符并去掉尾部斜杠，便于和 session 的 project_directory 精确比较。
  function normalizePath(dir) {
    return String(dir || "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
  }

  // 当前 Cursor 窗口的工作区绝对路径，取自原生 window.vscode（无需额外注入信息）。
  // 取不到（多根工作区 / 空窗口 / 接口缺失）时返回 null，调用方据此降级为原有端口选择逻辑。
  function getWorkspacePath() {
    try {
      const ctx = window.vscode && window.vscode.context;
      const cfg = ctx && typeof ctx.configuration === "function" ? ctx.configuration() : null;
      const uri = cfg && cfg.workspace && cfg.workspace.uri;
      const p = uri && (uri.path || uri.fsPath || uri._fsPath);
      return p ? normalizePath(p) : null;
    } catch (error) {
      return null;
    }
  }

  // 在 server 进程里读「窗口真实工作区」的命令：WORKSPACE_FOLDER_PATHS / CURSOR_WORKSPACE_LABEL 由 Cursor 注入，
  // 不受 AI 传入的 project_directory 影响。用单个 print 表达式（不含 ';'）+ chr(10) 分隔（不含 '|'），
  // 规避服务端 _safe_parse_command 的危险子串过滤。
  function buildWorkspaceProbeCmd() {
    const code =
      "print(__import__('os').environ.get('WORKSPACE_FOLDER_PATHS','')+chr(10)+__import__('os').environ.get('CURSOR_WORKSPACE_LABEL',''))";
    return config.pyCmd + ' -c "' + code + '"';
  }

  // WORKSPACE_FOLDER_PATHS 可能含多个路径（多根工作区）；按常见分隔符拆开后看是否包含当前工作区。
  function matchFolders(folders, ws) {
    if (!folders || !ws) return false;
    return String(folders)
      .split(/[:;,\n]/)
      .map((s) => normalizePath(s))
      .filter(Boolean)
      .includes(ws);
  }

  // 端口是否属于「当前窗口」：优先用 WORKSPACE_FOLDER_PATHS（完整路径），其次用 CURSOR_WORKSPACE_LABEL（项目名）。
  function isPortMine(port, ws) {
    if (!ws) return false;
    if (matchFolders(state.portWorkspaces[port], ws)) return true;
    const label = state.portLabels[port];
    return !!(label && label === basename(ws));
  }

  // 从一轮扫描结果里挑出「属于当前窗口」的端口：主用 WORKSPACE_FOLDER_PATHS，次用 CURSOR_WORKSPACE_LABEL。
  function pickWorkspacePort(results) {
    const ws = getWorkspacePath();
    if (!ws) return null;
    const wsLabel = basename(ws);
    let hit = results.find((r) => r.alive && matchFolders(r.workspaceFolders, ws));
    if (hit) return String(hit.port);
    hit = results.find((r) => r.alive && r.workspaceLabel && r.workspaceLabel === wsLabel);
    return hit ? String(hit.port) : null;
  }

  // 选项文本：Port {port}[ · 状态][ · 项目名]（状态在前、项目在后）。
  // 下拉展开时所有项都带「状态 · 项目名」，便于按项目/状态区分端口；
  // 收起时框里显示的是「选中项」，为避免与右侧项目名重复，选中项收起时不带项目名。
  function portText(port, status, withProject) {
    let text = "Port " + port;
    if (status) text += " · " + status;
    if (withProject) {
      const project = state.portProjects[String(port)];
      if (project) text += " · " + project;
    }
    return text;
  }

  // 收起时所有选项都不带项目名，让 select 宽度贴合短文字（避免「文字短框长」）；
  // 展开时所有选项带上项目名，下拉列表自然变宽以完整显示。
  function refreshOptionLabels() {
    const selected = els.portSelect.value;
    for (const option of Array.from(els.portSelect.options)) {
      if (option.value === config.customValue) continue;
      const isSelected = option.value === selected;
      const status = isSelected ? state.selectedStatus : state.portStatuses[option.value] || null;
      option.textContent = portText(option.value, status, state.expanded);
    }
    updatePortButton();
  }

  function setOptionLabel(port, status) {
    if (String(port) === els.portSelect.value) state.selectedStatus = status;
    refreshOptionLabels();
  }

  // ———————————————————— 自定义端口下拉 ————————————————————
  // 触发按钮文字 = 当前选中端口（带状态、不带项目名；项目名在右侧 projectName 单独显示）。
  function updatePortButton() {
    if (!els.portBtnText) return;
    const cur = els.portSelect.value;
    els.portBtnText.textContent =
      cur === config.customValue ? "自定义端口…" : portText(cur, state.selectedStatus, false);
  }

  // 渲染浮层菜单：扫描中显示「扫描中…」，否则按最新 foundPorts 列出可用端口（带状态·项目名）+「自定义端口…」。
  // 关键：菜单仅在「打开瞬间」与「扫描完成时」各渲染一次，渲染后保持稳定 —— 自定义 div 不会像原生 <select>
  // 那样在用户点击瞬间因重建 DOM 而打断点选，因此点选即时生效、无打断、无闪。
  function renderPortMenu(opts) {
    if (!els.portMenu) return;
    const loading = !!(opts && opts.loading) || state.scanning;
    clear(els.portMenu);
    if (loading) {
      els.portMenu.appendChild(
        h(
          "div",
          { class: "cmf-menuhint" },
          h("span", { class: "cmf-spinner", "aria-hidden": "true" }),
          h("span", null, "扫描中…")
        )
      );
      return;
    }
    const cur = els.portSelect.value;
    const ports = state.foundPorts.length ? state.foundPorts.map(String) : defaultPorts();
    for (const p of ports) {
      const status = p === cur ? state.selectedStatus : state.portStatuses[p] || null;
      const item = h("div", { class: "cmf-opt" + (p === cur ? " sel" : ""), role: "option" }, portText(p, status, true));
      item.addEventListener("click", () => selectPort(p));
      els.portMenu.appendChild(item);
    }
    const customItem = h("div", { class: "cmf-opt cmf-opt-custom", role: "option" }, "自定义端口…");
    customItem.addEventListener("click", selectCustom);
    els.portMenu.appendChild(customItem);
  }

  // 打开菜单：先显示「扫描中…」，按需扫一次，扫完用最新结果填充并展示（满足「先扫描→填充→再展示」）。
  async function openPortMenu() {
    if (state.expanded) return;
    state.expanded = true;
    els.portMenu.style.display = "";
    els.portBtn.classList.add("open");
    els.portBtn.setAttribute("aria-expanded", "true");
    renderPortMenu({ loading: true });
    await scanPorts({ refreshOnly: true });
    if (state.expanded) renderPortMenu();
  }

  function closePortMenu() {
    state.expanded = false;
    if (els.portMenu) els.portMenu.style.display = "none";
    if (els.portBtn) {
      els.portBtn.classList.remove("open");
      els.portBtn.setAttribute("aria-expanded", "false");
    }
  }

  function togglePortMenu() {
    if (state.expanded) closePortMenu();
    else openPortMenu();
  }

  // 点选某端口：写回隐藏 select 的 value，关菜单，刷新按钮，再走既有连接逻辑（onPortChange）。
  function selectPort(port) {
    const v = String(port);
    // 关键：浮层从 foundPorts 渲染，可能领先于隐藏 select 的 options；先补齐再赋值，
    // 否则原生 <select> 对不存在的 value 会静默置空，导致连空端口 → offline。
    ensurePortOption(v);
    els.portSelect.value = v;
    closePortMenu();
    updatePortButton();
    onPortChange();
  }

  function selectCustom() {
    els.portSelect.value = config.customValue;
    closePortMenu();
    updatePortButton();
    onPortChange();
  }

  function deriveStatusLabel(info) {
    if (!info) return "";
    if (info.feedback_completed === true || info.status === "feedback_submitted" || info.status === "completed") {
      return "AI processing";
    }
    if (info.status === "active" || info.project_directory) return "waiting";
    return "";
  }

  function sessionTitle(data) {
    const name = basename(data && data.project_directory);
    return name ? " · " + name : "";
  }

  function updateProjectName(data) {
    const dir = data && data.project_directory ? data.project_directory : "";
    els.projectName.textContent = basename(dir) || "No project";
    els.projectName.title = dir || "";
  }

  function setVisualState(stateName, message) {
    const port = els.portSelect.value;
    state.currentState = stateName;

    if (stateName === "ready") {
      setStatus("ready");
      setSendReady(true);
      els.hint.textContent = message || port + sessionTitle(state.currentSession) + " · waiting";
    } else if (stateName === "connecting") {
      setStatus("spinner");
      setSendReady(false);
      els.hint.textContent = message || port + " 正在连接 MCP WebSocket。";
    } else if (stateName === "processing") {
      setStatus("spinner");
      setSendReady(false);
      els.hint.textContent = message || port + " 反馈已提交，等待 AI 下一次调用。";
    } else {
      setStatus("offline");
      setSendReady(false);
      els.hint.textContent = message || port + " 当前没有可用的 MCP feedback session。";
    }

    updateSendEnabled();

    // 自动提交：仅「等待反馈」时倒计时；离开该状态视为新一轮，清除用户打断标记并取消倒计时。
    if (stateName === "ready") {
      reevaluateAutoSubmit();
    } else {
      state.autoSubmitSuppressed = false;
      cancelAutoSubmit();
    }
  }

  function applySession(info) {
    state.currentSession = info || null;
    updateProjectName(info);

    // 首次拿到有效会话时拉取一次常用提示词（loadPrompts 内有守卫，仅执行一次）。
    if (info && info.project_directory) loadPrompts();

    const project = basename(info && info.project_directory);
    if (project) state.portProjects[state.socketPort] = project;
    state.portStatuses[state.socketPort] = deriveStatusLabel(info);

    const status = info && info.status;
    const completed = info && info.feedback_completed === true;

    if (status === "feedback_submitted" || status === "completed" || completed) {
      setOptionLabel(state.socketPort, "AI processing");
      setVisualState("processing", state.socketPort + " 反馈已提交，等待 AI 下一次调用。");
      return;
    }

    setOptionLabel(state.socketPort, "waiting");
    const summary = info && info.summary ? String(info.summary).replace(/\s+/g, " ").trim() : "";
    setVisualState(
      "ready",
      summary ? "待回复 · " + summary.slice(0, 60) : state.socketPort + sessionTitle(info) + " · waiting"
    );

    if (state.wantSend && els.prompt.value.trim()) {
      sendFeedback(els.prompt.value.trim());
    }
  }

  function handleSocketMessage(data) {
    if (data.type === "connection_established") {
      els.hint.textContent = state.socketPort + " 已连接，等待会话状态。";
      return;
    }

    // 仅在我们主动用 run_command 拉取提示词期间（cmdBuffer 非 null）收集命令输出。
    if (data.type === "command_output") {
      if (state.cmdBuffer !== null) state.cmdBuffer += data.output || "";
      return;
    }
    if (data.type === "command_complete") {
      if (state.cmdBuffer !== null) finishLoadPrompts();
      else if (state.writing) onWriteComplete(data.exit_code);
      return;
    }
    if (data.type === "command_error") {
      if (state.cmdBuffer !== null) {
        state.cmdBuffer = null;
        state.loadingPrompts = false;
        if (els.promptRefresh) els.promptRefresh.classList.remove("scanning");
      }
      state.writing = false;
      return;
    }

    if (data.type === "session_updated") {
      applySession(data.session_info || {});
      return;
    }

    if (data.type === "status_update") {
      applySession(data.status_info || {});
      return;
    }

    if (data.type === "notification") {
      if (data.code === "session.feedbackSubmitted" || data.status === "feedback_submitted") {
        setOptionLabel(state.socketPort, "AI processing");
        setVisualState("processing", state.socketPort + " 反馈已提交，等待 AI 下一次调用。");
      }
    }
  }

  // 办法①：借道当前 WS 的 run_command 让服务端 cat ui_settings.json，从命令输出里取常用提示词。
  // 仅首次拿到活跃会话时拉取一次并缓存（低频，不重复触发）。
  function loadPrompts() {
    if (state.promptsLoaded || state.loadingPrompts) return;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (config.settingsPath.indexOf("__MCP_") === 0) return; // 占位符未被注入脚本替换

    state.loadingPrompts = true;
    state.cmdBuffer = "";
    if (els.promptRefresh) els.promptRefresh.classList.add("scanning");
    try {
      // 读取命令由注入脚本按平台生成（Mac/Linux: cat；Windows: python -X utf8 读取）。
      state.socket.send(JSON.stringify({ type: "run_command", command: config.readCmd }));
    } catch (error) {
      state.loadingPrompts = false;
      state.cmdBuffer = null;
      if (els.promptRefresh) els.promptRefresh.classList.remove("scanning");
      return;
    }
    // 兜底：服务端若未推 command_complete，超时后用已收集内容尝试解析。
    window.setTimeout(() => {
      if (state.loadingPrompts) finishLoadPrompts();
    }, config.promptLoadTimeoutMs);
  }

  function finishLoadPrompts() {
    const raw = state.cmdBuffer;
    state.cmdBuffer = null;
    state.loadingPrompts = false;
    if (els.promptRefresh) els.promptRefresh.classList.remove("scanning");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      state.settings = data && typeof data === "object" ? data : {};
      const list = (state.settings.promptSettings && state.settings.promptSettings.prompts) || [];
      state.prompts = Array.isArray(list) ? list : [];
      state.promptsLoaded = true;
      fillPromptOptions();
      renderPromptList();
      syncAutoSubmitUI();
      reevaluateAutoSubmit();
    } catch (error) {
      // 解析失败（如输出被截断），保持未加载状态，下次会话仍可重试。
    }
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // 写回 ui_settings.json：ws_b64 方案——python 单表达式 base64 解码写文件，过黑名单、保留全部配置。
  function writeSettings(mutator) {
    if (!state.settings) return false;
    if (state.writing) return false;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      setVisualState(state.currentState, els.portSelect.value + " 未连接到会话，无法保存配置。");
      return false;
    }
    if (config.settingsPath.indexOf("__MCP_") === 0) return false;
    try {
      mutator(state.settings);
    } catch (error) {
      return false;
    }

    // 服务端 _safe_parse_command 会对整条命令（小写）做危险子串匹配，base64 字母表恰好可拼出
    // "format"/"fdisk" 等模式（极小概率）。命中则向 JSON 追加空白改变尾部后重算 base64 重试。
    const dangerous = [";", "&&", "||", "|", ">", "<", "`", "$(", "rm -rf", "del /f", "format", "fdisk"];
    let payload;
    try {
      payload = JSON.stringify(state.settings, null, 2);
    } catch (error) {
      return false;
    }
    let command = "";
    let safe = false;
    for (let attempt = 0; attempt < 8 && !safe; attempt++) {
      const b64 = utf8ToBase64(payload);
      const py =
        "__import__('pathlib').Path('" +
        config.settingsPath +
        "').write_bytes(__import__('base64').b64decode('" +
        b64 +
        "'))";
      command = config.pyCmd + ' -c "' + py + '"';
      const lower = command.toLowerCase();
      safe = dangerous.every((p) => lower.indexOf(p) === -1);
      if (!safe) payload += "\n";
    }
    if (!safe) return false;

    state.writing = true;
    try {
      state.socket.send(JSON.stringify({ type: "run_command", command: command }));
    } catch (error) {
      state.writing = false;
      return false;
    }
    return true;
  }

  function onWriteComplete(exitCode) {
    state.writing = false;
    if (exitCode === 0) {
      // 写成功后本地 state.settings 即为最新内容；同步 prompts 引用并刷新依赖它的 UI。
      state.prompts =
        (state.settings && state.settings.promptSettings && state.settings.promptSettings.prompts) || [];
      fillPromptOptions();
      renderPromptList();
      syncAutoSubmitUI();
      reevaluateAutoSubmit();
    }
  }

  function fillPromptOptions() {
    if (!els.promptSelect) return;
    clear(els.promptSelect);
    els.promptSelect.appendChild(h("option", { value: "" }, "常用提示词…"));
    for (let i = 0; i < state.prompts.length; i++) {
      const p = state.prompts[i];
      if (!p || !p.content) continue;
      els.promptSelect.appendChild(h("option", { value: String(i) }, p.name || "未命名"));
    }
    els.promptSelect.value = "";
    els.promptSelect.style.display = state.prompts.length ? "" : "none";
  }

  function onPromptPick() {
    suppressAutoSubmit();
    const idx = Number(els.promptSelect.value);
    els.promptSelect.value = "";
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.prompts.length) return;
    const content = state.prompts[idx] && state.prompts[idx].content;
    if (!content) return;

    // 追加填入：已有内容则换行后追加。
    const cur = els.prompt.value;
    els.prompt.value = cur && cur.trim() ? cur.replace(/\s*$/, "") + "\n" + content : content;
    autoResize();
    updateSendEnabled();
    els.prompt.focus();
  }

  // 手动刷新：清除缓存标记并重新经 WS 拉取一次配置（提示词）。
  function refreshPrompts() {
    if (els.portSelect.value === config.customValue) return;
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      setVisualState(state.currentState, els.portSelect.value + " 未连接到会话，无法刷新配置。");
      return;
    }
    state.promptsLoaded = false;
    loadPrompts();
  }

  // ———————————————————— 配置抽屉：开关 ————————————————————
  function toggleDrawer() {
    state.drawerOpen = !state.drawerOpen;
    els.drawer.style.display = state.drawerOpen ? "" : "none";
    els.gear.classList.toggle("active", state.drawerOpen);
    if (state.drawerOpen) {
      closePromptEditor();
      // 抽屉打开但还没拉到配置时，尝试拉一次（需有活跃 WS）。
      if (!state.settings && !state.loadingPrompts) {
        state.promptsLoaded = false;
        loadPrompts();
      }
      renderPromptList();
      syncAutoSubmitUI();
    }
  }

  function ensurePromptSettings() {
    if (!state.settings) state.settings = {};
    const s = state.settings;
    if (!s.promptSettings || typeof s.promptSettings !== "object") {
      s.promptSettings = { prompts: [], lastUsedPromptId: "", promptCounter: 0 };
    }
    if (!Array.isArray(s.promptSettings.prompts)) s.promptSettings.prompts = [];
    return s.promptSettings;
  }

  function findPromptIndex(id) {
    const list = state.prompts || [];
    let idx = list.findIndex((x) => x && x.id === id);
    if (idx < 0 && /^\d+$/.test(String(id))) {
      const n = Number(id);
      if (n >= 0 && n < list.length) idx = n;
    }
    return idx;
  }

  // ———————————————————— 提示词列表与增删改 ————————————————————
  function renderPromptList() {
    if (!els.plist) return;
    clear(els.plist);
    const list = state.prompts || [];
    if (!list.length) {
      els.plist.appendChild(
        h("div", { class: "cmf-pempty" }, state.settings ? "暂无提示词，点右上「+ 新增」。" : "连接会话后自动加载…")
      );
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      const id = p.id || String(i);
      const name = h("span", { class: "cmf-pname", title: p.content || "" }, p.name || "未命名");
      const edit = h("button", { class: "cmf-pbtn", type: "button", "aria-label": "编辑", title: "编辑" }, "改");
      const del = h("button", { class: "cmf-pbtn", type: "button", "aria-label": "删除", title: "删除" }, "删");
      edit.addEventListener("click", () => openPromptEditor(id));
      del.addEventListener("click", () => deletePrompt(id));
      els.plist.appendChild(h("div", { class: "cmf-pitem" }, name, edit, del));
    }
  }

  function openPromptEditor(id) {
    state.editingId = id || null;
    let name = "";
    let content = "";
    if (id) {
      const idx = findPromptIndex(id);
      if (idx >= 0) {
        name = state.prompts[idx].name || "";
        content = state.prompts[idx].content || "";
      }
    }
    els.pName.value = name;
    els.pContent.value = content;
    els.pEdit.style.display = "";
    els.pName.focus();
  }

  function closePromptEditor() {
    state.editingId = null;
    if (els.pEdit) els.pEdit.style.display = "none";
    if (els.pName) els.pName.value = "";
    if (els.pContent) els.pContent.value = "";
  }

  function addPrompt(ps, name, content) {
    const counter = (Number(ps.promptCounter) || 0) + 1;
    ps.promptCounter = counter;
    ps.prompts.push({
      id: "prompt_" + counter + "_" + Date.now(),
      name: name || "未命名",
      content: content,
      createdAt: new Date().toISOString(),
      lastUsedAt: "",
      isAutoSubmit: false,
    });
  }

  function savePromptEditor() {
    if (!state.settings) return;
    const name = (els.pName.value || "").trim();
    const content = (els.pContent.value || "").trim();
    if (!content) {
      els.pContent.focus();
      return;
    }
    const editingId = state.editingId;
    const ok = writeSettings(() => {
      const ps = ensurePromptSettings();
      const idx = editingId ? findPromptIndex(editingId) : -1;
      if (idx >= 0) {
        ps.prompts[idx].name = name || ps.prompts[idx].name || "未命名";
        ps.prompts[idx].content = content;
        ps.prompts[idx].updatedAt = new Date().toISOString();
      } else {
        addPrompt(ps, name, content);
      }
    });
    if (ok) closePromptEditor();
  }

  function deletePrompt(id) {
    if (!state.settings) return;
    const idx = findPromptIndex(id);
    if (idx < 0) return;
    let proceed = true;
    try {
      proceed = window.confirm("删除提示词「" + (state.prompts[idx].name || "未命名") + "」？");
    } catch (error) {
      proceed = true;
    }
    if (!proceed) return;
    const ok = writeSettings(() => {
      const ps = ensurePromptSettings();
      const removed = ps.prompts.splice(idx, 1)[0];
      const rid = removed && removed.id;
      if (rid && state.settings.autoSubmitPromptId === rid) {
        state.settings.autoSubmitPromptId = "";
        state.settings.autoSubmitEnabled = false;
      }
      if (rid && ps.lastUsedPromptId === rid) ps.lastUsedPromptId = "";
    });
    if (ok && state.editingId === id) closePromptEditor();
  }

  // ———————————————————— 自动提交：配置 UI ————————————————————
  function syncAutoSubmitUI() {
    if (!els.asToggle) return;
    const s = state.settings || {};
    const enabled = s.autoSubmitEnabled === true;
    els.asToggle.checked = enabled;
    const timeout = Number(s.autoSubmitTimeout);
    els.asTimeout.value = Number.isFinite(timeout) && timeout > 0 ? String(timeout) : "300";

    clear(els.asSelect);
    els.asSelect.appendChild(h("option", { value: "" }, "（未选择）"));
    const list = state.prompts || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      els.asSelect.appendChild(h("option", { value: p.id || String(i) }, p.name || "未命名"));
    }
    els.asSelect.value = s.autoSubmitPromptId || "";

    const ready = !!getAutoSubmitPrompt();
    els.asStatus.textContent = ready ? "已启用" : enabled ? "已启用（未选提示词）" : "已停用";
    els.asStatus.classList.toggle("on", ready);
  }

  function onAutoSubmitToggle() {
    const checked = els.asToggle.checked;
    state.autoSubmitSuppressed = false;
    const ok = writeSettings((s) => {
      s.autoSubmitEnabled = checked;
    });
    if (!ok) syncAutoSubmitUI();
    else {
      syncAutoSubmitUI();
      reevaluateAutoSubmit();
    }
  }

  function onAutoSubmitTimeoutChange() {
    let v = Math.round(Number(els.asTimeout.value));
    if (!Number.isFinite(v)) v = 300;
    v = Math.max(5, Math.min(86400, v));
    els.asTimeout.value = String(v);
    state.autoSubmitSuppressed = false;
    const ok = writeSettings((s) => {
      s.autoSubmitTimeout = v;
    });
    if (!ok) syncAutoSubmitUI();
    else reevaluateAutoSubmit();
  }

  function onAutoSubmitSelect() {
    const id = els.asSelect.value;
    state.autoSubmitSuppressed = false;
    const ok = writeSettings((s) => {
      s.autoSubmitPromptId = id;
      const ps = ensurePromptSettings();
      for (let i = 0; i < ps.prompts.length; i++) {
        if (ps.prompts[i]) ps.prompts[i].isAutoSubmit = ps.prompts[i].id === id;
      }
    });
    syncAutoSubmitUI();
    if (ok) reevaluateAutoSubmit();
  }

  // ———————————————————— 自动提交：运行时 ————————————————————
  function getAutoSubmitPrompt() {
    const s = state.settings;
    if (!s || s.autoSubmitEnabled !== true || !s.autoSubmitPromptId) return null;
    const idx = findPromptIndex(s.autoSubmitPromptId);
    if (idx < 0) return null;
    const p = state.prompts[idx];
    return p && p.content ? p : null;
  }

  function fmtLeft(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? m + ":" + (s < 10 ? "0" + s : s) : s + "s";
  }

  function updateAsCount() {
    if (!els.asCount) return;
    if (state.autoSubmitTimer && state.autoSubmitLeft > 0) {
      els.asCount.textContent = "自动提交 " + fmtLeft(state.autoSubmitLeft);
      els.asCount.style.display = "";
    } else {
      els.asCount.textContent = "";
      els.asCount.style.display = "none";
    }
  }

  // 仅在「等待反馈」(ready) 且未被用户打断、配置就绪时倒计时；其余情况取消。
  function reevaluateAutoSubmit() {
    if (state.currentState === "ready" && !state.autoSubmitSuppressed && getAutoSubmitPrompt()) startAutoSubmit();
    else cancelAutoSubmit();
  }

  function startAutoSubmit() {
    const p = getAutoSubmitPrompt();
    if (!p) {
      cancelAutoSubmit();
      return;
    }
    // 已在为同一提示词倒计时则不重置（避免周期性重连刷新会话状态时反复归零）。
    if (state.autoSubmitTimer && state.asActiveId === p.id) return;
    if (state.autoSubmitTimer) {
      window.clearInterval(state.autoSubmitTimer);
      state.autoSubmitTimer = null;
    }
    const timeout = Math.max(5, Math.round(Number(state.settings.autoSubmitTimeout)) || 300);
    state.asActiveId = p.id;
    state.autoSubmitLeft = timeout;
    // 先建立计时器再刷新标签：updateAsCount 依赖 autoSubmitTimer 为真才显示。
    state.autoSubmitTimer = window.setInterval(() => {
      state.autoSubmitLeft -= 1;
      if (state.autoSubmitLeft <= 0) {
        fireAutoSubmit();
        return;
      }
      updateAsCount();
    }, 1000);
    updateAsCount();
  }

  function cancelAutoSubmit() {
    if (state.autoSubmitTimer) {
      window.clearInterval(state.autoSubmitTimer);
      state.autoSubmitTimer = null;
    }
    state.autoSubmitLeft = 0;
    state.asActiveId = null;
    updateAsCount();
  }

  // 用户介入（输入 / 手动插入提示词 / 手动发送 / 点倒计时）后，本轮不再自动提交。
  function suppressAutoSubmit() {
    state.autoSubmitSuppressed = true;
    cancelAutoSubmit();
  }

  function fireAutoSubmit() {
    const p = getAutoSubmitPrompt();
    cancelAutoSubmit();
    if (!p || !p.content) return;
    if (state.currentState !== "ready") return;
    if (els.portSelect.value === config.customValue) return;
    // 自动场景：以配置的提示词内容覆盖输入框后走与手动一致的发送流程（含重连抢占）。
    els.prompt.value = p.content;
    autoResize();
    updateSendEnabled();
    doSend();
  }

  // 浏览器内只能用 WebSocket 探测端口：连得上（或返回 4004「无 session」）即视为有 MCP 服务。
  // 连上后顺便读取会话的 project_directory，用于在下拉选项里显示项目名。
  function probePort(port, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      let opened = false;
      let project = "";
      let statusLabel = "";
      let workspaceFolders = "";
      let workspaceLabel = "";
      let cmdBuf = null;
      let needCmd = false;
      let ws = null;
      const finish = (alive) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        if (ws) {
          ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
          try {
            ws.close();
          } catch (error) {
            /* noop */
          }
        }
        resolve({ alive, project, statusLabel, workspaceFolders, workspaceLabel });
      };
      const timer = window.setTimeout(() => finish(opened), timeoutMs);
      try {
        ws = new WebSocket("ws://127.0.0.1:" + port + "/ws?lang=" + config.lang);
        ws.onopen = () => {
          opened = true;
          // 连上后用 run_command 读「窗口真实工作区」（不受 AI 传入的 project_directory 影响）。
          // pyCmd 占位符未被注入替换时跳过，退回靠 session_info 仅识别项目名。
          if (config.pyCmd.indexOf("__MCP_") !== 0) {
            cmdBuf = "";
            needCmd = true;
            try {
              ws.send(JSON.stringify({ type: "run_command", command: buildWorkspaceProbeCmd() }));
            } catch (error) {
              needCmd = false;
            }
          }
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const info = data.session_info || data.status_info;
            if (info && info.project_directory) {
              project = info.project_directory;
              statusLabel = deriveStatusLabel(info);
              // 没发探测命令时（占位符未替换），拿到会话即可结束。
              if (!needCmd) finish(true);
            }
            if (data.type === "command_output") {
              if (cmdBuf !== null) cmdBuf += data.output || "";
            }
            if (data.type === "command_complete" || data.type === "command_error") {
              const raw = (cmdBuf || "").replace(/\r/g, "");
              const nl = raw.indexOf("\n");
              if (nl >= 0) {
                workspaceFolders = raw.slice(0, nl).trim();
                workspaceLabel = raw.slice(nl + 1).trim();
              } else {
                workspaceFolders = raw.trim();
              }
              finish(true);
            }
          } catch (error) {
            /* noop */
          }
        };
        ws.onerror = () => finish(false);
        ws.onclose = (event) => finish(event.code === 4004 ? true : opened);
      } catch (error) {
        finish(false);
      }
    });
  }

  async function scanPorts(opts) {
    const refreshOnly = !!(opts && opts.refreshOnly);
    if (state.scanning) return;
    state.scanning = true;
    if (els.scanBtn) {
      els.scanBtn.classList.add("scanning");
      els.scanBtn.disabled = true;
    }

    const from = config.scanStart;
    const to = config.scanStart + config.scanCount - 1;
    els.hint.textContent = "正在扫描端口 " + from + "–" + to + "…";

    const ports = defaultPorts();
    // 跳过探测「当前已连接的健康端口」：probe 会另建连接抢占服务端的「最后连接」，从而把面板自己挤下线。
    // 对已连端口直接用已知信息标记为活跃，保证下拉扫描/重扫不会断开当前会话。
    const curPort =
      state.socket && state.socket.readyState === WebSocket.OPEN ? String(state.socketPort) : null;
    const results = await Promise.all(
      ports.map((port) => {
        if (curPort && String(port) === curPort) {
          return Promise.resolve({
            port,
            alive: true,
            project: state.currentSession ? state.currentSession.project_directory : "",
            statusLabel: state.portStatuses[port] || state.selectedStatus || "",
            workspaceFolders: state.portWorkspaces[port] || "",
            workspaceLabel: state.portLabels[port] || "",
          });
        }
        return probePort(port, config.probeTimeoutMs).then((res) => ({
          port,
          alive: res.alive,
          project: res.project,
          statusLabel: res.statusLabel,
          workspaceFolders: res.workspaceFolders,
          workspaceLabel: res.workspaceLabel,
        }));
      })
    );
    const found = [];
    for (const item of results) {
      if (item.alive) {
        found.push(item.port);
        if (item.project) state.portProjects[item.port] = basename(item.project);
        else delete state.portProjects[item.port];
        if (item.workspaceFolders) state.portWorkspaces[item.port] = item.workspaceFolders;
        else delete state.portWorkspaces[item.port];
        if (item.workspaceLabel) state.portLabels[item.port] = item.workspaceLabel;
        else delete state.portLabels[item.port];
        if (item.statusLabel) state.portStatuses[item.port] = item.statusLabel;
        else delete state.portStatuses[item.port];
      } else {
        delete state.portProjects[item.port];
        delete state.portWorkspaces[item.port];
        delete state.portLabels[item.port];
        delete state.portStatuses[item.port];
      }
    }
    state.foundPorts = found;

    if (els.scanBtn) {
      els.scanBtn.classList.remove("scanning");
      els.scanBtn.disabled = false;
    }
    state.scanning = false;

    els.hint.textContent = found.length
      ? "扫描完成：发现活跃端口 " + found.join("、") + "。"
      : "扫描完成：" + from + "–" + to + " 未发现活跃 MCP 端口。";

    if (refreshOnly) {
      // 自定义下拉：先把本次扫到的端口补进隐藏 select（数据载体），保证点选时 value 设得上；
      // 菜单仍展开则用最新结果渲染浮层（渲染后保持稳定，点选即时生效、无打断、无闪）。
      found.forEach((p) => ensurePortOption(String(p)));
      if (state.expanded) renderPortMenu();
      return;
    }

    const wasCustom = els.portSelect.value === config.customValue;
    // 优先选中 project_directory 与当前窗口工作区相等的端口；取不到工作区或无匹配端口时维持原有选择
    //（combo 降级），连接层再由 connectSelectedPort 守卫兜底，避免连到别的项目。
    const preferred = pickWorkspacePort(results);
    fillPortOptions(found, preferred || (wasCustom ? null : els.portSelect.value));
    if (wasCustom && !preferred) els.portSelect.value = config.customValue;

    // 探测会短暂抢占连接，扫描结束后立即重连选中端口抢回「最后连接」。
    if (els.portSelect.value !== config.customValue) connectSelectedPort(false);
  }

  function showCustomInput() {
    els.customInput.style.display = "";
    els.customInput.value = "";
    els.customInput.focus();
    els.hint.textContent = "输入端口号后回车连接。";
  }

  function hideCustomInput() {
    els.customInput.style.display = "none";
  }

  function applyCustomPort() {
    const port = els.customInput.value.trim();
    if (!/^\d{2,5}$/.test(port)) {
      els.hint.textContent = "请输入有效的端口号（2–5 位数字）。";
      return;
    }
    let opt = Array.from(els.portSelect.options).find((item) => item.value === port);
    if (!opt) {
      opt = h("option", { value: port });
      const customOpt = Array.from(els.portSelect.options).find((item) => item.value === config.customValue);
      els.portSelect.insertBefore(opt, customOpt);
    }
    els.portSelect.value = port;
    hideCustomInput();
    connectSelectedPort(false);
  }

  function onPortChange() {
    state.expanded = false;
    if (els.portSelect.value === config.customValue) {
      showCustomInput();
    } else {
      hideCustomInput();
      connectSelectedPort(false);
    }
  }

  function connectSelectedPort(auto) {
    const port = els.portSelect.value;
    if (port === config.customValue) return;

    // 守卫：能确定当前窗口、且该端口已知属于别的窗口时不连接，
    // 避免误连到其它窗口的实例或常驻 feedback 实例（等本窗口端口被识别后由 refreshTick 重扫接管）。
    const ws = getWorkspacePath();
    const known = !!(state.portWorkspaces[port] || state.portLabels[port]);
    if (ws && known && !isPortMine(port, ws)) {
      if (state.socket) {
        state.socket.onclose = null;
        state.socket.onerror = null;
        state.socket.onmessage = null;
        state.socket.close();
        state.socket = null;
      }
      setOptionLabel(port, "other window");
      setVisualState("offline", port + " 属于其它窗口，等待本窗口的 MCP 会话…");
      return;
    }

    const seq = ++state.connectSeq;

    if (state.socket) {
      state.socket.onclose = null;
      state.socket.onerror = null;
      state.socket.onmessage = null;
      state.socket.close();
    }

    state.socket = null;
    state.socketPort = port;

    if (!auto) {
      state.currentSession = null;
      updateProjectName(null);
      setOptionLabel(port, "connecting");
      setVisualState("connecting", port + " 正在连接 MCP WebSocket。");
    }

    try {
      const nextSocket = new WebSocket("ws://127.0.0.1:" + port + "/ws?lang=" + config.lang);
      state.socket = nextSocket;

      nextSocket.onopen = () => {
        if (seq !== state.connectSeq) return;
        els.hint.textContent = port + " WebSocket 已打开，等待 MCP 返回会话状态。";
        // 发送场景：重连成功即已是「最后连接」。优先等服务端推送会话状态由 applySession 发送；
        // 若短时间内未推送，则兜底直接发送，避免卡在「正在重连」。
        if (state.wantSend && els.prompt.value.trim()) {
          window.setTimeout(() => {
            if (
              seq === state.connectSeq &&
              state.wantSend &&
              state.socket &&
              state.socket.readyState === WebSocket.OPEN &&
              els.prompt.value.trim()
            ) {
              sendFeedback(els.prompt.value.trim());
            }
          }, config.sendAfterOpenMs);
        }
      };

      nextSocket.onmessage = (event) => {
        if (seq !== state.connectSeq) return;
        try {
          handleSocketMessage(JSON.parse(event.data));
        } catch (error) {
          els.hint.textContent = port + " 收到无法解析的 MCP 消息。";
        }
      };

      nextSocket.onerror = () => {
        if (seq !== state.connectSeq) return;
        // 连接失败：端口很可能已关闭或换了端口（实例重启），清除其归属缓存，
        // 让 refreshTick 退避重扫去发现新的本窗口端口，而不是一直重连这个死端口。
        delete state.portWorkspaces[port];
        delete state.portLabels[port];
        setOptionLabel(port, "offline");
        setVisualState("offline", port + " 连接失败，可能端口未启动或没有 MCP WebUI。");
      };

      nextSocket.onclose = (event) => {
        if (seq !== state.connectSeq) return;
        state.socket = null;
        if (state.currentState === "processing") return;
        setOptionLabel(port, event.code === 4004 ? "no session" : "offline");
        setVisualState(
          "offline",
          event.code === 4004
            ? port + " 已连接到 MCP，但当前没有 active session。"
            : port + " WebSocket 已断开。"
        );
      };
    } catch (error) {
      setOptionLabel(port, "offline");
      setVisualState("offline", port + " 无法创建 WebSocket 连接。");
    }
  }

  // 服务端是「最后连接优先」模型：每个连接绑定其建立时的 session，且只向最后连接推送。
  // 因此面板必须持续保持为「最后连接」，否则会收不到新会话、提交也会作用到已失效的旧会话。
  // 定期重连以抢占活跃连接并同步当前会话；仅在用户正在输入时不打断（输入期间一般无其他端抢占）。
  function refreshTick() {
    if (state.scanning) return;
    if (els.portSelect.value === config.customValue) return;
    if (els.customInput === document.activeElement) return;
    if (els.prompt === document.activeElement && els.prompt.value.trim()) return;

    // 不做后台扫描（扫描仅发生在启动时与下拉展开期间）。这里只保持连接：
    // 已连且健康 → 发 heartbeat 维持「最后连接」；否则重连选中端口（守卫会拦掉别窗口端口；
    // 端口已关时 onerror 会清归属并置 offline，等待用户展开下拉重新选择本窗口端口）。
    if (
      state.socket &&
      state.socket.readyState === WebSocket.OPEN &&
      state.socketPort === els.portSelect.value
    ) {
      try {
        state.socket.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
      } catch (error) {
        /* 发送失败则下个周期走重连 */
      }
      return;
    }

    connectSelectedPort(true);
  }

  function autoResize() {
    els.prompt.style.height = "auto";
    els.prompt.style.height = Math.min(els.prompt.scrollHeight, 160) + "px";
  }

  function sendFeedback(text) {
    state.socket.send(
      JSON.stringify({
        type: "submit_feedback",
        feedback: text,
        images: [],
        settings: {},
      })
    );

    state.wantSend = false;
    els.prompt.value = "";
    autoResize();
    updateSendEnabled();
    setOptionLabel(els.portSelect.value, "AI processing");
    setVisualState("processing", els.portSelect.value + " 已发送反馈，等待 MCP 返回给 AI。");
  }

  function doSend() {
    const text = els.prompt.value.trim();
    if (!text) {
      els.hint.textContent = "请输入反馈内容后再发送。";
      return;
    }
    if (els.portSelect.value === config.customValue) {
      els.hint.textContent = "请先选择端口或输入有效端口号。";
      return;
    }

    // 一旦发送（手动或自动触发后走到这里），本轮不再倒计时。
    state.autoSubmitSuppressed = true;
    cancelAutoSubmit();

    // MCP 是「最后连接优先」模型：本地 socket 即使仍是 OPEN，服务端的活跃连接也可能已被
    // 其他客户端（WebUI / 其他面板）顶掉，此时直接发会作用到已失效的会话，表现为「总断」。
    // 因此发送前总是重连一次，抢回「最后连接」后再发（连上由 applySession / onopen 兜底触发）。
    state.wantSend = true;
    setVisualState("connecting", els.portSelect.value + " 正在重连，连上后自动发送…");
    connectSelectedPort(false);
  }

  function revertFromCustom() {
    els.customInput.value = "";
    hideCustomInput();
    if (els.portSelect.value === config.customValue) {
      const first = Array.from(els.portSelect.options).find((item) => item.value !== config.customValue);
      if (first) {
        els.portSelect.value = first.value;
        connectSelectedPort(false);
      }
    }
  }

  function wireEvents() {
    // 自定义端口下拉：点按钮开/关；打开即「扫描中→填充→展示」；点选即时生效（见 selectPort / selectCustom）。
    els.portBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePortMenu();
    });
    // 点击按钮与浮层之外的区域、或按 Esc 关闭菜单。
    state.onDocPointerDown = (event) => {
      if (!state.expanded) return;
      if (els.portWrap && els.portWrap.contains(event.target)) return;
      closePortMenu();
    };
    document.addEventListener("mousedown", state.onDocPointerDown, true);
    state.onDocKeydown = (event) => {
      if (state.expanded && event.key === "Escape") closePortMenu();
    };
    document.addEventListener("keydown", state.onDocKeydown, true);
    els.scanBtn.addEventListener("click", () => {
      scanPorts();
    });
    els.customInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        applyCustomPort();
      } else if (event.key === "Escape") {
        event.preventDefault();
        revertFromCustom();
      }
    });
    els.customInput.addEventListener("blur", () => {
      if (/^\d{2,5}$/.test(els.customInput.value.trim())) applyCustomPort();
      else revertFromCustom();
    });
    els.promptSelect.addEventListener("change", onPromptPick);
    els.promptRefresh.addEventListener("click", refreshPrompts);
    els.sendBtn.addEventListener("click", doSend);

    // 配置抽屉：齿轮开关 + 提示词增删改 + 自动提交配置。
    els.gear.addEventListener("click", toggleDrawer);
    els.pAdd.addEventListener("click", () => openPromptEditor(null));
    els.pSave.addEventListener("click", savePromptEditor);
    els.pCancel.addEventListener("click", closePromptEditor);
    els.asToggle.addEventListener("change", onAutoSubmitToggle);
    els.asTimeout.addEventListener("change", onAutoSubmitTimeoutChange);
    els.asSelect.addEventListener("change", onAutoSubmitSelect);
    els.asCount.addEventListener("click", suppressAutoSubmit);
    [els.pName, els.pContent].forEach((field) => {
      field.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          closePromptEditor();
        } else if ((event.key === "Enter" || event.code === "Enter") && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          savePromptEditor();
        }
      });
    });

    els.prompt.addEventListener("input", () => {
      autoResize();
      updateSendEnabled();
      suppressAutoSubmit();
    });
    els.prompt.addEventListener("focus", () => {
      if (els.portSelect.value !== config.customValue) connectSelectedPort(true);
    });
    // 跟踪输入法组字状态：组字期间（含上屏候选词的回车）不触发发送。
    els.prompt.addEventListener("compositionstart", () => {
      state.composing = true;
    });
    els.prompt.addEventListener("compositionend", () => {
      state.composing = false;
    });
    els.prompt.addEventListener("keydown", (event) => {
      event.stopPropagation();
      // 组字进行中的回车用于上屏（拼音/注音等），放行给输入法处理，不发送。
      if (state.composing || event.isComposing || event.keyCode === 229) return;
      if ((event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") && !event.shiftKey) {
        event.preventDefault();
        doSend();
      }
    });
  }

  function uninstall() {
    cancelAutoSubmit();
    if (state.onDocPointerDown) document.removeEventListener("mousedown", state.onDocPointerDown, true);
    if (state.onDocKeydown) document.removeEventListener("keydown", state.onDocKeydown, true);
    for (const timer of state.timers) {
      window.clearInterval(timer);
    }
    state.timers = [];

    if (state.socket) {
      state.socket.onclose = null;
      state.socket.onerror = null;
      state.socket.onmessage = null;
      try {
        state.socket.close();
      } catch (error) {
        /* noop */
      }
      state.socket = null;
    }

    els.panel?.remove();
    document.getElementById(config.styleId)?.remove();
    delete window[NAME];
  }

  ensureStyle();
  buildPanel();
  ensureMounted();
  connectSelectedPort(false);
  scanPorts();

  state.timers.push(window.setInterval(ensureMounted, config.mountScanMs));
  state.timers.push(window.setInterval(refreshTick, config.reconnectMs));

  window[NAME] = {
    config,
    state,
    remount: ensureMounted,
    reconnect: () => connectSelectedPort(false),
    scan: scanPorts,
    toggleConfig: toggleDrawer,
    _reevalAutoSubmit: reevaluateAutoSubmit,
    uninstall,
    status() {
      return {
        installedAt: state.installedAt,
        mounted: state.mounted,
        socketPort: state.socketPort,
        currentState: state.currentState,
        currentSession: state.currentSession,
        scanning: state.scanning,
        foundPorts: state.foundPorts,
      };
    },
  };

  return window[NAME].status();
})();
