import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const subscription = payload as {
    app_subscription?: {
      name?: string;
      status?: string;
      trial_ends_on?: string;
    };
  };
  const appSubscription = subscription.app_subscription;

  if (appSubscription) {
    const shopRecord = await db.shop.upsert({
      where: { domain: shop },
      create: { domain: shop },
      update: {},
    });
    await db.subscription.upsert({
      where: { shopId: shopRecord.id },
      create: {
        shopId: shopRecord.id,
        plan: appSubscription.name || "Basic",
        status: (appSubscription.status || "inactive").toLowerCase(),
        trialEndsAt: appSubscription.trial_ends_on
          ? new Date(appSubscription.trial_ends_on)
          : null,
      },
      update: {
        plan: appSubscription.name || "Basic",
        status: (appSubscription.status || "inactive").toLowerCase(),
        trialEndsAt: appSubscription.trial_ends_on
          ? new Date(appSubscription.trial_ends_on)
          : null,
      },
    });
  }

  return new Response();
};
