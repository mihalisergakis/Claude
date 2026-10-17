export type OrgType =
  | "solo_agent"
  | "team"
  | "independent_brokerage"
  | "franchise_office"
  | "other"
  | "unknown";

export const ORG_TYPES: OrgType[] = [
  "solo_agent",
  "team",
  "independent_brokerage",
  "franchise_office",
  "other",
  "unknown",
];

export type PipelineStage =
  | "discovered"
  | "researched"
  | "qualified"
  | "disqualified"
  | "contact_ready"
  | "drafted"
  | "approved"
  | "in_sequence"
  | "replied"
  | "interested"
  | "demo_booked"
  | "trial"
  | "customer"
  | "nurture"
  | "not_interested"
  | "unsubscribed"
  | "bounced"
  | "do_not_contact";

export const PIPELINE_STAGES: PipelineStage[] = [
  "discovered",
  "researched",
  "qualified",
  "disqualified",
  "contact_ready",
  "drafted",
  "approved",
  "in_sequence",
  "replied",
  "interested",
  "demo_booked",
  "trial",
  "customer",
  "nurture",
  "not_interested",
  "unsubscribed",
  "bounced",
  "do_not_contact",
];

export interface RubricCriterion {
  key: string;
  label: string;
  weight: number;
  guidance: string;
}

export interface ProductConfig {
  name: string;
  description: string;
  stage_label: string;
  icp: {
    summary: string;
    include: string[];
    exclude: string[];
    markets: { state: string; county?: string; city?: string }[];
  };
  qualification_rubric: RubricCriterion[];
  value_props: string[];
  approved_claims: { feature: string; status: "working" | "roadmap" | "unconfirmed" }[];
  discovery: { business_label: string; search_hints: string[] };
}

export interface Product extends ProductConfig {
  id: string;
  workspace_id: string;
}

export interface Organization {
  id: string;
  workspace_id: string;
  name: string;
  org_type: OrgType;
  website: string | null;
  domain: string | null;
  phone_e164: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  brokerage_id: string | null;
  team_size: number | null;
  lead_source: string;
  notes: string;
  researched_at: string | null;
  created_at: string;
}

export interface Fact {
  id: string;
  organization_id: string;
  contact_id: string | null;
  field: string;
  value: unknown;
  quote: string | null;
  source_url: string | null;
  source_type: "website" | "public_record" | "search_result" | "csv" | "manual";
  extracted_by: "ai" | "human" | "import" | "rule";
  is_verified: boolean;
  retrieved_at: string;
}

export interface CriterionResult {
  key: string;
  label: string;
  weight: number;
  score: number;
  basis: "verified" | "inferred" | "unknown";
  evidence_fact_ids: string[];
  note: string;
}
