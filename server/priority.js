// Priority automation engine: turns the two intake answers (who is affected, how soon it is
// needed) into a P1-P4 tier, then escalates by one tier for exam-type keywords or finals week.
//
// The calculation is a pure function (no database, no Express) so it is easy to unit test
// (see priority.test.js). `calculatePriority` below is the Express middleware that wraps it.

export const IMPACT_LEVELS = ["Organization", "Department", "Individual"];
export const URGENCY_LEVELS = ["High", "Medium", "Low"];
export const PRIORITY_TIERS = ["P1", "P2", "P3", "P4"];

// Calendar switch: set to true during finals week (or start the API with FINALS_WEEK=true).
export const IS_FINALS_WEEK = process.env.FINALS_WEEK === "true";

// Escalation keywords found in the ticket description.
export const ESCALATION_KEYWORDS = ["Exam", "Graduation", "Lecture", "Dean"];

// impact -> urgency -> tier
export const PRIORITY_MATRIX = {
  Organization: { High: "P1", Medium: "P1", Low: "P2" },
  Department: { High: "P1", Medium: "P2", Low: "P3" },
  Individual: { High: "P2", Medium: "P3", Low: "P4" },
};

// The older High/Medium/Low label that reports, KPIs and SLA targets still use.
const TIER_TO_LABEL = { P1: "High", P2: "High", P3: "Medium", P4: "Low" };
export const tierToPriorityLabel = (tier) => TIER_TO_LABEL[tier] ?? "Low";

// One tier more urgent; P1 stays P1.
export function escalate(tier) {
  const index = PRIORITY_TIERS.indexOf(tier);
  return PRIORITY_TIERS[Math.max(0, index - 1)];
}

// Whole-word, case-insensitive keyword scan ("Exam" matches "exam" and "Exam," but not "example").
export function findEscalationKeywords(description = "") {
  const text = String(description ?? "");
  return ESCALATION_KEYWORDS.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

/**
 * @param {{impact: string, urgency: string, description?: string, isFinalsWeek?: boolean}} input
 * @returns {{tier: string, baseTier: string, escalated: boolean, keywords: string[], finalsWeek: boolean, label: string}}
 * @throws {RangeError} when impact or urgency is not one of the allowed values
 */
export function calculatePriorityTier({ impact, urgency, description = "", isFinalsWeek = IS_FINALS_WEEK }) {
  if (!IMPACT_LEVELS.includes(impact)) {
    throw new RangeError(`impact must be one of: ${IMPACT_LEVELS.join(", ")}.`);
  }
  if (!URGENCY_LEVELS.includes(urgency)) {
    throw new RangeError(`urgency must be one of: ${URGENCY_LEVELS.join(", ")}.`);
  }
  const baseTier = PRIORITY_MATRIX[impact][urgency];
  const keywords = findEscalationKeywords(description);
  const finalsWeek = Boolean(isFinalsWeek);
  // Only one step up, even when both a keyword and finals week apply.
  const escalated = (keywords.length > 0 || finalsWeek) && baseTier !== "P1";
  const tier = keywords.length > 0 || finalsWeek ? escalate(baseTier) : baseTier;
  return { tier, baseTier, escalated, keywords, finalsWeek, label: tierToPriorityLabel(tier) };
}

// Express middleware: runs on ticket creation. Reads impactLevel, urgencyLevel and description
// from the body and leaves the result on req.priority for the route to store.
export function calculatePriority(req, res, next) {
  try {
    req.priority = calculatePriorityTier({
      impact: req.body?.impactLevel,
      urgency: req.body?.urgencyLevel,
      description: req.body?.description,
    });
    next();
  } catch (error) {
    if (error instanceof RangeError) return res.status(400).json({ error: error.message });
    next(error);
  }
}
