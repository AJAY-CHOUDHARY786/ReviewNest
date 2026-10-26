import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { z } from "zod";
import db from "../db.server";
import { getAuthenticatedShop } from "../services/shop-context.server";
import "../styles/reviewnest.css";

const toggleSchema = z.enum(["pause", "enable"]);

type RequestSettings = { reviewRequestsEnabled?: boolean; delayDays?: number };
function settingsFrom(value: unknown): RequestSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const scoped =
    record.requests && typeof record.requests === "object"
      ? record.requests
      : record;
  return scoped as RequestSettings;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const [config, counts, recent, events] = await Promise.all([
    db.widgetConfig.findUnique({
      where: { shopId: shop.id },
      select: { settings: true },
    }),
    db.reviewRequest.groupBy({
      by: ["status"],
      where: { shopId: shop.id },
      _count: { _all: true },
    }),
    db.reviewRequest.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        orderId: true,
        status: true,
        dueAt: true,
        sentAt: true,
        createdAt: true,
      },
    }),
    db.emailEvent.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, createdAt: true },
    }),
  ]);
  const configRecord =
    config?.settings &&
    typeof config.settings === "object" &&
    !Array.isArray(config.settings)
      ? (config.settings as Record<string, unknown>)
      : {};
  return {
    settings: settingsFrom(configRecord.requests),
    counts,
    recent,
    events,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const shop = await getAuthenticatedShop(request);
  const form = await request.formData();
  const parsed = toggleSchema.safeParse(form.get("intent"));
  if (!parsed.success)
    return data({ error: "Invalid review request setting." }, { status: 400 });
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
  const settings = settingsFrom(record.requests);
  await db.widgetConfig.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      settings: {
        ...record,
        requests: {
          ...settings,
          reviewRequestsEnabled: parsed.data === "enable",
        },
      },
    },
    update: {
      settings: {
        ...record,
        requests: {
          ...settings,
          reviewRequestsEnabled: parsed.data === "enable",
        },
      },
    },
  });
  return { saved: true };
}

export default function ReviewRequestsPage() {
  const { settings, counts, recent, events } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const enabled = settings.reviewRequestsEnabled === true;
  return (
    <s-page heading="Review requests">
      <s-section heading="Request automation">
        <s-paragraph>
          Sending requires a verified fulfillment webhook, a configured email
          provider, and a running worker. This switch records your intended
          setting; it does not send emails yet.
        </s-paragraph>
        <s-paragraph>Automation: {enabled ? "Enabled" : "Paused"}</s-paragraph>
        {result && "saved" in result && (
          <s-banner tone="success">Request setting saved.</s-banner>
        )}
        {result && "error" in result && (
          <s-banner tone="critical">{result.error}</s-banner>
        )}
        <Form method="post">
          <button name="intent" value={enabled ? "pause" : "enable"}>
            {enabled ? "Pause requests" : "Enable requests"}
          </button>
        </Form>
      </s-section>
      <s-section heading="Request status">
        {counts.length ? (
          counts.map((item) => (
            <s-paragraph key={item.status}>
              {item.status}: {item._count._all}
            </s-paragraph>
          ))
        ) : (
          <s-paragraph>No review requests have been recorded.</s-paragraph>
        )}
      </s-section>
      <s-section heading="Recent requests">
        {recent.length ? (
          <div className="rn-table-wrap">
            <table className="rn-table">
              <thead>
                <tr>
                  <th>Order reference</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((item) => (
                  <tr key={item.id}>
                    <td>{item.orderId}</td>
                    <td>{item.status}</td>
                    <td>{item.dueAt.toLocaleString()}</td>
                    <td>{item.sentAt?.toLocaleString() || "Not sent"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <s-paragraph>
            The queue is empty. Requests will appear when the fulfillment worker
            is implemented and active.
          </s-paragraph>
        )}
      </s-section>
      <s-section heading="Email delivery events">
        {events.length ? (
          events.map((event) => (
            <s-paragraph key={event.id}>
              {event.status} · {event.createdAt.toLocaleString()}
            </s-paragraph>
          ))
        ) : (
          <s-paragraph>No email events recorded.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
