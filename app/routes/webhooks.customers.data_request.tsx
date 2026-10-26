import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { encryptPayload } from "../services/secure-payload.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const webhook = payload as {
    customer?: { id?: number | string; email?: string; phone?: string };
    orders_requested?: Array<number | string>;
  };
  const email = webhook.customer?.email;
  if (!email) return new Response();
  const shopRecord = await db.shop.findUnique({ where: { domain: shop } });
  if (!shopRecord) return new Response();

  const [reviews, requests] = await Promise.all([
    db.review.findMany({
      where: { shopId: shopRecord.id, reviewerEmail: email },
      select: {
        id: true,
        shopifyProductId: true,
        reviewerName: true,
        reviewerEmail: true,
        rating: true,
        title: true,
        body: true,
        status: true,
        verified: true,
        verificationSource: true,
        source: true,
        submittedAt: true,
        publishedAt: true,
      },
    }),
    db.reviewRequest.findMany({
      where: { shopId: shopRecord.id, customerEmail: email },
      select: {
        orderId: true,
        status: true,
        dueAt: true,
        sentAt: true,
        createdAt: true,
      },
    }),
  ]);
  await db.privacyExport.create({
    data: {
      shopId: shopRecord.id,
      payload: encryptPayload({
        customerId: webhook.customer?.id,
        reviews,
        reviewRequests: requests,
      }),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return new Response();
};
