import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { reviewSubmissionSchema } from "../services/review.validation";

const listQuerySchema = z.object({
  productId: z.string().min(1).max(128),
  cursor: z.string().optional(),
});
const shopDomainSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i);

export async function loader({ request }: LoaderFunctionArgs) {
  const proxy = await authenticate.public.appProxy(request);
  const shopDomain = new URL(request.url).searchParams.get("shop");
  const signedShop = shopDomainSchema.safeParse(shopDomain);
  const query = listQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!signedShop.success || !query.success)
    return data({ error: "Invalid request." }, { status: 400 });
  if (
    "session" in proxy &&
    proxy.session &&
    proxy.session.shop !== signedShop.data
  )
    return data({ error: "Invalid shop context." }, { status: 403 });
  const shop = await db.shop.findUnique({ where: { domain: signedShop.data } });
  if (!shop) return data({ reviews: [], nextCursor: null });
  const [reviews, aggregate, total] = await Promise.all([
    db.review.findMany({
      where: {
        shopId: shop.id,
        shopifyProductId: query.data.productId,
        status: "published",
      },
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: 21,
      ...(query.data.cursor
        ? { cursor: { id: query.data.cursor }, skip: 1 }
        : {}),
      select: {
        id: true,
        reviewerName: true,
        rating: true,
        title: true,
        body: true,
        verified: true,
        verificationSource: true,
        submittedAt: true,
        media: { select: { url: true, mimeType: true } },
      },
    }),
    db.review.aggregate({
      where: {
        shopId: shop.id,
        shopifyProductId: query.data.productId,
        status: "published",
      },
      _avg: { rating: true },
    }),
    db.review.count({
      where: {
        shopId: shop.id,
        shopifyProductId: query.data.productId,
        status: "published",
      },
    }),
  ]);
  const hasMore = reviews.length > 20;
  const page = reviews.slice(0, 20);
  return data(
    {
      reviews: page.map((review) => ({
        id: review.id,
        reviewerName: review.reviewerName,
        rating: review.rating,
        title: review.title,
        body: review.body,
        verified:
          review.verified &&
          ["shopify_order_match", "source_data"].includes(
            review.verificationSource,
          ),
        submittedAt: review.submittedAt.toISOString(),
        media: review.media.filter((item) => item.url?.startsWith("https://")),
      })),
      averageRating: aggregate._avg.rating,
      total,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      },
    },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const proxy = await authenticate.public.appProxy(request);
  if (request.method !== "POST")
    return data({ error: "Method not allowed." }, { status: 405 });
  const url = new URL(request.url);
  const shopDomain = shopDomainSchema.safeParse(url.searchParams.get("shop"));
  if (!shopDomain.success)
    return data({ error: "Shop context is required." }, { status: 400 });
  if (
    "session" in proxy &&
    proxy.session &&
    proxy.session.shop !== shopDomain.data
  )
    return data({ error: "Invalid shop context." }, { status: 403 });
  const shop = await db.shop.findUnique({ where: { domain: shopDomain.data } });
  if (!shop) return data({ error: "Shop is not installed." }, { status: 404 });
  const form = await request.formData();
  if (form.get("website")) return data({ success: true }, { status: 202 });
  const parsed = reviewSubmissionSchema.safeParse({
    productId: form.get("productId"),
    name: form.get("name"),
    email: form.get("email") || "",
    rating: form.get("rating"),
    title: form.get("title") || "",
    body: form.get("body"),
  });
  if (!parsed.success)
    return data({ error: "Review details are invalid." }, { status: 400 });
  const product = await db.productRef.findFirst({
    where: { shopId: shop.id, shopifyProductId: parsed.data.productId },
    select: { shopifyProductId: true },
  });
  if (!product)
    return data({ error: "Product not found for this shop." }, { status: 404 });
  const duplicateSince = new Date(Date.now() - 60 * 60 * 1000);
  const duplicate = await db.review.findFirst({
    where: {
      shopId: shop.id,
      shopifyProductId: product.shopifyProductId,
      reviewerName: parsed.data.name,
      submittedAt: { gte: duplicateSince },
      ...(parsed.data.email ? { reviewerEmail: parsed.data.email } : {}),
    },
    select: { id: true },
  });
  if (duplicate)
    return data(
      { error: "A recent review from you was already received." },
      { status: 409 },
    );
  const config = await db.widgetConfig.findUnique({
    where: { shopId: shop.id },
    select: { settings: true },
  });
  const stored =
    config?.settings &&
    typeof config.settings === "object" &&
    !Array.isArray(config.settings)
      ? (config.settings as {
          general?: { moderationMode?: string };
          moderationMode?: string;
        })
      : {};
  const settings = stored.general || stored;
  const autoPublish = settings.moderationMode === "auto";
  await db.review.create({
    data: {
      shopId: shop.id,
      shopifyProductId: product.shopifyProductId,
      reviewerName: parsed.data.name,
      reviewerEmail: parsed.data.email || null,
      rating: parsed.data.rating,
      title: parsed.data.title || null,
      body: parsed.data.body,
      status: autoPublish ? "published" : "pending",
      publishedAt: autoPublish ? new Date() : null,
      verified: false,
      verificationSource: "none",
      source: "native",
    },
  });
  return data(
    { success: true, status: autoPublish ? "published" : "pending" },
    { status: 201 },
  );
}
