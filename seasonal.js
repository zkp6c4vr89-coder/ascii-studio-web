// Seasonal bits: is it Christmas season, the countdown line, the secret "Doomsday" countdown,
// and whether to switch the wallpaper for the season. Pure functions of a date, so they are
// easy to test and every page agrees.

export const CHRISTMAS_SCENES = ["snow", "tree", "fireplace", "aurora"];
export const SEASON_SCENE = "snow";              // what the December auto-switch picks
export const CHRISTMAS_DAY_SCENE = "tree";       // ...and what Christmas Day picks
const DOOMSDAY = [2026, 11, 18];                 // 18 Dec 2026 (month is 0-based)

const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 86400000);

// 1 Dec to 6 Jan (Twelfth Night)
export function christmasSeason(date = new Date()) {
  const m = date.getMonth(), d = date.getDate();
  return m === 11 || (m === 0 && d <= 6);
}
// "2026" for Dec 2026 and for 1–6 Jan 2027: one key per season
export function seasonKey(date = new Date()) {
  return String(date.getMonth() === 0 ? date.getFullYear() - 1 : date.getFullYear());
}

// The line under the clock, or "" when there is nothing to count down to.
export function countdownText(date = new Date()) {
  const m = date.getMonth(), d = date.getDate();
  if (m === 11 && d < 24) { const n = 25 - d; return `${n} sleeps till Christmas`; }
  if (m === 11 && d === 24) return "Christmas Eve! 1 sleep to go";
  if (m === 11 && d === 25) return "Merry Christmas!";
  if (m === 11) { const n = 32 - d; return n === 1 ? "1 day to New Year" : `${n} days to New Year`; }
  if (m === 0 && d === 1) return "Happy New Year!";
  return "";
}

export function doomsdayText(date = new Date()) {
  const n = daysBetween(date, new Date(...DOOMSDAY));
  if (n > 1) return `Doomsday: ${n} days`;
  if (n === 1) return "Doomsday: tomorrow";
  return "Doomsday is here.";
}

// What to do about the wallpaper this season.
//   current: the scene showing now ("custom" = the user's own picture, "off" = nothing)
//   season:  what we remembered: { key, prev, picked, done }
// Returns { switch: id, christmasDay?, season } | { restore: id, season } | { season } (just remember) | null
export function autoSwitchDecision(current, season = {}, date = new Date()) {
  const key = seasonKey(date);
  if (christmasSeason(date)) {
    const own = current === "custom" || current === "off";
    // Christmas Day: the tree, once (same rules: never over someone's own picture or an empty desktop)
    if (date.getMonth() === 11 && date.getDate() === 25 && season.xmas !== key) {
      const fresh = season.key === key ? season : {};
      if (own || current === CHRISTMAS_DAY_SCENE) return { season: { ...fresh, key, xmas: key, done: fresh.key ? fresh.done : true } };
      // if our December pick is still showing, "Undo" / the January restore go back to what was before it
      const prev = fresh.prev && current === fresh.picked ? fresh.prev : current;
      return { switch: CHRISTMAS_DAY_SCENE, christmasDay: true, season: { key, xmas: key, prev, picked: CHRISTMAS_DAY_SCENE, done: false } };
    }
    if (season.key === key) return null;                         // already handled this season
    // never replace someone's own picture, an empty desktop, or a festive scene they chose
    if (own || CHRISTMAS_SCENES.includes(current)) {
      return { season: { key, done: true } };
    }
    return { switch: SEASON_SCENE, season: { key, prev: current, picked: SEASON_SCENE, done: false } };
  }
  if (season.key && !season.done) {                              // the season is over
    const restore = current === season.picked && season.prev;    // only if they kept our pick
    return restore ? { restore: season.prev, season: { ...season, done: true } } : { season: { ...season, done: true } };
  }
  return null;
}
