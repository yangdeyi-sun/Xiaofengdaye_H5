async (page) => {
  const checks = [];
  const check = (ok, name, evidence = '') => {
    checks.push({ ok: !!ok, name, evidence });
    if (!ok) throw new Error(`${name}: ${JSON.stringify(evidence)}`);
  };
  const pause = (ms = 120) => page.waitForTimeout(ms);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const down = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  const up = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const tap = async (p) => { await down(p.x, p.y); await up(); await pause(180); };
  const close = async () => { await page.evaluate(() => { window.__xfui.closePanel(false); }); await pause(280); };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const s = window.__xf, u = window.__xfui;
    s.resetProgress(true); u.introId = ''; u.offlineReport = null; s.pendingOffline = null;
    u.introGapUntil = Date.now() + 1e9; u.screen = 'game'; u.view = 'field'; u.panel = ''; u.drawerOpen = false;
    u.render(); s.start();
  });
  await pause(200);
  const flower = await page.evaluate(() => {
    const u = window.__xfui, r = window.__xf.renderer, f = window.__xf.eng.run.map.fields[0];
    return { x: (f.x - r.cam.x) * r.cam.zoom + u.canvasWidth / 2, y: (f.y - r.cam.y) * r.cam.zoom + u.canvasHeight / 2 };
  });
  await down(flower.x, flower.y); await pause(900); await up();
  check(await page.evaluate(() => window.__xf.eng.run.stats.manualCollects === 1), '#4 first press only collects once');
  await tap(flower);
  check(await page.evaluate(() => window.__xf.eng.run.stats.manualCollects === 2), '#4 second tap completes introduction');
  await down(flower.x, flower.y);
  await page.waitForFunction(() => window.__xf.eng.run.stats.manualCollects >= 4, null, { timeout: 3500 });
  await up();
  check(await page.evaluate(() => window.__xf.eng.run.stats.manualCollects >= 4), '#4 third press continuously collects without a scout');
  const hive = await page.evaluate(() => {
    const u = window.__xfui, r = window.__xf.renderer;
    return { x: -r.cam.x * r.cam.zoom + u.canvasWidth / 2, y: (-12 - r.cam.y) * r.cam.zoom + u.canvasHeight / 2 };
  });
  await tap(hive);
  check(await page.evaluate(() => window.__xfui.view === 'hive' && !window.__xfui.drawerOpen), '#8 field hive enters hive interior');
  await page.evaluate(() => {
    const s = window.__xf, e = s.eng, u = window.__xfui, B = e.run.res.honey.constructor;
    e.run.res.honey = B.of(2000); e.run.res.wax = B.of(1000); e.run.res.jelly = B.of(50);
    e.run.tasksDone = e.w.cfg.tasks.map((t) => t.id); e.run.tasksClaimed = e.run.tasksDone.slice();
    e.state.meta.featureUnlocks = e.run.tasksDone.slice(); e.state.meta.tutorialDone = true;
    for (const type of ['brewery', 'foragerRoom', 'scoutRoom', 'storage', 'nursery', 'guardRoom']) {
      const cell = e.run.hive.cells.find((c) => c.unlocked && !c.building);
      if (cell) { const result = e.build(cell.cellId, type); if (!result.ok) throw Error(result.message); }
    }
    e.run.colony.roles.house = 3; e.run.colony.roles.forager = 4; e.run.colony.roles.scout = 1; e.run.colony.roles.guard = 1;
    e.run.colony.houseWaxShare = 0; e.w.attrs.recompute(); u.refreshGame(true); u.drawCanvas();
  });
  for (const type of ['brewery', 'foragerRoom', 'scoutRoom', 'storage', 'nursery', 'guardRoom']) {
    await close();
    const point = await page.evaluate((type) => {
      const u = window.__xfui, s = window.__xf;
      u.drawCanvas(); const cell = s.eng.run.hive.cells.find((c) => c.building === type);
      return { x: s.renderer.cellX(cell), y: s.renderer.cellY(cell) };
    }, type);
    await tap(point); await pause(500);
    const state = await page.evaluate(() => ({ open: window.__xfui.drawerOpen, panel: window.__xfui.panel,
      heading: document.querySelector('#panel-host h2')?.textContent,
      upgrades: document.querySelectorAll('#panel-host [data-action="upgrade"]').length,
      selected: window.__xfui.selectedCell }));
    check(state.open && state.panel === 'cell' && state.upgrades > 0 && state.selected, `#2 touch ${type} opens persistent upgrade details`, state);
  }
  await page.evaluate(() => window.__xfui.openPanel('hub'));
  await page.locator('#panel-host [data-action="open-upgrade"][data-id="brewery"]').click();
  await page.locator('#panel-back').click();
  check(await page.evaluate(() => window.__xfui.panel === 'hub' && window.__xfui.screen === 'game'), '#5 back returns to parent panel');
  await page.locator('#panel-host [data-action="open-upgrade"][data-id="brewery"]').click();
  check(await page.evaluate(() => window.__xfHandleNativeBack() && window.__xfui.panel === 'hub'), '#5 Android back bridge returns to the parent panel');
  check(await page.locator('#drawer-handle img').getAttribute('src').then((s) => s.includes('xf_nav_comb')), '#6 handle uses honeycomb icon');
  await close();
  const expandPoint = await page.evaluate(() => {
    const s = window.__xf, u = window.__xfui; u.view = 'hive'; u.drawCanvas();
    const c = s.eng.run.hive.cells.find((c) => s.eng.hive.canExpandCell(c) && s.renderer.cellY(c) > s.renderer.hudTop + 20 && s.renderer.cellY(c) < u.canvasHeight - 90);
    return { x: s.renderer.cellX(c), y: s.renderer.cellY(c), id: c.cellId, before: s.eng.run.hive.expansions };
  });
  await tap(expandPoint);
  check(await page.evaluate((p) => window.__xf.eng.hive.cell(p.id).unlocked && window.__xf.eng.run.hive.expansions === p.before + 1, expandPoint), '#11 map expansion deducts wax and unlocks a cell');
  await page.evaluate(() => window.__xfui.openPanel('build'));
  const beforeExpand = await page.evaluate(() => window.__xf.eng.run.hive.expansions);
  await page.locator('#panel-host [data-action="expand-next"]').click();
  check(await page.evaluate((n) => window.__xf.eng.run.hive.expansions === n + 1, beforeExpand), '#11 sidebar expansion works');
  const missing = [];
  for (const panel of ['hub', 'queen', 'build', 'colony', 'upgrade', 'eco', 'evolution', 'swarm', 'resources', 'codex', 'settings']) {
    await page.evaluate((p) => window.__xfui.openPanel(p), panel); await pause(150);
    missing.push(...await page.locator('#panel-host img, #drawer-nav img').evaluateAll((imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src'))));
  }
  check(missing.length === 0, '#3 all sidebar images load', missing);
  await close();
  await page.evaluate(() => { const u = window.__xfui; u.view = 'field'; u.refreshGame(true); u.drawCanvas(); });
  const blank = await page.evaluate(() => {
    const u = window.__xfui, r = window.__xf.renderer;
    for (let y = r.hudTop + 60; y < u.canvasHeight - 100; y += 35) for (let x = 60; x < u.canvasWidth - 60; x += 35) {
      if (!r.hitField(x, y, u.canvasWidth, u.canvasHeight) && document.elementFromPoint(x, y)?.id === 'scene-canvas') return { x, y, zoom: r.cam.zoom };
    }
    throw Error('no free map point');
  });
  await tap(blank); await tap(blank); await pause(750);
  const zoom = await page.evaluate(() => window.__xf.renderer.cam.zoom);
  check(zoom > blank.zoom * 1.5, '#15 touch double tap zooms in');
  await tap(blank); await tap(blank); await pause(750);
  check(await page.evaluate((z) => window.__xf.renderer.cam.zoom < z * 0.8, zoom), '#15 second double tap zooms out');
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [768, 1024], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const e = window.__xf.eng, u = window.__xfui;
      e.state.meta.tutorialDone = false; e.state.meta.tutorialStep = 0;
      u.hiddenHint = ''; u.view = 'field'; u.panel = ''; u.drawerOpen = false; u.refreshGame(true); u.resizeCanvas(); u.drawCanvas();
    });
    await pause(200);
    const layout = await page.evaluate(() => {
      const hint = document.querySelector('.hint-main span'), hud = document.querySelector('.hud-stack'), prod = document.querySelector('.prod-strip');
      const hr = hint.getBoundingClientRect(), pr = prod.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, clipped: hint.scrollHeight > hint.clientHeight + 1,
        hint: hr.toJSON(), prod: pr.toJSON(), hudBottom: hud.getBoundingClientRect().bottom,
        bees: document.querySelectorAll('.prod-chip').length,
        chipsVisible: document.querySelector('.prod-chips').getBoundingClientRect().height > 0,
        loadClipped: document.querySelector('.prod-bar > span').scrollWidth > document.querySelector('.prod-bar > span').clientWidth,
        text: prod.innerText };
    });
    check(!layout.overflow && !layout.clipped && !layout.loadClipped && layout.chipsVisible && layout.hint.right <= width + 1 && layout.hint.bottom <= height && layout.bees >= 4,
      `#14/#16 ${width}x${height} HUD, role data and full tutorial text`, layout);
    await page.screenshot({ path: `output/playwright/audit-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const e = window.__xf.eng, u = window.__xfui;
    e.state.meta.tutorialDone = true; e.state.meta.introsSeen = e.state.meta.introsSeen.filter((s) => s !== 'handover');
    u.introId = 'handover'; u.refreshGame(true);
  });
  check(await page.locator('.handover-card').count() === 1 && !await page.locator('.handover-card').innerText().then((s) => s.includes('有什么用')),
    '#7 handover uses dedicated entrusted-kingdom copy');
  await page.screenshot({ path: 'output/playwright/audit-handover.png' });
  await page.locator('[data-action="intro-done"]').click();
  for (const season of ['autumn', 'winter']) {
    await page.evaluate((id) => {
      const s = window.__xf, u = window.__xfui;
      s.eng.run.season.formal = false; s.eng.run.season.season = id; s.eng.w.attrs.recompute();
      u.view = 'field'; u.closePanel(false); u.refreshGame(true); u.drawCanvas();
    }, season);
    await pause(200); await page.screenshot({ path: `output/playwright/audit-${season}.png` });
  }
  const offline = await page.evaluate(() => {
    const s = window.__xf, e = s.eng, u = window.__xfui, B = e.run.res.honey.constructor;
    u.introId = ''; u.offlineReport = null; s.pendingOffline = null;
    e.run.season.formal = false; e.run.season.season = 'tutorial'; e.run.res.honey = B.of(10); e.run.res.nectar = B.of(80); e.run.colony.houseWaxShare = 0;
    s.onBackground(); e.state.lastSavedAt -= 120000; s.onForeground(); s.stop();
    const initial = s.pendingOffline;
    if (!initial) throw Error('missing offline report');
    const first = B.parse(initial.gains.honey).toNumber();
    s.beginAway(); e.run.res.honey = e.run.res.honey.addN(5); s.awaySince -= 45000; s.endAway();
    const merged = B.parse(s.pendingOffline.gains.honey).toNumber();
    u.onSessionTick(); u.refreshGame(true);
    return { first, merged, report: u.offlineReport };
  });
  check(offline.first > 0 && Math.abs(offline.merged - offline.first - 5) < 0.001, '#13 offline gains survive waiting on the home screen', offline);
  check(await page.locator('.offline-card [data-action="ad-offline-double"]').count() === 1, '#13 offline report provides ad doubling when gains exist');
  await page.screenshot({ path: 'output/playwright/audit-offline.png' });
  await page.evaluate((data) => { window.__feedbackChecks = data; }, checks);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
}
