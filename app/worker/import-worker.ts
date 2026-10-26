import { PgBoss } from "pg-boss";
import { z } from "zod";
import db from "../db.server";
import {
  decryptPayload,
  encryptPayload,
} from "../services/secure-payload.server";
import { importQueueName } from "../services/import-queue.server";

const queuedImportSchema = z.object({ jobId: z.string().min(1) });
const queuedRowsSchema = z.array(
  z.object({
    rowNumber: z.number().int().positive(),
    valid: z.boolean(),
    duplicate: z.boolean(),
    errors: z.array(z.string()),
    values: z.object({
      product: z.string().optional(),
      rating: z.number().optional(),
      name: z.string().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
      email: z.string().optional(),
      sourceId: z.string().optional(),
      submittedAt: z.string().optional(),
      verified: z.boolean().optional(),
    }),
  }),
);

type WorkerError = { rowNumber: number; reason: string };

async function runImport(jobId: string) {
  const job = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job || !job.payload) return;
  const rows = queuedRowsSchema.parse(decryptPayload<unknown>(job.payload));
  const errors: WorkerError[] = job.errorReport
    ? decryptPayload<WorkerError[]>(job.errorReport)
    : [];
  let processed = 0;
  let failed = errors.length;

  await db.importJob.update({
    where: { id: job.id },
    data: {
      status: "processing",
      processed: errors.length,
      failed: errors.length,
    },
  });
  for (const row of rows) {
    if (!row.valid || row.duplicate) {
      failed += 1;
      errors.push({
        rowNumber: row.rowNumber,
        reason: row.errors.join("; ") || "Duplicate row in file",
      });
    } else {
      const productKey = row.values.product?.trim();
      const rating = row.values.rating;
      const reviewerName = row.values.name?.trim();
      const body = row.values.body?.trim();
      if (!productKey || !rating || !reviewerName || !body) {
        failed += 1;
        errors.push({
          rowNumber: row.rowNumber,
          reason: "Required review values are missing",
        });
      } else {
        const idCandidate = /^\d+$/.test(productKey)
          ? `gid://shopify/Product/${productKey}`
          : productKey;
        const product = await db.productRef.findFirst({
          where: {
            shopId: job.shopId,
            OR: [
              { shopifyProductId: idCandidate },
              { handle: productKey.replace(/^@/, "") },
            ],
          },
          select: { id: true, shopifyProductId: true },
        });
        if (!product) {
          failed += 1;
          errors.push({
            rowNumber: row.rowNumber,
            reason: `Unmatched product: ${productKey}`,
          });
        } else {
          try {
            await db.review.create({
              data: {
                shopId: job.shopId,
                productRefId: product.id,
                shopifyProductId: product.shopifyProductId,
                reviewerName,
                reviewerEmail: row.values.email || null,
                rating,
                title: row.values.title || null,
                body,
                status: "pending",
                verified: row.values.verified === true,
                verificationSource:
                  row.values.verified === true ? "source_data" : "none",
                source: "csv_import",
                sourceReviewId:
                  row.values.sourceId ||
                  `import-${job.id}-row-${row.rowNumber}`,
                submittedAt: row.values.submittedAt
                  ? new Date(row.values.submittedAt)
                  : undefined,
              },
            });
          } catch (error) {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "P2002"
            ) {
              failed += 1;
              errors.push({
                rowNumber: row.rowNumber,
                reason: "This source review was already imported.",
              });
            } else {
              throw error;
            }
          }
        }
      }
    }
    processed += 1;
    if (processed % 25 === 0 || processed === rows.length) {
      await db.importJob.update({
        where: { id: job.id },
        data: { processed: processed + errors.length, failed },
      });
    }
  }

  await db.importJob.update({
    where: { id: job.id },
    data: {
      status: failed ? "completed_with_errors" : "completed",
      processed: processed + errors.length,
      failed,
      errorReport: errors.length ? encryptPayload(errors) : null,
      payload: null,
    },
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const boss = new PgBoss({
    connectionString,
    application_name: "reviewnest-import-worker",
  });
  boss.on("error", (error) =>
    console.error("Import queue error:", error.message),
  );
  await boss.start();
  await boss.createQueue(importQueueName);
  await boss.work(importQueueName, async (jobs) => {
    for (const job of jobs) {
      const parsed = queuedImportSchema.safeParse(job.data);
      if (!parsed.success) throw new Error("Invalid import queue payload.");
      await runImport(parsed.data.jobId);
    }
  });
  await boss.schedule("privacy-export-cleanup", "15 3 * * *", {});
  await boss.work("privacy-export-cleanup", async () => {
    await db.privacyExport.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  });
  const shutdown = async () => {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await db.$disconnect();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(
    "Review import worker failed to start:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
