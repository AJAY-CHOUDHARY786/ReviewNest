import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const customer = payload as { customer?: { email?: string } };
  const email = customer.customer?.email;

  if (email) {
    const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
    if (shopRecord) {
      await db.review.updateMany({
        where: { shopId: shopRecord.id, reviewerEmail: email },
        data: { reviewerEmail: null, reviewerName: "Redacted" },
      });
      await db.reviewRequest.deleteMany({
        where: { shopId: shopRecord.id, customerEmail: email },
      });
    }
  }

  return new Response();
};
