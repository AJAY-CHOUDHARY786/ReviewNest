import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import db from "../db.server";
import { getAuthenticatedShop } from "../services/shop-context.server";
import "../styles/reviewnest.css";

const settingsSchema = z.object({
  moderationMode: z.enum(["manual", "auto"], {
    error: "Choose a moderation mode.",
  }),
  requestDelayDays: z.coerce.number().int().min(1).max(90),
  reviewsPerPage: z.coerce.number().int().min(1).max(50),
  defaultSort: z.enum(["newest", "highest", "lowest"]),
});
type AppSettings = z.infer<typeof settingsSchema>;
const defaults: AppSettings = {
  moderationMode: "manual",
  requestDelayDays: 7,
  reviewsPerPage: 10,
  defaultSort: "newest",
};
function asSettings(value: unknown): Partial<AppSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const scoped =
    record.general && typeof record.general === "object"
      ? record.general
      : record;
  return scoped as Partial<AppSettings>;
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
  const privacyExports = await db.privacyExport.findMany({
    where: { shopId: shop.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, createdAt: true, expiresAt: true },
  });
  return {
    settings: { ...defaults, ...asSettings(record.general) },
    updatedAt: config?.updatedAt ?? null,
    privacyExports,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const form = await request.formData();
  const intent = form.get("intent");
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
  if (intent === "reset") {
    await db.widgetConfig.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, settings: { general: defaults } },
      update: { settings: { ...record, general: defaults } },
    });
    return { saved: "reset" as const };
  }
  if (intent !== "save")
    return data({ error: "Unknown settings action." }, { status: 400 });
  const submitted = Object.fromEntries(form);
  const parsed = settingsSchema.safeParse({
    ...submitted,
  });
  if (!parsed.success)
    return data(
      { error: "Settings are invalid. Check the values and try again." },
      { status: 400 },
    );
  await db.widgetConfig.upsert({
    where: { shopId: shop.id },
    create: { shopId: shop.id, settings: { general: parsed.data } },
    update: { settings: { ...record, general: parsed.data } },
  });
  return { saved: "settings" as const };
}

export default function SettingsPage() {
  const { settings, updatedAt, privacyExports } =
    useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <s-page heading="Settings">
      <s-section heading="Review behavior">
        <Form method="post" className="rn-form">
          <input type="hidden" name="intent" value="save" />
          <label>
            Moderation
            <select
              name="moderationMode"
              defaultValue={settings.moderationMode}
            >
              <option value="manual">Approve reviews manually</option>
              <option value="auto">Publish automatically</option>
            </select>
          </label>
          <label>
            Review request delay (days)
            <input
              type="number"
              name="requestDelayDays"
              min="1"
              max="90"
              defaultValue={settings.requestDelayDays}
            />
          </label>
          <label>
            Reviews per page
            <input
              type="number"
              name="reviewsPerPage"
              min="1"
              max="50"
              defaultValue={settings.reviewsPerPage}
            />
          </label>
          <label>
            Default review sort
            <select name="defaultSort" defaultValue={settings.defaultSort}>
              <option value="newest">Newest first</option>
              <option value="highest">Highest rating</option>
              <option value="lowest">Lowest rating</option>
            </select>
          </label>
          <s-button type="submit">Save settings</s-button>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="reset" />
          <button type="submit">Reset defaults</button>
        </Form>
        {result && "saved" in result && (
          <s-banner tone="success">
            {result.saved === "reset"
              ? "Defaults restored."
              : "Settings saved."}
          </s-banner>
        )}
        {result && "error" in result && (
          <s-banner tone="critical">{result.error}</s-banner>
        )}
        {updatedAt && (
          <s-paragraph>Last saved {updatedAt.toLocaleString()}</s-paragraph>
        )}
      </s-section>
      <s-section heading="Privacy and data handling">
        <s-paragraph>
          Customer data is scoped to each shop. Reviewer email is optional in
          the review form; encryption at rest and configurable retention are not
          implemented yet.
        </s-paragraph>
        <s-paragraph>
          Shop redaction deletes the shop and its related records. Customer
          redaction removes matching reviewer details.
        </s-paragraph>
        <s-heading>Customer data exports</s-heading>
        {privacyExports.length ? (
          privacyExports.map((exportItem) => (
            <s-paragraph key={exportItem.id}>
              Created {exportItem.createdAt.toLocaleString()} · expires{" "}
              {exportItem.expiresAt.toLocaleDateString()} ·{" "}
              <a
                href={`/app/privacy-exports/${encodeURIComponent(exportItem.id)}`}
              >
                Download export
              </a>
            </s-paragraph>
          ))
        ) : (
          <s-paragraph>No privacy exports are currently available.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
