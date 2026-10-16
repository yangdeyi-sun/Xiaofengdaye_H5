async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const rendering = await page.evaluate(() => {
    const s = window.__xf, u = window.__xfui, e = s.eng, r = s.renderer;
    s.stop(); s.pendingOffline = null; u.offlineReport = null; u.introId = ''; u.introGapUntil = Date.now() + 1e9;
    e.state.meta.tutorialDone = true; u.view = 'hive'; u.selectedCell = ''; u.closePanel(false); u.resizeCanvas(); u.drawCanvas();
    const cell = e.run.hive.cells.find((c) => c.building === 'brewery');
    if (!cell) throw Error('missing brewery fixture');
    const scale = u.canvas.width / u.canvasWidth;
    const x = Math.round(r.cellX(cell) * scale) - 12, y = Math.round(r.cellY(cell) * scale) - 12;
    const before = u.ctx.getImageData(x, y, 24, 24).data;
    u.selectedCell = cell.cellId; u.refreshGame(true); u.drawCanvas();
    const after = u.ctx.getImageData(x, y, 24, 24).data;
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
    if (changed) throw Error(`selection covered building center: ${changed} channels changed`);
    const sprites = window.__xfSprites, original = sprites.draw;
    let fallingLeaves = 0;
    sprites.draw = function(ctx, atlas, animation, ...args) {
      if (atlas === 'atlas_weather' && animation === 'leaves') fallingLeaves++;
      return original.call(this, ctx, atlas, animation, ...args);
    };
    u.view = 'field'; e.run.season.formal = false; e.run.season.season = 'autumn'; u.drawCanvas();
    sprites.draw = original;
    if (fallingLeaves) throw Error('autumn still renders falling leaves');
    e.run.season.season = 'winter'; u.drawCanvas();
    const pixels = u.ctx.getImageData(0, 0, u.canvas.width, u.canvas.height).data;
    let white = 0, total = 0;
    for (let py = 220 * scale; py < u.canvas.height - 100 * scale; py += 20 * scale) {
      for (let px = 20 * scale; px < u.canvas.width - 20 * scale; px += 20 * scale) {
        const i = (Math.round(py) * u.canvas.width + Math.round(px)) * 4;
        total++; if (pixels[i] > 220 && pixels[i + 1] > 225 && pixels[i + 2] > 225) white++;
      }
    }
    if (white / total < 0.65) throw Error('winter ground is not predominantly covered by snow');
    return { selectedBuildingCenterUnchanged: changed === 0, autumnFallingLeaves: fallingLeaves, winterWhiteGroundRatio: white / total };
  });
  const context = await page.context().browser().newContext();
  const reloadPage = await context.newPage();
  try {
    await reloadPage.goto('http://127.0.0.1:4186/?debug=1');
    await reloadPage.getByRole('button', { name: '同意并开始', exact: true }).click();
    for (let i = 0; i < 2; i++) {
      await reloadPage.reload();
      await reloadPage.waitForFunction(() => window.__xf?.ready || window.__xf?.status === 'error');
      if (await reloadPage.evaluate(() => window.__xf.status === 'error')) throw Error('immediate reload left a stale writer lease');
    }
  } finally { await context.close(); }
  return { ...rendering, cleanContextImmediateReload: true };
}
