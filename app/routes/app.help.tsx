import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAuthenticatedShop } from "../services/shop-context.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  return { shopDomain: shop.domain };
}

export default function HelpPage() {
  const { shopDomain } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Help">
      <s-section heading="Workspace status">
        <s-paragraph>Connected shop: {shopDomain}</s-paragraph>
        <s-paragraph>
          ReviewNest uses PostgreSQL and Prisma for shop-scoped records. Shopify
          authentication is provided by the official Shopify React Router
          package.
        </s-paragraph>
      </s-section>
      <s-section heading="Available now">
        <s-unordered-list>
          <s-list-item>Review overview with live database counts</s-list-item>
          <s-list-item>Review moderation and shop-scoped actions</s-list-item>
          <s-list-item>CSV upload preview and row validation</s-list-item>
          <s-list-item>Persisted widget and review settings</s-list-item>
          <s-list-item>
            Review-request queue and subscription status views
          </s-list-item>
        </s-unordered-list>
      </s-section>
      <s-section heading="Still required">
        <s-unordered-list>
          <s-list-item>
            Configure and authenticate a Shopify development app
          </s-list-item>
          <s-list-item>
            Build and deploy the storefront theme extension and App Proxy
          </s-list-item>
          <s-list-item>
            Implement background CSV processing and review-request worker
          </s-list-item>
          <s-list-item>
            Configure email and S3-compatible media providers
          </s-list-item>
          <s-list-item>
            Configure managed pricing in Shopify and complete app review
            requirements
          </s-list-item>
        </s-unordered-list>
      </s-section>
      <s-section heading="Data and privacy">
        <s-paragraph>
          Customer-provided review text is rendered as text, not HTML. Avoid
          adding secrets to source control. Keep database and provider
          credentials in the ignored .env file.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
