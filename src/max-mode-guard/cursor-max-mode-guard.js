(function installCursorMaxModeGuard() {
  const NAME = "__cursorMaxModeGuard";

  if (window[NAME] && typeof window[NAME].uninstall === "function") {
    window[NAME].uninstall();
  }

  const config = {
    scanMs: 300,
    sendDisableMs: 100,
    menuOpenCooldownMs: 1200,
    menuVerifyDelayMs: 180,
    verifiedOffTtlMs: 3000,
    loadedToastMs: 4000,
    borderId: "cursor-max-input-warning-border",
    loadedToastId: "cursor-max-mode-guard-loaded-toast",
    styleId: "cursor-max-input-warning-style",
  };

  const state = {
    installedAt: new Date().toISOString(),
    badgeSeen: false,
    composerHasText: false,
    warningBorder: false,
    sendBlocked: false,
    sendControlsSeen: 0,
    sendControlsDisabled: 0,
    sendControlsRestored: 0,
    lastMenuOpenAt: 0,
    lastMaxModeClickAt: 0,
    verifiedOffUntil: 0,
    verifyInProgress: false,
    last: null,
    lastSend: null,
    lastBlockedEvent: null,
    timers: [],
  };

  function norm(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function textOf(el) {
    return norm(el && el.textContent);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasComposerContext(el) {
    return Boolean(
      el.closest(".composer-bar, .aislash-editor, .full-input-box, .anysphere-markdown-container-root") ||
        el.closest("[class*='composer'], [class*='chat'], [class*='input']")
    );
  }

  function isStandaloneMaxBadge(el) {
    if (!visible(el) || textOf(el) !== "MAX") return false;
    if (el.closest("[role='menu'], [role='listbox'], .monaco-menu-container")) return false;

    const cls = String(el.className || "");
    if (cls.includes("ui-model-picker__trigger-max-badge")) return true;
    if (cls.includes("max-badge") && hasComposerContext(el)) return true;

    const trigger = el.closest("button, [role='button']");
    return Boolean(trigger && /model-picker|trigger|max/i.test(String(trigger.className || "")));
  }

  function findMaxBadge() {
    const preferred = Array.from(
      document.querySelectorAll(".ui-model-picker__trigger-max-badge, .ui-model-picker__trigger-max-badge-text")
    ).find(isStandaloneMaxBadge);
    if (preferred) return preferred;

    return Array.from(document.querySelectorAll("span, div, button"))
      .filter((el) => textOf(el) === "MAX")
      .find(isStandaloneMaxBadge) || null;
  }

  function composerHasText() {
    const candidates = Array.from(
      document.querySelectorAll(
        "textarea, [contenteditable='true'], [role='textbox'], .aislash-editor-input, .aislash-editor-placeholder"
      )
    ).filter((el) => visible(el) && hasComposerContext(el));

    return candidates.some((el) => {
      const value = "value" in el ? el.value : el.textContent;
      const text = norm(value)
        .replace(/^Plan, Build, \/ for skills, @ for context$/i, "")
        .replace(/^Ask, Build, .*$/i, "");
      return text.length > 0;
    });
  }

  function shouldBlockSendNow() {
    const badge = findMaxBadge();
    const hasText = composerHasText();
    state.badgeSeen = Boolean(badge);
    state.composerHasText = hasText;
    state.sendBlocked = Boolean(badge && hasText);
    return state.sendBlocked;
  }

  function findMaxModeRow() {
    const rows = Array.from(
      document.querySelectorAll(
        "[role='menuitemcheckbox'], [role='menuitem'], li, div, button"
      )
    );
    return rows.find((el) => visible(el) && textOf(el) === "MAX Mode") || null;
  }

  function rowIsOn(row) {
    return row && row.getAttribute("aria-checked") === "true";
  }

  function syntheticClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const target = hit && el.contains(hit) ? hit : el;
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      button: 0,
      buttons: 1,
      detail: 1,
    };

    if (typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }

    if (typeof PointerEvent === "function") {
      const pointer = {
        ...base,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        buttons: 1,
      };
      target.dispatchEvent(new PointerEvent("pointerover", pointer));
      target.dispatchEvent(new PointerEvent("pointerenter", pointer));
      target.dispatchEvent(new PointerEvent("pointermove", pointer));
      target.dispatchEvent(new PointerEvent("pointerdown", pointer));
      target.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    } else {
      target.dispatchEvent(new MouseEvent("pointerdown", base));
      target.dispatchEvent(new MouseEvent("pointerup", { ...base, buttons: 0 }));
    }

    target.dispatchEvent(new MouseEvent("mouseover", base));
    target.dispatchEvent(new MouseEvent("mousemove", base));
    target.dispatchEvent(new MouseEvent("mousedown", base));
    target.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));

    if (target !== el) {
      el.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
    }

    if (typeof target.click === "function") {
      target.click();
    }
  }

  function pressEscape() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
  }

  function markVerifiedOff(row) {
    const off = row && row.getAttribute("aria-checked") === "false";
    if (off) {
      state.verifiedOffUntil = Date.now() + config.verifiedOffTtlMs;
    }

    state.last = {
      step: "verify-max-mode-off",
      checked: row ? row.getAttribute("aria-checked") : null,
      off,
      at: new Date().toISOString(),
    };
  }

  function verifyMaxModeOff(row) {
    const current = findMaxModeRow() || (row && row.isConnected ? row : null);
    if (current) {
      markVerifiedOff(current);
      state.verifyInProgress = false;
      return;
    }

    const badge = findMaxBadge();
    if (!badge) {
      markVerifiedOff(null);
      state.verifyInProgress = false;
      return;
    }

    const trigger = badge.closest("button, [role='button']") || badge;
    syntheticClick(trigger);
    state.lastMenuOpenAt = Date.now();

    window.setTimeout(() => {
      const reopenedRow = findMaxModeRow();
      markVerifiedOff(reopenedRow);
      if (reopenedRow && reopenedRow.getAttribute("aria-checked") === "false") {
        pressEscape();
      }
      state.verifyInProgress = false;
    }, config.menuVerifyDelayMs);
  }

  function ensureMenuMaxModeOff() {
    if (state.verifyInProgress || Date.now() < state.verifiedOffUntil) return;

    const row = findMaxModeRow();
    if (row) {
      if (rowIsOn(row)) {
        syntheticClick(row);
        state.lastMaxModeClickAt = Date.now();
        state.verifyInProgress = true;
        state.last = {
          step: "clicked-max-mode-row-to-turn-off",
          checkedBefore: "true",
          at: new Date().toISOString(),
        };
        window.setTimeout(() => verifyMaxModeOff(row), config.menuVerifyDelayMs);
        return;
      }

      state.last = {
        step: "max-mode-already-off",
        checked: row.getAttribute("aria-checked"),
        at: new Date().toISOString(),
      };
      return;
    }

    const badge = findMaxBadge();
    const now = Date.now();
    if (!badge || now - state.lastMenuOpenAt < config.menuOpenCooldownMs) return;

    const trigger = badge.closest("button, [role='button']") || badge;
    syntheticClick(trigger);
    state.lastMenuOpenAt = now;
    state.last = {
      step: "clicked-badge-to-open-menu",
      at: new Date().toISOString(),
    };
  }

  function ensureBorderStyle() {
    if (document.getElementById(config.styleId)) return;

    const style = document.createElement("style");
    style.id = config.styleId;
    style.textContent = `
      #${config.borderId} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
      }

      #${config.borderId}::before {
        content: "";
        position: absolute;
        inset: 0;
        padding: 50px;
        background:
          radial-gradient(circle at 50% 50%, rgba(255, 40, 40, 0) 44%, rgba(255, 40, 40, .42) 66%, rgba(255, 30, 30, .9) 100%),
          linear-gradient(135deg, rgba(255, 42, 42, .95), rgba(255, 149, 0, .72), rgba(255, 0, 84, .95));
        -webkit-mask:
          linear-gradient(#000 0 0) content-box,
          linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
      }

      #${config.borderId}::after {
        content: "";
        position: absolute;
        inset: 50px;
        border-radius: 24px;
        box-shadow: inset 0 0 26px rgba(255, 35, 35, .52), 0 0 20px rgba(255, 35, 35, .28);
      }

      .cursor-max-send-disabled {
        pointer-events: none !important;
        cursor: not-allowed !important;
        opacity: .36 !important;
        filter: grayscale(1) !important;
      }

      #${config.loadedToastId} {
        position: fixed;
        right: 16px;
        bottom: 18px;
        z-index: 2147483647;
        max-width: min(360px, calc(100vw - 32px));
        padding: 9px 12px;
        border: 1px solid rgba(71, 207, 127, .45);
        border-radius: 8px;
        background: rgba(24, 28, 26, .92);
        color: rgba(238, 255, 244, .96);
        box-shadow: 0 8px 28px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .04);
        font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        pointer-events: none;
        opacity: 1;
        transform: translateY(0);
        transition: opacity .24s ease, transform .24s ease;
      }

      #${config.loadedToastId}[data-hiding="true"] {
        opacity: 0;
        transform: translateY(8px);
      }
    `;
    document.documentElement.appendChild(style);
  }

  function showLoadedToast() {
    ensureBorderStyle();

    const existing = document.getElementById(config.loadedToastId);
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = config.loadedToastId;
    toast.textContent = "Cursor Extension loaded";
    document.documentElement.appendChild(toast);

    const hideTimer = window.setTimeout(() => {
      toast.setAttribute("data-hiding", "true");
      const removeTimer = window.setTimeout(() => {
        toast.remove();
      }, 280);
      state.timers.push(removeTimer);
    }, config.loadedToastMs);

    state.timers.push(hideTimer);
  }

  function setWarningBorder(on) {
    ensureBorderStyle();
    let border = document.getElementById(config.borderId);

    if (on && !border) {
      border = document.createElement("div");
      border.id = config.borderId;
      document.documentElement.appendChild(border);
    } else if (!on && border) {
      border.remove();
    }

    state.warningBorder = Boolean(on);
  }

  function findSendControls() {
    return Array.from(
      document.querySelectorAll(".send-with-mode, [class*='send-with-mode'], [aria-label*='Send'], [title*='Send']")
    ).filter((el) => visible(el) && hasComposerContext(el));
  }

  function hardDisableSendControls() {
    const block = shouldBlockSendNow();
    const controls = findSendControls();
    state.sendControlsSeen = controls.length;

    let disabled = 0;
    let restored = 0;

    for (const el of controls) {
      if (block) {
        el.classList.add("cursor-max-send-disabled");
        el.setAttribute("aria-disabled", "true");
        el.setAttribute("data-cursor-max-send-disabled", "true");
        el.setAttribute("tabindex", "-1");
        disabled += 1;
      } else if (el.getAttribute("data-cursor-max-send-disabled") === "true") {
        el.classList.remove("cursor-max-send-disabled");
        el.removeAttribute("aria-disabled");
        el.removeAttribute("data-cursor-max-send-disabled");
        el.removeAttribute("tabindex");
        restored += 1;
      }
    }

    state.sendControlsDisabled = disabled;
    state.sendControlsRestored = restored;
    state.lastSend = {
      blocked: block,
      badgeSeen: state.badgeSeen,
      composerHasText: state.composerHasText,
      seen: controls.length,
      disabled,
      restored,
      at: new Date().toISOString(),
    };
  }

  function eventInsideComposer(event) {
    return Boolean(event.target && event.target.closest && hasComposerContext(event.target));
  }

  function blockEvent(event) {
    if (!shouldBlockSendNow()) return;

    const sendControl = event.target && event.target.closest && event.target.closest(".send-with-mode, [class*='send-with-mode']");
    const enterInComposer =
      event.type === "keydown" &&
      (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") &&
      !event.shiftKey &&
      eventInsideComposer(event);

    if (!sendControl && !enterInComposer) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    state.lastBlockedEvent = {
      type: event.type,
      key: event.key || null,
      code: event.code || null,
      targetClass: String((event.target && event.target.className) || ""),
      at: new Date().toISOString(),
    };
  }

  function scan() {
    const block = shouldBlockSendNow();
    setWarningBorder(block);

    if (state.badgeSeen) {
      ensureMenuMaxModeOff();
    }

    hardDisableSendControls();
  }

  function uninstall() {
    for (const timer of state.timers) {
      window.clearInterval(timer);
    }

    for (const type of ["pointerdown", "mousedown", "mouseup", "click", "keydown"]) {
      window.removeEventListener(type, blockEvent, true);
    }

    setWarningBorder(false);
    document.getElementById(config.loadedToastId)?.remove();
    for (const el of document.querySelectorAll("[data-cursor-max-send-disabled='true']")) {
      el.classList.remove("cursor-max-send-disabled");
      el.removeAttribute("aria-disabled");
      el.removeAttribute("data-cursor-max-send-disabled");
      el.removeAttribute("tabindex");
    }
  }

  for (const type of ["pointerdown", "mousedown", "mouseup", "click", "keydown"]) {
    window.addEventListener(type, blockEvent, true);
  }

  state.timers.push(window.setInterval(scan, config.scanMs));
  state.timers.push(window.setInterval(hardDisableSendControls, config.sendDisableMs));

  window[NAME] = {
    config,
    state,
    scan,
    ensureMenuMaxModeOff,
    uninstall,
    status() {
      return {
        installedAt: state.installedAt,
        badgeSeen: state.badgeSeen,
        composerHasText: state.composerHasText,
        warningBorder: state.warningBorder,
        sendBlocked: state.sendBlocked,
        sendControlsSeen: state.sendControlsSeen,
        sendControlsDisabled: state.sendControlsDisabled,
        last: state.last,
        lastSend: state.lastSend,
        lastBlockedEvent: state.lastBlockedEvent,
      };
    },
  };

  showLoadedToast();
  scan();
  return window[NAME].status();
})();
