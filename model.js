// driveTime simulation model.
// Pure functions, no DOM. Every number here is an estimate meant for
// comparing speeds against each other, not for predicting an exact trip.

// Typical trip length for each road type, used when switching types.
export const DISTANCE_BY_ROAD = { interstate: 120, mixed: 40, city: 8 };

export const DEFAULTS = {
  distance: 120,          // miles
  roadType: 'interstate', // 'interstate' | 'city' | 'mixed'
  cityShare: 20,          // % of the trip on city streets (mixed only)
  mpg: 30,                // highway MPG at ~55 mph
  gasPrice: 3.5,          // $/gal
  timeValue: 20,          // $/hr the driver puts on their time
  hwyLimit: 70,           // mph
  cityLimit: 35,          // mph
  offset: 10,             // mph over (or under) the limit you drive
  lightsPerMile: 4,
  redSeconds: 45,         // length of a red phase
  crashCostPerMile: 0.10, // $ expected crash cost per mile at the limit
  includeRisk: true,
};

const MPH_TO_MS = 0.44704;
const ACCEL = 2.0;         // m/s^2 pulling away from a light
const DECEL = 2.5;         // m/s^2 braking for a light
const IDLE_GPH_AT_30 = 0.3; // gal/hr idling, for a 30 MPG car
const STOP_GAL_AT_30 = 0.0045; // extra gal to get back up to 30 mph, 30 MPG car
const BASE_RED_CHANCE = 0.45;  // chance of catching a red when driving the timed speed
const MAX_RED_CHANCE = 0.65;

// Fuel used per mile relative to a car's best steady speed (~50 mph).
// Above 50, aerodynamic drag grows with the square of speed, so each extra
// 5 mph costs more than the last. Below 50, low gears add a mild penalty.
export function fuelFactor(v) {
  if (v >= 50) {
    const d = v - 50;
    return 1 + 0.003 * d + 0.0003 * d * d;
  }
  const d = 50 - v;
  return 1 + 0.0004 * d * d;
}

// MPG at a steady speed, given the car's rated highway MPG at ~55 mph.
export function mpgAtSpeed(ratedMpg, v) {
  return ratedMpg * fuelFactor(55) / fuelFactor(v);
}

// Lights are usually timed for the posted limit. Drive faster than that
// and you arrive at the next light before it turns green more often.
export function redChance(v, limit) {
  const over = Math.max(0, (v - limit) / limit);
  return BASE_RED_CHANCE + (MAX_RED_CHANCE - BASE_RED_CHANCE) * Math.min(1, over);
}

function interstate(miles, v, p) {
  const hours = miles / v;
  const gallons = miles / mpgAtSpeed(p.mpg, v);
  return { hours, gallons, stops: 0 };
}

function city(miles, v, p) {
  const ms = v * MPH_TO_MS;
  const sizeScale = 30 / p.mpg; // thirstier cars are heavier and idle hungrier
  const stopsPerMile = p.lightsPerMile * redChance(v, p.cityLimit);
  const waitSec = p.redSeconds / 2;                // average wait once you hit a red
  const slowSec = ms / (2 * ACCEL) + ms / (2 * DECEL); // time lost braking + pulling away
  const hours = miles * (1 / v + stopsPerMile * (waitSec + slowSec) / 3600);

  const cruiseGal = miles / mpgAtSpeed(p.mpg, v);
  const stopGal = STOP_GAL_AT_30 * (v / 30) ** 2 * sizeScale;
  const idleGal = IDLE_GPH_AT_30 * sizeScale * waitSec / 3600;
  const gallons = cruiseGal + miles * stopsPerMile * (stopGal + idleGal);
  return { hours, gallons, stops: miles * stopsPerMile };
}

// Relative risk vs driving at the limit (Nilsson power model):
// injury crashes scale with speed^2, fatal crashes with speed^4.
export function riskMultipliers(v, limit) {
  const r = v / limit;
  return { crash: r ** 2, fatal: r ** 4 };
}

// Simulate a whole trip with the driver going `offset` mph relative to each limit.
export function simulate(p, offset = p.offset) {
  const share = p.roadType === 'city' ? 1 : p.roadType === 'interstate' ? 0 : p.cityShare / 100;
  const cityMiles = p.distance * share;
  const hwyMiles = p.distance - cityMiles;
  const vCity = Math.max(10, p.cityLimit + offset);
  const vHwy = Math.max(20, p.hwyLimit + offset);

  const c = cityMiles > 0 ? city(cityMiles, vCity, p) : { hours: 0, gallons: 0, stops: 0 };
  const h = hwyMiles > 0 ? interstate(hwyMiles, vHwy, p) : { hours: 0, gallons: 0, stops: 0 };

  const rc = riskMultipliers(vCity, p.cityLimit);
  const rh = riskMultipliers(vHwy, p.hwyLimit);
  const crashMult = p.distance ? (rc.crash * cityMiles + rh.crash * hwyMiles) / p.distance : 1;
  const fatalMult = p.distance ? (rc.fatal * cityMiles + rh.fatal * hwyMiles) / p.distance : 1;

  const hours = c.hours + h.hours;
  const gallons = c.gallons + h.gallons;
  const fuelCost = gallons * p.gasPrice;
  const riskCost = p.includeRisk ? p.crashCostPerMile * p.distance * crashMult : 0;

  return {
    offset, vCity, vHwy, cityMiles, hwyMiles,
    hours, gallons, fuelCost, riskCost,
    totalCost: fuelCost + riskCost,
    mpg: gallons ? p.distance / gallons : 0,
    avgSpeed: hours ? p.distance / hours : 0,
    stops: c.stops,
    crashMult, fatalMult,
  };
}

// Compare a run against the at-the-limit baseline.
export function compare(run, base, p) {
  const hoursSaved = base.hours - run.hours;
  const extraFuel = run.fuelCost - base.fuelCost;
  const extraRisk = run.riskCost - base.riskCost;
  const extraCost = extraFuel + extraRisk;
  const timeWorth = hoursSaved * p.timeValue;
  const costPerHourSaved = hoursSaved > 1e-6 ? extraCost / hoursSaved : null;
  return {
    hoursSaved, extraFuel, extraRisk, extraCost, timeWorth,
    costPerHourSaved,
    net: timeWorth - extraCost, // positive = worth it at your time value
  };
}

// Offsets shown in the comparison table and charts.
export function offsets() {
  const out = [];
  for (let o = -10; o <= 25; o += 5) out.push(o);
  return out;
}
