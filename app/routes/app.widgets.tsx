import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import db from "../db.server";
import { getAuthenticatedShop } from "../services/shop-context.server";
import "../styles/reviewnest.css";

const widgetSchema = z.object({
  heading: z.string().trim().max(100),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  reviewsPerPage: z.coerce.number().int().min(1).max(50),
  showVerifiedBadge: z
    .enum(["yes", "no"])
    .transform((value) => value === "yes"),
  showPhotos: z.enum(["yes", "no"]).transform((value) => value === "yes"),
});

type WidgetSettings = z.infer<typeof widgetSchema>;
const defaults: WidgetSettings = {
  heading: "Customer reviews",
  accentColor: "#176B5B",
  reviewsPerPage: 10,
  showVerifiedBadge: true,
  showPhotos: true,
};
function asSettings(value: unknown): Partial<WidgetSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const scoped =
    record.widget && typeof record.widget === "object" ? record.widget : record;
  return scoped as Partial<WidgetSettings>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const config = await db.widgetConfig.findUnique({
    where: { shopId: shop.id },
    select: { settings: true, updatedAt: true },
  });
  const record =
    config?.settings &&
    typeof config.settings === "object" &&
    !Array.isArray(config.settings)
      ? (config.settings as Record<string, unknown>)
      : {};
  const settings = asSettings(record.widget);
  return {
    settings: { ...defaults, ...settings },
    updatedAt: config?.updatedAt ?? null,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const form = await request.formData();
  const parsed = widgetSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return data(
      { error: "Check the widget values and try again." },
      { status: 400 },
    );
  const current = await db.widgetConfig.findUnique({
    where: { shopId: shop.id },
    select: { settings: true },
  });
  const record =
    current?.settings &&
    typeof current.settings === "object" &&
    !Array.isArray(current.settings)
      ? (current.settings as Record<string, unknown>)
      : {};
  await db.widgetConfig.upsert({
    where: { shopId: shop.id },
    create: { shopId: shop.id, settings: { widget: parsed.data } },
    update: { settings: { ...record, widget: parsed.data } },
  });
  return { saved: true };
}

export default function WidgetsPage() {
  const { settings, updatedAt } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <s-page heading="Widgets">
      <s-section heading="Review display settings">
        <Form method="post" className="rn-form">
          <label>
            Widget heading
            <input
              name="heading"
              defaultValue={settings.heading}
              maxLength={100}
            />
          </label>
          <label>
            Accent color
            <input
              name="accentColor"
              type="color"
              defaultValue={settings.accentColor}
            />
          </label>
          <label>
            Reviews per page
            <select
              name="reviewsPerPage"
              defaultValue={settings.reviewsPerPage}
            >
              {[5, 10, 15, 20, 30, 50].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Show verified badge
            <select
              name="showVerifiedBadge"
              defaultValue={settings.showVerifiedBadge ? "yes" : "no"}
            >
              <option value="yes">Show</option>
              <option value="no">Hide</option>
            </select>
          </label>
          <label>
            Show review photos
            <select
              name="showPhotos"
              defaultValue={settings.showPhotos ? "yes" : "no"}
            >
              <option value="yes">Show</option>
              <option value="no">Hide</option>
            </select>
          </label>
          <s-button type="submit">Save widget settings</s-button>
        </Form>
        {result && "saved" in result && (
          <s-banner tone="success">Widget settings saved.</s-banner>
        )}
        {result && "error" in result && (
          <s-banner tone="critical">{result.error}</s-banner>
        )}
        {updatedAt && (
          <s-paragraph>Last saved {updatedAt.toLocaleString()}</s-paragraph>
        )}
      </s-section>
      <s-section heading="Storefront installation">
        <s-paragraph>
          Add the ReviewNest blocks through Online Store → Themes → Customize;
          app blocks are not inserted automatically.
        </s-paragraph>
        <s-banner tone="warning">
          Settings are saved. The App Proxy and theme extension still need to be
          configured and deployed to your Shopify development store.
        </s-banner>
      </s-section>
    </s-page>
  );
}
