/* Pillow — Import from Pillow Hub.
 * Reads a beats export (pillow.beats.v1) from the Pillow Hub website (Tools → Auto Beats) and puts
 * the markers on the selected layer, or on the comp.
 * The work happens in host/pillow.jsx (pillowHubImport), one undo step. */
(function () {
  var SCHEMAS = { "pillow.beats.v1": "beats" };

  function $(id) { return document.getElementById(id); }
  function say(msg, bad) { if (typeof window.toast === "function") window.toast(msg, !!bad); }
  function baseName(p) { return String(p || "").split(/[\\/]/).pop(); }

  var box, btn, input, line, label = "";

  function busy(on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.textContent = on ? "Applying\u2026" : label;
  }

  function apply(text, name) {
    var data = null;
    try { data = JSON.parse(String(text || "").replace(/^\uFEFF/, "")); } catch (e) {}
    var kind = data && SCHEMAS[data.schema];
    if (!kind) {
      say(data && /^pillow\./.test(String(data.schema || "")) ? "This export needs a newer Pillow panel" : "This file isn't a Pillow Hub export", true);
      return;
    }
    if (typeof host !== "function") { say("Not running inside After Effects", true); return; }
    busy(true);
    host('pillowHubImport("' + encodeURIComponent(JSON.stringify(data)) + '")', function (r) {
      busy(false);
      if (!r || !r.ok) { say((r && r.error) || "Couldn't apply this file", true); return; }
      say(r.message || "Done");
      if (line) { line.textContent = baseName(name) + " \u00b7 " + (r.message || "applied"); line.className = "hub-import-file"; }
      if (kind === "beats" && window.PillowMusic && window.PillowMusic.refresh) window.PillowMusic.refresh();
    });
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { say("This file is too large for a Pillow Hub export", true); return; }
    var fr = new FileReader();
    fr.onload = function () { apply(fr.result, file.name); };
    fr.onerror = function () { say("Couldn't read this file", true); };
    fr.readAsText(file);
  }

  function pick() {
    var fs = window.cep && window.cep.fs;
    if (fs && typeof fs.showOpenDialogEx === "function") {
      var r = fs.showOpenDialogEx(false, false, "Import from Pillow Hub", "", ["json"]);
      if (!r || r.err !== 0 || !r.data || !r.data.length) return;
      var f = fs.readFile(r.data[0]);
      if (f && f.err === 0) apply(f.data, r.data[0]); else say("Couldn't read this file", true);
      return;
    }
    if (input) input.click();
  }

  function init() {
    box = $("hub-import"); btn = $("btn-hub-import"); input = $("hub-import-input"); line = $("hub-import-file");
    if (!box || !btn) return;
    label = btn.textContent;
    btn.onclick = function () { if (!btn.disabled) pick(); };
    if (input) input.onchange = function () { readFile(input.files && input.files[0]); input.value = ""; };
    box.addEventListener("dragover", function (e) { e.preventDefault(); box.classList.add("is-over"); });
    box.addEventListener("dragleave", function () { box.classList.remove("is-over"); });
    box.addEventListener("drop", function (e) {
      e.preventDefault(); box.classList.remove("is-over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
  }

  window.PillowHubImport = { apply: apply };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
