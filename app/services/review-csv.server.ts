import { parse } from "csv-parse/sync";
import { z } from "zod";

const reviewRowSchema = z.object({
  product: z.string().trim().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().min(1).max(5000),
  email: z
    .union([z.email().max(254), z.literal("")])
    .optional()
    .default(""),
  sourceId: z.string().trim().max(200).optional().default(""),
  submittedAt: z.string().trim().optional().default(""),
  verified: z
    .enum(["true", "false", "1", "0", "yes", "no", ""], {
      error: "Expected a boolean verified value",
    })
    .optional()
    .default("false")
    .transform((value) => ["true", "1", "yes"].includes(value.toLowerCase())),
});

export type CsvReviewRow = z.infer<typeof reviewRowSchema>;
export type CsvReviewResult = {
  rowNumber: number;
  valid: boolean;
  values: Partial<CsvReviewRow>;
  errors: string[];
  duplicate: boolean;
};

const aliases: Record<keyof CsvReviewRow, string[]> = {
  product: [
    "product",
    "product id",
    "product_id",
    "product handle",
    "product_handle",
    "handle",
  ],
  rating: ["rating", "score", "stars"],
  name: ["name", "reviewer", "reviewer name", "reviewer_name", "author"],
  title: ["title", "review title", "review_title"],
  body: ["body", "review", "review body", "review_body", "content", "text"],
  email: ["email", "reviewer email", "reviewer_email", "author email"],
  sourceId: ["id", "review id", "review_id", "source id", "source_id"],
  submittedAt: [
    "date",
    "created at",
    "created_at",
    "submitted at",
    "submitted_at",
    "review date",
  ],
  verified: [
    "verified",
    "verified purchase",
    "verified_purchase",
    "verified buyer",
  ],
};

export function previewReviewCsv(csv: string): {
  headers: string[];
  rows: CsvReviewResult[];
} {
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    max_record_size: 20_000,
    to: 10_000,
  }) as Array<Record<string, string>>;
  const headers = records.length ? Object.keys(records[0]!) : [];
  const normalizedHeaders = new Map(
    headers.map((header) => [header.trim().toLowerCase(), header]),
  );
  const mapping = Object.fromEntries(
    Object.entries(aliases).map(([field, candidates]) => [
      field,
      candidates
        .map((candidate) => normalizedHeaders.get(candidate))
        .find(Boolean),
    ]),
  ) as Record<keyof CsvReviewRow, string | undefined>;
  const seen = new Set<string>();
  const rows = records.map((record, index): CsvReviewResult => {
    const raw = Object.fromEntries(
      Object.entries(mapping).flatMap(([field, header]) =>
        header ? [[field, record[header] ?? ""]] : [],
      ),
    );
    const parsed = reviewRowSchema.safeParse(raw);
    const errors = parsed.success
      ? []
      : parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "row"}: ${issue.message}`,
        );
    if (!mapping.product) errors.push("Missing product id or handle column");
    if (!mapping.rating) errors.push("Missing rating column");
    if (!mapping.name) errors.push("Missing reviewer name column");
    if (!mapping.body) errors.push("Missing review text column");
    const values = parsed.success
      ? parsed.data
      : (raw as Partial<CsvReviewRow>);
    if (
      values.submittedAt &&
      !Number.isFinite(Date.parse(values.submittedAt))
    ) {
      errors.push("submittedAt: invalid review date");
    }
    const duplicateKey =
      values.sourceId ||
      `${values.product}:${values.name}:${values.rating}:${values.body}`;
    const duplicate = Boolean(duplicateKey && seen.has(duplicateKey));
    if (duplicate) errors.push("Duplicate row in this file");
    if (duplicateKey) seen.add(duplicateKey);
    return {
      rowNumber: index + 2,
      valid: parsed.success && errors.length === 0,
      values,
      errors,
      duplicate,
    };
  });
  return { headers, rows };
}
