export const IMPORT_FIELDS = [
  "name",
  "website",
  "email",
  "contact_name",
  "contact_role",
  "phone",
  "city",
  "county",
  "state",
  "brokerage",
  "team_size",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRow = Partial<Record<ImportField, string>>;
