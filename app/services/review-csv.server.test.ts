import { describe, expect, it } from "vitest";
import { previewReviewCsv } from "./review-csv.server";

describe("previewReviewCsv", () => {
  it("maps common headers and parses quoted commas", () => {
    const result = previewReviewCsv(
      'Product Handle,Rating,Reviewer Name,Review Title,Review Body,Reviewer Email\nshirt,5,Ada,Great,"Soft, durable fabric",ada@example.test',
    );
    expect(result.rows[0]).toMatchObject({
      valid: true,
      values: {
        product: "shirt",
        rating: 5,
        name: "Ada",
        body: "Soft, durable fabric",
      },
    });
  });

  it("flags invalid ratings and repeated source ids", () => {
    const result = previewReviewCsv(
      "product,rating,name,body,id\nshoe,8,Sam,Good,id-1\nshoe,5,Sam,Good,id-1",
    );
    expect(result.rows[0]?.valid).toBe(false);
    expect(result.rows[1]?.duplicate).toBe(true);
  });

  it("reports missing required columns", () => {
    const result = previewReviewCsv("rating,name\n5,Sam");
    expect(result.rows[0]?.errors.join(" ")).toContain("Missing product");
    expect(result.rows[0]?.errors.join(" ")).toContain("Missing review text");
  });

  it("preserves source review date and verified value", () => {
    const result = previewReviewCsv(
      "product,rating,name,body,date,verified\nshoe,5,Sam,Great,2024-06-01,yes",
    );
    expect(result.rows[0]).toMatchObject({
      valid: true,
      values: {
        submittedAt: "2024-06-01",
        verified: true,
      },
    });
  });
});
