import { describe, expect, it } from "vitest";
import {
  reviewSubmissionSchema,
  reviewWhereForShop,
} from "./review.validation";

describe("reviewSubmissionSchema", () => {
  it("accepts valid review input and normalizes text", () => {
    const result = reviewSubmissionSchema.parse({
      productId: "gid://shopify/Product/123",
      name: "  Alex  ",
      email: "alex@example.test",
      rating: "5",
      title: "  Great  ",
      body: "  Works well  ",
    });

    expect(result).toMatchObject({
      name: "Alex",
      rating: 5,
      title: "Great",
      body: "Works well",
    });
  });

  it("rejects ratings outside the supported range", () => {
    expect(() =>
      reviewSubmissionSchema.parse({
        productId: "123",
        name: "Alex",
        rating: 6,
        body: "Review text",
      }),
    ).toThrow();
  });
});

describe("reviewWhereForShop", () => {
  it("always scopes review lookups to the authenticated shop", () => {
    expect(reviewWhereForShop("shop-a.myshopify.com")).toEqual({
      shopId: "shop-a.myshopify.com",
    });
  });
});
