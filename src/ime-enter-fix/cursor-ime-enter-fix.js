(function installCursorImeEnterFix() {
  const NAME = "__cursorImeEnterFix";

  if (window[NAME] && typeof window[NAME].uninstall === "function") {
    window[NAME].uninstall();
  }

  // 全局修复输入法（拼音/注音等）组字期间按回车被当成「提交」的问题：
  // 组字时的回车应仅用于上屏候选词，不应触发应用级回车提交（如 Cursor 自带的 AskQuestion「Other」输入框）。
  // 做法：在 window 捕获阶段尽早拦截「组字中的回车」，stopImmediatePropagation 阻止其到达任何提交处理器；
  // 不调用 preventDefault，保证输入法正常上屏。组字结束后回车一切照旧。
  const state = {
    installedAt: new Date().toISOString(),
    composing: false,
    guardedCount: 0, // 被拦截的组字回车次数（验证/排障用）
    lastGuardedTarget: "", // 最近一次被拦截回车的目标元素描述（验证/排障用）
  };

  function isTextEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    // 代码编辑器（Monaco）自行处理组字，避免误伤，跳过。
    if (typeof el.closest === "function" && el.closest(".monaco-editor")) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return (
        type === "text" ||
        type === "search" ||
        type === "url" ||
        type === "email" ||
        type === "tel" ||
        type === "password" ||
        type === "number" ||
        type === ""
      );
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return "";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (typeof el.className === "string" && el.className.trim()) {
      s += "." + el.className.trim().split(/\s+/).join(".");
    }
    return s.slice(0, 200);
  }

  function onCompositionStart() {
    state.composing = true;
  }

  function onCompositionEnd() {
    state.composing = false;
  }

  function onKeyDownCapture(event) {
    const isEnter = event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
    if (!isEnter) return;

    // 组字判定：优先标准的 isComposing；keyCode 229 是输入法处理中的传统信号；
    // state.composing 兜底（个别浏览器/输入法在提交回车的 keydown 上 isComposing 不可靠）。
    const composing = state.composing || event.isComposing || event.keyCode === 229;
    if (!composing) return;

    if (!isTextEditable(event.target)) return;

    event.stopImmediatePropagation();
    state.guardedCount += 1;
    state.lastGuardedTarget = describe(event.target);
  }

  window.addEventListener("compositionstart", onCompositionStart, true);
  window.addEventListener("compositionend", onCompositionEnd, true);
  window.addEventListener("keydown", onKeyDownCapture, true);

  function uninstall() {
    window.removeEventListener("compositionstart", onCompositionStart, true);
    window.removeEventListener("compositionend", onCompositionEnd, true);
    window.removeEventListener("keydown", onKeyDownCapture, true);
    delete window[NAME];
  }

  window[NAME] = {
    state,
    uninstall,
    status() {
      return {
        installedAt: state.installedAt,
        composing: state.composing,
        guardedCount: state.guardedCount,
        lastGuardedTarget: state.lastGuardedTarget,
      };
    },
  };

  return window[NAME].status();
})();
