async (page) => {
  await page.evaluate(() => {
    const s = window.__xf, e = s.eng, u = window.__xfui, B = e.run.res.honey.constructor;
    u.offlineReport = null; s.pendingOffline = null;
    e.run.res.honey = B.of(10); e.run.res.nectar = B.of(80);
    e.run.colony.houseWaxShare = 0; e.run.season.formal = false; e.run.season.season = 'tutorial';
    s.saveNow(); localStorage.removeItem('audit.shifted');
  });
  await page.addInitScript(() => {
    if (location.port !== '4186' || localStorage.getItem('audit.shifted')) return;
    const raw = localStorage.getItem('xiaofengdaye.h5.save');
    if (!raw) return;
    const envelope = JSON.parse(raw), state = JSON.parse(envelope.payload);
    state.lastSavedAt = Date.now() - 120000; state.lastSettlementId = '';
    envelope.payload = JSON.stringify(state);
    let hash = 0x811c9dc5;
    for (let i = 0; i < envelope.payload.length; i++) hash = Math.imul(hash ^ envelope.payload.charCodeAt(i), 0x01000193) >>> 0;
    envelope.checksum = hash.toString(16).padStart(8, '0');
    localStorage.setItem('xiaofengdaye.h5.save', JSON.stringify(envelope)); localStorage.setItem('audit.shifted', '1');
  });
  await page.goto('http://127.0.0.1:4186/?debug=1&ads=mock&adtime=1');
  await page.locator('[data-action="home-start"]').waitFor();
  const beforeEntry = await page.evaluate(() => {
    const s = window.__xf;
    const report = s.pendingOffline;
    if (!report || !(Number(report.gains.honey) > 0)) throw Error('cold restart did not settle offline honey');
    s.awaySince -= 45000;
    return { gains: Number(report.gains.honey), credited: report.credited };
  });
  await page.locator('[data-action="home-start"]').click();
  await page.locator('.offline-card').waitFor();
  const report = await page.evaluate(() => window.__xfui.offlineReport);
  if (Number(report.gains.honey) + 1e-6 < beforeEntry.gains || report.credited < beforeEntry.credited + 45) {
    throw Error('home screen replaced cold-start offline earnings');
  }
  await page.evaluate(() => window.__xf.stop());
  const honeyBefore = await page.evaluate(() => window.__xf.eng.w.econ.num('honey'));
  await page.locator('[data-action="ad-offline-double"]').click();
  await page.getByRole('button', { name: '领取奖励', exact: true }).waitFor();
  await page.getByRole('button', { name: '领取奖励', exact: true }).click();
  await page.waitForTimeout(150);
  const earned = await page.evaluate(() => window.__xf.eng.w.econ.num('honey')) - honeyBefore;
  if (Math.abs(earned - Number(report.gains.honey)) > 0.01) throw Error('mock ad did not grant exactly one extra offline gain');
  if (await page.locator('.offline-card').count() !== 0) throw Error('claimed offline report was not dismissed');
  console.log(JSON.stringify({ coldRestart: true, originalHoney: beforeEntry.gains, displayedHoney: Number(report.gains.honey), mockAdExtraHoney: earned }));
}
