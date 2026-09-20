/**
 * Database predicate for content that may leave VC Hunter for an external model.
 * Keep this fail-closed: every permission must be explicit and current.
 */
export const SOURCE_MAY_USE_EXTERNAL_MODEL_SQL = `s.access_class='public'
  AND s.allow_external_model=1
  AND s.policy_status='approved'
  AND s.terms_review_status='reviewed'`;

