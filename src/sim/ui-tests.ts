import { setPlatform } from '../platform/Platform';
import type { Platform } from '../platform/Platform';
import { GameSession, PRIVACY_VERSION } from '../app/GameSession';
import { FullCanvasUI } from '../app/ui/FullCanvasUI';
import { UiDocument, type UiElement } from '../app/ui/VirtualDocument';
import { StyleSheet, cssLength } from '../app/ui/StyleSheet';
import { createInitialState } from '../domain/NewGame';
import { DEFAULT_CONFIG } from '../domain/GameConfig';
import { GameEngine } from '../domain/GameEngine';
import { BigNum } from '../common/BigNum';
import { Bld, Role } from '../domain/Types';
import type { SceneRenderer } from '../scene/SceneRenderer';

const storage = new Map<string, string>();
setPlatform({ name: 'douyin', storage: { probe: () => true, get: (key) => storage.get(key) ?? null, set: (key, value) => { storage.set(key, value); },
  remove: (key) => { storage.delete(key); }, keys: () => [...storage.keys()] }, audio: { create: () => ({ volume: 0, paused: true, async play() {}, pause() {}, stop() {}, dispose() {}, onFinish() {} }) },
  images: { load: () => new Promise(() => {}) }, ads: { showRewarded: async () => ({ status: 'unavailable', detail: '' }), showInterstitial: async () => false },
  vibrate() {}, perfNow: () => 0, requestFrame: () => 1, cancelFrame() {}, onHide() {}, onShow() {} } as Platform);

let passed = 0;
function check(condition: boolean, label: string): void { if (!condition) throw new Error(label); passed++; }
const context = new Proxy({ measureText: (text: string) => ({ width: [...text].length * 8, fontBoundingBoxAscent: 19, fontBoundingBoxDescent: 5 }),
  createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  getImageData: () => ({ data: new Uint8ClampedArray(52 * 52 * 4) }) }, { get: (object, key) => key in object ? object[key as keyof typeof object] : () => {} }) as unknown as CanvasRenderingContext2D;
const surface = () => ({ width: 390, height: 844, getContext: () => context });
const viewport = { width: 390, height: 844, pixelRatio: 1, top: 0, bottom: 0 };
const doc = new UiDocument(viewport, surface, () => {});
doc.root.innerHTML = '<div id="host"><button class="btn primary" data-action="test" data-id="a&amp;b">你好 &lt;蜂后&gt;</button><label><input type="range" value="25"><output>25</output></label></div>';
const button = doc.root.querySelector<UiElement>('[data-action]')!;
check(button.textContent === '你好 <蜂后>' && button.dataset.id === 'a&b', 'shared markup entities and data attributes preserved');
check(button.matches('#host > .btn.primary') && !button.matches('.btn:not(.primary)'), 'compound, child and negative selectors match correctly');
check(doc.root.querySelectorAll('input, output').length === 2 && button.closest('#host') !== null, 'queries and closest preserve GameUI action dispatch');
let bubbled = false; doc.root.addEventListener('click', (event) => { bubbled = event.target === button as unknown as EventTarget; });
button.dispatch('click'); check(bubbled, 'delegated action events bubble to shared controller');
const sheet = new StyleSheet(':root { --accent: #123; color: #456; } button { color: inherit; } .btn { background: var(--accent); } @media (max-width: 430px) { .btn { width: calc(100% - 14px); } }');
const rootStyle = sheet.resolve(doc.root, {}, viewport), style = sheet.resolve(button, rootStyle, viewport);
check(style.color === '#456' && style.background === '#123' && cssLength(style.width, 390, viewport) === 376, 'CSS cascade, variables, inheritance and narrow media rules shared');

const session = new GameSession();
session.eng = new GameEngine(DEFAULT_CONFIG, createInitialState(DEFAULT_CONFIG, 'ui-parity', Date.now(), 42));
const ui = new FullCanvasUI(surface(), session, viewport, surface);
const click = (action: string, id?: string): void => {
  const target = ui.document.root.querySelectorAll<UiElement>('[data-action]').find((n) => n.dataset.action === action && (id === undefined || n.dataset.id === id));
  if (!target) throw new Error(`Missing shared action ${action}:${id}`);
  target.dispatch('click'); ui.draw();
};
check(ui.document.root.querySelector('.privacy-card') !== null, 'mini game starts at the complete privacy screen');
click('privacy-decline'); check(ui.document.root.querySelector('.declined-card') !== null, 'privacy rejection stays outside game');
click('privacy-reconsider'); click('privacy-accept');
check(session.engine().state.meta.settings.privacyVersion === PRIVACY_VERSION && ui.document.root.querySelector('.home-card') !== null, 'privacy acceptance opens complete homepage');
click('home-start');
check(ui.document.root.querySelector('#game-screen') !== null && ui.document.root.querySelector('.prod-strip') !== null, 'full game HUD replaces simplified mini-game navigation');
const e = session.engine();
e.state.meta.tutorialDone = true;
e.run.tasksDone = e.w.cfg.tasks.map((task) => task.id);
e.run.hive.cells.filter((cell) => cell.ring <= 2).forEach((cell) => { cell.unlocked = true; });
const available = e.run.hive.cells.filter((cell) => cell.unlocked);
e.w.cfg.buildings.forEach((building, i) => { if (available[i]) available[i].building = building.id; });
e.run.colony.roles[Role.Forager] = 4; e.run.colony.roles[Role.House] = 3;
e.hive.recomputeAdjacency(); e.w.attrs.recompute(); e.run.res.honey = BigNum.of(5000); e.run.res.wax = BigNum.of(1000); e.run.res.jelly = BigNum.of(20);
const controller = ui.controller as unknown as { openPanel(panel: string): void; introId: string; refreshGame(force: boolean): void; selectedCell: string; selectedField: string; upgradeBuilding: string; };
controller.introId = ''; controller.selectedCell = available.find((cell) => cell.building === Bld.Brewery)!.cellId;
controller.selectedField = e.run.map.fields[0].fieldId; controller.upgradeBuilding = Bld.Brewery;
e.run.threats.enabled = true; e.run.threats.streak = 2;
e.run.threats.active.push({ eventId: 'ui-wasp', type: 'wasp', targetId: e.run.map.fields[0].fieldId, phase: 'active', hp: 20, maxHp: 40, startedAt: 0, endsAt: 1e6, postponed: 0, settled: false });
controller.openPanel('eco'); ui.draw();
check(ui.document.root.querySelectorAll<UiElement>('[data-action]').some((n) => n.dataset.action === 'goto-threat' && n.dataset.id === 'ui-wasp'), 'eco panel offers a go-to button for an active threat');
check(JSON.stringify(ui.document.root.textContent ?? '').includes('连续击退 2 次'), 'eco panel shows the clear streak');
e.run.threats.active = [];
// 名册、蜜蜂信息卡、季节事件弹窗、王国小标在完整界面宿主里都能渲染与操作
e.step(1.05);
const firstBee = e.roster.list()[0];
check(firstBee !== undefined, 'roster has named bees in the full UI host');
const ctl = controller as unknown as { beeCard: number; eventModal: boolean };
ctl.beeCard = firstBee.id; controller.refreshGame(true); ui.draw();
check(ui.document.root.querySelector('.bee-card') !== null && JSON.stringify(ui.document.root.textContent ?? '').includes(firstBee.n), 'bee card shows the bee name');
check((ui.document.root.querySelector<UiElement>('.bee-card .bee-portrait')?.getAttribute('src') ?? '').endsWith(`bee_${firstBee.r}.webp`),
  'bee card shows the original cute bee portrait for a normal bee');
firstBee.t = 'lightning'; firstBee.lv = 1;
controller.refreshGame(true); ui.draw();
check((ui.document.root.querySelector<UiElement>('.bee-card .bee-portrait.star')?.getAttribute('src') ?? '').endsWith('star_lightning.webp'),
  'bee card shows the star bee portrait');
delete firstBee.t; delete firstBee.lv;
click('bee-close');
check(ui.document.root.querySelector('.bee-card') === null, 'bee card closes');
e.run.season.formal = true; e.run.season.season = 'summer';
e.run.season.event = { id: 'pollen', key: 'ui', until: e.run.time + 100, resolved: false };
controller.refreshGame(true); ui.draw();
click('open-event');
check(ui.document.root.querySelector('.event-card') !== null, 'season event modal opens from the event chip');
click('event-choose', 'forage');
check(ui.document.root.querySelector('.event-card') === null && e.events.effects().length > 0, 'choosing an event option applies its effect');
check(ui.document.root.querySelector('.kingdom-chip') !== null, 'kingdom level chip is in the top bar');
for (const panel of ['hub', 'queen', 'tasks', 'build', 'colony', 'cell', 'upgrade', 'field', 'eco', 'evolution', 'swarm', 'colonies', 'resources', 'codex', 'roster', 'settings']) {
  controller.openPanel(panel); ui.draw();
  check(ui.document.root.querySelector('.panel-frame > header h2')!.textContent !== '功能', `complete shared ${panel} panel is present`);
  check(ui.document.root.querySelector('.panel-scroll')!.rect.height > 100, `${panel} panel has a usable scroll viewport`);
}
const music = e.state.meta.settings.music;
click('toggle-setting', 'music'); check(e.state.meta.settings.music !== music, 'mini settings execute the exact shared setting action');
const range = ui.document.root.querySelector<UiElement>('input[data-id="musicVolume"]')!;
const rect = range.getBoundingClientRect(); ui.touchStart(rect.x + rect.width * 0.5, rect.y + rect.height / 2, 4); ui.touchEnd(rect.x + rect.width * 0.5, rect.y + rect.height / 2, 4);
check(e.state.meta.settings.musicVolume === 50, 'touch slider updates shared volume setting');
const scroll = ui.document.root.querySelector<UiElement>('.panel-scroll')!;
ui.wheel(300, 500, 0, 420);
check(scroll.scrollTop > 0, 'full settings scrolls inside the drawer');
const scrollTop = scroll.scrollTop;
controller.refreshGame(true); ui.draw();
check(ui.document.root.querySelector<UiElement>('.panel-scroll')!.scrollTop === scrollTop, 'periodic markup refresh retains scrolling position');
controller.openPanel('queen'); ui.draw();
const honey = e.w.econ.num('honey'); click('lay');
check(e.w.econ.num('honey') < honey && e.run.colony.larvae > 0, 'shared manual breeding spends resources and adds larvae');
for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1024, 768], [1440, 900]]) {
  ui.resize({ ...viewport, width, height });
  const drawer = ui.document.root.querySelector('.game-drawer')!;
  check(drawer.rect.width > 200 && drawer.rect.width <= width + 1 && drawer.rect.height <= height + 1, `${width}x${height} uses shared responsive drawer rules`);
  const content = ui.document.root.querySelector('.panel-scroll')!;
  check(content.rect.y + content.rect.height <= height + 1, `${width}x${height} keeps the panel viewport within the screen`);
}
ui.resize(viewport);
let pans = 0, zoom = 1;
const destination = available.find((cell) => !cell.building)!;
session.renderer = { fitDefault() {}, drawField() {}, drawHive() {}, hitField: () => e.run.map.fields[0].fieldId, hitThreat: () => '', swatFx() {}, hitBee: () => -1, follow: -1, highlight: -1, stopFollow() {}, startFollow() {}, canFollow: () => false, followPos: () => null,
  hitCell: () => destination.cellId, pan: () => { pans++; }, zoomBy: (factor: number) => { zoom *= factor; },
  panHive() {}, zoomHiveBy() {}, selectedCell: '', selectedField: '', focus: '' } as unknown as SceneRenderer;
const settle = (): void => { for (const node of ui.document.root.querySelectorAll<UiElement>('*')) node.transitionFrom = null; ui.draw(); };
click('close-panel'); settle();
ui.touchStart(110, 500, 7); ui.touchMove(135, 510, 7); ui.touchEnd(135, 510, 7);
check(pans > 0, 'canvas host forwards scene dragging through the complete controller');
ui.touchStart(110, 500, 7); ui.touchStart(150, 500, 8); ui.touchMove(190, 500, 8); ui.touchEnd(190, 500, 8); ui.touchEnd(110, 500, 7);
check(zoom > 1, 'canvas host forwards both pointer identities for pinch zoom');
controller.openPanel('cell'); settle();
const original = e.hive.cell(controller.selectedCell)!;
const originalBuilding = original.building, balance = e.w.econ.num('honey');
click('start-move-cell', original.cellId); settle();
ui.touchStart(160, 500, 7); ui.touchEnd(160, 500, 7);
check(original.building === '' && destination.building === originalBuilding && e.w.econ.num('honey') === balance, 'mini game executes the same free building move as H5');
ui.destroy(); session.audio.release();
console.log(`${passed} complete UI host checks passed`);
