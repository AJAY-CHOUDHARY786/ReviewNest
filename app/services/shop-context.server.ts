import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function getAuthenticatedShop(request: Request) {
  const { session } = await authenticate.admin(request);
  return db.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop },
    update: {},
  });
}
