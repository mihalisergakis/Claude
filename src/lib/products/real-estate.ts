import type { ProductConfig } from "@/lib/types";

/**
 * Default configuration for the first product. A new SaaS product is a new
 * config like this one; the engine code does not change.
 */
export const realEstateProduct: ProductConfig = {
  name: "Real Estate CRM + Transaction Management",
  description:
    "A unified CRM and transaction management platform for independent real estate agents and small teams: " +
    "lead management and follow-up tracking, AI-assisted outreach drafting, property and opportunity tracking, " +
    "transaction management, document organization, automated transaction communication drafts, and team collaboration.",
  stage_label: "beta",
  icp: {
    summary:
      "Independent real estate agents, small real estate teams (about 2–20 agents), and independent brokerages, " +
      "especially teams that would benefit from integrated CRM and transaction coordination.",
    include: [
      "Real estate teams of roughly 2–20 agents",
      "Independent (non-franchise) brokerages",
      "Productive independent agents who handle their own transaction coordination",
    ],
    exclude: [
      "Large franchise offices with corporate-mandated tooling",
      "Teams of 50+ agents",
      "Businesses that are not residential real estate sales (property management only, mortgage, title, etc.)",
    ],
    markets: [
      { state: "UT", county: "Salt Lake" },
      { state: "UT", county: "Utah" },
      { state: "UT", county: "Davis" },
      { state: "UT", county: "Weber" },
    ],
  },
  qualification_rubric: [
    {
      key: "icp_fit",
      label: "Fit with target customer profile",
      weight: 30,
      guidance:
        "1.0 = small team or independent brokerage doing residential sales; 0.6 = solo agent; 0.3 = franchise office or very large team; 0 = not a residential sales business.",
    },
    {
      key: "team_size",
      label: "Team size in the 2–20 agent range",
      weight: 25,
      guidance:
        "Use only agents listed on the prospect's own site. 1.0 = 2–20 agents; 0.5 = 1 agent or 21–40; 0.1 = more than 40. Unknown if no roster is visible.",
    },
    {
      key: "operational_complexity",
      label: "Operational complexity",
      weight: 20,
      guidance:
        "Signals: multiple agents, admin/operations/transaction coordinator roles, several offices, buyer and listing sides, visible listing volume on their own site.",
    },
    {
      key: "transaction_mgmt_relevance",
      label: "Likely relevance of transaction management",
      weight: 15,
      guidance:
        "Higher when they handle many transactions or both sides of deals. Do not assume what software they use.",
    },
    {
      key: "contact_channel",
      label: "Legitimate business contact channel available",
      weight: 10,
      guidance:
        "1.0 = a business email published on their own site; 0.5 = only a contact form or phone; 0 = none found.",
    },
  ],
  value_props: [
    "One place for leads, follow-ups, and active transactions instead of separate CRM and transaction tools",
    "Drafts routine transaction updates so agents spend less time writing status emails",
    "Keeps documents organized per transaction",
  ],
  // All features are in beta. Mark each "working" once confirmed; drafts only cite working features.
  approved_claims: [
    { feature: "Lead management and follow-up tracking", status: "unconfirmed" },
    { feature: "AI-assisted outreach drafting", status: "unconfirmed" },
    { feature: "Property and opportunity tracking", status: "unconfirmed" },
    { feature: "Transaction management", status: "unconfirmed" },
    { feature: "Document organization", status: "unconfirmed" },
    { feature: "Automated transaction communication drafts", status: "unconfirmed" },
    { feature: "Team collaboration", status: "unconfirmed" },
  ],
  discovery: {
    business_label: "real estate team or independent brokerage",
    search_hints: [
      "real estate team",
      "realty group",
      "independent real estate brokerage",
      "homes team",
    ],
  },
};
