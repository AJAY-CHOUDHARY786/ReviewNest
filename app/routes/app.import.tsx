import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { z } from "zod";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { enqueueReviewImport } from "../services/import-queue.server";
import { previewReviewCsv } from "../services/review-csv.server";
import { encryptPayload } from "../services/secure-payload.server";
import "../styles/reviewnest.css";

const maxBytes = 2 * 1024 * 1024;
const uploadSchema = z.string().min(1).max(maxBytes);

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop },
    update: {},
  });
  const jobs = await db.importJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      totalRows: true,
      processed: true,
      failed: true,
      errorReport: true,
      createdAt: true,
    },
  });
  return {
    jobs,
    queued: new URL(request.url).searchParams.get("queued") === "1",
    encryptionReady: Boolean(process.env.DATA_ENCRYPTION_KEY),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop },
    update: {},
  });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "sync-products") {
    let cursor: string | null = null;
    let synced = 0;
    let hasNextPage = true;
    while (hasNextPage) {
      const response = await admin.graphql(
        `#graphql
          query ReviewNestProductSync($after: String) {
            products(first: 100, after: $after) {
              edges { node { id handle title } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
        { variables: { after: cursor } },
      );
      const result: {
        data?: {
          products?: {
            edges: Array<{
              node: { id: string; handle: string; title: string };
            }>;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      } = await response.json();
      const connection = result.data?.products;
      if (!connection)
        return data({ error: "Shopify product sync failed." }, { status: 502 });
      for (const edge of connection.edges) {
        await db.productRef.upsert({
          where: {
            shopId_shopifyProductId: {
              shopId: shop.id,
              shopifyProductId: edge.node.id,
            },
          },
          create: {
            shopId: shop.id,
            shopifyProductId: edge.node.id,
            handle: edge.node.handle,
            title: edge.node.title,
          },
          update: { handle: edge.node.handle, title: edge.node.title },
        });
        synced += 1;
      }
      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;
    }
    return { syncedProducts: synced };
  }

  if (intent === "confirm") {
    const parsedJobId = z.string().min(1).safeParse(form.get("jobId"));
    if (!parsedJobId.success)
      return data({ error: "Import job not found." }, { status: 400 });
    const job = await db.importJob.findFirst({
      where: { id: parsedJobId.data, shopId: shop.id, status: "draft" },
    });
    if (!job?.payload)
      return data(
        { error: "Import draft not found or already processed." },
        { status: 404 },
      );
    await db.importJob.update({
      where: { id: job.id },
      data: { status: "queued" },
    });
    try {
      await enqueueReviewImport(job.id);
    } catch {
      await db.importJob.update({
        where: { id: job.id },
        data: { status: "queue_error" },
      });
      return data(
        {
          error:
            "Could not start the import queue. Start the worker and check database connectivity.",
        },
        { status: 503 },
      );
    }
    return redirect("/app/import?queued=1");
  }

  if (!process.env.DATA_ENCRYPTION_KEY)
    return data(
      {
        error:
          "Encrypted import storage is unavailable. Add DATA_ENCRYPTION_KEY to the private .env file first.",
      },
      { status: 503 },
    );
  const file = form.get("csvFile");
  if (!(file instanceof File) || !file.size)
    return data({ error: "Choose a CSV file first." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".csv") || file.size > maxBytes)
    return data(
      { error: "Upload a CSV file no larger than 2 MB." },
      { status: 400 },
    );
  const parsedInput = uploadSchema.safeParse(await file.text());
  if (!parsedInput.success)
    return data(
      { error: "The CSV is empty or exceeds the 2 MB limit." },
      { status: 400 },
    );

  try {
    const preview = previewReviewCsv(parsedInput.data);
    if (!preview.rows.length)
      return data(
        { error: "The CSV contains no review rows." },
        { status: 400 },
      );
    if (preview.rows.length > 5000)
      return data(
        { error: "A single import is limited to 5,000 rows." },
        { status: 400 },
      );
    const validRows = preview.rows.filter((row) => row.valid && !row.duplicate);
    if (!validRows.length)
      return data(
        { error: "No valid, unique rows to import." },
        { status: 400 },
      );
    const initialErrors = preview.rows
      .filter((row) => !row.valid || row.duplicate)
      .map((row) => ({
        rowNumber: row.rowNumber,
        reason: row.errors.join("; ") || "Duplicate row in file",
      }));
    const job = await db.importJob.create({
      data: {
        shopId: shop.id,
        status: "draft",
        totalRows: preview.rows.length,
        failed: initialErrors.length,
        payload: encryptPayload(validRows),
        errorReport: initialErrors.length
          ? encryptPayload(initialErrors)
          : null,
      },
      select: { id: true },
    });
    return { preview, draftJobId: job.id };
  } catch {
    return data(
      {
        error:
          "Could not parse this CSV. Check that it has a header row and valid CSV quoting.",
      },
      { status: 400 },
    );
  }
}

export default function ImportReviewsPage() {
  const { jobs, queued, encryptionReady } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const preview = result && "preview" in result ? result.preview : undefined;
  const error = result && "error" in result ? result.error : undefined;
  const syncedProducts =
    result && "syncedProducts" in result ? result.syncedProducts : undefined;
  const validCount =
    preview?.rows.filter((row) => row.valid && !row.duplicate).length || 0;
  const duplicateCount =
    preview?.rows.filter((row) => row.duplicate).length || 0;
  const invalidCount = (preview?.rows.length || 0) - validCount;

  return (
    <s-page heading="Import reviews">
      <s-section heading="Upload a merchant-exported CSV">
        <Form method="post">
          <input type="hidden" name="intent" value="sync-products" />
          <s-button type="submit">Sync Shopify products</s-button>
        </Form>
        {syncedProducts !== undefined && (
          <s-banner tone="success">
            Synced {syncedProducts} products. CSV product IDs and handles can
            now be matched.
          </s-banner>
        )}
        <s-paragraph>
          Choose a reviews CSV export from your existing provider. ReviewNest
          validates rows before confirmation. Queued review data is encrypted in
          PostgreSQL.
        </s-paragraph>
        <Form method="post" encType="multipart/form-data" className="rn-form">
          <label>
            CSV file
            <input
              type="file"
              name="csvFile"
              accept=".csv,text/csv"
              required
              disabled={!encryptionReady}
            />
          </label>
          <input type="hidden" name="intent" value="preview" />
          <s-button type="submit" disabled={!encryptionReady}>
            Preview CSV
          </s-button>
        </Form>
        {!encryptionReady && (
          <s-banner tone="warning">
            Set DATA_ENCRYPTION_KEY in the ignored .env file to enable encrypted
            review imports.
          </s-banner>
        )}
        {error && <s-banner tone="critical">{error}</s-banner>}
      </s-section>
      {preview && (
        <s-section heading="Import preview">
          <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-heading>{validCount}</s-heading>
              <s-text>Valid rows</s-text>
            </s-box>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-heading>{invalidCount}</s-heading>
              <s-text>Invalid rows</s-text>
            </s-box>
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-heading>{duplicateCount}</s-heading>
              <s-text>Possible duplicates</s-text>
            </s-box>
          </s-grid>
          <s-paragraph>
            Detected columns: {preview.headers.join(", ") || "None"}
          </s-paragraph>
          <div className="rn-table-wrap">
            <table className="rn-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Product</th>
                  <th>Rating</th>
                  <th>Reviewer</th>
                  <th>Review</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 25).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.values.product || "Missing"}</td>
                    <td>{row.values.rating ?? "Invalid"}</td>
                    <td>{row.values.name || "Missing"}</td>
                    <td>{row.values.body || "Missing"}</td>
                    <td>
                      {row.valid && !row.duplicate
                        ? "Valid"
                        : row.errors.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 25 && (
            <s-paragraph>
              Showing the first 25 of {preview.rows.length} rows.
            </s-paragraph>
          )}
          {result && "draftJobId" in result && (
            <Form method="post">
              <input type="hidden" name="intent" value="confirm" />
              <input type="hidden" name="jobId" value={result.draftJobId} />
              <s-button type="submit" disabled={!validCount}>
                Confirm and import {validCount} valid rows
              </s-button>
            </Form>
          )}
          <s-paragraph>
            Invalid and duplicate rows are recorded in the encrypted report.
            Unmatched products discovered during processing are reported
            separately.
          </s-paragraph>
        </s-section>
      )}
      <s-section heading="Import jobs">
        {jobs.length ? (
          jobs.map((job) => (
            <s-box
              key={job.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="inline" gap="base">
                <s-text>{job.status}</s-text>
                <s-text>
                  {job.processed} / {job.totalRows} processed
                </s-text>
                <s-text>{job.failed} rows with issues</s-text>
                <s-text>{job.createdAt.toLocaleString()}</s-text>
              </s-stack>
              {job.errorReport && (
                <a href={`/app/import-errors/${encodeURIComponent(job.id)}`}>
                  Download error report
                </a>
              )}
            </s-box>
          ))
        ) : (
          <s-paragraph>No imports have been started.</s-paragraph>
        )}
      </s-section>
      {queued && (
        <s-banner tone="success">
          Import queued. Refresh to see progress.
        </s-banner>
      )}
    </s-page>
  );
}
