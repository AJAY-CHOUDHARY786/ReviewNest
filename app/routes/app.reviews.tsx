import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import db from "../db.server";
import { getAuthenticatedShop } from "../services/shop-context.server";
import "../styles/reviewnest.css";

const pageSize = 20;
const allowedStatuses = ["all", "pending", "published", "rejected"] as const;
const reviewActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("approve"), reviewId: z.string().min(1) }),
  z.object({ intent: z.literal("reject"), reviewId: z.string().min(1) }),
  z.object({ intent: z.literal("delete"), reviewId: z.string().min(1) }),
  z.object({
    intent: z.literal("edit"),
    reviewId: z.string().min(1),
    reviewerName: z.string().trim().min(1).max(120),
    title: z.string().trim().max(200),
    body: z.string().trim().min(1).max(5000),
    rating: z.coerce.number().int().min(1).max(5),
  }),
  z.object({
    intent: z.enum(["bulk-approve", "bulk-reject"]),
    reviewIds: z.array(z.string().min(1)).min(1).max(50),
  }),
]);

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const url = new URL(request.url);
  const rawPage = Number(url.searchParams.get("page") || 1);
  const page = Number.isSafeInteger(rawPage) ? Math.max(1, rawPage) : 1;
  const rawStatus = url.searchParams.get("status") || "all";
  const status = allowedStatuses.includes(
    rawStatus as (typeof allowedStatuses)[number],
  )
    ? rawStatus
    : "all";
  const rawRating = url.searchParams.get("rating") || "";
  const rating = /^[1-5]$/.test(rawRating) ? Number(rawRating) : undefined;
  const search = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const where = {
    shopId: shop.id,
    ...(status === "all" ? {} : { status }),
    ...(rating ? { rating } : {}),
    ...(search
      ? {
          OR: [
            {
              reviewerName: { contains: search, mode: "insensitive" as const },
            },
            { title: { contains: search, mode: "insensitive" as const } },
            { body: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [reviews, total] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { product: true, media: true },
    }),
    db.review.count({ where }),
  ]);
  return {
    reviews,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    filters: { search, status, rating: rating || "" },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const form = await request.formData();
  const parsed = reviewActionSchema.safeParse({
    intent: form.get("intent"),
    reviewId: form.get("reviewId"),
    reviewerName: form.get("reviewerName"),
    title: form.get("title"),
    body: form.get("body"),
    rating: form.get("rating"),
    reviewIds: form.getAll("reviewIds"),
  });
  if (!parsed.success)
    return data(
      { error: "Review action or fields are invalid." },
      { status: 400 },
    );
  const input = parsed.data;
  if (input.intent === "delete") {
    const result = await db.review.deleteMany({
      where: { id: input.reviewId, shopId: shop.id },
    });
    if (!result.count)
      return data({ error: "Review not found." }, { status: 404 });
    return redirect("/app/reviews?notice=deleted");
  }
  if (input.intent === "edit") {
    const result = await db.review.updateMany({
      where: { id: input.reviewId, shopId: shop.id },
      data: {
        reviewerName: input.reviewerName,
        title: input.title || null,
        body: input.body,
        rating: input.rating,
      },
    });
    if (!result.count)
      return data({ error: "Review not found." }, { status: 404 });
    await db.moderationEvent.create({
      data: { shopId: shop.id, reviewId: input.reviewId, action: "edited" },
    });
    return redirect("/app/reviews?notice=updated");
  }
  if (input.intent === "approve" || input.intent === "reject") {
    const status = input.intent === "approve" ? "published" : "rejected";
    const result = await db.review.updateMany({
      where: { id: input.reviewId, shopId: shop.id },
      data: { status, publishedAt: status === "published" ? new Date() : null },
    });
    if (!result.count)
      return data({ error: "Review not found." }, { status: 404 });
    await db.moderationEvent.create({
      data: { shopId: shop.id, reviewId: input.reviewId, action: status },
    });
    return redirect(`/app/reviews?notice=${status}`);
  }
  const owned = await db.review.findMany({
    where: { shopId: shop.id, id: { in: input.reviewIds } },
    select: { id: true },
  });
  const ids = owned.map((review) => review.id);
  if (!ids.length)
    return data({ error: "No selected reviews found." }, { status: 404 });
  const status = input.intent === "bulk-approve" ? "published" : "rejected";
  await db.$transaction([
    db.review.updateMany({
      where: { shopId: shop.id, id: { in: ids } },
      data: { status, publishedAt: status === "published" ? new Date() : null },
    }),
    db.moderationEvent.createMany({
      data: ids.map((reviewId) => ({
        shopId: shop.id,
        reviewId,
        action: status,
      })),
    }),
  ]);
  return redirect(`/app/reviews?notice=${status}`);
}

export default function ReviewsPage() {
  const { reviews, total, page, pageCount, filters } =
    useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const toggleSelected = (id: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id),
    );
  const pageUrl = (nextPage: number) => {
    const query = new URLSearchParams({ page: String(nextPage) });
    if (filters.search) query.set("q", filters.search);
    if (filters.status !== "all") query.set("status", filters.status);
    if (filters.rating) query.set("rating", String(filters.rating));
    return `/app/reviews?${query}`;
  };

  return (
    <s-page heading="All reviews">
      <s-section>
        <div className="review-toolbar">
          <strong>{total} reviews</strong>
          <Form method="get" className="review-filters">
            <label>
              Search
              <input
                name="q"
                type="search"
                maxLength={120}
                defaultValue={filters.search}
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={filters.status}>
                {allowedStatuses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rating
              <select name="rating" defaultValue={filters.rating}>
                <option value="">Any rating</option>
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value} stars
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Apply filters</button>
          </Form>
        </div>
        {errorMessage && <p role="alert">{errorMessage}</p>}
        <Form
          method="post"
          id="bulk-review-form"
          onSubmit={(event) => {
            if (!selected.length) {
              event.preventDefault();
              setErrorMessage("Select at least one review first.");
            } else if (
              !window.confirm(`Update ${selected.length} selected reviews?`)
            )
              event.preventDefault();
          }}
        >
          {selected.map((id) => (
            <input key={id} type="hidden" name="reviewIds" value={id} />
          ))}
          <div className="review-bulk-actions">
            <button name="intent" value="bulk-approve">
              Approve selected
            </button>
            <button name="intent" value="bulk-reject">
              Reject selected
            </button>
          </div>
        </Form>
        {reviews.length ? (
          <div className="review-table-wrap">
            <table className="review-table">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Review</th>
                  <th>Product</th>
                  <th>Rating</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(review.id)}
                        onChange={(event) =>
                          toggleSelected(review.id, event.currentTarget.checked)
                        }
                        aria-label={`Select review by ${review.reviewerName}`}
                      />
                    </td>
                    <td>
                      <details>
                        <summary>
                          {review.title || "Untitled review"}
                          <span> by {review.reviewerName}</span>
                        </summary>
                        <p>{review.body}</p>
                        {review.media.map((media) =>
                          media.url ? (
                            <a
                              key={media.id}
                              href={media.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View review image
                            </a>
                          ) : null,
                        )}
                        <Form method="post" className="review-edit-form">
                          <input type="hidden" name="intent" value="edit" />
                          <input
                            type="hidden"
                            name="reviewId"
                            value={review.id}
                          />
                          <label>
                            Name
                            <input
                              name="reviewerName"
                              defaultValue={review.reviewerName}
                              maxLength={120}
                              required
                            />
                          </label>
                          <label>
                            Title
                            <input
                              name="title"
                              defaultValue={review.title || ""}
                              maxLength={200}
                            />
                          </label>
                          <label>
                            Text
                            <textarea
                              name="body"
                              defaultValue={review.body}
                              maxLength={5000}
                              required
                            />
                          </label>
                          <label>
                            Rating
                            <select name="rating" defaultValue={review.rating}>
                              {[5, 4, 3, 2, 1].map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button>Save edits</button>
                        </Form>
                      </details>
                    </td>
                    <td>{review.product?.title || "Unmatched product"}</td>
                    <td aria-label={`${review.rating} stars`}>
                      {"★".repeat(review.rating)}
                    </td>
                    <td>
                      <span className={`review-status status-${review.status}`}>
                        {review.status}
                      </span>
                    </td>
                    <td>
                      <time dateTime={review.submittedAt.toISOString()}>
                        {review.submittedAt.toLocaleDateString()}
                      </time>
                    </td>
                    <td>
                      <div className="review-row-actions">
                        {review.status !== "published" && (
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="approve"
                            />
                            <input
                              type="hidden"
                              name="reviewId"
                              value={review.id}
                            />
                            <button>Approve</button>
                          </Form>
                        )}
                        {review.status !== "rejected" && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="reject" />
                            <input
                              type="hidden"
                              name="reviewId"
                              value={review.id}
                            />
                            <button>Reject</button>
                          </Form>
                        )}
                        <Form
                          method="post"
                          onSubmit={(event) => {
                            if (
                              !window.confirm("Delete this review permanently?")
                            ) {
                              event.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="intent" value="delete" />
                          <input
                            type="hidden"
                            name="reviewId"
                            value={review.id}
                          />
                          <button className="danger-button">Delete</button>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No reviews match these filters.</p>
        )}
        <nav className="review-pagination" aria-label="Review pagination">
          {page > 1 && <a href={pageUrl(page - 1)}>Previous</a>}
          <span>
            Page {page} of {pageCount}
          </span>
          {page < pageCount && <a href={pageUrl(page + 1)}>Next</a>}
        </nav>
      </s-section>
    </s-page>
  );
}
