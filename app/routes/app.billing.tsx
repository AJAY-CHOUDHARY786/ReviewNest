import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import db from "../db.server";
import { getAuthenticatedShop } from "../services/shop-context.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const subscription = await db.subscription.findUnique({
    where: { shopId: shop.id },
  });
  return { subscription };
}

export default function BillingPage() {
  const { subscription } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Billing">
      <s-section heading="Basic plan">
        <s-paragraph>Basic · $9/month · 30-day free trial</s-paragraph>
        <s-paragraph>
          Billing is managed by Shopify. No external payment details are
          collected here.
        </s-paragraph>
        <s-banner tone="warning">
          The plan must first be created in the Shopify Partner/Dev Dashboard.
          Subscription checkout and entitlement gating are not active until the
          app is connected and managed pricing is configured.
        </s-banner>
      </s-section>
      <s-section heading="Subscription status">
        {subscription ? (
          <>
            <s-paragraph>Plan: {subscription.plan}</s-paragraph>
            <s-paragraph>Status: {subscription.status}</s-paragraph>
            <s-paragraph>
              Trial ends:{" "}
              {subscription.trialEndsAt?.toLocaleDateString() ||
                "Not available"}
            </s-paragraph>
            <s-paragraph>
              Current period ends:{" "}
              {subscription.currentPeriodEnd?.toLocaleDateString() ||
                "Not available"}
            </s-paragraph>
          </>
        ) : (
          <s-paragraph>
            No subscription status has been received from Shopify yet.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
