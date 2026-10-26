import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop },
    update: {},
  });
  const [
    total,
    published,
    pending,
    aggregate,
    recentReviews,
    importJobs,
    subscription,
  ] = await Promise.all([
    db.review.count({ where: { shopId: shop.id } }),
    db.review.count({ where: { shopId: shop.id, status: "published" } }),
    db.review.count({ where: { shopId: shop.id, status: "pending" } }),
    db.review.aggregate({
      where: { shopId: shop.id, status: "published" },
      _avg: { rating: true },
    }),
    db.review.findMany({
      where: { shopId: shop.id },
      orderBy: { submittedAt: "desc" },
      take: 5,
      include: { product: true },
    }),
    db.importJob.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    db.subscription.findUnique({ where: { shopId: shop.id } }),
  ]);
  const since = new Date();
  since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);
  const [activityReviews, productCounts] = await Promise.all([
    db.review.findMany({
      where: { shopId: shop.id, submittedAt: { gte: since } },
      select: { submittedAt: true },
    }),
    db.review.groupBy({
      by: ["productRefId"],
      where: {
        shopId: shop.id,
        status: "published",
        productRefId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { productRefId: "desc" } },
      take: 5,
    }),
  ]);
  const activity = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(since);
    day.setDate(day.getDate() + index);
    const date = day.toISOString().slice(0, 10);
    return {
      date,
      count: activityReviews.filter(
        (review) => review.submittedAt.toISOString().slice(0, 10) === date,
      ).length,
    };
  });
  const productIds = productCounts.flatMap((item) =>
    item.productRefId ? [item.productRefId] : [],
  );
  const products = await db.productRef.findMany({
    where: { shopId: shop.id, id: { in: productIds } },
    select: { id: true, title: true },
  });
  const productTitles = new Map(
    products.map((product) => [product.id, product.title]),
  );
  const topProducts = productCounts.flatMap((item) =>
    item.productRefId
      ? [
          {
            id: item.productRefId,
            title: productTitles.get(item.productRefId) || "Product",
            reviewCount: item._count._all,
          },
        ]
      : [],
  );
  return {
    total,
    published,
    pending,
    averageRating: aggregate._avg.rating,
    recentReviews,
    importJobs,
    subscription,
    activity,
    topProducts,
  };
};

export default function Index() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="ReviewNest overview">
      <s-section heading="Review performance">
        <s-grid gridTemplateColumns="repeat(4, 1fr)" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>{data.total}</s-heading>
            <s-text>Total reviews</s-text>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>{data.published}</s-heading>
            <s-text>Published</s-text>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>{data.pending}</s-heading>
            <s-text>Pending moderation</s-text>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-heading>{data.averageRating?.toFixed(1) ?? "—"}</s-heading>
            <s-text>Average rating</s-text>
          </s-box>
        </s-grid>
      </s-section>
      <s-section heading="Recent reviews">
        {data.recentReviews.length ? (
          data.recentReviews.map((review) => (
            <s-box
              key={review.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="inline" gap="base">
                <s-text>{"★".repeat(review.rating)}</s-text>
                <s-text>{review.title || "Untitled review"}</s-text>
                <s-text>{review.product?.title || "Unmatched product"}</s-text>
                <s-text>{review.status}</s-text>
              </s-stack>
            </s-box>
          ))
        ) : (
          <s-paragraph>No reviews have been received yet.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Recent imports">
        {data.importJobs.length ? (
          data.importJobs.map((job) => (
            <s-paragraph key={job.id}>
              {job.status}: {job.processed} of {job.totalRows} rows processed
            </s-paragraph>
          ))
        ) : (
          <s-paragraph>No imports have been started.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Review activity, last 30 days">
        {data.activity.some((day) => day.count > 0) ? (
          data.activity.map((day) => (
            <s-paragraph key={day.date}>
              {day.date}: {day.count} reviews
            </s-paragraph>
          ))
        ) : (
          <s-paragraph>No reviews were submitted in this period.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Top products">
        {data.topProducts.length ? (
          data.topProducts.map((product) => (
            <s-paragraph key={product.id}>
              {product.title}: {product.reviewCount} published reviews
            </s-paragraph>
          ))
        ) : (
          <s-paragraph>No published product reviews yet.</s-paragraph>
        )}
      </s-section>
      <s-section slot="aside" heading="Subscription">
        <s-paragraph>
          {data.subscription
            ? `${data.subscription.plan}: ${data.subscription.status}`
            : "No active subscription"}
        </s-paragraph>
        <s-link href="/app/billing">Manage billing</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
