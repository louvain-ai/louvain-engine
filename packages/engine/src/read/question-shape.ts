/** What kind of question a shape names. The small model that reads one is the host's. */
export type ShapeKind =
  | "lookup"
  | "paraphrased_lookup"
  | "count"
  | "yes_no"
  | "value"
  | "recency"
  | "advice"
  | "list"
  | "not_answerable"
  | "comparison"
  | "summary";
