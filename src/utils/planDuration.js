'use strict';

/**
 * Duration helpers for plans whose real length isn't stored in a trustworthy
 * column. Internal plans in particular carry only a hardcoded enum (always
 * 6_MONTHS) — the Plan ID code is the actual source of truth for how long the
 * plan runs, e.g. "SUMAGOTEST_SCOPE_30DAYS" or "SUMAGOTEST_SCOPE_3MONTHS".
 */

// Legacy InternalPlanDuration enum -> whole months. Accepts both Prisma's JS
// identifier form (ONE_MONTH, …) and the @map DB value ('1_MONTH', …).
const INTERNAL_DURATION_MONTHS = {
  ONE_MONTH: 1, THREE_MONTHS: 3, SIX_MONTHS: 6, TWELVE_MONTHS: 12,
  '1_MONTH': 1, '3_MONTHS': 3, '6_MONTHS': 6, '12_MONTHS': 12,
};

/**
 * Extract a duration from a Plan ID code.
 *   "SUMAGOTEST_SCOPE_30DAYS"  -> { value: 30, unit: 'DAYS'   }
 *   "SUMAGOTEST_SCOPE_3MONTHS" -> { value: 3,  unit: 'MONTHS' }
 *   "SUMAGOTEST_SILVER_1MONTH" -> { value: 1,  unit: 'MONTHS' }
 * Uses the LAST number+unit token so year-like prefixes are ignored.
 * @param {string|null|undefined} planId
 * @returns {{ value:number, unit:'DAYS'|'MONTHS' }|null}
 */
function parseDurationFromPlanId(planId) {
  if (!planId) return null;
  const matches = [...String(planId).matchAll(/(\d+(?:\.\d+)?)\s*_?\s*(DAYS?|MONTHS?)/gi)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const value = Number(last[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, unit: /^MONTH/i.test(last[2]) ? 'MONTHS' : 'DAYS' };
}

/**
 * Human label for an internal plan's duration: parsed from the Plan ID when
 * possible (e.g. "30 Days"), else the legacy enum ("6 Months"), else null.
 * @param {{ externalPlanId?:string, duration?:string }|null|undefined} internalPlan
 * @returns {string|null}
 */
function internalDurationLabel(internalPlan) {
  const parsed = parseDurationFromPlanId(internalPlan?.externalPlanId);
  if (parsed) {
    const u = parsed.unit === 'DAYS' ? 'Day' : 'Month';
    return `${parsed.value} ${u}${parsed.value === 1 ? '' : 's'}`;
  }
  const m = INTERNAL_DURATION_MONTHS[internalPlan?.duration];
  return m != null ? `${m} Month${m === 1 ? '' : 's'}` : null;
}

module.exports = { INTERNAL_DURATION_MONTHS, parseDurationFromPlanId, internalDurationLabel };
