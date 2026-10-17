"use client";

import Papa from "papaparse";
import { useState } from "react";
import { Button, Card, formatDate, inputClass } from "@/components/ui";
import { IMPORT_FIELDS, type ImportField, type ImportRow } from "@/lib/import/fields";
import { createImport, importChunk } from "../actions";

const CHUNK = 200;

// Header names we recognize automatically, per field.
const GUESSES: Record<ImportField, RegExp> = {
  name: /^(business|company|team|brokerage name|organization|name)$/i,
  website: /(website|url|domain|site)/i,
  email: /e-?mail/i,
  contact_name: /(contact|agent|owner|first.*last|full.?name)/i,
  contact_role: /(role|title|position)/i,
  phone: /(phone|mobile|cell|tel)/i,
  city: /^city$/i,
  county: /county/i,
  state: /^(state|st)$/i,
  brokerage: /brokerage/i,
  team_size: /(team.?size|agents|# ?of ?agents|headcount)/i,
  notes: /(notes?|comments?)/i,
};

interface RecentImport {
  id: string;
  file_name: string;
  rows_total: number;
  rows_created: number;
  rows_merged: number;
  rows_flagged: number;
  created_at: string;
}

export function ImportWizard({ productId, recent }: { productId: string; recent: RecentImport[] }) {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [emailsHaveSource, setEmailsHaveSource] = useState(false);
  const [queueResearch, setQueueResearch] = useState(true);
  const [progress, setProgress] = useState<{ done: number; created: number; merged: number; flagged: { row: number; reason: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onFile(file: File) {
    setError(null);
    setProgress(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const fields = result.meta.fields ?? [];
        setHeaders(fields);
        setRows(result.data);
        const guessed: Partial<Record<ImportField, string>> = {};
        for (const field of IMPORT_FIELDS) {
          const match = fields.find((h) => GUESSES[field].test(h.trim()) && !Object.values(guessed).includes(h));
          if (match) guessed[field] = match;
        }
        setMapping(guessed);
      },
      error: (err) => setError(err.message),
    });
  }

  function mapped(): ImportRow[] {
    return rows.map((r) => {
      const out: ImportRow = {};
      for (const [field, header] of Object.entries(mapping)) if (header) out[field as ImportField] = r[header];
      return out;
    });
  }

  async function runImport() {
    if (!mapping.name && !mapping.website) {
      setError("Map at least the business name or website column.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const all = mapped();
      const importId = await createImport(fileName, mapping as Record<string, string>, all.length);
      const totals = { done: 0, created: 0, merged: 0, flagged: [] as { row: number; reason: string }[] };
      for (let i = 0; i < all.length; i += CHUNK) {
        const res = await importChunk({
          importId,
          productId,
          fileName,
          rows: all.slice(i, i + CHUNK),
          rowOffset: i,
          emailsHaveSource,
          queueResearch,
        });
        totals.done = Math.min(all.length, i + CHUNK);
        totals.created += res.created;
        totals.merged += res.merged;
        totals.flagged.push(...res.flagged);
        setProgress({ ...totals });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="1. Choose a file">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
        {rows.length > 0 && <p className="mt-2 text-sm text-slate-600">{rows.length} rows, {headers.length} columns in {fileName}</p>}
      </Card>

      {headers.length > 0 && (
        <Card title="2. Match columns">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((field) => (
              <label key={field} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-600">{field.replace(/_/g, " ")}</span>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}
                  className={`${inputClass} w-44`}
                >
                  <option value="">(skip)</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>

          <h3 className="mb-1 mt-4 text-xs font-semibold text-slate-500">Preview</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>{IMPORT_FIELDS.filter((f) => mapping[f]).map((f) => <th key={f} className="pr-3">{f}</th>)}</tr>
              </thead>
              <tbody>
                {mapped().slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {IMPORT_FIELDS.filter((f) => mapping[f]).map((f) => <td key={f} className="py-1 pr-3">{r[f]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {headers.length > 0 && (
        <Card title="3. Import">
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={queueResearch} onChange={(e) => setQueueResearch(e.target.checked)} className="mt-1" />
              <span>Research and score new prospects automatically (uses Claude; about $0.20–0.25 each with the default model).</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={emailsHaveSource} onChange={(e) => setEmailsHaveSource(e.target.checked)} className="mt-1" />
              <span>
                The emails in this file come from a legitimate source (given to me directly, or published by each business).
                Otherwise they are kept as “unsourced” and are not eligible for outreach until research finds them published.
              </span>
            </label>
            <Button onClick={runImport} disabled={busy}>{busy ? "Importing…" : `Import ${rows.length} rows`}</Button>
            {error && <p className="text-red-700">{error}</p>}
            {progress && (
              <div className="rounded bg-slate-50 p-3">
                <p>
                  {progress.done}/{rows.length} processed · {progress.created} new · {progress.merged} merged into existing ·{" "}
                  {progress.flagged.length} flagged
                </p>
                {progress.flagged.length > 0 && (
                  <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-amber-800">
                    {progress.flagged.map((f, i) => <li key={i}>Row {f.row}: {f.reason}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card title="Recent imports">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="py-1">When</th><th>File</th><th className="text-right">Rows</th><th className="text-right">New</th><th className="text-right">Merged</th><th className="text-right">Flagged</th></tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5">{formatDate(r.created_at)}</td>
                <td>{r.file_name}</td>
                <td className="text-right tabular-nums">{r.rows_total}</td>
                <td className="text-right tabular-nums">{r.rows_created}</td>
                <td className="text-right tabular-nums">{r.rows_merged}</td>
                <td className="text-right tabular-nums">{r.rows_flagged}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td colSpan={6} className="py-3 text-slate-500">No imports yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
