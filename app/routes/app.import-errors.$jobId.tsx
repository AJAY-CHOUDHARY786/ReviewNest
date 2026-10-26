import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { decryptPayload } from "../services/secure-payload.server";
import { getAuthenticatedShop } from "../services/shop-context.server";
import db from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const job = await db.importJob.findFirst({
    where: { id: params.jobId, shopId: shop.id },
    select: { errorReport: true },
  });
  if (!job?.errorReport) return data({ error: "No report is available for this job." }, { status: 404 });
  let report: Array<{ rowNumber: number; reason: string }>;
  try {
    report = decryptPayload(job.errorReport);
  } catch {
    return data({ error: "The report could not be decrypted." }, { status: 500 });
  }
  const csv = ["row,reason", ...report.map((item) => `${item.rowNumber},"${item.reason.replaceAll('"', '""')}"`)].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="reviewnest-import-errors-${params.jobId}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
