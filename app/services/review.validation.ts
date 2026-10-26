import { z } from "zod";

export const reviewSubmissionSchema = z.object({
  productId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254).optional().or(z.literal("")),
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(5000),
});

export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

export function reviewWhereForShop(shopId: string) {
  return { shopId } as const;
}
