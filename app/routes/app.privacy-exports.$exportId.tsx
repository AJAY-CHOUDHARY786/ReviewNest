import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import db from "../db.server";
import { getAuthenticatedShop } from "../services/shop-context.server";
import { decryptPayload } from "../services/secure-payload.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const exportRecord = await db.privacyExport.findFirst({
    where: {
      id: params.exportId,
      shopId: shop.id,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, payload: true },
  });
  if (!exportRecord)
    return data({ error: "Export not found or expired." }, { status: 404 });
  try {
    const body = JSON.stringify(decryptPayload(exportRecord.payload), null, 2);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="customer-data-${exportRecord.id}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return data({ error: "Export could not be decrypted." }, { status: 500 });
  }
}
