/* A tiny After Effects object model for running generated ExtendScript in Node (vm). Test-only. */
import vm from 'node:vm';
class Prop {
  constructor() { this.keys = []; }
  get numKeys() { return this.keys.length; }
  setValueAtTime(t, v) { if (!(v instanceof this.MarkerValue)) throw new Error('not a MarkerValue'); this.keys.push({ t, v }); this.keys.sort((a, b) => a.t - b.t); }
  keyValue(i) { return this.keys[i - 1].v; }
  keyTime(i) { return this.keys[i - 1].t; }
  removeKey(i) { this.keys.splice(i - 1, 1); }
}
export function createAE({ duration = 70, selected = null, footage = [], existing = [] } = {}) {
  const log = { alerts: [], undo: [] }, files = new Set(existing);
  class MarkerValue { constructor(c) { this.comment = c; this.duration = 0; this.params = {}; } setParameters(p) { this.params = { ...p }; } getParameters() { return this.params; } }
  Prop.prototype.MarkerValue = MarkerValue;
  class Layer {
    constructor(name, o = {}) { Object.assign(this, { name, startTime: 0, stretch: 100, inPoint: 0, outPoint: duration, guideLayer: false, ...o }); this.marker = new Prop(); this.opacity = 100; }
    property(n) { if (n === 'ADBE Marker' || n === 'Marker') return this.marker; if (n === 'ADBE Transform Group') { const L = this; return { property: () => ({ setValue(v) { L.opacity = v; } }) }; } return null; }
    moveBefore(l) { this.above = l.name; }
  }
  class CompItem {
    constructor() {
      Object.assign(this, { duration, frameDuration: 1 / 30, width: 1080, height: 1920, pixelAspect: 1, markerProperty: new Prop(), added: [] });
      const comp = this;
      this.layers = {
        addNull(d) { const L = new Layer('Null 1', { kind: 'null', outPoint: d }); comp.added.push(L); return L; },
        addSolid(c, n, w, h, pa, d) { const L = new Layer(n, { kind: 'solid', color: c, outPoint: d }); comp.added.push(L); return L; }
      };
      this.selectedLayers = selected ? [new Layer(selected.name, selected)] : [];
    }
  }
  class File {
    constructor(p) { this.fsName = p; this.name = encodeURI(p.split('/').pop()); }
    get exists() { return files.has(this.fsName); }
    get parent() { return { fsName: this.fsName.split('/').slice(0, -1).join('/') }; }
    static decode(s) { return decodeURI(s); }
  }
  class FootageItem { constructor(name, path) { this.name = name; this.mainSource = path ? { file: new File(path) } : {}; } replace(f) { this.mainSource = { file: f }; this.name = File.decode(f.name); this.replaced = true; } }
  const comp = new CompItem(), items = [comp, ...footage.map(f => new FootageItem(f.name, f.path))];
  const app = { project: { activeItem: comp, get numItems() { return items.length; }, item: i => items[i - 1] }, beginUndoGroup: n => log.undo.push('begin ' + n), endUndoGroup: () => log.undo.push('end') };
  const context = vm.createContext({ app, CompItem, FootageItem, MarkerValue, File, alert: m => log.alerts.push(String(m)), JSON, Math, String, Number, encodeURIComponent, decodeURIComponent });
  return { context, comp, items, log, run: code => vm.runInContext(code, context, { timeout: 5000 }) };
}
/* ExtendScript is ES3: reject modern syntax that would fail inside After Effects. */
export function es3Problems(code) {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  const rules = [[/=>/, 'arrow function'], [/\b(let|const|class)\s/, 'let/const/class'], [/`/, 'template string'], [/,\s*[}\]]/, 'trailing comma'], [/catch\s*\{/, 'catch without binding'], [/\.\.\./, 'spread'], [/\?\?|\?\./, 'nullish/optional chaining']];
  return rules.filter(([re]) => re.test(stripped)).map(([, name]) => name);
}
