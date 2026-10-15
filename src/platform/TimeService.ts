export class TimeCheck {
  elapsedSec = 0;
  anomaly = '';
}

export class TimeService {
  static now(): number { return Date.now(); }

  static offlineElapsed(lastSavedAt: number, maxDays: number): TimeCheck {
    const result = new TimeCheck();
    if (!Number.isFinite(lastSavedAt) || lastSavedAt <= 0) {
      result.anomaly = 'no_timestamp';
      return result;
    }
    const diff = (Date.now() - lastSavedAt) / 1000;
    if (diff < -60) {
      result.anomaly = 'clock_back';
      return result;
    }
    const maxSec = maxDays * 86400;
    if (diff > maxSec) {
      result.anomaly = 'clock_jump';
      result.elapsedSec = maxSec;
      return result;
    }
    result.elapsedSec = Math.max(0, diff);
    return result;
  }
}
